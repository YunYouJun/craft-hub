import type { SettingsSnapshot } from './settings'
import type { SoftwareCatalogSnapshot, SoftwareFavoritesSnapshot } from './software-catalog'
import { findSoftwareFavorite } from './personal-workbench'

/** Project settings onto catalog identities without granting application launch or installation authority. */
export function softwareFavoritesSnapshot(catalog: SoftwareCatalogSnapshot, settings: SettingsSnapshot): SoftwareFavoritesSnapshot {
  const tools = settings.settings['workbench.home'].tools
  return {
    version: 1,
    revision: settings.revision,
    tools,
    matches: catalog.sources.flatMap(source => source.items.flatMap((item) => {
      const favorite = findSoftwareFavorite(tools, item)
      return favorite ? [{ sourceId: source.id, softwareId: item.id, toolId: favorite.id }] : []
    })),
  }
}
