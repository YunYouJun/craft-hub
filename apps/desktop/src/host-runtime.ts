import type { CraftHubPlugin, DistributionConfig, HostExtensionManager, WorkbenchCodexSetting } from 'craft-hub'
import { dirname } from 'node:path'
import codexConfigurationPlugin from '@craft-hub/craft-hub-plugin-codex'
import { createMicrosoftTodoPlugin, createMicrosoftTodoTransport } from '@craft-hub/craft-hub-plugin-microsoft-todo'
import { CraftHubRuntime, loadCraftHubPlugins } from 'craft-hub'
import { CodexAgentTaskProvider } from './codex-agent-task-provider.ts'
import { CodexWorkAssistant } from './codex-work-assistant.ts'
import { desktopWorkstation } from './workstation-runtime.ts'

/** Built-in host plugins every desktop host composes into its runtime, with the connections to close on shutdown. */
export interface BuiltinHostPlugins {
  plugins: CraftHubPlugin[]
  workstation: ReturnType<typeof desktopWorkstation>
  closeConnections: () => Promise<void>[]
}

/** Host plugins a distribution manifest declares, resolved from the manifest's directory. */
export interface DistributionHostPlugins {
  id: string
  name: string
  manifestPath: string
  modules: string[]
}

/** Inputs shared by the Electron host and the native host's runtime sidecar. */
export interface DesktopHostRuntimeOptions {
  dataDir: string
  /** Portable user configuration; defaults to the runtime's own configuration directory. */
  configDir?: string
  distribution: DistributionConfig
  distributionPlugins?: DistributionHostPlugins
  builtinPlugins: CraftHubPlugin[]
  hostExtensions: HostExtensionManager
  logError: (message: string) => void
}

/** Create the built-in Codex configuration, Microsoft To Do and Workstation host plugins. */
export function createBuiltinHostPlugins(options: { workstationDirectory: string }): BuiltinHostPlugins {
  const microsoftTodoTransport = createMicrosoftTodoTransport({ keepAlive: true })
  const microsoftTodoWriteTransport = createMicrosoftTodoTransport({ keepAlive: true, writable: true })
  const workstation = desktopWorkstation({ directory: options.workstationDirectory })
  return {
    plugins: [codexConfigurationPlugin, createMicrosoftTodoPlugin({ transport: microsoftTodoTransport, writeTransport: microsoftTodoWriteTransport }), workstation.plugin],
    workstation,
    closeConnections: () => [microsoftTodoTransport.close(), microsoftTodoWriteTransport.close()],
  }
}

/**
 * Compose the runtime a desktop host serves: distribution host plugins first, then approved host extensions, then
 * the built-in plugins a distribution does not replace, with Codex providing agent tasks and the work assistant.
 * Plugin load failures are reported as diagnostics instead of stopping the host.
 */
export async function createDesktopHostRuntime(options: DesktopHostRuntimeOptions): Promise<CraftHubRuntime> {
  let runtime!: CraftHubRuntime
  const codexSettings = async (): Promise<WorkbenchCodexSetting> => (await runtime.settings.get()).settings['workbench.codex']
  const distributionPlugins = options.distributionPlugins?.modules.length ? options.distributionPlugins : undefined
  const configuredPlugins = distributionPlugins
    ? await loadCraftHubPlugins(distributionPlugins.modules, { baseDir: dirname(distributionPlugins.manifestPath) })
    : { plugins: [], diagnostics: [] }
  const preloadedModules = distributionPlugins && !configuredPlugins.diagnostics.length
    ? options.hostExtensions.prepare(distributionPlugins).modules
    : []
  const hostPlugins = await options.hostExtensions.load([
    ...configuredPlugins.plugins,
    ...options.builtinPlugins.filter(builtin => !configuredPlugins.plugins.some(plugin => plugin.id === builtin.id)),
  ], preloadedModules)
  hostPlugins.diagnostics.unshift(...configuredPlugins.diagnostics)
  for (const diagnostic of hostPlugins.diagnostics)
    options.logError(`Host Plugin ${diagnostic.pluginId} failed to load: ${diagnostic.message}`)
  runtime = new CraftHubRuntime({
    agentTaskProvider: new CodexAgentTaskProvider(codexSettings),
    workAssistantProvider: new CodexWorkAssistant(codexSettings),
    dataDir: options.dataDir,
    ...(options.configDir ? { configDir: options.configDir } : {}),
    distribution: options.distribution,
    pluginDiagnostics: hostPlugins.diagnostics,
    plugins: hostPlugins.plugins,
  })
  return runtime
}
