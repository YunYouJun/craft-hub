import type { CraftHubStore } from './store'
import type { ProjectAccentColor, ProjectCatalogDiagnostic, ProjectCatalogSnapshot, ProjectRecord, ProjectVisualInput, TrustState } from './types'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { loadProjectConfig, projectConfigTargetPath, ProjectConfigValidationError, saveProjectVisual } from './config'
import { projectAccentColors } from './types'

const builtinProjectIcons = new Set(['folder', 'hub', 'skill', 'terminal'])

function projectId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16)
}

export class ProjectRegistry {
  constructor(private readonly store: CraftHubStore) {}

  /** Read registered projects while isolating project-local metadata failures. */
  async snapshot(): Promise<ProjectCatalogSnapshot> {
    const projects = await this.store.listProjects()
    const entries = await Promise.all(projects.map(async (project) => {
      try {
        const config = await loadProjectConfig(project.path)
        const visual = await projectVisual(project.path, config?.project?.icon, config?.project?.color)
        return {
          diagnostics: [] as ProjectCatalogDiagnostic[],
          project: {
            ...project,
            name: config?.project?.name ?? basename(project.path),
            ...visual,
          },
        }
      }
      catch (error) {
        return { diagnostics: catalogDiagnostics(project, error), project }
      }
    }))
    const refreshed = entries.map(entry => entry.project)
    const changed = refreshed.some((project, index) => {
      const previous = projects[index]
      return project.name !== previous?.name
        || project.icon !== previous.icon
        || project.iconWarning !== previous.iconWarning
        || project.color !== previous.color
    })
    if (changed)
      await this.store.saveProjects(refreshed)
    return {
      projects: refreshed,
      diagnostics: entries.flatMap(entry => entry.diagnostics),
    }
  }

  /** List registered projects with project-local metadata failures isolated. */
  async list(): Promise<ProjectRecord[]> {
    return (await this.snapshot()).projects
  }

  async add(inputPath: string): Promise<ProjectRecord> {
    const path = await realpath(inputPath)
    if (!(await stat(path)).isDirectory())
      throw new Error(`Project path is not a directory: ${path}`)

    const projects = await this.list()
    const existing = projects.find(project => project.path === path)
    if (existing)
      return existing

    const config = await loadProjectConfig(path)
    const visual = await projectVisual(path, config?.project?.icon, config?.project?.color)
    const project: ProjectRecord = {
      id: projectId(path),
      name: config?.project?.name ?? basename(path),
      path,
      ...visual,
      trust: 'untrusted',
      addedAt: new Date().toISOString(),
    }
    await this.store.saveProjects([...projects, project])
    return project
  }

  async get(id: string): Promise<ProjectRecord> {
    const project = (await this.list()).find(item => item.id === id)
    if (!project)
      throw new Error(`Unknown project: ${id}`)
    return project
  }

  async setTrust(id: string, trust: TrustState): Promise<ProjectRecord> {
    const projects = await this.list()
    const index = projects.findIndex(project => project.id === id)
    if (index < 0)
      throw new Error(`Unknown project: ${id}`)
    const project = { ...projects[index]!, trust }
    projects[index] = project
    await this.store.saveProjects(projects)
    return project
  }

  /** Update portable visual metadata without changing trust or registration state. */
  async setVisual(id: string, visual: ProjectVisualInput): Promise<ProjectRecord> {
    const project = await this.get(id)
    await saveProjectVisual(project.path, visual)
    return this.get(id)
  }

  /** Persist a complete ordering of registered projects. */
  async reorder(projectOrder: string[]): Promise<ProjectRecord[]> {
    const projects = await this.list()
    const known = new Map(projects.map(project => [project.id, project]))
    if (new Set(projectOrder).size !== projectOrder.length || projectOrder.length !== projects.length || projectOrder.some(id => !known.has(id)))
      throw new Error('Project order must contain every registered project exactly once')
    const reordered = projectOrder.map(id => known.get(id)!)
    await this.store.saveProjects(reordered)
    return reordered
  }

  /** Unregister a project without deleting its directory. */
  async remove(id: string): Promise<ProjectRecord> {
    const projects = await this.list()
    const project = projects.find(item => item.id === id)
    if (!project)
      throw new Error(`Unknown project: ${id}`)
    await this.store.saveProjects(projects.filter(item => item.id !== id))
    return project
  }

  /** Resolve a validated repository-local icon path for the local HTTP asset route. */
  async iconPath(id: string): Promise<string | undefined> {
    const project = await this.get(id)
    if (!project.icon || project.icon.startsWith('emoji:') || project.icon.startsWith('builtin:'))
      return undefined
    return validateIconPath(project.path, project.icon)
  }
}

function catalogDiagnostics(project: ProjectRecord, error: unknown): ProjectCatalogDiagnostic[] {
  if (error instanceof ProjectConfigValidationError) {
    return error.diagnostics.map(diagnostic => ({
      ...diagnostic,
      projectId: project.id,
      source: 'project-config',
      targetPath: projectConfigTargetPath,
    }))
  }
  return [{
    projectId: project.id,
    source: 'project',
    targetPath: projectConfigTargetPath,
    path: '/',
    message: error instanceof Error ? error.message : String(error),
  }]
}

async function projectVisual(projectPath: string, icon: unknown, color: unknown): Promise<Pick<ProjectRecord, 'color' | 'icon' | 'iconWarning'>> {
  const visual: Pick<ProjectRecord, 'color' | 'icon' | 'iconWarning'> = {}
  if (typeof color === 'string' && projectAccentColors.includes(color as ProjectAccentColor))
    visual.color = color as ProjectAccentColor
  if (typeof icon !== 'string' || !icon)
    return visual
  if (icon.startsWith('emoji:')) {
    if (icon.slice('emoji:'.length).trim())
      visual.icon = icon
    else
      visual.iconWarning = 'Project emoji icon is empty'
    return visual
  }
  if (icon.startsWith('builtin:')) {
    if (builtinProjectIcons.has(icon.slice('builtin:'.length)))
      visual.icon = icon
    else
      visual.iconWarning = `Unknown built-in project icon: ${icon}`
    return visual
  }
  try {
    await validateIconPath(projectPath, icon)
    visual.icon = icon
  }
  catch (error) {
    visual.iconWarning = error instanceof Error ? error.message : String(error)
  }
  return visual
}

async function validateIconPath(projectPath: string, icon: string): Promise<string> {
  if (isAbsolute(icon))
    throw new Error('Project icon must use a repository-relative path')
  const extension = extname(icon).toLowerCase()
  if (extension !== '.png' && extension !== '.svg')
    throw new Error('Project icon must be an SVG or PNG file')
  const root = await realpath(projectPath)
  const path = await realpath(resolve(root, icon))
  const relativePath = relative(root, path)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error('Project icon must stay inside the project directory')
  if (!(await stat(path)).isFile())
    throw new Error('Project icon path is not a file')
  return path
}
