import type { SoftwareSource } from './software-sources'
import { z } from 'zod'
import { operationSupportSchema } from './configuration-management'
import { personalWorkbenchToolSchema } from './personal-workbench'

const httpsUrl = personalWorkbenchToolSchema.shape.url
const localizedText = z.object({ en: z.string().trim().min(1).max(256), zh: z.string().trim().min(1).max(256).optional() }).strict()
const identifier = z.string().trim().min(1).max(128)
const installation = z.object({ kind: z.enum(['download', 'brew-cask', 'brew-formula', 'manual']), packageId: z.string().min(1).max(256).optional() }).strict()
const uniqueSoftwareIds = z.array(identifier).min(1).max(50).refine(ids => new Set(ids).size === ids.length, 'Software identifiers must be unique')

/** Browser requests select catalog identifiers, never executable recipes or paths. */
export const softwareInstallationRequestSchema = z.object({ softwareIds: uniqueSoftwareIds }).strict()
/** Installation requires explicit confirmation of a previously reviewed adapter plan. */
export const softwareInstallationConfirmationSchema = z.object({ planId: identifier, confirmed: z.literal(true) }).strict()
/** Only a trusted catalog application can be opened. */
export const softwareApplicationRequestSchema = z.object({ softwareId: identifier }).strict()

/** Portable catalog metadata; no machine observations or executable recipes. */
export const softwareMetadataSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: localizedText,
  group: z.object({ id: z.string().trim().min(1).max(128), title: localizedText }).strict(),
  url: httpsUrl,
  downloadUrl: httpsUrl.optional(),
  repositoryUrl: httpsUrl.optional(),
  iconUrl: httpsUrl.optional(),
  macosIconUrl: httpsUrl.optional(),
  iconStyle: personalWorkbenchToolSchema.shape.iconStyle,
  iconScale: personalWorkbenchToolSchema.shape.iconScale,
  description: z.string().max(1024).optional(),
  /** Explicit product support, independent of local installation capability. Omitted means unknown. */
  platforms: z.array(z.enum(['macos', 'windows', 'linux'])).min(1).max(3).refine(platforms => new Set(platforms).size === platforms.length, 'Platforms must be unique').optional(),
  installation,
}).strict()

/** Display metadata combined with fresh local observations from a trusted adapter. */
export const softwareCatalogItemSchema = softwareMetadataSchema.extend({
  status: z.enum(['detected', 'not-detected', 'unknown']),
  canInstall: z.boolean().optional(),
  canOpen: z.boolean().optional(),
}).strict()

const catalogSource = z.object({ id: z.string().min(1).max(128), title: z.string().min(1).max(128), url: httpsUrl.optional() }).strict()

