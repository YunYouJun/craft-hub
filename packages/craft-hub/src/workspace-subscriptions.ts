import type { WorkspaceRepositoryProvider } from './workspace-repository'
import type { SubscribedWorkspace, WorkspaceSource } from './workspace-source'
import type { WorkspaceService } from './workspaces'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { readWorkspaceGitRepository, WorkspaceSubscriptionError } from './workspace-repository'
import { readWorkspaceSource, workspaceSourceSchema } from './workspace-source'

const subscriptionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  url: z.string().url(),
  providerId: z.string(),
  repository: z.string(),
  branch: z.string(),
  directory: z.string(),
  sourceId: z.string(),
  name: z.string().max(120).optional(),
  selectedWorkspaceIds: z.array(z.string()),
  lastRevision: z.string(),
  lastImportedAt: z.string(),
  snapshot: workspaceSourceSchema,
}).strict()
const stateSchema = z.object({ schemaVersion: z.literal(1), version: z.string(), subscriptions: z.array(subscriptionSchema).max(100) }).strict()
export type WorkspaceSubscription = z.infer<typeof subscriptionSchema>
type State = z.infer<typeof stateSchema>

/** Preview token includes both remote content and the current local subscription state. */
export interface WorkspaceSubscriptionPreview {
  revision: string
  subscription: Omit<WorkspaceSubscription, 'snapshot'>
  workspaces: WorkspaceSource['workspaces']
  removedWorkspaceIds: string[]
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const publicSubscription = ({ snapshot: _snapshot, ...subscription }: WorkspaceSubscription): Omit<WorkspaceSubscription, 'snapshot'> & { sourceRevision: string } => ({ ...subscription, sourceRevision: digest([subscription.id, subscription.url, subscription.name]) })

/** Persist subscriptions as an atomic snapshot; discovery never materializes editable project configuration. */
export class WorkspaceSubscriptionService {
  private readonly path: string
  private queue: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string, private readonly workspaces: WorkspaceService, private readonly providers: WorkspaceRepositoryProvider[]) {
    this.path = join(dataDir, 'workspace-subscriptions.json')
    if (new Set(providers.map(provider => provider.id)).size !== providers.length)
      throw new Error('Duplicate workspace repository provider id')
  }

  /** List cached subscription metadata without contacting repositories. */
  async list(): Promise<Omit<WorkspaceSubscription, 'snapshot'>[]> {
    return (await this.read()).subscriptions.map(publicSubscription)
  }

  /** Render all selected workspaces from the last valid applied state, including while offline. */
  async projectedWorkspaces(): Promise<SubscribedWorkspace[]> {
    return (await this.read()).subscriptions.flatMap(subscription => subscription.snapshot.workspaces
      .filter(workspace => subscription.selectedWorkspaceIds.includes(workspace.id))
      .map(workspace => ({ ...workspace, id: this.workspaceId(subscription.id, workspace.id), subscription: { id: subscription.id, sourceId: subscription.sourceId, workspaceId: workspace.id, sourceName: subscription.name || subscription.snapshot.name, revision: subscription.lastRevision } })))
  }

  /** Save a named source for later selection without applying its workspaces. */
  async configure(input: { url: string, name: string, id?: string, expectedSourceRevision?: string }): Promise<ReturnType<typeof publicSubscription>> {
    return this.serialize(async () => {
      const current = input.id ? this.find(await this.read(), input.id) : undefined
      if (current && publicSubscription(current).sourceRevision !== input.expectedSourceRevision)
        throw new WorkspaceSubscriptionError(409, 'Source settings changed. Reload before editing.')
      if (current && current.url !== input.url)
        throw new WorkspaceSubscriptionError(409, 'Add a new source to change its repository location; existing workspaces are preserved.')
      if (!input.name.trim() || input.name.length > 120)
        throw new WorkspaceSubscriptionError(400, 'A source name of at most 120 characters is required')
      const { state, next } = await this.prepare(input.url, input.id)
      const saved = current ? { ...current, name: input.name.trim() } : { ...next, name: input.name.trim(), selectedWorkspaceIds: [], lastImportedAt: '' }
      if (!current && state.subscriptions.some(item => item.id === next.id))
        throw new WorkspaceSubscriptionError(409, 'This source is already saved')
      state.subscriptions = state.subscriptions.some(item => item.id === saved.id) ? state.subscriptions.map(item => item.id === saved.id ? saved : item) : [...state.subscriptions, saved]
      await this.write(state)
      return publicSubscription(saved)
    })
  }

