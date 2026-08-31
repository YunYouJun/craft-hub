import type { AgentTaskProvider } from './agent-tasks'
import type { MarketplaceSource, PluginPackageInstaller } from './marketplace'
import type { MarketplaceTrustPolicy } from './marketplace-trust'
import type { CraftHubPlugin } from './plugins'
import type { WorkbenchLocale } from './settings'
import type { Capability, CapabilityDiscoveryResult, ProjectRecord } from './types'
import { discoverCapabilitiesWithDiagnostics } from './discovery'

export interface DistributionConfig {
  id: string
  name: string
  appId?: string
  dataDirectoryName?: string
  /** Marketplace sources managed by this distribution. */
  marketplaceSources?: MarketplaceSource[]
  /** Publisher trust anchors provisioned by the host rather than an import link. */
  marketplaceTrustPolicies?: MarketplaceTrustPolicy[]
}

export interface CapabilityProviderContext {
  locale: WorkbenchLocale
  project: Readonly<ProjectRecord>
}

/** Adapter seam for contributing project capabilities without replacing discovery or execution. */
export interface CapabilityProvider {
  id: string
  discover: (context: CapabilityProviderContext) => Promise<Capability[] | CapabilityDiscoveryResult>
}

export interface CraftHubOptions {
  dataDir?: string
  configDir?: string
  distribution?: DistributionConfig
  /** Override npm package installation, primarily for embedded hosts and tests. */
  pluginPackageInstaller?: PluginPackageInstaller
  /** Plugins installed by the host distribution or application. */
  plugins?: CraftHubPlugin[]
  /** External agent adapter supplied by an embedding host. */
  agentTaskProvider?: AgentTaskProvider
  /** @deprecated Wrap providers in a Craft Hub plugin instead. */
  capabilityProviders?: CapabilityProvider[]
}

export const communityDistribution: DistributionConfig = {
  id: 'community',
  name: 'Craft Hub',
  appId: 'com.yunyoujun.craft-hub',
  dataDirectoryName: 'Craft Hub',
  marketplaceSources: [{
    id: 'craft-hub',
    name: 'Craft Hub',
    kind: 'builtin',
    catalogUrl: 'https://craft-hub.yunyoujun.cn/.well-known/craft-hub/plugins/v1/catalog.json',
    enabled: true,
    catalog: { schemaVersion: 1, id: 'craft-hub', name: 'Craft Hub', plugins: [] },
  }],
}

export const builtinCapabilityProvider: CapabilityProvider = {
  id: 'builtin',
  discover: context => discoverCapabilitiesWithDiagnostics(context.project.path, context.locale),
}

/** Preserve type inference while defining a third-party capability provider. */
export function defineCapabilityProvider(provider: CapabilityProvider): CapabilityProvider {
  return provider
}
