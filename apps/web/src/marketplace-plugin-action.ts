import type { MarketplacePluginAction } from 'craft-hub/marketplace-model'
import type { IconName } from './icons'

export { marketplacePluginAction } from 'craft-hub/marketplace-model'

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

export type { MarketplacePluginAction }

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
