import type { DistributionConfig, MarketplaceSource, MarketplaceTrustPolicy } from 'craft-hub'
import { readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pluginCatalogV1Schema } from 'craft-hub'

export interface DesktopAboutBranding {
  authors: string[]
  copyright: string
  description: string
  license: string
  linkLabel: string
  website: string
}

export interface DesktopDistributionManifest {
  schemaVersion: 1
  distribution: DistributionConfig
  desktop: {
    about?: DesktopAboutBranding
    artifactName: string
    developmentProtocol: string
    icons?: {
      application: string
      macos: string
    }
    protocol: string
    updateBaseUrl?: string
  }
}

export const communityDesktopAboutBranding: DesktopAboutBranding = {
  authors: ['YunYouJun'],
  copyright: 'Copyright © YunYouJun',
  description: 'A local, cross-project developer workbench.',
  license: 'Open source under the MIT License.',
  linkLabel: 'GitHub',
  website: 'https://github.com/YunYouJun/craft-hub',
}

export const communityDesktopArtifactName = 'Craft-Hub'
export const communityDesktopProtocol = 'craft-hub'
export const communityDesktopDevelopmentProtocol = 'craft-hub-dev'
export const communityDesktopUpdateBaseUrl = 'https://craft-hub.pages.dev/updates/alpha'

/** Parse the small, versioned interface supplied by a downstream desktop distribution. */
export function parseDesktopDistributionManifest(input: unknown): DesktopDistributionManifest {
  const root = objectValue(input, 'Desktop distribution manifest')
  if (root.schemaVersion !== 1)
    throw new Error('Desktop distribution manifest schemaVersion must be 1')

  const rawDistribution = objectValue(root.distribution, 'distribution')
  const distribution: DistributionConfig = {
    id: requiredString(rawDistribution.id, 'distribution.id'),
    name: safeFileName(rawDistribution.name, 'distribution.name'),
  }
  if (rawDistribution.appId !== undefined) {
    distribution.appId = requiredString(rawDistribution.appId, 'distribution.appId')
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(distribution.appId))
      throw new Error('distribution.appId must be a reverse-DNS identifier')
  }
  if (rawDistribution.dataDirectoryName !== undefined)
    distribution.dataDirectoryName = safeFileName(rawDistribution.dataDirectoryName, 'distribution.dataDirectoryName')
  if (rawDistribution.marketplaceSources !== undefined) {
    if (!Array.isArray(rawDistribution.marketplaceSources))
      throw new Error('distribution.marketplaceSources must be an array')
    distribution.marketplaceSources = rawDistribution.marketplaceSources.map((source, index) => parseMarketplaceSource(source, index))
  }
  if (rawDistribution.marketplaceTrustPolicies !== undefined) {
    if (!Array.isArray(rawDistribution.marketplaceTrustPolicies))
      throw new Error('distribution.marketplaceTrustPolicies must be an array')
    distribution.marketplaceTrustPolicies = rawDistribution.marketplaceTrustPolicies.map((policy, index) => parseMarketplaceTrustPolicy(policy, index))
  }

  const rawDesktop = objectValue(root.desktop, 'desktop')
  const protocol = protocolValue(rawDesktop.protocol, 'desktop.protocol')
  const developmentProtocol = rawDesktop.developmentProtocol === undefined
    ? `${protocol}-dev`
    : protocolValue(rawDesktop.developmentProtocol, 'desktop.developmentProtocol')
  if (developmentProtocol === protocol)
    throw new Error('desktop.developmentProtocol must differ from desktop.protocol')

  const desktop: DesktopDistributionManifest['desktop'] = {
    artifactName: artifactNameValue(rawDesktop.artifactName),
    developmentProtocol,
    protocol,
  }
  if (rawDesktop.updateBaseUrl !== undefined && rawDesktop.updateBaseUrl !== null)
    desktop.updateBaseUrl = secureHttpsUrl(rawDesktop.updateBaseUrl, 'desktop.updateBaseUrl')
  if (rawDesktop.about !== undefined)
    desktop.about = parseAboutBranding(rawDesktop.about)
  if (rawDesktop.icons !== undefined)
    desktop.icons = parseDesktopIcons(rawDesktop.icons)

  return { schemaVersion: 1, distribution, desktop }
}

