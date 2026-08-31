import { Buffer } from 'node:buffer'
import { createPublicKey, verify } from 'node:crypto'

export const marketplaceCatalogKeyIdHeader = 'x-craft-hub-key-id'
export const marketplaceCatalogSignatureHeader = 'x-craft-hub-signature'

/** A host-provisioned trust anchor for one exact marketplace Catalog URL. */
export interface MarketplaceTrustPolicy {
  id: string
  organization: string
  catalogUrl: string
  /** Optional detached-signature JSON URL. Defaults to `<catalogUrl>.sig`. */
  signatureUrl?: string
  algorithm: 'ed25519'
  /** Base64url-encoded DER SubjectPublicKeyInfo. The corresponding private key stays outside Craft Hub. */
  publicKeySpki: string
}

/** Successful publisher-identity verification for fetched Catalog bytes. */
export interface MarketplaceSourceVerification {
  policyId: string
  organization: string
  verifiedAt: string
}

/** Verify detached Catalog signatures against host-provisioned, URL-pinned trust policies. */
export class MarketplaceCatalogTrust {
  private readonly policiesByCatalogUrl = new Map<string, MarketplaceTrustPolicy>()

  constructor(policies: MarketplaceTrustPolicy[] = [], private readonly fetcher: typeof fetch = fetch) {
    for (const policy of policies) {
      const catalogUrl = secureCatalogUrl(policy.catalogUrl)
      if (!policy.id.trim() || !policy.organization.trim())
        throw new Error('Marketplace trust policy id and organization must be non-empty')
      if (policy.algorithm !== 'ed25519')
        throw new Error(`Unsupported marketplace trust algorithm: ${String(policy.algorithm)}`)
      if (this.policiesByCatalogUrl.has(catalogUrl))
        throw new Error(`Marketplace trust policy already exists for Catalog: ${catalogUrl}`)
      this.policiesByCatalogUrl.set(catalogUrl, {
        ...policy,
        catalogUrl,
        ...(policy.signatureUrl ? { signatureUrl: secureCatalogUrl(policy.signatureUrl) } : {}),
      })
    }
  }

  async verify(catalogUrl: string, bytes: Uint8Array, headers: Headers): Promise<MarketplaceSourceVerification | undefined> {
    const policy = this.policiesByCatalogUrl.get(secureCatalogUrl(catalogUrl))
    if (!policy)
      return undefined

    const headerKeyId = headers.get(marketplaceCatalogKeyIdHeader)
    const headerSignature = headers.get(marketplaceCatalogSignatureHeader)
    if (Boolean(headerKeyId) !== Boolean(headerSignature))
      throw new Error('Trusted marketplace Catalog response has incomplete signature headers')
    const detached = headerKeyId && headerSignature
      ? { keyId: headerKeyId, signature: headerSignature }
      : await this.fetchDetachedSignature(policy)
    const { keyId, signature: signatureValue } = detached
    if (keyId !== policy.id)
      throw new Error('Trusted marketplace Catalog response used an unexpected signing key')

    const publicKey = createPublicKey({
      key: decodeBase64Url(policy.publicKeySpki, 'Marketplace trust public key'),
      format: 'der',
      type: 'spki',
    })
    if (publicKey.asymmetricKeyType !== 'ed25519')
      throw new Error('Marketplace trust public key must be Ed25519')
    const signature = decodeBase64Url(signatureValue, 'Marketplace Catalog signature')
    if (!verify(null, bytes, publicKey, signature))
      throw new Error('Trusted marketplace Catalog signature is invalid')

    return {
      policyId: policy.id,
      organization: policy.organization,
      verifiedAt: new Date().toISOString(),
    }
  }

  retains(catalogUrl: string | undefined, verification: MarketplaceSourceVerification | undefined): boolean {
    if (!catalogUrl || !verification)
      return false
    const policy = this.policiesByCatalogUrl.get(secureCatalogUrl(catalogUrl))
    return policy?.id === verification.policyId && policy.organization === verification.organization
  }

  private async fetchDetachedSignature(policy: MarketplaceTrustPolicy): Promise<{ keyId: string, signature: string }> {
    const signatureUrl = policy.signatureUrl ?? `${policy.catalogUrl}.sig`
    const response = await this.fetcher(signatureUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok)
      throw new Error(`Trusted marketplace Catalog signature request failed: ${response.status}`)
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > 4096)
      throw new Error('Trusted marketplace Catalog signature response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 4096)
      throw new Error('Trusted marketplace Catalog signature response is too large')
    const document = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    if (document.schemaVersion !== 1 || typeof document.keyId !== 'string' || typeof document.signature !== 'string')
      throw new Error('Trusted marketplace Catalog signature response is invalid')
    return { keyId: document.keyId, signature: document.signature }
  }
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!/^[\w-]+$/.test(value))
    throw new Error(`${label} must use base64url encoding`)
  return Buffer.from(value, 'base64url')
}

function secureCatalogUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Marketplace trust policy Catalog URL must use credential-free HTTPS')
  return url.href
}
