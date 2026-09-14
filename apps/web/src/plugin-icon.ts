import type { ManagedPlugin } from 'craft-hub'
import { api } from './api'

/** Resolve a manifest icon through the package's isolated icon endpoint. */
export function pluginIconUrl(plugin: Pick<ManagedPlugin, 'sourceId' | 'package' | 'version'>, icon: string | undefined): string | undefined {
  if (!icon)
    return undefined
  return icon.startsWith('https://') ? icon : api.pluginIconUrl(plugin.sourceId, plugin.package, plugin.version)
}
