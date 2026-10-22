import type { SoftwareCatalogManifest } from './software-catalog'
import type { SoftwareSourceRefreshPolicy } from './software-source-refresh'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { z } from 'zod'
import { normalizeRepositoryUrl } from './project-reference'
import { softwareCatalogManifestSchema } from './software-catalog'
import { parseSoftwareCatalogManifest } from './software-catalog-manifest'
import { parseSoftwareConfig, workstationCatalogSource } from './software-config'
import { softwareSourceRefreshDue, softwareSourceRefreshPolicySchema } from './software-source-refresh'
import { readLocalRepositoryCatalogFile, readRepositoryCatalogFile, validateRepositoryCatalogPath } from './workspace-repository'

const idSchema = z.string().regex(/^[a-f0-9]{24}$/)
const modeSchema = z.enum(['remote', 'local'])
const defaultCatalogPath = 'software.config.ts'

export { softwareSourceRefreshPolicySchema } from './software-source-refresh'
export type { SoftwareSourceRefreshPolicy } from './software-source-refresh'

/** A repository identity can have both an online location and one host-local checkout binding. */
export const softwareSourceInputSchema = z.object({
  id: idSchema.optional(),
  repository: z.string().trim().max(2048).optional(),
  localPath: z.string().trim().max(4096).optional(),
  branch: z.string().trim().min(1).max(200).default('HEAD'),
  catalogPath: z.string().trim().min(1).max(256).default(defaultCatalogPath),
  mode: modeSchema,
  refreshPolicy: softwareSourceRefreshPolicySchema.optional(),
}).strict()

/** User-selected source locations, never executable recipes. */
export type SoftwareSourceInput = z.input<typeof softwareSourceInputSchema>

/** Mutations accept source locations or preview tokens, never catalog contents from the browser. */
export const softwareSourceCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preview'), input: softwareSourceInputSchema }).strict(),
  z.object({ operation: z.literal('apply'), previewId: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh'), id: idSchema }).strict(),
  z.object({ operation: z.literal('configure-refresh'), id: idSchema, revision: z.string().min(1).max(128), refreshPolicy: softwareSourceRefreshPolicySchema }).strict(),
  z.object({ operation: z.literal('remove'), id: idSchema, revision: z.string().min(1).max(128) }).strict(),
])

const sourceSchema = softwareSourceInputSchema.extend({
  id: idSchema,
  title: z.string(),
  cache: z.object({
    catalog: softwareCatalogManifestSchema,
    readFrom: modeSchema,
    commit: z.string().regex(/^[a-f0-9]{40,64}$/).optional(),
    savedAt: z.iso.datetime(),
  }).strict(),
  checkedAt: z.iso.datetime(),
  error: z.literal('unavailable').optional(),
}).strict()
type SavedSource = z.infer<typeof sourceSchema>
const stateSchema = z.object({ version: z.literal(1), revision: z.string(), sources: z.array(sourceSchema).max(30) }).strict()
type State = z.infer<typeof stateSchema>

/** Cached source metadata; local paths belong to this host and are never exported to other devices. */
export type SoftwareSource = Omit<SavedSource, 'cache'> & {
  cache: Omit<SavedSource['cache'], 'catalog'> & { revision: string, itemCount: number }
}
/** Listing reads only host persistence, including when repositories are unavailable. */
export interface SoftwareSourceSnapshot { version: 1, revision: string, sources: SoftwareSource[], localAvailable: boolean }
/** A bounded, immutable preview is applied by its token; the client cannot replace its catalog. */
export interface SoftwareSourcePreview { previewId: string, source: SoftwareSource, catalog: SoftwareCatalogManifest, replaces?: string }

/** Controlled source failures, without Git diagnostics or credentials. */
export class SoftwareSourceError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, message: string) { super(message) }
}