/** Load an optional downstream manifest; a missing file selects the community distribution. */
export function loadDesktopDistributionManifest(path: string | undefined): DesktopDistributionManifest | undefined {
  if (!path)
    return undefined
  try {
    return parseDesktopDistributionManifest(JSON.parse(readFileSync(path, 'utf8')))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw new Error(`Could not load desktop distribution manifest at ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** Resolve one validated distribution asset relative to the manifest that declared it. */
export function resolveDesktopDistributionAsset(manifestPath: string, assetPath: string): string {
  const manifestDirectory = dirname(resolve(manifestPath))
  const resolvedAsset = resolve(manifestDirectory, assetPath)
  const relativeAsset = relative(manifestDirectory, resolvedAsset)
  if (!relativeAsset || relativeAsset === '..' || relativeAsset.startsWith(`..${sep}`) || isAbsolute(relativeAsset))
    throw new Error(`Desktop distribution asset must stay inside the manifest directory: ${assetPath}`)
  return resolvedAsset
}

function parseMarketplaceSource(input: unknown, index: number): MarketplaceSource {
  const path = `distribution.marketplaceSources[${index}]`
  const source = objectValue(input, path)
  if (source.kind !== 'builtin' && source.kind !== 'managed')
    throw new Error(`${path}.kind must be builtin or managed`)
  const parsed: MarketplaceSource = {
    enabled: booleanValue(source.enabled, `${path}.enabled`),
    id: requiredString(source.id, `${path}.id`),
    kind: source.kind,
    name: requiredString(source.name, `${path}.name`),
  }
  if (source.catalogUrl !== undefined)
    parsed.catalogUrl = secureHttpsUrl(source.catalogUrl, `${path}.catalogUrl`)
  if (source.registry !== undefined)
    parsed.registry = secureHttpsUrl(source.registry, `${path}.registry`)
  if (source.catalog !== undefined)
    parsed.catalog = pluginCatalogV1Schema.parse(source.catalog)
  if (!parsed.catalogUrl && !parsed.catalog)
    throw new Error(`${path} must provide catalogUrl or catalog`)
  return parsed
}

function parseMarketplaceTrustPolicy(input: unknown, index: number): MarketplaceTrustPolicy {
  const path = `distribution.marketplaceTrustPolicies[${index}]`
  const policy = objectValue(input, path)
  if (policy.algorithm !== 'ed25519')
    throw new Error(`${path}.algorithm must be ed25519`)
  const publicKeySpki = requiredString(policy.publicKeySpki, `${path}.publicKeySpki`)
  if (!/^[\w-]+$/.test(publicKeySpki))
    throw new Error(`${path}.publicKeySpki must use base64url encoding`)
  const parsed: MarketplaceTrustPolicy = {
    id: requiredString(policy.id, `${path}.id`),
    organization: requiredString(policy.organization, `${path}.organization`),
    catalogUrl: secureHttpsUrl(policy.catalogUrl, `${path}.catalogUrl`),
    algorithm: policy.algorithm,
    publicKeySpki,
  }
  if (policy.signatureUrl !== undefined)
    parsed.signatureUrl = secureHttpsUrl(policy.signatureUrl, `${path}.signatureUrl`)
  return parsed
}

function parseAboutBranding(input: unknown): DesktopAboutBranding {
  const about = objectValue(input, 'desktop.about')
  if (!Array.isArray(about.authors) || about.authors.length === 0)
    throw new Error('desktop.about.authors must be a non-empty string array')
  return {
    authors: about.authors.map((author, index) => requiredString(author, `desktop.about.authors[${index}]`)),
    copyright: requiredString(about.copyright, 'desktop.about.copyright'),
    description: requiredString(about.description, 'desktop.about.description'),
    license: requiredString(about.license, 'desktop.about.license'),
    linkLabel: requiredString(about.linkLabel, 'desktop.about.linkLabel'),
    website: secureHttpsUrl(about.website, 'desktop.about.website'),
  }
}

function parseDesktopIcons(input: unknown): NonNullable<DesktopDistributionManifest['desktop']['icons']> {
  const icons = objectValue(input, 'desktop.icons')
  return {
    application: distributionAssetPath(icons.application, 'desktop.icons.application', '.png'),
    macos: distributionAssetPath(icons.macos, 'desktop.icons.macos', '.icns'),
  }
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a non-empty string`)
  return value
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean')
    throw new Error(`${name} must be a boolean`)
  return value
}

function protocolValue(value: unknown, name: string): string {
  const protocol = requiredString(value, name)
  if (!/^[a-z][a-z0-9+.-]*$/.test(protocol))
    throw new Error(`${name} must be a lowercase URL scheme`)
  return protocol
}

function artifactNameValue(value: unknown): string {
  const artifactName = requiredString(value, 'desktop.artifactName')
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(artifactName))
    throw new Error('desktop.artifactName may contain only letters, digits, and hyphens')
  return artifactName
}

function distributionAssetPath(value: unknown, name: string, expectedExtension: string): string {
  const assetPath = requiredString(value, name)
  const segments = assetPath.split('/')
  if (
    isAbsolute(assetPath)
    || assetPath.includes('\\')
    || assetPath.includes('\0')
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${name} must be a safe path relative to the distribution manifest`)
  }
  if (extname(assetPath).toLowerCase() !== expectedExtension)
    throw new Error(`${name} must reference a ${expectedExtension} file`)
  return assetPath
}

function safeFileName(value: unknown, name: string): string {
  const filename = requiredString(value, name)
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\') || filename.includes('\0'))
    throw new Error(`${name} must be a safe file name`)
  return filename
}

function secureHttpsUrl(value: unknown, name: string): string {
  const input = requiredString(value, name)
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('unsafe')
    return url.href.replace(/\/$/, input.endsWith('/') ? '/' : '')
  }
  catch {
    throw new Error(`${name} must be a credential-free HTTPS URL`)
  }
}
