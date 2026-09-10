import type { CraftHubRuntime } from './runtime'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { projectAccentColors } from './types'
import { WorkspaceSubscriptionError } from './workspace-repository'
import { workspaceSubscriptionSchema } from './workspace-subscriptions'

const id = z.string().regex(/^[\w-]+$/).max(200)
const reference = z.string().refine((value) => {
  if (/^[\w-]+$/.test(value))
    return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
  }
  catch { return false }
}, 'Only portable project identities can be synchronized')
const manifest = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().min(1),
  ownerScopeId: id.optional(),
  icon: z.string().optional(),
  color: z.enum(projectAccentColors).optional(),
  pinned: z.boolean().optional(),
  primaryProject: reference.optional(),
  members: z.array(z.object({ project: reference, label: z.string().optional(), pinned: z.boolean().optional() }).strict()),
}).strict()
const scope = z.object({ id, kind: z.enum(['personal', 'team']), name: z.string().min(1) }).strict()
const snapshot = z.object({
  schemaVersion: z.literal(1),
  workspaces: z.array(manifest),
  workspaceOrder: z.array(id),
  groups: z.array(z.object({ id, name: z.string().min(1), icon: z.string().optional(), ownerScopeId: id.optional() }).strict()),
  workspaceGroups: z.record(z.string(), z.string()),
}).strict()
/** Portable account data only. Credentials, project registrations, bindings and execution trust are excluded. */
export const accountConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  scopes: z.array(z.object({ scope, workspaces: snapshot }).strict()).max(100),
  subscriptions: z.array(workspaceSubscriptionSchema).max(100),
}).strict()
export type AccountConfiguration = z.infer<typeof accountConfigurationSchema>
export interface AccountSyncEnvelope { accountId: string, revision: string, configuration: AccountConfiguration }
/** Trusted host transport owns authentication; credentials never enter the portable document or UI. */
export interface AccountSyncProvider {
  read: () => Promise<Omit<AccountSyncEnvelope, 'configuration'> & { configuration: unknown }>
  write: (configuration: AccountConfiguration, expectedRevision: string) => Promise<Omit<AccountSyncEnvelope, 'configuration'> & { configuration: unknown }>
}
export interface AccountSyncStatus { state: 'disabled' | 'idle' | 'syncing' | 'synced' | 'conflict' | 'error', lastSyncedAt?: string, error?: string }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (key, item) => key === 'lastImportedAt' ? undefined : item)).digest('hex')

/** Synchronize portable account state with optimistic concurrency and recoverable conflict snapshots. */
export class AccountSyncService {
  status: AccountSyncStatus
  private queue: Promise<unknown> = Promise.resolve()
  private readonly statePath: string
  constructor(private readonly runtime: CraftHubRuntime, private readonly provider?: AccountSyncProvider) {
    this.statePath = join(runtime.store.dataDir, 'account-sync-state.json')
    this.status = { state: provider ? 'idle' : 'disabled' }
  }

