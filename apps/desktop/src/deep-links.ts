import type { ProjectReference } from 'craft-hub'
import { normalizeProjectReference } from 'craft-hub'

export const productionDesktopScheme = 'craft-hub'
export const developmentDesktopScheme = 'craft-hub-dev'
const maximumDesktopLinkLength = 2_048

export type DesktopNavigationRequest
  = | { kind: 'home' }
    | { kind: 'marketplace' }
    | { kind: 'settings' }
    | { kind: 'workspace', workspaceId: string, ownerScopeId?: string }
    | { kind: 'project', reference: ProjectReference, capabilityId?: string }

export type DesktopLink
  = | { kind: 'cloud-connect', url: string }
    | { kind: 'celebration' }
    | { kind: 'marketplace-import', catalogUrl: string }
    | { kind: 'navigation', navigation: DesktopNavigationRequest }

export type DesktopLinkErrorCode
  = | 'invalid-url'
    | 'link-too-long'
    | 'missing-parameter'
    | 'repeated-parameter'
    | 'unexpected-action'
    | 'unexpected-fragment'
    | 'unexpected-parameter'
    | 'unexpected-scheme'
    | 'unexpected-version'
    | 'unexpected-view'
    | 'unsafe-repository'

/** Stable, privacy-safe reason returned when a Desktop Link is rejected. */
export class DesktopLinkError extends Error {
  readonly code: DesktopLinkErrorCode

  constructor(code: DesktopLinkErrorCode) {
    super(code)
    this.code = code
  }
}

/** Parse one strict Desktop Link without performing navigation or local mutations. */
export function parseDesktopLink(rawUrl: string, acceptedSchemes = [productionDesktopScheme, developmentDesktopScheme]): DesktopLink {
  if (rawUrl.length > maximumDesktopLinkLength)
    throw new DesktopLinkError('link-too-long')
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    throw new DesktopLinkError('invalid-url')
  }
  const scheme = url.protocol.slice(0, -1)
  if (!acceptedSchemes.includes(scheme))
    throw new DesktopLinkError('unexpected-scheme')
  if (url.hash)
    throw new DesktopLinkError('unexpected-fragment')

  if (url.host === 'cloud' && url.pathname === '/connect') {
    assertParameters(url, ['challenge', 'code'], ['challenge', 'code'])
    return { kind: 'cloud-connect', url: url.href }
  }

  if (url.host === 'marketplace' && url.pathname === '/sources/import') {
    assertParameters(url, ['catalog'], ['catalog'])
    const catalog = secureHttpsUrl(url.searchParams.get('catalog')!)
    return { kind: 'marketplace-import', catalogUrl: catalog }
  }

  if (url.pathname !== '' && url.pathname !== '/')
    throw new DesktopLinkError('unexpected-action')
  if (url.host === 'celebrate') {
    assertParameters(url, ['v'], ['v'])
    assertVersion(url)
    return { kind: 'celebration' }
  }
  if (url.host === 'open') {
    assertParameters(url, ['v'], ['v', 'view'])
    assertVersion(url)
    const view = url.searchParams.get('view') ?? 'home'
    if (view !== 'home' && view !== 'marketplace' && view !== 'settings')
      throw new DesktopLinkError('unexpected-view')
    return { kind: 'navigation', navigation: { kind: view } }
  }
  if (url.host === 'workspace') {
    assertParameters(url, ['id', 'v'], ['id', 'scope', 'v'])
    assertVersion(url)
    const ownerScopeId = url.searchParams.get('scope')
    return {
      kind: 'navigation',
      navigation: {
        kind: 'workspace',
        workspaceId: navigationIdentifier(url.searchParams.get('id')!),
        ...(ownerScopeId ? { ownerScopeId: navigationIdentifier(ownerScopeId) } : {}),
      },
    }
  }
  if (url.host === 'project') {
    assertParameters(url, ['repo', 'v'], ['capability', 'repo', 'v', 'subdir'])
    assertVersion(url)
    const repository = secureHttpsUrl(url.searchParams.get('repo')!)
    try {
      const capabilityId = url.searchParams.get('capability')
      return {
        kind: 'navigation',
        navigation: {
          kind: 'project',
          reference: normalizeProjectReference({ repository, subdir: url.searchParams.get('subdir') ?? undefined }),
          ...(capabilityId ? { capabilityId: navigationIdentifier(capabilityId) } : {}),
        },
      }
    }
    catch {
      throw new DesktopLinkError('unsafe-repository')
    }
  }
  throw new DesktopLinkError('unexpected-action')
}

/** Find the first Desktop Link passed to a Windows or Linux application process. */
export function findDesktopLinkArgument(argv: string[], acceptedSchemes = [productionDesktopScheme, developmentDesktopScheme]): string | undefined {
  return argv.find(argument => acceptedSchemes.some(scheme => argument.startsWith(`${scheme}://`)))
}

/** Keep independent pending callbacks while making normal navigation last-wins. */
export class DesktopLinkCoordinator {
  private celebrationPending = false
  private cloudConnect: string | undefined
  private marketplaceImport: string | undefined
  private navigation: DesktopNavigationRequest | undefined

  accept(rawUrl: string, acceptedSchemes?: string[]): DesktopLink {
    const link = parseDesktopLink(rawUrl, acceptedSchemes)
    if (link.kind === 'cloud-connect')
      this.cloudConnect = link.url
    else if (link.kind === 'celebration')
      this.celebrationPending = true
    else if (link.kind === 'marketplace-import')
      this.marketplaceImport = link.catalogUrl
    else
      this.navigation = link.navigation
    return link
  }

  consumeCelebration(): boolean {
    const value = this.celebrationPending
    this.celebrationPending = false
    return value
  }

  consumeCloudConnect(): string | undefined {
    const value = this.cloudConnect
    this.cloudConnect = undefined
    return value
  }

  consumeMarketplaceImport(): string | undefined {
    const value = this.marketplaceImport
    this.marketplaceImport = undefined
    return value
  }

  consumeNavigation(): DesktopNavigationRequest | undefined {
    const value = this.navigation
    this.navigation = undefined
    return value
  }

  hasMarketplaceImport(): boolean {
    return this.marketplaceImport !== undefined
  }

  hasCelebration(): boolean {
    return this.celebrationPending
  }

  hasNavigation(): boolean {
    return this.navigation !== undefined
  }
}

function assertParameters(url: URL, required: string[], allowed: string[]): void {
  const seen = new Set<string>()
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key))
      throw new DesktopLinkError('unexpected-parameter')
    if (seen.has(key))
      throw new DesktopLinkError('repeated-parameter')
    seen.add(key)
  }
  if (required.some(key => !seen.has(key) || !url.searchParams.get(key)))
    throw new DesktopLinkError('missing-parameter')
}

function assertVersion(url: URL): void {
  if (url.searchParams.get('v') !== '1')
    throw new DesktopLinkError('unexpected-version')
}

function navigationIdentifier(input: string): string {
  if (input.length > 512 || [...input].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127))
    throw new DesktopLinkError('unexpected-parameter')
  return input
}

function secureHttpsUrl(input: string): string {
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
      throw new Error('unsafe')
    return url.href
  }
  catch {
    throw new DesktopLinkError('unsafe-repository')
  }
}
