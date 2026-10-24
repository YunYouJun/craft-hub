import type { CatalogPluginV1, ManagedPlugin, MarketplaceSource } from './marketplace'
import { gt, lt, maxSatisfying } from 'semver'

/** User actions derived by the shared runtime; native clients do not implement SemVer policy. */
export type MarketplacePluginAction = 'install' | 'update' | 'repair' | 'enable' | 'installed' | 'newer' | 'local' | 'switchSource'
/** A catalog entry with its authoritative source identity. */
export type MarketplaceCatalogItem = CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }

/** Compare the catalog target against the effective plugin, including local overrides and source identity. */
export function marketplacePluginAction(target: CatalogPluginV1 & { sourceId: string }, active?: ManagedPlugin): MarketplacePluginAction {
  if (!active)
    return 'install'
  if (active.origin === 'local')
    return 'local'
  if (active.sourceId !== target.sourceId)
    return 'switchSource'
  if (gt(target.version, active.version))
    return 'update'
  if (lt(target.version, active.version))
    return 'newer'
  if (active.error || target.includesPlugins.length || target.requiresPlugins.length)
    return 'repair'
  return active.enabled ? 'installed' : 'enable'
}

/** Choose the latest active version per source/package, keeping blocked-only packages visible for explanation. */
export function preferredMarketplaceCatalog<T extends CatalogPluginV1 & { sourceId: string }>(catalog: T[]): T[] {
  const grouped = new Map<string, T[]>()
  for (const plugin of catalog) {
    const key = `${plugin.sourceId}:${plugin.package}`
    grouped.set(key, [...(grouped.get(key) ?? []), plugin])
  }
  return [...grouped.values()].map((versions) => {
    const active = versions.filter(plugin => plugin.status === 'active')
    const candidates = active.length ? active : versions
    const version = maxSatisfying(candidates.map(plugin => plugin.version), '*', { includePrerelease: true })
    return candidates.find(plugin => plugin.version === version) ?? candidates[0]!
  })
}

/** Stable marketplace presentation response for native and other runtime clients. */
export interface MarketplaceOverview {
  version: 1
  catalog: Array<MarketplaceCatalogItem & { action: MarketplacePluginAction, preferred: boolean, included: boolean }>
  installed: ManagedPlugin[]
  sources: MarketplaceSource[]
}

/** Read-only view model for clients, with actions for every exact version and bundle membership. */
export function marketplaceOverview(catalog: MarketplaceCatalogItem[], installed: ManagedPlugin[], sources: MarketplaceSource[]): MarketplaceOverview {
  const preferred = preferredMarketplaceCatalog(catalog)
  const included = new Set(preferred.filter(plugin => plugin.status === 'active').flatMap(plugin => plugin.includesPlugins.map(member => `${plugin.sourceId}:${member.package}`)))
  const active = new Map(installed.map(plugin => [plugin.package, plugin]))
  return {
    version: 1 as const,
    catalog: catalog.map(plugin => ({
      ...plugin,
      action: marketplacePluginAction(plugin, active.get(plugin.package)),
      preferred: preferred.includes(plugin),
      included: included.has(`${plugin.sourceId}:${plugin.package}`),
    })),
    installed,
    sources,
  }
}
