import type { IdentityTransferReview } from '@craft-hub/personal-cloud'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDesktopFuses } from '../../../scripts/desktop-fuses.ts'

// Real Electron entry-point verification. No Keychain read, authorization dialog or transfer acceptance.
assert.equal(process.platform, 'darwin', 'This verifier requires macOS')
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const requireDesktop = createRequire(join(repository, 'apps/desktop/package.json'))
const application = process.argv[2] ? await realpath(process.argv[2]) : undefined
const executableName = application ? String(execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(application, 'Contents/Info.plist')], { encoding: 'utf8' })).trim() : undefined
const electron = application ? join(application, 'Contents/MacOS', executableName!) : requireDesktop('electron') as string
if (application)
  await verifyDesktopFuses(application)
const entry = join(repository, 'apps/desktop/dist/main.mjs')
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-source-host-check-')))
const source = join(root, 'source')
const home = join(root, 'home')
const temporary = join(root, 'tmp')
const scratch = join(root, 'source-scratch')
const injectedMarker = join(root, 'injected')
const preload = join(root, 'preload.mjs')
const baseline = {
  HOME: home,
  TMPDIR: temporary,
  PATH: process.env.PATH,
  LANG: 'C.UTF-8',
  CRAFT_HUB_DATA_DIR: source,
  CRAFT_HUB_DESKTOP_PROFILE_DIR: join(root, 'browser'),
  CRAFT_HUB_PERFORMANCE_TRACE: join(root, 'trace.jsonl'),
  CRAFT_HUB_IDENTITY_SOURCE_SCRATCH: scratch,
  ...(application ? { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, NODE_PATH: join(root, 'untrusted-modules') } : {}),
}
let child: ReturnType<typeof spawn> | undefined
async function run(input?: unknown): Promise<{ code: number | null, stdout: string }> {
  child = spawn(electron, [...(application ? ['--inspect=0'] : [entry]), ...(input === undefined ? [] : ['--craft-hub-native-identity-transfer'])], {
    cwd: repository,
    env: { ...baseline, ...(input === undefined ? { CRAFT_HUB_SMOKE_TEST: 'true' } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    detached: true,
  })
  const current = child
  let stdout = ''
  let overflow = false
  current.stdout!.on('data', (chunk) => {
    if (stdout.length + chunk.length > 32 * 1024) {
      overflow = true
      current.kill('SIGKILL')
    }
    else { stdout += chunk.toString('utf8') }
  })
  let inspectorStarted = false
  current.stderr!.on('data', chunk => inspectorStarted ||= String(chunk).includes('Debugger listening'))
  current.stdin!.on('error', () => {})
  const deadline = setTimeout(() => current.kill('SIGKILL'), 45_000)
  try {
    current.stdin!.end(input === undefined ? '' : JSON.stringify(input))
    const [code] = await once(current, 'exit') as [number | null]
    assert.equal(overflow, false, 'The isolated Electron child exceeded its output limit')
    assert.notEqual(code, null, 'The isolated Electron child did not exit normally')
    assert.equal(inspectorStarted, false, 'The packaged app opened a Node inspector')
    return { code, stdout }
  }
  finally {
    clearTimeout(deadline)
    // A fresh process group belongs solely to this verifier, including any Chromium helpers.
    if (current.pid) {
      try {
        process.kill(-current.pid, 'SIGKILL')
      }
      catch {}
    }
    child = undefined
    // Own the helper profile through Chromium's final post-JS writes, then remove the disposable root.
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    await mkdir(scratch, { mode: 0o700 })
  }
}
try {
  await Promise.all([source, home, temporary, scratch].map(path => mkdir(path, { mode: 0o700 })))
  await writeFile(preload, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(injectedMarker)}, 'unexpected preload')`)
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' })
  const original = JSON.stringify({ schemaVersion: 1, deviceId: 'source-host-fixture', publicKey, encryptedPrivateKey: Buffer.from('opaque-fixture').toString('base64') })
  const path = join(source, 'personal-cloud-device.json')
  await writeFile(path, original, { mode: 0o600 })
  const preview = await run({ version: 1, action: 'preview' })
  assert.equal(preview.code, 0, 'Electron could not enter the read-only identity source mode')
  const result = JSON.parse(preview.stdout) as { version: number, capabilities: string[], value: IdentityTransferReview }
  assert.equal(result.version, 1)
  assert.deepEqual(result.capabilities, ['preview', 'recipient-preflight'])
  assert.equal(result.value.sourceData, source)
  assert.equal(result.value.sourceRevision, createHash('sha256').update(original).digest('hex'))
  assert.equal(result.value.publicKey, publicKey)
  assert.equal(result.value.deviceId, 'source-host-fixture')
  assert.deepEqual(await readdir(source), ['personal-cloud-device.json'])
  assert.equal(await readFile(path, 'utf8'), original)
  const rejected = await run({ version: 1, action: 'seal', request: { privateKey: 'must-not-be-accepted' } })
  assert.equal(rejected.code, 1)
  assert.equal(rejected.stdout, '')
  const rawRecipient = generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
  const unauthenticated = await run({ version: 1, action: 'seal', request: {
    ...result.value,
    version: 1,
    recipientKey: rawRecipient,
    challenge: randomBytes(32).toString('hex'),
    targetProfile: join(root, 'native'),
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
    expiresAt: Date.now() + 60_000,
  } })
  assert.equal(unauthenticated.code, 1, 'A caller-chosen recipient must not enable identity export')
  assert.equal(unauthenticated.stdout, '')
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(await readdir(scratch), [])
  const preflight = await run({ version: 1, action: 'recipient-preflight', application: join(repository, 'apps/macos/build/Craft Hub Prototype.app') })
  assert.equal(preflight.code, 0)
  assert.deepEqual(JSON.parse(preflight.stdout).value, { available: false, reason: 'peer-verification-failed' }, 'A development Electron host must not qualify for identity transfer')
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual(await readdir(source), ['personal-cloud-device.json'])
  for (const action of ['migrate', 'recover', 'rollback']) {
    const operation = await run({ version: 1, action, application: join(repository, 'apps/macos/build/Craft Hub Prototype.app'), ...(action === 'migrate' ? { targetProfile: join(root, 'native') } : { transaction: join(root, 'transaction') }) })
    assert.equal(operation.code, 1, 'An unsupported source must reject the coordinated action before consent or storage access')
    assert.equal(operation.stdout, '')
    assert.equal(await readFile(path, 'utf8'), original)
  }
  // The other startup branch still initializes and shuts down normally in independent disposable state.
  await rm(path)
  const normal = await run()
  assert.equal(normal.code, 0, 'The isolated normal Electron startup smoke test failed')
  const events = (await readFile(baseline.CRAFT_HUB_PERFORMANCE_TRACE, 'utf8')).trim().split('\n').map(line => JSON.parse(line).event)
  assert.ok(events.includes('app-launched'))
  assert.ok(events.includes('runtime-ready'))
  assert.equal((await readdir(root)).includes('injected'), false, 'NODE_OPTIONS injected code into the packaged source')
  console.log(JSON.stringify({ sourceHost: 'real Electron preview, recipient preflight and invalid transfer rejection', sourceIdentity: 'unchanged', secureStorage: 'not accessed', normalStartup: 'runtime ready and clean smoke-test exit', fuses: application ? 'actual packaged bits and injected Node options rejected' : 'development binary; not tested', profiles: 'disposable' }))
}
finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch {}
  }
  await rm(root, { recursive: true, force: true })
}
