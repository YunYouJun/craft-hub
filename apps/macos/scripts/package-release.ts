import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { nativeReleaseConfiguration, verifyNativeAppcast } from './native-release.ts'

// Run only for an authorized release. This command builds artifacts; it never uploads or publishes them.
const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
const config = nativeReleaseConfiguration(version, process.arch, process.env)
if (process.platform !== 'darwin' || !config.enabled)
  throw new Error('Native release packaging requires macOS and CRAFT_HUB_NATIVE_RELEASE=true')
const repository = process.env.GITHUB_REPOSITORY
const tag = process.env.RELEASE_TAG
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository) || tag !== `native-v${version}`)
  throw new Error('GITHUB_REPOSITORY and a matching native-v<workspace version> RELEASE_TAG are required')
if (!process.env.SPARKLE_PRIVATE_KEY_FILE)
  throw new Error('SPARKLE_PRIVATE_KEY_FILE is required; keep it outside the repository')
await run('pnpm', ['build:macos'], { cwd: root, maxBuffer: 64 * 1024 * 1024 })

const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
const app = join(root, 'apps/macos/build/Craft Hub Prototype.app')
const output = join(root, 'release/native', architecture)
const staging = await mkdtemp(join(tmpdir(), 'craft-hub-native-release-'))
const archiveName = `Craft-Hub-Native-${version}-macOS-${architecture}.zip`
const archive = join(staging, archiveName)
const tools = join(root, 'apps/macos/.build/artifacts/sparkle/Sparkle/bin')
const credentials = ['--key', process.env.APPLE_API_KEY_PATH!, '--key-id', process.env.APPLE_API_KEY_ID!, '--issuer', process.env.APPLE_API_ISSUER_ID!]
const keys = ['--ed-key-file', process.env.SPARKLE_PRIVATE_KEY_FILE]
const downloadPrefix = `https://github.com/${repository}/releases/download/${tag}/`
try {
  process.stdout.write('Notarizing the signed native app\n')
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
  const { stdout } = await run('xcrun', ['notarytool', 'submit', archive, ...credentials, '--wait', '--output-format', 'json'])
  const result = JSON.parse(stdout) as { status?: string }
  if (result.status !== 'Accepted')
    throw new Error(`Native notarization was not accepted: ${result.status ?? 'unknown'}`)
  for (let attempt = 0; ; attempt++) {
    try {
      await run('xcrun', ['stapler', 'staple', app])
      break
    }
    catch (error) {
      if (attempt >= 4)
        throw error
      await new Promise(resolve => setTimeout(resolve, 15_000))
    }
  }
  await run('codesign', ['--verify', '--deep', '--strict', app])
  await run('xcrun', ['stapler', 'validate', app])
  await run('spctl', ['--assess', '--type', 'execute', app])
  // Archive again after stapling; the Ed25519 signature must cover exactly the bytes users download.
  await rm(archive)
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
  await run('unzip', ['-t', archive], { maxBuffer: 64 * 1024 * 1024 })
  process.stdout.write('Generating and verifying the signed Sparkle appcast\n')
  const appcast = join(staging, 'appcast.xml')
  await run(join(tools, 'generate_appcast'), [...keys, '--download-url-prefix', downloadPrefix, '--maximum-deltas', '0', '-o', appcast, staging])
  await run(join(tools, 'sign_update'), ['--verify', ...keys, appcast])
  verifyNativeAppcast(await readFile(appcast, 'utf8'), await readFile(archive), config.publicKey, config.bundleVersion, `${downloadPrefix}${archiveName}`)
  await mkdir(output, { recursive: true })
  await cp(archive, join(output, archiveName))
  await cp(appcast, join(output, `appcast-${architecture}.xml`))
  process.stdout.write(`Verified native release artifacts: ${output}\n`)
}
finally { await rm(staging, { recursive: true, force: true }) }