  /** Recover an interrupted multi-file application before serving configuration requests. */
  async recover(): Promise<void> {
    const path = join(this.runtime.store.dataDir, 'account-sync-recovery.json')
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, 'utf8'))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return
      throw error
    }
    const configuration = accountConfigurationSchema.parse(value)
    validateConfiguration(configuration)
    await this.apply(configuration)
    await rm(path, { force: true })
  }

  /** Export only allowlisted portable data, including multiple Team identities. */
  async snapshot(): Promise<AccountConfiguration> {
    const scopes = []
    for (const scope of await this.runtime.ownerScopes.list()) {
      const workspaces = await this.runtime.workspaces.portableSnapshot(scope.id)
      scopes.push({ scope, workspaces: { ...workspaces, workspaces: workspaces.workspaces.map(workspace => ({ ...workspace, members: workspace.members.map(({ project, label, pinned }) => ({ project, label, pinned })) })) } })
    }
    return accountConfigurationSchema.parse({ schemaVersion: 1, scopes, subscriptions: await this.runtime.workspaceSubscriptions.portableSnapshot() })
  }

  /** Return a content revision suitable for compare-and-swap cloud writes. */
  async envelope(accountId: string): Promise<AccountSyncEnvelope> {
    const configuration = await this.snapshot()
    return { accountId, revision: hash(configuration), configuration }
  }

  /** Serialize cloud mutations and reject stale devices before changing any configuration. */
  async accept(accountId: string, input: unknown, expectedRevision: string): Promise<AccountSyncEnvelope> {
    return this.serialize(async () => {
      const configuration = accountConfigurationSchema.parse(input)
      const before = await this.envelope(accountId)
      if (before.revision !== expectedRevision)
        throw new WorkspaceSubscriptionError(409, 'Cloud configuration changed; synchronize again')
      await this.restore(configuration, before.configuration)
      return this.envelope(accountId)
    })
  }

  /** Automatically merge disjoint changes; preserve both versions and stop on overlapping edits. */
  async synchronize(resolution?: 'use-local' | 'use-cloud'): Promise<AccountSyncStatus> {
    if (!this.provider)
      return this.status
    return this.serialize(async () => {
      this.status = { ...this.status, state: 'syncing', error: undefined }
      try {
        const saved = await this.saved()
        const remote = await this.provider!.read()
        if (saved.accountId && saved.accountId !== remote.accountId)
          throw new Error('Account changed. Use a separate local profile to avoid mixing account data.')
        const local = await this.snapshot()
        const cloud = accountConfigurationSchema.parse(remote.configuration)
        const merged = resolution === 'use-local' ? local : resolution === 'use-cloud' ? cloud : mergeConfigurations(saved.base, local, cloud)
        if (!merged) {
          await this.persist({ ...saved, accountId: remote.accountId, conflict: { local, cloud } })
          this.status = { ...this.status, state: 'conflict', error: 'Both devices changed the same configuration. Export both versions and choose which version to keep.' }
          return this.status
        }
        // Never overwrite a local edit made while the network read was pending.
        const latest = await this.snapshot()
        if (hash(latest) !== hash(local))
          throw new Error('Local configuration changed during synchronization; retrying on the next cycle')
        const result = hash(merged) === hash(cloud) ? remote : await this.provider!.write(merged, remote.revision)
        if (hash(await this.snapshot()) !== hash(local))
          throw new Error('Local configuration changed during upload; preserved for the next synchronization')
        await this.restore(accountConfigurationSchema.parse(result.configuration), local)
        await this.persist({ accountId: remote.accountId, base: result.configuration })
        this.status = { state: 'synced', lastSyncedAt: new Date().toISOString() }
      }
      catch (error) {
        this.status = { ...this.status, state: 'error', error: error instanceof Error ? error.message : String(error) }
      }
      return this.status
    })
  }

  /** Export the saved conflict without exposing authentication material. */
  async conflict(): Promise<unknown> { return (await this.saved()).conflict ?? null }

  private async restore(configuration: AccountConfiguration, before: AccountConfiguration): Promise<void> {
    validateConfiguration(configuration)
    if (hash(configuration) === hash(before))
      return
    // A durable recovery copy survives interrupted multi-file application.
    await this.atomic(join(this.runtime.store.dataDir, 'account-sync-recovery.json'), before)
    try {
      await this.apply(configuration)
      await rm(join(this.runtime.store.dataDir, 'account-sync-recovery.json'), { force: true })
    }
    catch (error) {
      await this.apply(before)
      await rm(join(this.runtime.store.dataDir, 'account-sync-recovery.json'), { force: true })
      throw error
    }
  }

  private async apply(configuration: AccountConfiguration): Promise<void> {
    for (const item of configuration.scopes) {
      if (item.scope.kind === 'team')
        await this.runtime.ownerScopes.ensureTeam(item.scope)
    }
    await this.runtime.workspaceSubscriptions.replacePortableSnapshot(configuration.subscriptions)
    for (const item of configuration.scopes) {
      const previous = await this.runtime.workspaces.portableSnapshot(item.scope.id)
      const workspaces = item.workspaces.workspaces.map(workspace => ({
        ...workspace,
        members: workspace.members.map(member => ({ ...member, discoveryHint: previous.workspaces.find(old => old.id === workspace.id)?.members.find(old => old.project === member.project)?.discoveryHint })),
      }))
      await this.runtime.workspaces.replacePortableSnapshot({ ...item.workspaces, workspaces }, item.scope.id)
    }
    for (const previous of await this.runtime.ownerScopes.list()) {
      if (previous.kind === 'team' && !configuration.scopes.some(item => item.scope.id === previous.id)) {
        await this.runtime.workspaces.replacePortableSnapshot({ schemaVersion: 1, workspaces: [], groups: [], workspaceOrder: [], workspaceGroups: {} }, previous.id)
        await this.runtime.ownerScopes.deleteTeam(previous.id)
      }
    }
  }

  private async saved(): Promise<{ accountId?: string, base?: AccountConfiguration, conflict?: { local: AccountConfiguration, cloud: AccountConfiguration } }> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8'))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {}
      throw error
    }
  }

  private persist(value: unknown): Promise<void> { return this.atomic(this.statePath, value) }
  private async atomic(path: string, value: unknown): Promise<void> {
    await mkdir(this.runtime.store.dataDir, { recursive: true })
    const temp = `${path}.${randomUUID()}.tmp`
    const file = await open(temp, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(value))
      await file.sync()
    }
    finally { await file.close() }
    await rename(temp, path)
    const directory = await open(this.runtime.store.dataDir, 'r')
    try {
      await directory.sync()
    }
    finally { await directory.close() }
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(() => this.runtime.withConfiguration(action))
    this.queue = next
    return next
  }
}

