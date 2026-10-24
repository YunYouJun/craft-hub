import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { acquireProfileLease } from 'craft-hub'

// The actual app must refuse this unverified Node parent before SwiftUI, profile initialization, or Keychain access.
assert.equal(process.platform, 'darwin')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const executable = join(app, 'Contents/MacOS/CraftHubMac')
await access(executable)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-identity-recipient-')))
const profile = join(root, 'profile')
const trace = join(root, 'trace.jsonl')
const home = join(root, 'home')
let lease: Awaited<ReturnType<typeof acquireProfileLease>> | undefined
try {
  await mkdir(home)
  lease = await acquireProfileLease([profile, join(profile, 'runtime'), join(profile, 'config')], 'migration')
  const flag = '--craft-hub-native-identity-recipient'
  for (const args of [[flag], [flag, '--extra'], [`${flag}=true`], ['--craft-hub-native-identity-unknown']]) {
    const result = await new Promise<{ status: number | string | undefined, signal?: string | null, output: string }>((resolveResult, reject) => {
      const child = execFile(executable, args, {
        cwd: root,
        env: { HOME: home, PATH: '/usr/bin:/bin', CRAFT_HUB_NATIVE_DATA_DIR: profile, CRAFT_HUB_PERFORMANCE_TRACE: trace, CRAFT_HUB_NODE: process.execPath },
        timeout: 10_000,
        killSignal: 'SIGKILL',
        maxBuffer: 4096,
        encoding: 'utf8',
      }, (error, stdout) => {
        if (!error)
          reject(new Error('An unverified maintenance parent unexpectedly succeeded'))
        else
          resolveResult({ status: error.code, signal: error.signal, output: stdout })
      })
      child.stdin?.on('error', () => {})
      child.stdin?.end('{"version":1,"id":1,"operation":"prepare","recipientKey":"caller-selected"}\n')
    })
    assert.equal(result.status, args.length === 1 && args[0] === flag ? 1 : 64)
    assert.equal(result.signal, null, 'Maintenance must reject before the watchdog, not hang in a normal launch gate')
    assert.equal(result.output, '', 'Unverified peers must not receive a handshake or recipient key')
  }
  await assert.rejects(access(profile), { code: 'ENOENT' })
  await assert.rejects(access(trace), { code: 'ENOENT' })
  console.log(JSON.stringify({ recipient: 'actual app rejected unverified parent and malformed maintenance arguments', startup: 'no profile, instance, sidecar or UI trace', authentication: 'no public handshake or key', profileLease: 'coordinator lease remained held' }))
}
finally {
  lease?.release()
  await rm(root, { recursive: true, force: true })
}
