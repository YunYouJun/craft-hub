import { Buffer } from 'node:buffer'
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { nativeReleaseConfiguration, nativeUpdatePlist, verifyNativeAppcast, xmlText } from './native-release.ts'

const environment = {
  CRAFT_HUB_NATIVE_RELEASE: 'true',
  MACOS_KEYCHAIN_PATH: '/private/tmp/signing.keychain-db',
  APPLE_API_KEY_PATH: '/private/tmp/AuthKey.p8',
  APPLE_API_KEY_ID: 'example-key',
  APPLE_API_ISSUER_ID: 'example-issuer',
  SPARKLE_PUBLIC_ED_KEY: Buffer.alloc(32, 1).toString('base64'),
}

describe('native release configuration', () => {
  it('keeps local builds disabled even when release credentials exist', () => {
    const config = nativeReleaseConfiguration('0.0.1-alpha.5', 'arm64', { ...environment, CRAFT_HUB_NATIVE_RELEASE: undefined })
    expect(config.enabled).toBe(false)
    expect(config.bundleVersion).toBe('0.0.1005')
    expect(nativeUpdatePlist(config)).not.toContain('SUFeedURL')
  })

  it('isolates native and architecture feeds and preserves Sparkle consent defaults', () => {
    const arm = nativeReleaseConfiguration('0.0.1-alpha.5', 'arm64', environment)
    const intel = nativeReleaseConfiguration('0.0.1-alpha.5', 'x64', environment)
    expect(nativeUpdatePlist(arm)).toContain('/updates/native/alpha/darwin/arm64/appcast.xml')
    expect(nativeUpdatePlist(intel)).toContain('/updates/native/alpha/darwin/x64/appcast.xml')
    expect(nativeUpdatePlist(arm)).toContain('<key>SURequireSignedFeed</key><true/>')
    expect(nativeUpdatePlist(arm)).not.toContain('SUEnableAutomaticChecks')
    expect(nativeUpdatePlist(arm)).not.toContain('SUAutomaticallyUpdate')
  })

  it.each(['MACOS_KEYCHAIN_PATH', 'APPLE_API_KEY_PATH', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'SPARKLE_PUBLIC_ED_KEY'])('fails closed without %s', (key) => {
    expect(() => nativeReleaseConfiguration('0.0.1-alpha.5', 'arm64', { ...environment, [key]: '' })).toThrow('required')
  })

  it.each(['http://updates.example.com', 'https://user:secret@example.com', 'https://example.com?token=secret', 'https://example.com/#alpha', 'https://example.com/\nfeed'])('rejects unsafe feed bases: %s', (base) => {
    expect(() => nativeReleaseConfiguration('0.0.1-alpha.5', 'arm64', { ...environment, CRAFT_HUB_NATIVE_UPDATE_BASE_URL: base })).toThrow()
  })

  it('rejects malformed signing keys, unknown architectures and unsupported release channels', () => {
    expect(() => nativeReleaseConfiguration('0.0.1-alpha.5', 'arm64', { ...environment, SPARKLE_PUBLIC_ED_KEY: 'bad-key' })).toThrow('Ed25519')
    expect(() => nativeReleaseConfiguration('0.0.1-alpha.5', 'ia32', environment)).toThrow('arm64 or x64')
    expect(() => nativeReleaseConfiguration('0.0.1', 'arm64', environment)).toThrow('alpha')
    expect(xmlText('a&b<>"')).toBe('a&amp;b&lt;&gt;&quot;')
  })
})

describe('official appcast output verification', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const embeddedKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const archive = Buffer.from('signed update archive fixture')
  const signature = sign(null, archive, privateKey).toString('base64')
  const url = 'https://example.com/releases/native-v0.0.1-alpha.5/app.zip'
  const xml = `<rss><channel><item><sparkle:version>0.0.1005</sparkle:version><enclosure url="${url}" sparkle:edSignature="${signature}" length="${archive.length}" type="application/octet-stream" /></item></channel></rss>`

  it('accepts the signed archive only for the expected URL and bundled version', () => {
    expect(() => verifyNativeAppcast(xml, archive, embeddedKey, '0.0.1005', url)).not.toThrow()
    expect(() => verifyNativeAppcast(xml.replace(' />', '></enclosure>'), archive, embeddedKey, '0.0.1005', url)).not.toThrow()
    expect(() => verifyNativeAppcast(xml, archive, embeddedKey, '0.0.1004', url)).toThrow('version')
    expect(() => verifyNativeAppcast(xml, archive, embeddedKey, '0.0.1005', `${url}.other`)).toThrow('URL')
  })

  it('rejects tampered archives and a private key that differs from the embedded public key', () => {
    const tampered = Buffer.from(archive)
    tampered[0] ^= 1
    expect(() => verifyNativeAppcast(xml, tampered, embeddedKey, '0.0.1005', url)).toThrow('signature')
    expect(() => verifyNativeAppcast(xml, archive, environment.SPARKLE_PUBLIC_ED_KEY, '0.0.1005', url)).toThrow('signature')
    expect(() => verifyNativeAppcast(xml.replace(`sparkle:edSignature="${signature}"`, ''), archive, embeddedKey, '0.0.1005', url)).toThrow('signed archive')
  })
})
