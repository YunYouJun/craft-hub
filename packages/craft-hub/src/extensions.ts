import type { CraftHubPlugin } from './plugins'
import type { Capability, ProjectRecord } from './types'
import { discoverCapabilities } from './discovery'

export interface DistributionConfig {
  id: string
  name: string
  appId?: string
  dataDirectoryName?: string
}

export interface CapabilityProviderContext {
  project: Readonly<ProjectRecord>
}

/** Adapter seam for contributing project capabilities without replacing discovery or execution. */
export interface CapabilityProvider {
  id: string
  discover: (context: CapabilityProviderContext) => Promise<Capability[]>
}

export interface CraftHubOptions {
  dataDir?: string
  distribution?: DistributionConfig
  /** Plugins installed by the host distribution or application. */
  plugins?: CraftHubPlugin[]
  /** @deprecated Wrap providers in a Craft Hub plugin instead. */
  capabilityProviders?: CapabilityProvider[]
}

export const communityDistribution: DistributionConfig = {
  id: 'community',
  name: 'Craft Hub',
  appId: 'com.yunyoujun.craft-hub',
  dataDirectoryName: 'Craft Hub',
}

export const builtinCapabilityProvider: CapabilityProvider = {
  id: 'builtin',
  discover: context => discoverCapabilities(context.project.path),
}

/** Preserve type inference while defining a third-party capability provider. */
export function defineCapabilityProvider(provider: CapabilityProvider): CapabilityProvider {
  return provider
}
