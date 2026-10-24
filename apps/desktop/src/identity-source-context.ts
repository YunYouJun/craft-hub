import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { communityDistribution, getCraftHubConfigDir } from 'craft-hub'
import { app } from 'electron'
import { resolveDesktopDataDirectories } from './data-directories.ts'
import { loadDesktopDistributionManifest } from './distribution.ts'

/** Source-owned paths shared by maintenance and the pre-runtime migration gate. Never supplied by a dialog or pipe. */
export function identitySourceContext(): { name: string, sourceData: string, sourceConfig: string } {
  const manifestPath = process.env.CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG
    ? resolve(process.env.CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG)
    : fileURLToPath(new URL('../distribution.json', import.meta.url))
  const distribution = loadDesktopDistributionManifest(manifestPath)?.distribution ?? communityDistribution
  const { runtimeDataDir } = resolveDesktopDataDirectories({ appDataDir: app.getPath('appData'), development: false, distribution })
  return { name: distribution.name, sourceData: runtimeDataDir, sourceConfig: getCraftHubConfigDir() }
}
