import type { CatalogPluginV1, ManagedPlugin } from 'craft-hub'
import type { IconName } from './icons'
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

/** Leading icon for each action, so the plugin's state reads at a glance before its label. */
export const marketplaceActionIcons = {
  install: 'download',
  update: 'download',
  repair: 'refresh',
  enable: 'play',
  installed: 'check',
  newer: 'check',
  local: 'folderOpen',
  switchSource: 'transfer',
} as const satisfies Record<MarketplacePluginAction, IconName>

/** Actions that change what is installed lead with the primary button; status and navigation stay secondary. */
export function marketplaceActionVariant(action: MarketplacePluginAction): 'primary' | 'secondary' {
  return action === 'install' || action === 'update' || action === 'repair' || action === 'enable' ? 'primary' : 'secondary'
}
