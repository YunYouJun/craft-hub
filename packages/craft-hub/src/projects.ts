import type { CraftHubStore } from './store'
import type { ProjectRecord, TrustState } from './types'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { loadProjectConfig } from './config'

function projectId(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16)
}

export class ProjectRegistry {
  constructor(private readonly store: CraftHubStore) {}

  list(): Promise<ProjectRecord[]> {
    return this.store.listProjects()
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
    const project: ProjectRecord = {
      id: projectId(path),
      name: config?.project?.name ?? basename(path),
      path,
      icon: config?.project?.icon,
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
}
