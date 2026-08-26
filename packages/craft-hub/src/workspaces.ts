import type { ProjectRegistry } from './projects'
import type { PortableWorkspaceSnapshot, ResolvedWorkspaceMember, WorkspaceCatalog, WorkspaceManifest, WorkspaceRecord, WorkspaceUiState } from './types'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'yaml'
import { projectAccentColors } from './types'

interface WorkspaceBindings {
  schemaVersion: 1
  projects: Record<string, string>
  expandedWorkspaces: string[]
  selectedWorkspace?: string
  selectedProject?: string
}

/** Optimistic input used to save a portable workspace manifest. */
export interface SaveWorkspaceInput {
  manifest: WorkspaceManifest
  revision?: string
}

/** Raised when a workspace changes after the caller read it. */
export class WorkspaceConflictError extends Error {
  constructor(readonly actualRevision: string) {
    super('Workspace changed on disk. Reload it before saving.')
  }
}

/** Manage portable workspace manifests separately from machine-local bindings. */
export class WorkspaceService {
  private readonly bindingsPath: string

  constructor(
    readonly configDir: string,
    dataDir: string,
    private readonly projects: ProjectRegistry,
  ) {
    this.bindingsPath = join(dataDir, 'workspace-bindings.json')
  }

  async list(): Promise<WorkspaceRecord[]> {
    const directory = join(this.configDir, 'workspaces')
    let names: string[] = []
    try {
      names = (await readdir(directory)).filter(name => name.endsWith('.yaml')).sort()
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const records = await Promise.all(names.map(name => this.readFile(join(directory, name))))
    const catalog = await this.catalog()
    const positions = new Map(catalog.workspaceOrder.map((id, index) => [id, index]))
    return records.sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned))
        return left.pinned ? -1 : 1
      return (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        || left.name.localeCompare(right.name)
    })
  }

  async get(id: string): Promise<WorkspaceRecord> {
    assertWorkspaceId(id)
    return this.readFile(this.workspacePath(id))
  }

  async create(name: string): Promise<WorkspaceRecord> {
    const id = slug(name) || randomUUID()
    const existing = await this.list()
    let candidate = id
    let suffix = 2
    while (existing.some(workspace => workspace.id === candidate))
      candidate = `${id}-${suffix++}`
    const record = await this.save({
      manifest: { schemaVersion: 1, id: candidate, name: name.trim(), members: [] },
    })
    await this.saveCatalog({ schemaVersion: 1, workspaceOrder: [...existing.map(item => item.id), candidate] })
    return record
  }

  async save(input: SaveWorkspaceInput): Promise<WorkspaceRecord> {
    validateManifest(input.manifest)
    const path = this.workspacePath(input.manifest.id)
    const current = await readOptional(path)
    const actualRevision = revision(current ?? '')
    if (current !== undefined && input.revision !== actualRevision)
      throw new WorkspaceConflictError(actualRevision)
    if (current === undefined && input.revision)
      throw new WorkspaceConflictError(revision(''))
    await writeAtomic(path, stringify(input.manifest, { lineWidth: 0 }))
    return this.get(input.manifest.id)
  }

  async delete(id: string, expectedRevision: string): Promise<void> {
    const current = await this.get(id)
    if (current.revision !== expectedRevision)
      throw new WorkspaceConflictError(current.revision)
    await rm(this.workspacePath(id))
    const catalog = await this.catalog()
    await this.saveCatalog({ ...catalog, workspaceOrder: catalog.workspaceOrder.filter(item => item !== id) })
  }

  async reorder(workspaceOrder: string[]): Promise<WorkspaceCatalog> {
    const known = new Set((await this.list()).map(workspace => workspace.id))
    if (new Set(workspaceOrder).size !== workspaceOrder.length || workspaceOrder.some(id => !known.has(id)))
      throw new Error('Workspace order must contain unique, known workspace ids')
    const catalog = { schemaVersion: 1 as const, workspaceOrder }
    await this.saveCatalog(catalog)
    return catalog
  }

  /** Export only user-owned workspace manifests and their portable order. */
  async portableSnapshot(): Promise<PortableWorkspaceSnapshot> {
    const workspaces = await this.list()
    const catalog = await this.catalog()
    return {
      schemaVersion: 1,
      workspaces: workspaces.map(portableManifest),
      workspaceOrder: catalog.workspaceOrder.filter(id => workspaces.some(workspace => workspace.id === id)),
    }
  }

  /** Apply one portable manifest while preserving this machine's project bindings and trust. */
  async applyPortableManifest(manifest: WorkspaceManifest): Promise<WorkspaceRecord> {
    validateManifest(manifest)
    try {
      const current = await this.get(manifest.id)
      return this.save({ manifest, revision: current.revision })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return this.save({ manifest })
      throw error
    }
  }

  /** Apply portable ordering without deleting local-only workspaces. */
  async applyPortableOrder(remoteOrder: string[]): Promise<WorkspaceCatalog> {
    const known = (await this.list()).map(workspace => workspace.id)
    const remoteKnown = remoteOrder.filter(id => known.includes(id))
    return this.reorder([...new Set([...remoteKnown, ...known])])
  }

  /** Resolve a portable project key through this machine's bindings without changing trust. */
  async resolveProjectKey(projectKey: string): Promise<string | undefined> {
    const projectId = (await this.bindings()).projects[projectKey]
    if (!projectId)
      return undefined
    return (await this.projects.list()).some(project => project.id === projectId) ? projectId : undefined
  }

  async bind(projectKey: string, projectId: string): Promise<void> {
    await this.projects.get(projectId)
    const bindings = await this.bindings()
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      projects: { ...bindings.projects, [projectKey]: projectId },
    })
  }

  async uiState(): Promise<WorkspaceUiState> {
    const bindings = await this.bindings()
    return {
      expandedWorkspaceIds: bindings.expandedWorkspaces,
      selectedWorkspaceId: bindings.selectedWorkspace,
      selectedProjectId: bindings.selectedProject,
    }
  }

  async updateUiState(state: WorkspaceUiState): Promise<WorkspaceUiState> {
    if (!Array.isArray(state.expandedWorkspaceIds) || !state.expandedWorkspaceIds.every(id => typeof id === 'string'))
      throw new Error('Expanded workspace ids must be an array of strings')
    const bindings = await this.bindings()
    await writeJsonAtomic(this.bindingsPath, {
      ...bindings,
      expandedWorkspaces: [...new Set(state.expandedWorkspaceIds)],
      selectedWorkspace: state.selectedWorkspaceId || undefined,
      selectedProject: state.selectedProjectId || undefined,
    })
    return this.uiState()
  }

  async addProject(workspaceId: string, projectId: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId)
    const key = await this.projectKey(projectId, workspace)
    if (workspace.members.some(member => member.project === key))
      return workspace
    const manifest = portableManifest(workspace)
    manifest.members.push({ project: key })
    manifest.primaryProject ??= key
    return this.save({ manifest, revision: workspace.revision })
  }

  async removeProject(workspaceId: string, projectIdOrKey: string): Promise<WorkspaceRecord> {
    const workspace = await this.get(workspaceId)
    const member = workspace.members.find(item => item.projectId === projectIdOrKey || item.project === projectIdOrKey)
    if (!member)
      return workspace
    const manifest = portableManifest(workspace)
    manifest.members = manifest.members.filter(item => item.project !== member.project)
    if (manifest.primaryProject === member.project)
      manifest.primaryProject = manifest.members[0]?.project
    return this.save({ manifest, revision: workspace.revision })
  }

  async projectKey(projectId: string, workspace?: WorkspaceRecord): Promise<string> {
    const bindings = await this.bindings()
    const existing = Object.entries(bindings.projects).find(([, id]) => id === projectId)?.[0]
    if (existing)
      return existing
    const project = await this.projects.get(projectId)
    const base = slug(project.name) || project.id
    const used = new Set([
      ...Object.keys(bindings.projects),
      ...(workspace?.members.map(member => member.project) ?? []),
    ])
    let key = base
    let suffix = 2
    while (used.has(key))
      key = `${base}-${suffix++}`
    await this.bind(key, projectId)
    return key
  }

  private async readFile(path: string): Promise<WorkspaceRecord> {
    const content = await readFile(path, 'utf8')
    const manifest = parse(content) as WorkspaceManifest
    validateManifest(manifest)
    const bindings = await this.bindings()
    const projects = await this.projects.list()
    const members: ResolvedWorkspaceMember[] = manifest.members.map((member) => {
      const projectId = bindings.projects[member.project]
      return { ...member, projectId, resolved: Boolean(projectId && projects.some(project => project.id === projectId)) }
    })
    return { ...manifest, members, revision: revision(content) }
  }

  private async catalog(): Promise<WorkspaceCatalog> {
    const content = await readOptional(join(this.configDir, 'config.yaml'))
    if (!content)
      return { schemaVersion: 1, workspaceOrder: [] }
    const value = parse(content) as WorkspaceCatalog
    if (value.schemaVersion !== 1 || !Array.isArray(value.workspaceOrder))
      throw new Error('Unsupported Craft Hub config schema')
    return value
  }

  private async saveCatalog(catalog: WorkspaceCatalog): Promise<void> {
    await writeAtomic(join(this.configDir, 'config.yaml'), stringify(catalog, { lineWidth: 0 }))
  }

  private async bindings(): Promise<WorkspaceBindings> {
    try {
      return JSON.parse(await readFile(this.bindingsPath, 'utf8')) as WorkspaceBindings
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, projects: {}, expandedWorkspaces: [] }
      throw error
    }
  }

  private workspacePath(id: string): string {
    assertWorkspaceId(id)
    return join(this.configDir, 'workspaces', `${id}.yaml`)
  }
}