/** Versioned parsed cache; revision is the SHA-256 of its ordered version/source/items JSON. */
export const softwareCatalogManifestSchema = z.object({
  version: z.literal(1),
  source: catalogSource,
  items: z.array(softwareMetadataSchema).min(1).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Software identifiers must be unique'),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

/** Portable software facts parsed from a catalog. */
export type SoftwareCatalogManifest = z.infer<typeof softwareCatalogManifestSchema>

/** One bounded, versioned catalog supplied by a trusted local host adapter. */
export const softwareCatalogSchema = z.object({
  version: z.literal(1),
  source: catalogSource,
  items: z.array(softwareCatalogItemSchema).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Software identifiers must be unique'),
  operationSupport: operationSupportSchema.optional(),
}).strict()

/** Immutable preview; persistence and plan freshness are owned by the trusted adapter. */
export const softwareInstallationPlanSchema = z.object({
  version: z.literal(1),
  id: identifier,
  sourceId: identifier,
  createdAt: z.iso.datetime(),
  items: z.array(z.object({
    softwareId: identifier,
    title: localizedText,
    action: z.enum(['install', 'skip', 'manual']),
    installation,
    reason: z.string().max(1024).optional(),
  }).strict()).min(1).max(50).refine(items => new Set(items.map(item => item.softwareId)).size === items.length, 'Software identifiers must be unique'),
  prerequisites: z.array(z.string().max(1024)).max(50),
}).strict()

/** Bounded adapter-owned progress; log text is rendered as text, never executed. */
export const softwareInstallationRunSchema = z.object({
  version: z.literal(1),
  id: identifier,
  sourceId: identifier,
  planId: identifier,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  state: z.enum(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted', 'waiting']),
  items: z.array(z.object({
    softwareId: identifier,
    title: localizedText,
    state: z.enum(['queued', 'running', 'installed', 'skipped', 'failed', 'manual', 'cancelled', 'interrupted']),
    message: z.string().max(1024).optional(),
    log: z.string().max(16 * 1024),
    progress: z.discriminatedUnion('phase', [
      z.object({ phase: z.literal('preparing') }).strict(),
      z.object({ phase: z.literal('downloading'), percent: z.number().finite().min(0).max(100).optional(), resource: z.string().max(256).optional() }).strict(),
      z.object({ phase: z.literal('installing') }).strict(),
    ]).optional(),
  }).strict()).min(1).max(50).refine(items => new Set(items.map(item => item.softwareId)).size === items.length, 'Software identifiers must be unique'),
  retryOf: identifier.optional(),
}).strict()

/** Recent progress survives client refreshes and is bounded by the adapter. */
export const softwareInstallationRunsSchema = z.object({
  version: z.literal(1),
  runs: z.array(softwareInstallationRunSchema).max(20).refine(runs => new Set(runs.map(run => run.id)).size === runs.length, 'Run identifiers must be unique'),
}).strict()

/** A launch acknowledgement does not imply that an application is already foregrounded. */
export const softwareApplicationOpenSchema = z.object({ version: z.literal(1), softwareId: identifier, destination: z.literal('application') }).strict()

/** Adapter-owned installation preview. */
export type SoftwareInstallationPlan = z.infer<typeof softwareInstallationPlanSchema>
/** Adapter-owned installation progress. */
export type SoftwareInstallationRun = z.infer<typeof softwareInstallationRunSchema>
/** Recent adapter-owned installation runs. */
export type SoftwareInstallationRuns = z.infer<typeof softwareInstallationRunsSchema>
/** Acknowledgement of a catalog application launch request. */
export type SoftwareApplicationOpen = z.infer<typeof softwareApplicationOpenSchema>

/** Trusted host interface: all software detection, execution and persistence stay in the adapter. */
export interface SoftwareManagementProvider {
  preview: (softwareIds: string[]) => Promise<SoftwareInstallationPlan>
  install: (planId: string, confirmed: true) => Promise<SoftwareInstallationRun>
  runs: () => Promise<SoftwareInstallationRuns>
  cancel: (runId: string) => Promise<SoftwareInstallationRun>
  open: (softwareId: string) => Promise<SoftwareApplicationOpen>
}

/** Controlled host operation error, safe to return without external process diagnostics. */
export class SoftwareOperationError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, message: string) {
    super(message)
  }
}

/** A software entry containing external links and a partial local detection result. */
export type SoftwareCatalogItem = z.infer<typeof softwareCatalogItemSchema>
/** Versioned software catalog; source configuration remains owned by its adapter. */
export type SoftwareCatalog = z.infer<typeof softwareCatalogSchema>
/** Trusted host extension for side-effect-free software discovery. */
export interface SoftwareCatalogProvider {
  id: string
  title: string
  url: string
  read: () => Promise<SoftwareCatalog>
  management?: SoftwareManagementProvider
}
/** Failed adapters retain their identity without forwarding external process diagnostics. */
export type SoftwareCatalogSource = SoftwareCatalog['source'] & {
  items: SoftwareCatalogItem[]
  error?: 'unavailable'
  canManage?: boolean
  operationSupport?: SoftwareCatalog['operationSupport']
  /** Static build snapshot; no installed state or management capability is implied. */
  bundled?: boolean
  /** Repository metadata is cached separately from local plugin observations. */
  repositorySourceId?: string
  repositoryReadFrom?: 'local' | 'remote'
  repositoryStale?: boolean
}
/** Local software center snapshot, allowing an unavailable source to be retried independently. */
export interface SoftwareCatalogSnapshot {
  version: 1
  sources: SoftwareCatalogSource[]
}

function withFallbackMetadata(item: SoftwareCatalogItem, fallback?: SoftwareCatalogItem): SoftwareCatalogItem {
  if (fallback && item.url === fallback.url && item.installation.kind === fallback.installation.kind && item.installation.packageId === fallback.installation.packageId && item.platforms === undefined && fallback.platforms)
    item = { ...item, platforms: [...fallback.platforms] }
  if (!fallback || item.url !== fallback.url || (item.iconUrl && item.iconUrl !== fallback.iconUrl))
    return item
  const preferredIcon = item.macosIconUrl ?? fallback.macosIconUrl ?? item.iconUrl ?? fallback.iconUrl
  return {
    ...item,
    ...(!item.iconUrl && fallback.iconUrl ? { iconUrl: fallback.iconUrl } : {}),
    ...(!item.macosIconUrl && fallback.macosIconUrl ? { macosIconUrl: fallback.macosIconUrl } : {}),
    ...(!item.iconStyle && fallback.iconStyle ? { iconStyle: fallback.iconStyle } : {}),
    ...(item.iconScale === undefined && preferredIcon === (fallback.macosIconUrl ?? fallback.iconUrl) && fallback.iconScale !== undefined ? { iconScale: fallback.iconScale } : {}),
  }
}

/** Validate and isolate independent catalogs without executing metadata or exposing raw errors. */
export class SoftwareCatalogService {
  private readonly bundledCatalogs: SoftwareCatalogManifest[]

  constructor(private readonly providers: SoftwareCatalogProvider[] = [], bundledCatalogs: SoftwareCatalogManifest[] = []) {
    const ids = providers.map(provider => provider.id)
    if (new Set(ids).size !== ids.length)
      throw new Error('Software catalog provider identifiers must be unique')
    providers.forEach(({ id, title, url }) => softwareCatalogSchema.shape.source.parse({ id, title, url }))
    this.bundledCatalogs = bundledCatalogs.map(catalog => softwareCatalogManifestSchema.parse(catalog))
    if (new Set(this.bundledCatalogs.map(catalog => catalog.source.id)).size !== this.bundledCatalogs.length)
      throw new Error('Bundled catalog source identifiers must be unique')
  }

  /** Read fresh metadata from configured host providers; no installation or project trust changes. */
  async snapshot({ localDiscovery = true, repositories = [] }: { localDiscovery?: boolean, repositories?: { source: SoftwareSource, catalog: SoftwareCatalogManifest }[] } = {}): Promise<SoftwareCatalogSnapshot> {
    const sources = new Map<string, SoftwareCatalogSource>(this.bundledCatalogs.map(catalog => [catalog.source.id, {
      ...catalog.source,
      bundled: true,
      items: catalog.items.map(item => ({ ...structuredClone(item), status: 'unknown', canInstall: false, canOpen: false })),
    }]))
    for (const { source, catalog } of repositories) {
      // A catalog claiming a plugin's id does not gain that plugin's authority.
      const bundled = this.bundledCatalogs.find(item => item.source.id === catalog.source.id && (item.source.url === source.repository || (item.source.url?.startsWith('https://github.com/') && item.source.url.toLowerCase() === source.repository?.toLowerCase())) && source.catalogPath === 'software.config.ts')
      const id = bundled?.source.id ?? `repository-${source.id}`
      const fallbackItems = new Map(sources.get(id)?.items.map(item => [item.id, item]))
      sources.set(id, {
        ...catalog.source,
        id,
        repositorySourceId: source.id,
        repositoryReadFrom: source.cache.readFrom,
        repositoryStale: source.error === 'unavailable',
        items: catalog.items.map(item => withFallbackMetadata({ ...structuredClone(item), status: 'unknown', canInstall: false, canOpen: false }, fallbackItems.get(item.id))),
      })
    }
    if (localDiscovery) {
      const discovered = await Promise.all(this.providers.map(async (provider): Promise<SoftwareCatalogSource> => {
        const source = { id: provider.id, title: provider.title, url: provider.url, ...(provider.management ? { canManage: true } : {}) }
        const fallback = sources.get(provider.id)
        try {
          const catalog = softwareCatalogSchema.parse(await provider.read())
          if (catalog.source.id !== provider.id)
            throw new Error('Unexpected software catalog identity')
          const support = catalog.operationSupport
          const supported = (operation: string): boolean => !support || (support.state === 'available' && support.operations[operation]?.supported === true)
          const observedItems = catalog.items.map(item => ({ ...item, ...(item.canInstall !== undefined ? { canInstall: item.canInstall && supported('preview') && supported('install') } : {}), ...(item.canOpen !== undefined ? { canOpen: item.canOpen && supported('open') } : {}) }))
          const supportedSource = { ...source, ...(support ? { operationSupport: support } : {}) }
          if (fallback?.repositorySourceId) {
            const observed = new Map(observedItems.map(item => [item.id, item]))
            return { ...fallback, ...supportedSource, items: fallback.items.map((item) => {
              const live = observed.get(item.id)
              const sameApplication = live?.url === item.url && live.installation.kind === item.installation.kind && live.installation.packageId === item.installation.packageId
              return live && sameApplication ? { ...item, status: live.status, canInstall: live.canInstall, canOpen: live.canOpen } : item
            }) }
          }
          const items = new Map((fallback?.items ?? []).map(item => [item.id, item]))
          observedItems.forEach(item => items.set(item.id, withFallbackMetadata(item, items.get(item.id))))
          return { ...supportedSource, items: [...items.values()] }
        }
        catch { return fallback ?? { ...source, items: [], error: 'unavailable' } }
      }))
      discovered.forEach(source => sources.set(source.id, source))
    }
    return { version: 1, sources: [...sources.values()] }
  }

  /** Review selected identifiers through the configured provider without executing software. */
  async preview(sourceId: string, softwareIds: string[]): Promise<SoftwareInstallationPlan> {
    const ids = uniqueSoftwareIds.parse(softwareIds)
    return this.operation(sourceId, async (management) => {
      const plan = softwareInstallationPlanSchema.parse(await management.preview(ids))
      if (plan.sourceId !== sourceId || plan.items.length !== ids.length || plan.items.some(item => !ids.includes(item.softwareId)))
        throw new Error('Unexpected software plan identity')
      return plan
    })
  }

  /** Start an explicitly confirmed provider plan; the adapter checks freshness and idempotency. */
  async install(sourceId: string, planId: string, confirmed: boolean): Promise<SoftwareInstallationRun> {
    if (confirmed !== true)
      throw new SoftwareOperationError(409, 'Review and confirm the software installation plan')
    const id = identifier.parse(planId)
    return this.operation(sourceId, async (management) => {
      const run = softwareInstallationRunSchema.parse(await management.install(id, true))
      if (run.sourceId !== sourceId || run.planId !== id)
        throw new Error('Unexpected software run identity')
      return run
    })
  }

  /** Read persisted runs, independent of the project registry or project trust. */
  async runs(sourceId: string): Promise<SoftwareInstallationRuns> {
    return this.operation(sourceId, async (management) => {
      const result = softwareInstallationRunsSchema.parse(await management.runs())
      if (result.runs.some(run => run.sourceId !== sourceId))
        throw new Error('Unexpected software run source')
      return result
    })
  }

  /** Request cancellation through the owner of the worker and process group. */
  async cancel(sourceId: string, runId: string): Promise<SoftwareInstallationRun> {
    const id = identifier.parse(runId)
    return this.operation(sourceId, async (management) => {
      const run = softwareInstallationRunSchema.parse(await management.cancel(id))
      if (run.id !== id || run.sourceId !== sourceId)
        throw new Error('Unexpected software cancellation identity')
      return run
    })
  }

  /** Open one application by catalog identity; no browser-supplied application paths. */
  async open(sourceId: string, softwareId: string): Promise<SoftwareApplicationOpen> {
    const id = identifier.parse(softwareId)
    return this.operation(sourceId, async (management) => {
      const result = softwareApplicationOpenSchema.parse(await management.open(id))
      if (result.softwareId !== id)
        throw new Error('Unexpected software application identity')
      return result
    })
  }

  private async operation<T>(sourceId: string, execute: (management: SoftwareManagementProvider) => Promise<T>): Promise<T> {
    identifier.parse(sourceId)
    const provider = this.providers.find(provider => provider.id === sourceId)
    if (!provider && this.bundledCatalogs.some(catalog => catalog.source.id === sourceId))
      throw new SoftwareOperationError(503, 'Connect a local software management plugin to manage this catalog.')
    if (!provider)
      throw new SoftwareOperationError(404, 'Software source is unavailable')
    if (!provider.management)
      throw new SoftwareOperationError(503, 'Software management is unavailable. Update the local provider.')
    try {
      return await execute(provider.management)
    }
    catch (error) {
      if (error instanceof SoftwareOperationError)
        throw error
      throw new SoftwareOperationError(503, 'Software operation is unavailable. Refresh its history before retrying.')
    }
  }
}
