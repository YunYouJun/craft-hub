import type { ProjectRecord } from './types'
import type { WorkItemSourceRef } from './work-items'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { workItemContainerKey, workItemContainerRefSchema, workItemSourceKey, workItemSourceRefSchema } from './work-items'

/** One exact work item override or a default for its source container. */
export const workItemProjectTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), ref: workItemSourceRefSchema }).strict(),
  z.object({ type: z.literal('container'), ref: workItemContainerRefSchema }).strict(),
])

const projectIdSchema = z.string().trim().min(1).max(256).nullable()
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const associationSchema = z.object({ target: workItemProjectTargetSchema, projectId: projectIdSchema }).strict()
const stateSchema = z.object({ version: z.literal(1), associations: z.array(associationSchema).max(100_000) }).strict()

/** Validated optimistic-concurrency update; null explicitly suppresses an inherited default. */
export const workItemProjectUpdateRequestSchema = z.object({ revision: revisionSchema, target: workItemProjectTargetSchema, projectId: projectIdSchema }).strict()

/** Validated removal; deleting an item override exposes the container default again. */
export const workItemProjectDeleteRequestSchema = z.object({ revision: revisionSchema, target: workItemProjectTargetSchema }).strict()

export type WorkItemProjectTarget = z.infer<typeof workItemProjectTargetSchema>
export type WorkItemProjectAssociation = z.infer<typeof associationSchema>
export type WorkItemProjectUpdateRequest = z.infer<typeof workItemProjectUpdateRequestSchema>
export type WorkItemProjectDeleteRequest = z.infer<typeof workItemProjectDeleteRequestSchema>

/** Fresh host verification of a saved project identifier, without granting trust. */
export type WorkItemProjectResolution
  = | { status: 'unlinked' }
    | { status: 'available', project: Pick<ProjectRecord, 'id' | 'name' | 'trust'> }
    | { status: 'unavailable', reason: 'project-unregistered' | 'invalid-project-path' | 'directory-unavailable', message: string }

/** A saved association enriched with the current host's project availability. */
export interface ResolvedWorkItemProjectAssociation extends WorkItemProjectAssociation {
  resolution: WorkItemProjectResolution
}

/** Revision and associations of the machine-local, versioned binding file. */
export interface WorkItemProjectSnapshot {
  version: 1
  revision: string
  associations: ResolvedWorkItemProjectAssociation[]
}

/** The winning binding for an exact item; unavailable overrides remain visible. */
export interface WorkItemProjectBinding {
  source: 'item' | 'container' | 'none'
  projectId: string | null
  resolution: WorkItemProjectResolution
}

/** A stale revision cannot overwrite associations changed by another client. */
export class WorkItemProjectConflictError extends Error {
  constructor(readonly actualRevision: string) {
    super('Work item project associations changed; reload before saving')
  }
}

/** Actionable local association failures, including preserved invalid state files. */
export class WorkItemProjectError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

type AssociationState = z.infer<typeof stateSchema>
type ProjectCatalog = () => Promise<ProjectRecord[]>
const fileQueues = new Map<string, Promise<unknown>>()

function targetKey(target: WorkItemProjectTarget): string {
  return target.type === 'item' ? `item:${workItemSourceKey(target.ref)}` : `container:${workItemContainerKey(target.ref)}`
}

