import type { RunHandle } from './executor'
import type { CapabilityProvider, CraftHubOptions, DistributionConfig } from './extensions'
import type { CraftHubPlugin, PluginDiagnostic } from './plugins'
import type { Capability, CommandCapability, ProjectRecord, RunOutputEvent } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { executeCommand } from './executor'
import { builtinCapabilityProvider, communityDistribution } from './extensions'
import { getCraftHubDataDir } from './platform'
import { ProjectRegistry } from './projects'
import { CraftHubStore } from './store'

export class CraftHubRuntime {
  readonly store: CraftHubStore
  readonly projects: ProjectRegistry
  readonly distribution: DistributionConfig
  private readonly capabilityProviders: Array<{ pluginId?: string, provider: CapabilityProvider }>
  private diagnostics: PluginDiagnostic[] = []

  constructor(options: string | CraftHubOptions = {}) {
    const normalizedOptions = typeof options === 'string' ? { dataDir: options } : options
    this.distribution = normalizedOptions.distribution ?? communityDistribution
    const plugins = normalizedOptions.plugins ?? []
    assertUniquePluginIds(plugins)
    this.capabilityProviders = [
      { provider: builtinCapabilityProvider },
      ...(normalizedOptions.capabilityProviders ?? []).map(provider => ({ provider })),
      ...plugins.flatMap(plugin => (plugin.capabilityProviders ?? []).map(provider => ({ pluginId: plugin.id, provider }))),
    ]
    this.store = new CraftHubStore(normalizedOptions.dataDir ?? getCraftHubDataDir(process.env, this.distribution.dataDirectoryName ?? this.distribution.name))
    this.projects = new ProjectRegistry(this.store)
  }

  async addProject(path: string): Promise<ProjectRecord> {
    return this.projects.add(resolve(path))
  }

  async capabilities(projectId: string): Promise<Capability[]> {
    const project = await this.projects.get(projectId)
    this.diagnostics = []
    const capabilities: Capability[] = []
    const ids = new Set<string>()
    for (const entry of this.capabilityProviders) {
      try {
        const discovered = await entry.provider.discover({ project })
        validateCapabilities(discovered, ids, project.path)
        for (const capability of discovered) {
          ids.add(capability.id)
          capabilities.push(capability)
        }
      }
      catch (error) {
        if (!entry.pluginId)
          throw error
        this.diagnostics.push({
          pluginId: entry.pluginId,
          phase: 'discover',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return capabilities.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Diagnostics from the most recent plugin discovery pass. */
  getPluginDiagnostics(): readonly PluginDiagnostic[] {
    return this.diagnostics
  }

  async run(projectId: string, capabilityId: string, onOutput?: (event: RunOutputEvent) => void): Promise<RunHandle> {
    const project = await this.projects.get(projectId)
    const capability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability)
      throw new Error(`Unknown capability: ${capabilityId}`)
    if (capability.kind !== 'command')
      throw new Error('Skills are inspected or handed to an agent; they are not shell commands')
    return executeCommand(this.store, project, capability as CommandCapability, onOutput)
  }
}

function assertUniquePluginIds(plugins: CraftHubPlugin[]): void {
  const ids = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.id)
      throw new Error('Craft Hub plugins require a non-empty id')
    if (ids.has(plugin.id))
      throw new Error(`Duplicate plugin id: ${plugin.id}`)
    ids.add(plugin.id)
  }
}

function validateCapabilities(capabilities: Capability[], existingIds: Set<string>, projectPath: string): void {
  const providerIds = new Set<string>()
  for (const capability of capabilities) {
    if (existingIds.has(capability.id) || providerIds.has(capability.id))
      throw new Error(`Duplicate capability id: ${capability.id}`)
    providerIds.add(capability.id)
    if (capability.kind === 'command' && capability.invocation.cwd !== projectPath)
      throw new Error(`Capability ${capability.id} uses a working directory outside its project`)
  }
}

/** Create a configured Craft Hub runtime for a community or downstream distribution. */
export function createCraftHub(options: CraftHubOptions = {}): CraftHubRuntime {
  return new CraftHubRuntime(options)
}
