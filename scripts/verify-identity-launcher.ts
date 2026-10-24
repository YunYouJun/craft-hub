import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { buildIdentityLauncher, identityIPCSource, identityLauncherSource } from './build-identity-launcher.ts'

assert.equal(process.platform, 'darwin')
const run = promisify(execFile)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-identity-launcher-')))
try {
  const module = join(root, 'launcher.node')
  await buildIdentityLauncher(module, process.arch === 'arm64' ? 'arm64' : 'x64')
  const launcher = createRequire(import.meta.url)(module) as { launch: (path: string, source?: string, recipient?: string) => unknown }
  // The production addon has no exception for an unverified caller, even for a valid receiver path.
  assert.throws(() => launcher.launch('/Applications/Unverified.app', 'a'.repeat(40), 'b'.repeat(40)), { code: 'CRAFT_HUB_IDENTITY_LAUNCH_REJECTED' })
  assert.throws(() => launcher.launch('/path\0injected.app'))
  await run('/usr/bin/xcrun', ['clang', '-Wall', '-Wextra', '-Werror', join(identityLauncherSource, 'fixture.c'), '-o', join(root, 'fixture')])
  await run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'fixture')])
  await run('/usr/bin/xcrun', ['clang++', '-std=c++20', '-fobjc-arc', '-mmacosx-version-min=15.0', '-Wall', '-Wextra', '-Werror', '-framework', 'Foundation', '-framework', 'Security', join(identityLauncherSource, 'test.mm'), '-o', join(root, 'test')])
  const result = await run(join(root, 'test'), [join(root, 'fixture')], { timeout: 15_000, maxBuffer: 64 * 1024 })
  assert.match(result.stdout, /suspended validation.*passed/)
  const nativeFlags = ['-mmacosx-version-min=15.0', '-Wall', '-Wextra', '-Werror', '-I', join(identityIPCSource, 'include')]
  await run('/usr/bin/xcrun', ['clang', '-std=c11', ...nativeFlags, '-c', join(identityIPCSource, 'identity-ipc.c'), '-o', join(root, 'ipc.o')])
  await run('/usr/bin/xcrun', ['clang', ...nativeFlags, join(identityLauncherSource, 'mach-fixture.c'), join(root, 'ipc.o'), '-lbsm', '-o', join(root, 'mach-fixture')])
  await run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'mach-fixture')])
  await run('/usr/bin/xcrun', ['clang++', '-std=c++20', '-fobjc-arc', ...nativeFlags, '-framework', 'Foundation', '-framework', 'Security', join(identityLauncherSource, 'mach-test.mm'), join(root, 'ipc.o'), '-lbsm', '-o', join(root, 'mach-test')])
  const channel = await run(join(root, 'mach-test'), [join(root, 'mach-fixture')], { timeout: 15_000, maxBuffer: 64 * 1024 })
  assert.match(channel.stdout, /Mach audit tokens.*passed/)
  for (const name of ['channel-fixture', 'channel-test']) {
    await run('/usr/bin/xcrun', ['clang++', '-std=c++20', '-fobjc-arc', ...nativeFlags, '-framework', 'Foundation', '-framework', 'Security', join(identityLauncherSource, `${name}.mm`), join(root, 'ipc.o'), '-lbsm', '-o', join(root, name)])
  }
  await run('/usr/bin/codesign', ['--force', '--sign', '-', join(root, 'channel-fixture')])
  const sourceChannel = await run(join(root, 'channel-test'), [join(root, 'channel-fixture')], { timeout: 30_000, maxBuffer: 64 * 1024 })
  assert.match(sourceChannel.stdout, /Source channel authenticated handshake.*passed/)
  const legacyDirectory = join(root, 'Craft Hub Fixture.app/Contents/MacOS')
  await mkdir(legacyDirectory, { recursive: true })
  await copyFile(join(root, 'fixture'), join(legacyDirectory, 'Fixture'))
  await run('/usr/bin/xcrun', ['clang++', '-std=c++20', '-fobjc-arc', ...nativeFlags, '-framework', 'Foundation', '-framework', 'AppKit', join(identityLauncherSource, 'quiescence-test.mm'), '-o', join(root, 'quiescence-test')])
  const quiescence = await run(join(root, 'quiescence-test'), [join(legacyDirectory, 'Fixture')], { timeout: 10_000, maxBuffer: 64 * 1024 })
  assert.match(quiescence.stdout, /Known legacy host detected/)
  if (process.argv[2]) {
    const desktop = join(resolve(process.argv[2]), 'Contents/Resources/app.asar.unpacked/apps/desktop')
    await run(join(desktop, 'workstation-runtime/node/bin/node'), ['-e', 'const assert=require("node:assert/strict");const addon=require(process.argv[1]);assert.throws(()=>addon.launch("/Unverified.app","a".repeat(40),"b".repeat(40)),{code:"CRAFT_HUB_IDENTITY_LAUNCH_REJECTED"})', join(desktop, 'identity-launcher/launcher.node')], { timeout: 10_000, env: { PATH: '/usr/bin:/bin' } })
  }
  console.log(JSON.stringify({ nativeLauncher: 'production addon rejects unverified host', processOwner: result.stdout.trim(), messageChannel: channel.stdout.trim(), sourceChannel: sourceChannel.stdout.trim(), quiescence: quiescence.stdout.trim(), packagedNode: process.argv[2] ? 'addon ABI and refusal passed' : 'not selected', identities: 'fixture only; no account or profile access' }))
}
finally { await rm(root, { recursive: true, force: true }) }
