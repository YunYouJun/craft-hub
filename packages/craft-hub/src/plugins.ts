import type { AccountProvider } from './accounts'
import type { HostDiagnosticProvider } from './diagnostics'
import type { EnvironmentSetupProvider } from './environment-setup'
import type { EnvironmentSourceProvider } from './environment-sources'
import type { CapabilityProvider } from './extensions'
import type { IntegrationContribution, IntegrationProvider } from './integrations'
import type { RepositoryValidationProvider } from './repository-validation'
import type { SoftwareCatalogProvider } from './software-catalog'
import type { WorkspaceCatalogProvider } from './workspace-catalog'
import type { WorkspaceRepositoryProvider } from './workspace-repository'
import { createRequire } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { integrationContributionSchema } from './integrations'
import { assertRepositoryValidationProviders } from './repository-validation'

/** A trusted, host-installed extension to the Craft Hub runtime. */
export interface CraftHubPlugin {
  id: string
  name?: string
  version?: string
  /** Display-only prerequisite and source-connection guidance; never an execution provider. */
  environmentSetupProviders?: EnvironmentSetupProvider[]
  /** Explicit local source connections, separate from read-only prerequisite checks. */
  environmentSourceProviders?: EnvironmentSourceProvider[]
  accountProvider?: AccountProvider
  workspaceRepositoryProviders?: WorkspaceRepositoryProvider[]
  workspaceCatalogProviders?: WorkspaceCatalogProvider[]
  /** Read-only software catalogs supplied by the trusted local host. */
  softwareCatalogProviders?: SoftwareCatalogProvider[]
  capabilityProviders?: CapabilityProvider[]
  integrationProviders?: IntegrationProvider[]
  /** Read-only host diagnostics; local providers are never called by hosted runtimes. */
  diagnosticProviders?: HostDiagnosticProvider[]
  /** Pure content validators explicitly loaded for read-only repository validation. */
  repositoryValidationProviders?: RepositoryValidationProvider[]
  /** Declarative views shipped with an explicitly loaded trusted Host Plugin. */
  integrations?: IntegrationContribution[]
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
  if (plugin.integrations !== undefined) {
    if (!Array.isArray(plugin.integrations))
      throw new TypeError(`Plugin ${specifier} integrations must be an array`)
    plugin.integrations.forEach(contribution => integrationContributionSchema.parse(contribution))
  }
  if (plugin.integrationProviders !== undefined && !Array.isArray(plugin.integrationProviders))
    throw new TypeError(`Plugin ${specifier} integrationProviders must be an array`)
  if (plugin.softwareCatalogProviders !== undefined && !Array.isArray(plugin.softwareCatalogProviders))
    throw new TypeError(`Plugin ${specifier} softwareCatalogProviders must be an array`)
  if (plugin.environmentSetupProviders !== undefined && (!Array.isArray(plugin.environmentSetupProviders) || plugin.environmentSetupProviders.length > 20))
    throw new TypeError(`Plugin ${specifier} environmentSetupProviders must be an array with at most 20 providers`)
  if (plugin.environmentSourceProviders !== undefined && (!Array.isArray(plugin.environmentSourceProviders) || plugin.environmentSourceProviders.length > 20))
    throw new TypeError(`Plugin ${specifier} environmentSourceProviders must be an array with at most 20 providers`)
  if (plugin.repositoryValidationProviders !== undefined)
    assertRepositoryValidationProviders(plugin.repositoryValidationProviders)
  if (plugin.diagnosticProviders !== undefined) {
    if (!Array.isArray(plugin.diagnosticProviders) || plugin.diagnosticProviders.length > 20)
      throw new TypeError(`Plugin ${specifier} diagnosticProviders must be an array with at most 20 providers`)
    const ids = new Set<string>()
    for (const provider of plugin.diagnosticProviders) {
      if (!provider || typeof provider.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(provider.id)
        || typeof provider.title !== 'string' || !provider.title || provider.title.length > 256 || /\p{Cc}/u.test(provider.title)
        || typeof provider.read !== 'function' || (provider.localOnly !== undefined && typeof provider.localOnly !== 'boolean')) {
        throw new TypeError(`Plugin ${specifier} has an invalid diagnostic provider`)
      }
      if (ids.has(provider.id))
        throw new TypeError(`Plugin ${specifier} has duplicate diagnostic provider ids`)
      ids.add(provider.id)
    }
  }
}