  /** Preview a fresh immutable remote revision and report workspaces removed upstream. */
  async preview(url?: string, id?: string): Promise<WorkspaceSubscriptionPreview> {
    const { state, next } = await this.prepare(url, id)
    return this.toPreview(state, next)
  }

  /** Validate every selected workspace, then atomically replace only this subscription's snapshot. */
  async apply(input: { url?: string, id?: string, expectedRevision: string, selectedWorkspaceIds?: string[] }): Promise<WorkspaceSubscriptionPreview> {
    return this.serialize(async () => {
      const { state, next } = await this.prepare(input.url, input.id)
      const preview = this.toPreview(state, next)
      if (preview.revision !== input.expectedRevision)
        throw new WorkspaceSubscriptionError(409, 'The source or subscriptions changed. Preview again before applying.')
      const selected = input.selectedWorkspaceIds ?? next.selectedWorkspaceIds
      if ((!selected.length && next.snapshot.workspaces.length > 0) || new Set(selected).size !== selected.length || selected.some(id => !next.snapshot.workspaces.some(workspace => workspace.id === id)))
        throw new WorkspaceSubscriptionError(400, 'Select unique workspaces present in this source')
      next.selectedWorkspaceIds = selected
      await this.workspaces.assertSubscriptionIdsAvailable(selected.map(id => this.workspaceId(next.id, id)))
      if (state.subscriptions.length >= 100 && !state.subscriptions.some(item => item.id === next.id))
        throw new WorkspaceSubscriptionError(400, 'At most 100 subscriptions are supported')
      state.subscriptions = state.subscriptions.some(item => item.id === next.id) ? state.subscriptions.map(item => item.id === next.id ? next : item) : [...state.subscriptions, next]
      await this.write(state)
      return { ...preview, subscription: publicSubscription(next) }
    })
  }

  /** Export the last applied portable snapshot without network access or local paths. */
  async export(id: string): Promise<WorkspaceSubscription> {
    return this.find(await this.read(), id)
  }

  /** Stop tracking this source; never remove a checkout, local binding, or independent workspace. */
  async remove(id: string): Promise<void> {
    await this.serialize(async () => {
      const state = await this.read()
      this.find(state, id)
      state.subscriptions = state.subscriptions.filter(item => item.id !== id)
      await this.write(state)
    })
  }

  /** Copy one selected source workspace into an independent, editable Personal workspace. */
  async copy(id: string, sourceWorkspaceId: string): Promise<Awaited<ReturnType<WorkspaceService['save']>>> {
    return this.serialize(async () => {
      const subscription = this.find(await this.read(), id)
      const workspace = subscription.snapshot.workspaces.find(item => item.id === sourceWorkspaceId && subscription.selectedWorkspaceIds.includes(item.id))
      if (!workspace)
        throw new WorkspaceSubscriptionError(404, 'Subscribed workspace not found')
      return this.workspaces.save({ manifest: { ...workspace, id: `copy-${randomUUID()}`, name: `${workspace.name} (copy)` } })
    })
  }

