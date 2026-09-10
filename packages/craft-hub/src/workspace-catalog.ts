import { z } from 'zod'

const identifier = z.string().trim().min(1).max(128).regex(/^[\w.-]+$/)
const httpsUrl = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
}, 'Expected an HTTPS URL without credentials or a fragment')

/** A discoverable configuration directory, not permission to execute its projects. */
export const workspaceCatalogEntrySchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  publisher: z.string().trim().min(1).max(160),
  configurationUrl: httpsUrl,
  team: z.boolean().optional(),
}).strict()

/** Versioned index published separately from workspace configuration documents. */
export const workspaceCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  id: identifier,
  name: z.string().trim().min(1).max(160),
  entries: z.array(workspaceCatalogEntrySchema).max(1000),
}).strict().superRefine((catalog, context) => {
  const ids = new Set<string>()
  for (const [index, entry] of catalog.entries.entries()) {
    if (ids.has(entry.id))
      context.addIssue({ code: 'custom', path: ['entries', index, 'id'], message: 'Duplicate workspace source id' })
    ids.add(entry.id)
  }
})

/** A trusted distribution can provision multiple independent workspace markets. */
export const workspaceMarketSchema = z.object({
  enabled: z.boolean(),
  catalog: workspaceCatalogSchema,
}).strict()

export type WorkspaceSourceCatalog = z.infer<typeof workspaceCatalogSchema>
export type WorkspaceCatalogEntry = z.infer<typeof workspaceCatalogEntrySchema>
export type WorkspaceMarket = z.infer<typeof workspaceMarketSchema>

/** Authenticated host catalog reader; each call must filter entries using current repository permissions. */
export interface WorkspaceCatalogProvider {
  id: string
  list: () => Promise<WorkspaceSourceCatalog[]>
}

/** Read validated distribution indexes without fetching repositories or changing local state. */
export class WorkspaceCatalogService {
  private readonly markets: WorkspaceMarket[]

  constructor(markets: WorkspaceMarket[] = [], private readonly providers: WorkspaceCatalogProvider[] = []) {
    this.markets = markets.map(market => workspaceMarketSchema.parse(market))
    const ids = this.markets.map(market => market.catalog.id)
    if (new Set(ids).size !== ids.length)
      throw new Error('Duplicate workspace market id')
  }

  /** Discover host catalogs without sharing private cached entries across users or sessions. */
  async discover(): Promise<WorkspaceSourceCatalog[]> {
    const catalogs = [...this.list(), ...(await Promise.all(this.providers.map(provider => provider.list()))).flat().map(catalog => workspaceCatalogSchema.parse(catalog))]
    if (new Set(catalogs.map(catalog => catalog.id)).size !== catalogs.length)
      throw new Error('Duplicate workspace market id')
    return catalogs
  }

  /** Return isolated indexes; catalog and entry ids together identify an item. */
  list(): WorkspaceSourceCatalog[] {
    return structuredClone(this.markets.filter(market => market.enabled).map(market => market.catalog))
  }
}