function portableManifest(record: WorkspaceRecord): WorkspaceManifest {
  return {
    schemaVersion: 1,
    id: record.id,
    name: record.name,
    icon: record.icon,
    color: record.color,
    pinned: record.pinned,
    primaryProject: record.primaryProject,
    members: record.members.map(({ project, label, pinned, discoveryHint }) => ({ project, label, pinned, discoveryHint })),
  }
}

function validateManifest(value: WorkspaceManifest): void {
  if (value.schemaVersion !== 1)
    throw new Error('Unsupported workspace schema version')
  assertWorkspaceId(value.id)
  if (!value.name?.trim())
    throw new Error('Workspace name is required')
  if (value.color && !projectAccentColors.includes(value.color))
    throw new Error('Workspace color is invalid')
  if (!Array.isArray(value.members) || value.members.some(member => !member.project))
    throw new Error('Workspace members require project keys')
  if (value.members.some(member => member.label !== undefined && (typeof member.label !== 'string' || !member.label.trim())))
    throw new Error('Workspace member labels must be non-empty strings')
  if (new Set(value.members.map(member => member.project)).size !== value.members.length)
    throw new Error('Workspace members must be unique')
  if (value.primaryProject && !value.members.some(member => member.project === value.primaryProject))
    throw new Error('Primary project must be a workspace member')
}

function assertWorkspaceId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error('Workspace id must contain lowercase letters, numbers, and hyphens')
}

function slug(value: string): string {
  return value.toLowerCase().trim().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '')
}

function revision(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}
