import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createPublicKey, verify } from 'node:crypto'
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { macosApplicationVersion } from '../../desktop/src/macos-version.ts'

const run = promisify(execFile)

/** Validate release-only configuration before building; a local build cannot accidentally enable Sparkle. */
export function nativeReleaseConfiguration(version: string, architecture: string, environment: NodeJS.ProcessEnv) {
  if (architecture !== 'arm64' && architecture !== 'x64')
    throw new Error('Native macOS builds require arm64 or x64')
  const bundleVersion = macosApplicationVersion(version)
  if (!bundleVersion.split('.').every(value => Number.isSafeInteger(Number(value))))
    throw new Error('Native bundle version exceeds the supported numeric range')
  if (environment.CRAFT_HUB_NATIVE_RELEASE !== 'true')
    return { enabled: false as const, bundleVersion }
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version))
    throw new Error('Native release distribution currently supports numeric alpha versions only')
  for (const name of ['MACOS_KEYCHAIN_PATH', 'APPLE_API_KEY_PATH', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER_ID', 'SPARKLE_PUBLIC_ED_KEY']) {
    if (!environment[name])
      throw new Error(`${name} is required for native release builds`)
  }
  const publicKey = environment.SPARKLE_PUBLIC_ED_KEY!
  if (!/^[A-Z0-9+/]{43}=$/i.test(publicKey) || Buffer.from(publicKey, 'base64').length !== 32 || Buffer.from(publicKey, 'base64').toString('base64') !== publicKey)
    throw new Error('SPARKLE_PUBLIC_ED_KEY must be a base64 Ed25519 public key')
  const base = environment.CRAFT_HUB_NATIVE_UPDATE_BASE_URL ?? 'https://craft-hub.pages.dev/updates/native/alpha'
  const url = new URL(base)
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || /\s/.test(base))
    throw new Error('The native update base URL must be credential-free HTTPS without query or fragment')
  const feedURL = `${url.href.replace(/\/$/, '')}/darwin/${architecture}/appcast.xml`
  return { enabled: true as const, bundleVersion, publicKey, feedURL }
}

/** Escape configuration values before embedding them in an XML property list. */
export function xmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\'', '&apos;')
}

/** Public URL eligibility is a separate release decision; ordinary candidates never claim the public scheme. */
export function nativeLinkPlist(config: ReturnType<typeof nativeReleaseConfiguration>, environment: NodeJS.ProcessEnv): string {
  const enabled = environment.CRAFT_HUB_NATIVE_PUBLIC_LINKS === 'true'
  if (enabled && !config.enabled)
    throw new Error('Public-link handover requires an explicitly enabled signed native release')
  return `<key>CraftHubPublicLinksEnabled</key><${enabled ? 'true' : 'false'}/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Craft Hub Native Candidate</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>CFBundleURLSchemes</key><array><string>craft-hub-native</string>${enabled ? '<string>craft-hub</string>' : ''}</array>
</dict></array>`
}

/** Use Sparkle's default consent prompt and scheduler; never reset user defaults on launch. */
export function nativeUpdatePlist(config: ReturnType<typeof nativeReleaseConfiguration>): string {
  if (!config.enabled)
    return '<key>CraftHubUpdatesEnabled</key><false/>'
  return `<key>CraftHubUpdatesEnabled</key><true/>
<key>SUFeedURL</key><string>${xmlText(config.feedURL)}</string>
<key>SUPublicEDKey</key><string>${xmlText(config.publicKey)}</string>
<key>SUVerifyUpdateBeforeExtraction</key><true/>
<key>SURequireSignedFeed</key><true/>
<key>SUEnableSystemProfiling</key><false/>
<key>SUEnableJavaScript</key><false/>`
}

/** Sign nested Mach-O code and bundles from the inside out, preserving Sparkle helper entitlements. */
export async function signNativeBundle(bundle: string, keychain?: string): Promise<void> {
  let identity = '-'
  if (keychain) {
    const { stdout } = await run('security', ['find-identity', '-v', '-p', 'codesigning', keychain])
    const matches = [...stdout.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"Developer ID Application:/gm)]
    if (matches.length !== 1)
      throw new Error('The release keychain must contain exactly one Developer ID Application identity')
    identity = matches[0][1]
  }
  const sign = async (path: string) => {
    await run('codesign', ['--force', '--sign', identity, '--preserve-metadata=entitlements', ...(keychain ? ['--keychain', keychain, '--options', 'runtime', '--timestamp'] : ['--timestamp=none']), path])
  }
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink())
        continue
      if (entry.isDirectory()) {
        await visit(path)
        if (/\.(?:app|xpc|framework)$/.test(entry.name))
          await sign(path)
      }
      else if (entry.isFile()) {
        const handle = await open(path, 'r')
        try {
          const bytes = Buffer.alloc(4)
          const { bytesRead } = await handle.read(bytes, 0, 4, 0)
          if (bytesRead === 4 && ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(bytes.toString('hex')))
            await sign(path)
        }
        finally { await handle.close() }
      }
    }
  }
  await visit(bundle)
  await sign(bundle)
  await run('codesign', ['--verify', '--deep', '--strict', bundle])
}

/** Validate the official generator's single-archive output against the embedded public key and immutable URL. */
export function verifyNativeAppcast(xml: string, archive: Buffer, publicKey: string, version: string, downloadURL: string): void {
  // Adding Sparkle's feed signature can expand empty XML elements to explicit closing tags.
  const enclosures = [...xml.matchAll(/<enclosure\s[^>]*>/g)]
  if (enclosures.length !== 1 || !xml.includes(`<sparkle:version>${xmlText(version)}</sparkle:version>`))
    throw new Error('Expected one native update with the packaged bundle version')
  const enclosure = enclosures[0][0]
  const signature = /sparkle:edSignature="([A-Za-z0-9+/=]+)"/.exec(enclosure)?.[1]
  const length = /\blength="(\d+)"/.exec(enclosure)?.[1]
  const url = /\burl="([^"]+)"/.exec(enclosure)?.[1]
  if (!signature || Number(length) !== archive.length || url !== xmlText(downloadURL))
    throw new Error('The generated appcast is missing a signed archive or has the wrong download URL/length')
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' })
  if (!verify(null, archive, key, Buffer.from(signature, 'base64')))
    throw new Error('The update signature does not match the public key embedded in the application')
}
