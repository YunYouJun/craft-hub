import type { CapabilityProvider } from './extensions'
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** A trusted, host-installed extension to the Craft Hub runtime. */
export interface CraftHubPlugin {
  id: string
  name?: string
  version?: string
  capabilityProviders?: CapabilityProvider[]
}

export interface PluginDiagnostic {
  pluginId: string
  phase: 'load' | 'discover'
  message: string
}

export interface LoadCraftHubPluginsOptions {
  /** Directory whose node_modules and relative paths are used to resolve plugins. */
  baseDir?: string
}

export interface LoadCraftHubPluginsResult {
  plugins: CraftHubPlugin[]
  diagnostics: PluginDiagnostic[]
}

/** Preserve type inference while defining a Craft Hub plugin. */
export function defineCraftHubPlugin(plugin: CraftHubPlugin): CraftHubPlugin {
  return plugin
}

/**
 * Load explicitly configured plugin packages or local modules.
 *
 * Loading a plugin executes its module, so callers must only pass trusted,
 * installed dependencies. A broken plugin is reported without blocking the
 * remaining plugins.
 */
export async function loadCraftHubPlugins(
  specifiers: string[],
  options: LoadCraftHubPluginsOptions = {},
): Promise<LoadCraftHubPluginsResult> {
  const baseDir = resolve(options.baseDir ?? process.cwd())
  const require = createRequire(resolve(baseDir, 'package.json'))
  const plugins: CraftHubPlugin[] = []
  const diagnostics: PluginDiagnostic[] = []
  const ids = new Set<string>()

  for (const specifier of specifiers) {
    try {
      const modulePath = isAbsolute(specifier)
        ? specifier
        : specifier.startsWith('.')
          ? resolve(baseDir, specifier)
          : require.resolve(specifier)
      const module = await import(pathToFileURL(modulePath).href)
      const plugin = module.default ?? module.plugin
      assertPlugin(plugin, specifier)
      if (ids.has(plugin.id))
        throw new Error(`Duplicate plugin id: ${plugin.id}`)
      ids.add(plugin.id)
      plugins.push(plugin)
    }
    catch (error) {
      diagnostics.push({
        pluginId: specifier,
        phase: 'load',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { plugins, diagnostics }
}

function assertPlugin(value: unknown, specifier: string): asserts value is CraftHubPlugin {
  if (!value || typeof value !== 'object')
    throw new TypeError(`Plugin ${specifier} must export a plugin object as default or "plugin"`)
  const plugin = value as Partial<CraftHubPlugin>
  if (!plugin.id || typeof plugin.id !== 'string')
    throw new TypeError(`Plugin ${specifier} must have a non-empty string id`)
  if (plugin.capabilityProviders !== undefined && !Array.isArray(plugin.capabilityProviders))
    throw new TypeError(`Plugin ${specifier} capabilityProviders must be an array`)
}
