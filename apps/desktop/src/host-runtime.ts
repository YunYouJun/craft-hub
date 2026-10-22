import type { CraftHubPlugin, DistributionConfig, HostExtensionManager, HostExtensionStatus, WorkbenchCodexSetting } from 'craft-hub'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import codexConfigurationPlugin from '@craft-hub/craft-hub-plugin-codex'
import { createMicrosoftTodoPlugin, createMicrosoftTodoTransport } from '@craft-hub/craft-hub-plugin-microsoft-todo'
import { CraftHubRuntime, loadCraftHubPlugins } from 'craft-hub'
import { CodexAgentTaskProvider } from './codex-agent-task-provider.ts'
import { CodexWorkAssistant } from './codex-work-assistant.ts'
import { desktopWorkstation } from './workstation-runtime.ts'

/**
 * A plugin shipped with the application that loads only when the user enables it in plugin management. Without a
 * saved choice, `enabledByDefault` decides, so existing users keep what they already use.
 */
export interface OptionalHostPlugin {
  id: string
  name: string
  plugin: CraftHubPlugin
  enabledByDefault: () => Promise<boolean>
}

/** Built-in host plugins every desktop host composes into its runtime, with the connections to close on shutdown. */
export interface BuiltinHostPlugins {
  plugins: CraftHubPlugin[]
  optionalPlugins: OptionalHostPlugin[]
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
  optionalPlugins?: OptionalHostPlugin[]
  hostExtensions: HostExtensionManager
  logError: (message: string) => void
}

/** Microsoft To Do is optional: its local connectors are two Node processes and its packages are the largest. */
export const microsoftTodoBundledId = 'microsoft-todo'
// Reads back the home page often, so its connector outlives ordinary pauses; writes happen in short bursts.
const microsoftTodoReadIdleMs = 10 * 60_000
const microsoftTodoWriteIdleMs = 2 * 60_000

/** Whether a runtime data directory records a Microsoft To Do connection the user enabled before it became optional. */
export async function hasMicrosoftTodoConnection(dataDir: string): Promise<boolean> {
  try {
    const saved = JSON.parse(await readFile(join(dataDir, 'integrations', 'microsoft-todo', 'connection.json'), 'utf8')) as { enabled?: unknown }
    return saved.enabled === true
  }
  catch {
    return false
  }
}

/**
 * Create the built-in Codex configuration and Workstation host plugins, and the optional Microsoft To Do plugin.
 * To Do connectors start on the first call and close after an idle period instead of staying resident.
 */
export function createBuiltinHostPlugins(options: { workstationDirectory: string, dataDir: string }): BuiltinHostPlugins {
  const microsoftTodoTransport = createMicrosoftTodoTransport({ idleTimeoutMs: microsoftTodoReadIdleMs })
  const microsoftTodoWriteTransport = createMicrosoftTodoTransport({ idleTimeoutMs: microsoftTodoWriteIdleMs, writable: true })
  const workstation = desktopWorkstation({ directory: options.workstationDirectory })
  const microsoftTodo = createMicrosoftTodoPlugin({
    transport: microsoftTodoTransport,
    writeTransport: microsoftTodoWriteTransport,
    // Follow the host's runtime data, not the default directory, so an isolated host never reads another's account.
    statePath: join(options.dataDir, 'integrations', 'microsoft-todo', 'connection.json'),
  })
  return {
    plugins: [codexConfigurationPlugin, workstation.plugin],
    optionalPlugins: [{ id: microsoftTodoBundledId, name: 'Microsoft To Do', plugin: microsoftTodo, enabledByDefault: () => hasMicrosoftTodoConnection(options.dataDir) }],
    workstation,
    closeConnections: () => [microsoftTodoTransport.close(), microsoftTodoWriteTransport.close()],
  }
}

/** Whether an optional plugin loads: the user's saved choice, otherwise its default. */
export async function isOptionalHostPluginEnabled(hostExtensions: HostExtensionManager, optional: OptionalHostPlugin): Promise<boolean> {
  return await hostExtensions.bundledChoice(optional.id) ?? await optional.enabledByDefault()
}

/** Plugin management entries for optional plugins, reporting whether each loads on the next startup. */
export async function optionalHostPluginStatus(hostExtensions: HostExtensionManager, optionalPlugins: OptionalHostPlugin[]): Promise<NonNullable<HostExtensionStatus['bundledExtensions']>> {
  return Promise.all(optionalPlugins.map(async optional => ({
    id: optional.id,
    name: optional.name,
    version: optional.plugin.version ?? '',
    optional: true,
    enabled: await isOptionalHostPluginEnabled(hostExtensions, optional),
  })))
}

/**
 * Compose the runtime a desktop host serves: distribution host plugins first, then approved host extensions, then
 * the built-in plugins a distribution does not replace, including optional ones the user enabled, with Codex
 * providing agent tasks and the work assistant. Plugin load failures are reported as diagnostics instead of
 * stopping the host.
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
  const enabledOptional: CraftHubPlugin[] = []
  for (const optional of options.optionalPlugins ?? []) {
    if (await isOptionalHostPluginEnabled(options.hostExtensions, optional))
      enabledOptional.push(optional.plugin)
  }
  const hostPlugins = await options.hostExtensions.load([
    ...configuredPlugins.plugins,
    ...[...options.builtinPlugins, ...enabledOptional].filter(builtin => !configuredPlugins.plugins.some(plugin => plugin.id === builtin.id)),
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

/** Allow the native host to toggle only shipped optional plugins, never arbitrary executable modules. */
export function bundledHostExtensionControls(manager: HostExtensionManager, builtins: BuiltinHostPlugins): {
  status: () => Promise<HostExtensionStatus>
  setEnabled: (id: string, enabled: boolean) => Promise<HostExtensionStatus>
} {
  const status = async (): Promise<HostExtensionStatus> => ({
    ...await manager.status(),
    bundledExtensions: [
      ...(builtins.workstation.bundled ? [{ id: 'workstation', name: 'Workstation', version: builtins.workstation.bundled.version }] : []),
      ...await optionalHostPluginStatus(manager, builtins.optionalPlugins),
    ],
  })
  return {
    status,
    async setEnabled(id, enabled) {
      if (!builtins.optionalPlugins.some(plugin => plugin.id === id))
        throw new Error('Only optional plugins shipped with this app can be changed')
      await manager.setBundledEnabled(id, enabled)
      return status()
    },
  }
}