/** Repository IO seam used by both the source workflow and isolated tests. */
export interface SoftwareRepositoryReader {
  remote: typeof readRepositoryCatalogFile
  local: typeof readLocalRepositoryCatalogFile
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
const publicSource = ({ cache, ...source }: SavedSource): SoftwareSource => ({ ...source, cache: { readFrom: cache.readFrom, commit: cache.commit, savedAt: cache.savedAt, revision: cache.catalog.revision, itemCount: cache.catalog.items.length } })

function repositoryIdentity(input: string): string {
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('Invalid URL')
    const normalized = normalizeRepositoryUrl(input)
    return url.hostname === 'github.com' ? normalized.toLowerCase() : normalized
  }
  catch { throw new SoftwareSourceError(400, 'Use an HTTPS repository URL without credentials') }
}

/** Preview, bind and refresh repository catalogs while retaining the last valid snapshot. */
export class SoftwareSourceService {
  private readonly path: string
  private readonly previews = new Map<string, { source: SavedSource, revision: string, expiresAt: number }>()
  private queue: Promise<unknown> = Promise.resolve()
  private automaticRefresh?: Promise<boolean>

  constructor(dataDir: string, private readonly localAvailable = true, private readonly reader: SoftwareRepositoryReader = { remote: readRepositoryCatalogFile, local: readLocalRepositoryCatalogFile }) {
    this.path = join(dataDir, 'software-sources.v1.json')
  }

  /** List cache status without reading any online or local repository. */
  async snapshot(): Promise<SoftwareSourceSnapshot> {
    const state = await this.read()
    return { version: 1, revision: state.revision, localAvailable: this.localAvailable, sources: state.sources.map((source) => {
      const visible = publicSource(source)
      if (!this.localAvailable)
        delete visible.localPath
      return visible
    }) }
  }

  /** Read cached catalogs for browsing; no source refresh or command execution is implicit. */
  async catalogs(): Promise<{ source: SoftwareSource, catalog: SoftwareCatalogManifest }[]> {
    const state = await this.read().catch(() => undefined)
    return (state?.sources ?? []).filter(source => this.localAvailable || source.cache.readFrom === 'remote').flatMap((source) => {
      try {
        return [{ source: publicSource(source), catalog: parseSoftwareCatalogManifest(source.cache.catalog) }]
      }
      catch { return [] }
    })
  }

  /** Read and validate a proposed source, preserving its other binding when editing. */
  async preview(input: SoftwareSourceInput): Promise<SoftwareSourcePreview> {
    const state = await this.read()
    const source = await this.prepare(softwareSourceInputSchema.parse(input), state)
    const existing = state.sources.find(item => item.id === source.id)
    if (!existing && state.sources.length >= 30)
      throw new SoftwareSourceError(400, 'At most 30 repository sources are supported')
    for (const [key, preview] of this.previews) {
      if (preview.expiresAt < Date.now())
        this.previews.delete(key)
    }
    if (this.previews.size >= 30)
      this.previews.delete(this.previews.keys().next().value!)
    const previewId = randomUUID()
    this.previews.set(previewId, { source, revision: state.revision, expiresAt: Date.now() + 10 * 60 * 1000 })
    const visible = publicSource(source)
    if (!this.localAvailable)
      delete visible.localPath
    return { previewId, source: visible, catalog: structuredClone(source.cache.catalog), ...(existing ? { replaces: existing.id } : {}) }
  }

  /** Apply exactly the reviewed snapshot if the saved source set has not changed. */
  async apply(previewId: string): Promise<SoftwareSourceSnapshot> {
    await this.serialize(async () => {
      const preview = this.previews.get(previewId)
      if (!preview || preview.expiresAt < Date.now())
        throw new SoftwareSourceError(409, 'Source preview expired. Preview it again.')
      const state = await this.read()
      this.assertRevision(state, preview.revision)
      state.sources = [...state.sources.filter(source => source.id !== preview.source.id), preview.source]
      await this.write(state)
      this.previews.delete(previewId)
    })
    return this.snapshot()
  }

