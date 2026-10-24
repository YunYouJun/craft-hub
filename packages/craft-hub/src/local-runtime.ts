import { resolve } from 'node:path'
import { HostExtensionManager } from './host-extensions'
import { getCraftHubConfigDir, getCraftHubDataDir } from './platform'
import { loadCraftHubPlugins } from './plugins'
import { acquireProfileLease } from './profile-lease'
import { CraftHubRuntime } from './runtime'

/**
 * Create a local workbench with the same saved, trusted extensions as desktop.
 * Only workbench startup uses this path; discovery, CLI help, and explicitly
 * supplied runtimes do not implicitly import machine-local extension code.
 */
export async function createLocalCraftHubRuntime(hostPlugin?: string): Promise<CraftHubRuntime> {
  const dataDir = getCraftHubDataDir()
  const lease = await acquireProfileLease([resolve(dataDir), resolve(getCraftHubConfigDir())])
  try {
    const manager = new HostExtensionManager(dataDir)
    const configured = hostPlugin
      ? await loadCraftHubPlugins([hostPlugin])
      : { plugins: [], diagnostics: [] }
    const preloadedModules = hostPlugin && !configured.diagnostics.length
      ? manager.prepare({
        id: 'command-line',
        name: 'Command-line Host Plugin',
        manifestPath: resolve('package.json'),
        modules: [hostPlugin],
      }).modules
      : []
    const loaded = await manager.load(configured.plugins, preloadedModules)
    return new CraftHubRuntime({
      dataDir,
      profileLease: lease,
      plugins: loaded.plugins,
      pluginDiagnostics: [...configured.diagnostics, ...loaded.diagnostics],
    })
  }
  catch (error) {
    lease.release()
    throw error
  }
}
