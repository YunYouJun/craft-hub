import { z } from 'zod'
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

/** Display-only software metadata; executable commands never enter the browser contract. */
export const softwareCatalogItemSchema = z.object({
  id: z.string().trim().min(1).max(128),
  title: localizedText,
  group: z.object({ id: z.string().trim().min(1).max(128), title: localizedText }).strict(),
  url: httpsUrl,
  downloadUrl: httpsUrl.optional(),
  repositoryUrl: httpsUrl.optional(),
  description: z.string().max(1024).optional(),
  installation,
  status: z.enum(['detected', 'not-detected', 'unknown']),
  canInstall: z.boolean().optional(),
  canOpen: z.boolean().optional(),
}).strict()

/** One bounded, versioned catalog supplied by a trusted local host adapter. */
export const softwareCatalogSchema = z.object({
  version: z.literal(1),
  source: z.object({ id: z.string().min(1).max(128), title: z.string().min(1).max(128), url: httpsUrl }).strict(),
  items: z.array(softwareCatalogItemSchema).max(1000).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Software identifiers must be unique'),
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
}
/** Local software center snapshot, allowing an unavailable source to be retried independently. */
export interface SoftwareCatalogSnapshot {
  version: 1
  sources: SoftwareCatalogSource[]
}

/** Validate and isolate independent catalogs without executing metadata or exposing raw errors. */
export class SoftwareCatalogService {
  constructor(private readonly providers: SoftwareCatalogProvider[] = []) {
    const ids = providers.map(provider => provider.id)
    if (new Set(ids).size !== ids.length)
      throw new Error('Software catalog provider identifiers must be unique')
    providers.forEach(({ id, title, url }) => softwareCatalogSchema.shape.source.parse({ id, title, url }))
  }

  /** Read fresh metadata from configured host providers; no installation or project trust changes. */
  async snapshot(): Promise<SoftwareCatalogSnapshot> {
    return {
      version: 1,
      sources: await Promise.all(this.providers.map(async (provider): Promise<SoftwareCatalogSource> => {
        const source = { id: provider.id, title: provider.title, url: provider.url, ...(provider.management ? { canManage: true } : {}) }
        try {
          const catalog = softwareCatalogSchema.parse(await provider.read())
          if (catalog.source.id !== provider.id)
            throw new Error('Unexpected software catalog identity')
          return { ...source, items: catalog.items }
        }
        catch { return { ...source, items: [], error: 'unavailable' } }
      })),
    }
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
