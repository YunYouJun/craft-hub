import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { signNativeBundle, verifyNativeAppcast } from './native-release.ts'

// Exercise the actual embedded framework, ZIP and official appcast tools using throwaway keys and identity.
// This does not publish a release, alter Keychain, launch the workbench or replace an installed application.
const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const source = join(root, 'apps/macos/build/Craft Hub Prototype.app')
const tools = join(root, 'apps/macos/.build/artifacts/sparkle/Sparkle/bin')
const temporary = await mkdtemp(join(tmpdir(), 'craft-hub-update-check-'))
try {
  const app = join(temporary, 'Update Fixture.app')
  await run('ditto', [source, app])
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicEDKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const privateKeyFile = join(temporary, 'fixture.key')
  await writeFile(privateKeyFile, privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64'), { mode: 0o600 })
  const plist = join(app, 'Contents/Info.plist')
  for (const [key, type, value] of [
    ['CFBundleIdentifier', 'string', `dev.craft-hub.update-fixture.${randomUUID()}`],
    ['CFBundleVersion', 'string', '0.0.1006'],
    ['SUFeedURL', 'string', 'https://updates.example.com/appcast.xml'],
    ['SUPublicEDKey', 'string', publicEDKey],
    ['CraftHubUpdatesEnabled', 'bool', 'true'],
    ['SUVerifyUpdateBeforeExtraction', 'bool', 'true'],
    ['SURequireSignedFeed', 'bool', 'true'],
  ]) {
    await run('plutil', ['-replace', key, `-${type}`, value, plist])
  }
  await signNativeBundle(app)
  const { stdout: libraries } = await run('otool', ['-L', join(app, 'Contents/MacOS/CraftHubMac')])
  assert.match(libraries, /@rpath\/Sparkle\.framework\//)
  const { stdout: loadCommands } = await run('otool', ['-l', join(app, 'Contents/MacOS/CraftHubMac')])
  assert.ok(loadCommands.includes('@executable_path/../Frameworks'))
  // Actually load the embedded framework, catching broken symlinks or signatures that link-time tests miss.
  const probe = join(temporary, 'probe.swift')
  await writeFile(probe, 'import Foundation\nimport Sparkle\nprecondition(Bundle(for: SPUUpdater.self).bundleIdentifier == "org.sparkle-project.Sparkle")\n')
  const frameworks = join(app, 'Contents/Frameworks')
  await run('xcrun', ['swiftc', probe, '-F', frameworks, '-framework', 'Sparkle', '-Xlinker', '-rpath', '-Xlinker', frameworks, '-o', join(temporary, 'probe')])
  await run(join(temporary, 'probe'), [])
  const archives = join(temporary, 'archives')
  await mkdir(archives)
  const archive = join(archives, 'fixture.zip')
  await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive])
  const appcast = join(archives, 'appcast.xml')
  const keys = ['--ed-key-file', privateKeyFile]
  await run(join(tools, 'generate_appcast'), [...keys, '--download-url-prefix', 'https://updates.example.com/', '--maximum-deltas', '0', '-o', appcast, archives])
  await run(join(tools, 'sign_update'), ['--verify', ...keys, appcast])
  const xml = await readFile(appcast, 'utf8')
  const bytes = await readFile(archive)
  verifyNativeAppcast(xml, bytes, publicEDKey, '0.0.1006', 'https://updates.example.com/fixture.zip')
  bytes[0] ^= 1
  assert.throws(() => verifyNativeAppcast(xml, bytes, publicEDKey, '0.0.1006', 'https://updates.example.com/fixture.zip'), /signature/)
  await writeFile(appcast, xml.replace('<sparkle:version>0.0.1006', '<sparkle:version>0.0.1007'))
  await assert.rejects(run(join(tools, 'sign_update'), ['--verify', ...keys, appcast]))
  process.stdout.write('Embedded Sparkle loaded; official signed ZIP/appcast verified; modified ZIP and feed rejected.\n')
}
finally { await rm(temporary, { recursive: true, force: true }) }