function revisionFor(state: AssociationState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

function emptyState(): AssociationState {
  return { version: 1, associations: [] }
}

/** Persist source-to-project choices only in the OS data directory; adapters retain business logic. */
export class WorkItemProjectService {
  private readonly path: string

  constructor(dataDir: string, private readonly projects: ProjectCatalog) {
    this.path = join(resolve(dataDir), 'work-item-projects.json')
  }

  /** Read saved choices and recheck project registration and local directory availability. */
  async snapshot(): Promise<WorkItemProjectSnapshot> {
    const [state, projects] = await Promise.all([this.read(), this.projects()])
    return this.snapshotFor(state, projects)
  }

  /** Resolve item overrides ahead of container defaults; explicit null prevents fallback. */
  async resolve(ref: WorkItemSourceRef): Promise<WorkItemProjectBinding> {
    const validated = workItemSourceRefSchema.parse(ref)
    const { associations } = await this.snapshot()
    const item = associations.find(association => targetKey(association.target) === targetKey({ type: 'item', ref: validated }))
    if (item)
      return { source: 'item', projectId: item.projectId, resolution: item.resolution }
    const { itemId: _itemId, ...container } = validated
    const fallback = associations.find(association => targetKey(association.target) === targetKey({ type: 'container', ref: container }))
    if (fallback)
      return { source: 'container', projectId: fallback.projectId, resolution: fallback.resolution }
    return { source: 'none', projectId: null, resolution: { status: 'unlinked' } }
  }

  /** Save a registered, available project or an explicit unlinked override after revision validation. */
  async upsert(request: WorkItemProjectUpdateRequest): Promise<WorkItemProjectSnapshot> {
    const validated = workItemProjectUpdateRequestSchema.parse(request)
    return this.update(validated.revision, async (state, projects) => {
      if (validated.projectId !== null) {
        const resolution = await resolveProject(validated.projectId, projects)
        if (resolution.status === 'unavailable')
          throw new WorkItemProjectError(resolution.reason === 'project-unregistered' ? 404 : 400, resolution.message)
      }
      const key = targetKey(validated.target)
      const index = state.associations.findIndex(association => targetKey(association.target) === key)
      const association = { target: validated.target, projectId: validated.projectId }
      if (index < 0)
        state.associations.push(association)
      else
        state.associations[index] = association
      return state
    })
  }

  /** Remove one saved choice, allowing an item to inherit its container default. */
  async remove(request: WorkItemProjectDeleteRequest): Promise<WorkItemProjectSnapshot> {
    const validated = workItemProjectDeleteRequestSchema.parse(request)
    return this.update(validated.revision, async state => ({
      version: 1,
      associations: state.associations.filter(association => targetKey(association.target) !== targetKey(validated.target)),
    }))
  }

  private async read(): Promise<AssociationState> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return emptyState()
      throw error
    }
    try {
      const state = stateSchema.parse(JSON.parse(text))
      if (new Set(state.associations.map(association => targetKey(association.target))).size !== state.associations.length)
        throw new Error('Duplicate association targets')
      return state
    }
    catch {
      throw new WorkItemProjectError(500, 'Work item project state is invalid or uses an unsupported version; the existing file has been preserved')
    }
  }

  private async snapshotFor(state: AssociationState, projects: ProjectRecord[]): Promise<WorkItemProjectSnapshot> {
    const resolutionCache = new Map<string, Promise<WorkItemProjectResolution>>()
    const associations = await Promise.all(state.associations.map(async (association) => {
      if (association.projectId === null)
        return { ...association, resolution: { status: 'unlinked' as const } }
      let resolution = resolutionCache.get(association.projectId)
      if (!resolution) {
        resolution = resolveProject(association.projectId, projects)
        resolutionCache.set(association.projectId, resolution)
      }
      return { ...association, resolution: await resolution }
    }))
    return { version: 1, revision: revisionFor(state), associations }
  }

  private update(revision: string, apply: (state: AssociationState, projects: ProjectRecord[]) => Promise<AssociationState>): Promise<WorkItemProjectSnapshot> {
    const previous = fileQueues.get(this.path) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const release = await acquireFileLock(this.path)
      try {
        const state = await this.read()
        const actualRevision = revisionFor(state)
        if (revision !== actualRevision)
          throw new WorkItemProjectConflictError(actualRevision)
        const projects = await this.projects()
        const updated = stateSchema.parse(await apply(state, projects))
        if (revisionFor(updated) !== actualRevision)
          await writeAtomic(this.path, updated)
        return this.snapshotFor(updated, projects)
      }
      finally {
        await release()
      }
    })
    fileQueues.set(this.path, operation)
    void operation.finally(() => {
      if (fileQueues.get(this.path) === operation)
        fileQueues.delete(this.path)
    }).catch(() => {})
    return operation
  }
}

async function resolveProject(projectId: string, projects: ProjectRecord[]): Promise<WorkItemProjectResolution> {
  const project = projects.find(project => project.id === projectId)
  if (!project)
    return { status: 'unavailable', reason: 'project-unregistered', message: 'The associated project is no longer registered on this host' }
  if (typeof project.path !== 'string' || !isAbsolute(project.path) || project.path.includes('\0'))
    return { status: 'unavailable', reason: 'invalid-project-path', message: 'The associated project has an invalid local directory path' }
  try {
    const path = await realpath(project.path)
    if (!(await stat(path)).isDirectory())
      throw new Error('Project path is not a directory')
  }
  catch {
    return { status: 'unavailable', reason: 'directory-unavailable', message: 'The associated project directory is unavailable on this host' }
  }
  return { status: 'available', project: { id: project.id, name: project.name, trust: project.trust } }
}

async function acquireFileLock(path: string): Promise<() => Promise<void>> {
  // The persistent sidecar stores no work-item data. SQLite's OS lock is
  // automatically released when a writer exits, including abrupt termination.
  const lockPath = `${path}.lock.sqlite`
  const database = new DatabaseSync(lockPath)
  try {
    await chmod(lockPath, 0o600)
    database.exec('PRAGMA busy_timeout = 2000')
    database.exec('BEGIN IMMEDIATE')
  }
  catch (error) {
    database.close()
    const code = (error as { errcode?: number }).errcode
    if (code !== undefined && [5, 6].includes(code & 0xFF))
      throw new WorkItemProjectError(503, 'Work item project state is locked by another writer; retry after the current write finishes')
    throw error
  }
  return async () => {
    try {
      database.exec('ROLLBACK')
    }
    finally {
      database.close()
    }
  }
}

async function writeAtomic(path: string, state: AssociationState): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
      await file.sync()
    }
    finally {
      await file.close()
    }
    await rename(temporary, path)
  }
  finally {
    await rm(temporary, { force: true })
  }
}
