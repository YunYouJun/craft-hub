import { resolve } from 'node:path'
import { HostExtensionManager } from './host-extensions'
import { getCraftHubDataDir } from './platform'
import { loadCraftHubPlugins } from './plugins'
import { CraftHubRuntime } from './runtime'

/**
 * Create a local workbench with the same saved, trusted extensions as desktop.
 * Only workbench startup uses this path; discovery, CLI help, and explicitly
 * supplied runtimes do not implicitly import machine-local extension code.
 */
export async function createLocalCraftHubRuntime(hostPlugin?: string): Promise<CraftHubRuntime> {
  const dataDir = getCraftHubDataDir()
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
    plugins: loaded.plugins,
    pluginDiagnostics: [...configured.diagnostics, ...loaded.diagnostics],
  })
}
