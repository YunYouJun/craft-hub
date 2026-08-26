import type { ProjectAccentColor } from './types'
import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const projectConfigTargetPath = '.craft-hub/project.yaml' as const

export type LocalizedText = string | Record<string, string | undefined>

export interface ProjectConfig {
  version: 1
  project?: { name?: string, icon?: string, color?: ProjectAccentColor }
  defaults?: { agent?: string }
  capabilities?: { hidden?: string[], descriptions?: Record<string, LocalizedText> }
}

export interface ProjectConfigInitialization {
  targetPath: typeof projectConfigTargetPath
  path: string
  content: string
  revision: string
  exists: boolean
  created?: boolean
}

/** Load optional project-owned metadata without requiring configuration. */
export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig | undefined> {
  const content = await readProjectConfigSource(projectPath)
  if (content === undefined)
    return undefined
  return parseProjectConfig(content)
}

/** Preview the exact file content used to initialize optional project metadata. */
export async function previewProjectConfigInitialization(projectPath: string, projectName: string): Promise<ProjectConfigInitialization> {
  const path = resolve(projectPath, projectConfigTargetPath)
  const current = await readProjectConfigSource(projectPath)
  if (current !== undefined) {
    parseProjectConfig(current)
    return {
      targetPath: projectConfigTargetPath,
      path,
      content: current,
      revision: configRevision(current),
      exists: true,
    }
  }
  const content = stringifyYaml({
    version: 1,
    project: { name: projectName },
    capabilities: { hidden: [], descriptions: {} },
  }, { lineWidth: 0 })
  return {
    targetPath: projectConfigTargetPath,
    path,
    content,
    revision: configRevision(''),
    exists: false,
  }
}

/** Create the previewed project configuration if its target revision is unchanged. */
export async function applyProjectConfigInitialization(projectPath: string, projectName: string, expectedRevision: string): Promise<ProjectConfigInitialization> {
  const preview = await previewProjectConfigInitialization(projectPath, projectName)
  if (preview.revision !== expectedRevision)
    throw new Error('Project config changed after preview. Preview it again before applying.')
  if (preview.exists)
    return { ...preview, created: false }

  const temporary = `${preview.path}.${randomUUID()}.tmp`
  await mkdir(dirname(preview.path), { recursive: true })
  await assertInsideProject(projectPath, dirname(preview.path), 'Project config directory')
  await writeFile(temporary, preview.content, 'utf8')
  try {
    await link(temporary, preview.path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('Project config changed after preview. Preview it again before applying.')
    throw error
  }
  finally {
    await rm(temporary, { force: true })
  }
  return { ...preview, exists: true, created: true, revision: configRevision(preview.content) }
}

/** Persist user-selected project visuals in the portable project configuration. */
export async function saveProjectVisual(projectPath: string, visual: { icon?: string, color?: ProjectAccentColor }): Promise<ProjectConfig> {
  const path = resolve(projectPath, '.craft-hub', 'project.yaml')
  const current = await loadProjectConfig(projectPath) ?? { version: 1 as const }
  const project = { ...current.project, icon: visual.icon || undefined, color: visual.color }
  const next: ProjectConfig = { ...current, version: 1, project }
  const temporary = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await assertInsideProject(projectPath, dirname(path), 'Project config directory')
  await writeFile(temporary, stringifyYaml(next, { lineWidth: 0 }), 'utf8')
  await rename(temporary, path)
  return next
}

async function readProjectConfigSource(projectPath: string): Promise<string | undefined> {
  const path = resolve(projectPath, projectConfigTargetPath)
  try {
    await assertInsideProject(projectPath, path, 'Project config')
    return await readFile(path, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

function configRevision(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function parseProjectConfig(content: string): ProjectConfig {
  const config = parseYaml(content) as Omit<ProjectConfig, 'version'> & { version?: number }
  if (config.version !== undefined && config.version !== 1)
    throw new Error(`Unsupported Craft Hub config version: ${String(config.version)}`)
  return { ...config, version: 1 }
}

async function assertInsideProject(projectPath: string, targetPath: string, label: string): Promise<void> {
  const root = await realpath(projectPath)
  const target = await realpath(targetPath)
  const relativePath = relative(root, target)
  if (relativePath.startsWith('..') || isAbsolute(relativePath))
    throw new Error(`${label} must stay inside the project directory`)
}