function validateConfiguration(configuration: AccountConfiguration): void {
  const scopes = configuration.scopes.map(item => item.scope.id)
  if (new Set(scopes).size !== scopes.length || !configuration.scopes.some(item => item.scope.id === 'personal' && item.scope.kind === 'personal'))
    throw new Error('Invalid account owner scopes')
  const workspaceIds = configuration.scopes.flatMap(item => item.workspaces.workspaces.map(workspace => workspace.id))
  const groupIds = configuration.scopes.flatMap(item => item.workspaces.groups.map(group => group.id))
  if (new Set(workspaceIds).size !== workspaceIds.length || new Set(groupIds).size !== groupIds.length)
    throw new Error('Duplicate account workspace or group identities')
  for (const item of configuration.scopes) {
    if (item.scope.kind === 'personal' && item.scope.id !== 'personal')
      throw new Error('Invalid Personal identity')
    for (const workspace of item.workspaces.workspaces) {
      if ((workspace.ownerScopeId ?? 'personal') !== item.scope.id)
        throw new Error('Workspace owner scope mismatch')
    }
  }
  for (const subscription of configuration.subscriptions) {
    if (subscription.ownerScopeId && !scopes.includes(subscription.ownerScopeId))
      throw new Error('Subscription Team is missing')
  }
}

/** Three-way merge by stable scope and subscription identities, preserving explicit deletions. */
export function mergeConfigurations(base: AccountConfiguration | undefined, local: AccountConfiguration, cloud: AccountConfiguration): AccountConfiguration | undefined {
  function merge<T>(before: T[], left: T[], right: T[], key: (item: T) => string): T[] | undefined {
    const b = new Map(before.map(item => [key(item), item]))
    const l = new Map(left.map(item => [key(item), item]))
    const r = new Map(right.map(item => [key(item), item]))
    const result: T[] = []
    for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
      const bv = b.get(id)
      const lv = l.get(id)
      const rv = r.get(id)
      const chosen = hash(lv ?? null) === hash(rv ?? null) ? lv : hash(lv ?? null) === hash(bv ?? null) ? rv : hash(rv ?? null) === hash(bv ?? null) ? lv : undefined
      if (chosen === undefined && lv !== undefined && rv !== undefined)
        return undefined
      if (chosen === undefined && hash(lv ?? null) !== hash(bv ?? null) && hash(rv ?? null) !== hash(bv ?? null) && hash(lv ?? null) !== hash(rv ?? null))
        return undefined
      if (chosen !== undefined)
        result.push(chosen)
    }
    return result
  }
  // An empty initial Personal scope is absence, so a new device can download its account.
  const compact = (items: AccountConfiguration['scopes']): AccountConfiguration['scopes'] => items.filter(item => item.scope.id !== 'personal' || item.workspaces.workspaces.length || item.workspaces.groups.length)
  const scopes = merge(compact(base?.scopes ?? []), compact(local.scopes), compact(cloud.scopes), item => item.scope.id)
  const subscriptions = merge(base?.subscriptions ?? [], local.subscriptions, cloud.subscriptions, item => item.id)
  if (!scopes || !subscriptions)
    return undefined
  if (!scopes.some(item => item.scope.id === 'personal'))
    scopes.unshift(local.scopes.find(item => item.scope.id === 'personal')!)
  return { schemaVersion: 1, scopes, subscriptions }
}