  /** Refresh the selected binding; failures retain the last known catalog and its provenance. */
  async refresh(id: string): Promise<SoftwareSourceSnapshot> {
    await this.refreshSource(id)
    return this.snapshot()
  }

  /** Save a refresh preference independently of repository reads and cached metadata. */
  async configureRefresh(id: string, refreshPolicy: SoftwareSourceRefreshPolicy, revision: string): Promise<SoftwareSourceSnapshot> {
    const policy = softwareSourceRefreshPolicySchema.parse(refreshPolicy)
    await this.serialize(async () => {
      const state = await this.read()
      this.assertRevision(state, revision)
      if (!state.sources.some(source => source.id === id))
        throw new SoftwareSourceError(404, 'Source not found')
      state.sources = state.sources.map(source => source.id === id ? { ...source, refreshPolicy: policy } : source)
      await this.write(state)
    })
    return this.snapshot()
  }

  /** Refresh subscribed online catalogs when their saved schedule is due on a local host. */
  refreshDue(): Promise<boolean> {
    if (!this.localAvailable)
      return Promise.resolve(false)
    this.automaticRefresh ??= this.refreshDueSources().finally(() => {
      this.automaticRefresh = undefined
    })
    return this.automaticRefresh
  }

  private async refreshDueSources(): Promise<boolean> {
    const state = await this.read()
    let refreshed = false
    for (const source of state.sources) {
      if (source.mode !== 'remote')
        continue
      try {
        refreshed = await this.refreshSource(source.id, true) || refreshed
      }
      catch (error) {
        // A user's concurrent edit or removal takes precedence over background metadata updates.
        if (!(error instanceof SoftwareSourceError) || ![404, 409].includes(error.status))
          throw error
      }
    }
    return refreshed
  }

  private async refreshSource(id: string, onlyIfDue = false): Promise<boolean> {
    const state = await this.read()
    const existing = state.sources.find(source => source.id === id)
    if (!existing)
      throw new SoftwareSourceError(404, 'Source not found')
    if (onlyIfDue && (existing.mode !== 'remote' || !softwareSourceRefreshDue(existing)))
      return false
    if (!this.localAvailable && existing.mode === 'local')
      throw new SoftwareSourceError(403, 'Local repository access requires a local host')
    let next: SavedSource
    try {
      next = await this.prepare({ id, repository: existing.repository, localPath: this.localAvailable ? existing.localPath : undefined, branch: existing.branch, catalogPath: existing.catalogPath, mode: existing.mode }, state)
    }
    catch { next = { ...existing, checkedAt: new Date().toISOString(), error: 'unavailable' } }
    await this.serialize(async () => {
      const current = await this.read()
      this.assertRevision(current, state.revision)
      current.sources = current.sources.map(source => source.id === id ? next : source)
      await this.write(current)
    })
    return true
  }

  /** Unsubscribe without touching checkouts, favorites, plugins or the bundled catalog. */
  async remove(id: string, revision: string): Promise<SoftwareSourceSnapshot> {
    await this.serialize(async () => {
      const state = await this.read()
      this.assertRevision(state, revision)
      state.sources = state.sources.filter(source => source.id !== id)
      await this.write(state)
    })
    return this.snapshot()
  }

