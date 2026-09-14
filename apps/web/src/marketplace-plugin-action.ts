import type { CatalogPluginV1, ManagedPlugin } from 'craft-hub'
import { gt, lt } from 'semver'

export const marketplaceActionLabels = {
  install: 'installPlugin',
  update: 'updatePlugin',
  repair: 'repairPluginBundle',
  enable: 'enablePlugin',
  installed: 'pluginAlreadyInstalled',
  newer: 'pluginNewerInstalled',
  local: 'viewLocalPlugin',
  switchSource: 'switchPluginSource',
} as const

export type MarketplacePluginAction = keyof typeof marketplaceActionLabels

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

export function marketplaceActionDisabled(action: MarketplacePluginAction): boolean {
  return action === 'installed' || action === 'newer'
}
