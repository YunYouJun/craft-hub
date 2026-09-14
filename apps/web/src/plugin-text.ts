import type { PluginManifestV1, WorkbenchLocale } from 'craft-hub'

type PluginText = Pick<PluginManifestV1, 'displayName' | 'description' | 'localizations'>

export function pluginDisplayName(plugin: PluginText, locale: WorkbenchLocale): string {
  return plugin.localizations?.[locale]?.displayName ?? plugin.displayName
}

export function pluginDescription(plugin: PluginText, locale: WorkbenchLocale): string | undefined {
  return plugin.localizations?.[locale]?.description ?? plugin.description
}