  private async prepare(input: z.output<typeof softwareSourceInputSchema>, state: State): Promise<SavedSource> {
    const existing = input.id ? state.sources.find(source => source.id === input.id) : undefined
    if (input.id && !existing)
      throw new SoftwareSourceError(404, 'Source not found')
    if (!this.localAvailable && (input.mode === 'local' || input.localPath))
      throw new SoftwareSourceError(403, 'Local repository access requires a local host')
    validateRepositoryCatalogPath(input.catalogPath)
    let repository = input.repository ? repositoryIdentity(input.repository) : existing?.repository
    let localPath = input.localPath || existing?.localPath
    let content: string
    let commit: string | undefined
    try {
      // A new/changed binding is verified even when the online reading mode is selected.
      let local: Awaited<ReturnType<SoftwareRepositoryReader['local']>> | undefined
      if (localPath && (input.mode === 'local' || localPath !== existing?.localPath)) {
        local = await this.reader.local(localPath, input.catalogPath)
        const localRepository = local.repository ? repositoryIdentity(local.repository) : undefined
        if (repository && localRepository !== repository)
          throw new SoftwareSourceError(409, 'The local origin does not match this online repository')
        repository ??= localRepository
        localPath = local.localPath
      }
      if (input.mode === 'local') {
        if (!local)
          throw new SoftwareSourceError(400, 'Select a local Git repository')
        content = local.content
        commit = local.commit
      }
      else {
        if (!repository)
          throw new SoftwareSourceError(400, 'Enter an online repository URL')
        const remote = await this.reader.remote(repository, input.branch, input.catalogPath)
        content = remote.content
        commit = remote.commit
      }
      if (existing?.repository && repository !== existing.repository)
        throw new SoftwareSourceError(409, 'Add a new source to change the repository identity')
      const sourceIdentity = repository === workstationCatalogSource.url.toLowerCase()
        ? workstationCatalogSource
        : { id: digest(repository ?? localPath), title: basename(repository ?? localPath ?? 'Software catalog'), ...(repository ? { url: repository } : {}) }
      const catalog = parseSoftwareConfig(content, sourceIdentity)
      const matched = state.sources.find(source => source.catalogPath === input.catalogPath && (repository ? source.repository === repository : source.localPath === localPath))
      if (existing && matched && existing.id !== matched.id)
        throw new SoftwareSourceError(409, 'This repository is already linked to another source')
      localPath ??= matched?.localPath
      const now = new Date().toISOString()
      return { id: existing?.id ?? matched?.id ?? digest([repository ?? localPath, input.catalogPath]), repository, localPath, branch: input.branch, catalogPath: input.catalogPath, mode: input.mode, refreshPolicy: input.refreshPolicy ?? existing?.refreshPolicy ?? matched?.refreshPolicy, title: catalog.source.title, cache: { catalog, readFrom: input.mode, commit, savedAt: now }, checkedAt: now }
    }
    catch (error) {
      if (error instanceof SoftwareSourceError)
        throw error
      throw new SoftwareSourceError(503, 'Could not read a valid catalog. Check the repository, branch and path, and use an exported softwareGroups array of literal data in software.config.ts.')
    }
  }

  private assertRevision(state: State, expected: string): void {
    if (state.revision !== expected)
      throw new SoftwareSourceError(409, 'Sources changed elsewhere. Reload and preview again.')
  }

  private async read(): Promise<State> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.path, 'utf8')))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1, revision: 'empty', sources: [] }
      throw new SoftwareSourceError(503, 'Saved source data could not be read. Preserve it before restoring a backup.')
    }
  }

  private async write(state: State): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(JSON.stringify(stateSchema.parse({ ...state, revision: randomUUID() })))
        await file.sync()
      }
      finally { await file.close() }
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
          throw new SoftwareSourceError(503, 'Could not write source state in the host data directory')
        const pid = Number(await readFile(lockPath, 'utf8').catch(() => ''))
        let running = true
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0)
          }
          catch (error) { running = (error as NodeJS.ErrnoException).code !== 'ESRCH' }
        }
        if (running)
          throw new SoftwareSourceError(409, 'Another source update is in progress. Retry after it finishes.')
        const recoveryPath = `${lockPath}.recovery`
        let recovery
        try {
          recovery = await open(recoveryPath, 'wx', 0o600)
        }
        catch { throw new SoftwareSourceError(409, 'Source lock recovery is in progress. Retry shortly.') }
        try {
          if (Number(await readFile(lockPath, 'utf8')) !== pid)
            throw new SoftwareSourceError(409, 'Source lock changed. Retry the update.')
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
