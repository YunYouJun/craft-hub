import type { ManagedPlugin } from 'craft-hub'
import { ref } from 'vue'
import { api } from './api'

/** Resolve a manifest icon through the package's isolated icon endpoint. */
export function pluginIconUrl(plugin: Pick<ManagedPlugin, 'sourceId' | 'package' | 'version'>, icon: string | undefined): string | undefined {
  if (!icon)
    return undefined
  return icon.startsWith('https://') ? icon : api.pluginIconUrl(plugin.sourceId, plugin.package, plugin.version)
}

/** Keep failed artwork local to its presentation and consistently fall back to the plugin symbol. */
export function usePluginIconFallback(): {
  visibleIcon: (url: string | undefined) => string | undefined
  markIconFailed: (url: string | undefined) => void
} {
  const failed = ref(new Set<string>())
  return {
    visibleIcon: (url: string | undefined): string | undefined => url && !failed.value.has(url) ? url : undefined,
    markIconFailed(url: string | undefined): void {
      if (url)
        failed.value.add(url)
    },
  }
}