  private async prepare(url?: string, id?: string): Promise<{ state: State, next: WorkspaceSubscription }> {
    const state = await this.read()
    const existing = id ? this.find(state, id) : state.subscriptions.find(item => item.url === url)
    const target = existing?.url ?? url
    if (!target || target.length > 2048)
      throw new WorkspaceSubscriptionError(400, 'Configuration URL is required')
    const provider = existing ? this.providers.find(item => item.id === existing.providerId) : this.providers.find(item => item.accepts(target))
    if (!provider || !provider.accepts(target))
      throw new WorkspaceSubscriptionError(400, 'No repository reader is configured for this source')
    const remote = await provider.read(target, { readGit: readWorkspaceGitRepository })
    const snapshot = readWorkspaceSource(remote.files)
    if (existing && (existing.sourceId !== snapshot.id || existing.repository !== remote.repository || existing.branch !== remote.branch || existing.directory !== remote.directory))
      throw new WorkspaceSubscriptionError(409, 'Source identity changed. Add it as a new subscription after reviewing the new location.')
    const next: WorkspaceSubscription = {
      id: existing?.id ?? digest([provider.id, remote.repository, remote.branch, remote.directory]).slice(0, 24),
      url: target,
      providerId: provider.id,
      repository: remote.repository,
      branch: remote.branch,
      directory: remote.directory,
      sourceId: snapshot.id,
      snapshot,
      selectedWorkspaceIds: existing?.lastImportedAt ? existing.selectedWorkspaceIds.filter(id => snapshot.workspaces.some(workspace => workspace.id === id)) : snapshot.workspaces.map(workspace => workspace.id),
      lastRevision: remote.revision,
      lastImportedAt: new Date().toISOString(),
    }
    const sameIdentity = state.subscriptions.find(item => item.id === next.id)
    if (!existing && sameIdentity)
      throw new WorkspaceSubscriptionError(409, 'This source is already subscribed using another URL')
    return { state, next }
  }

  private toPreview(state: State, next: WorkspaceSubscription): WorkspaceSubscriptionPreview {
    const previous = state.subscriptions.find(item => item.id === next.id)
    return {
      revision: digest([state.version, next.id, next.url, next.lastRevision, next.snapshot]),
      subscription: publicSubscription(next),
      workspaces: next.snapshot.workspaces,
      removedWorkspaceIds: previous?.snapshot.workspaces.filter(workspace => !next.snapshot.workspaces.some(item => item.id === workspace.id)).map(workspace => workspace.id) ?? [],
    }
  }

  private workspaceId(subscriptionId: string, workspaceId: string): string { return `sub-${subscriptionId}-${digest(workspaceId).slice(0, 12)}` }
  private find(state: State, id: string): WorkspaceSubscription {
    const subscription = state.subscriptions.find(item => item.id === id)
    if (!subscription)
      throw new WorkspaceSubscriptionError(404, 'Subscription not found')
    return subscription
  }

  private async read(): Promise<State> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, version: 'empty', subscriptions: [] }
      throw error
    }
  }

  private async write(state: State): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(stateSchema.parse({ ...state, version: randomUUID() })))
      await file.sync()
    }
    finally { await file.close() }
    try {
      await rename(temporary, this.path)
    }
    finally { await rm(temporary, { force: true }) }
  }

  private async serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const lockPath = `${this.path}.lock`
      let lock
      try {
        lock = await open(lockPath, 'wx', 0o600)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw error
        const pid = Number(await readFile(lockPath, 'utf8'))
        let running = true
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0)
          }
          catch (error) { running = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
        }
        if (running)
          throw new WorkspaceSubscriptionError(409, 'Another subscription update is in progress. Retry after it finishes.')
        // Serialize stale-lock recovery so two restarting runtimes cannot remove each other's new lock.
        const recoveryPath = `${lockPath}.recovery`
        let recovery
        try {
          recovery = await open(recoveryPath, 'wx', 0o600)
        }
        catch { throw new WorkspaceSubscriptionError(409, 'Subscription lock recovery is already in progress. Retry after it finishes.') }
        try {
          if (Number(await readFile(lockPath, 'utf8')) !== pid)
            throw new WorkspaceSubscriptionError(409, 'Subscription lock changed. Retry the update.')
          await rm(lockPath, { force: true })
          lock = await open(lockPath, 'wx', 0o600)
        }
        finally {
          await recovery.close()
          await rm(recoveryPath, { force: true })
        }
      }
      try {
        await lock.writeFile(String(process.pid))
        return await action()
      }
      finally {
        await lock.close()
        await rm(lockPath, { force: true })
      }
    })
    this.queue = next
    return next
  }
}
