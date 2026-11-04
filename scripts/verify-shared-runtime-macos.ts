import type { ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers/promises'

/** Isolated, signed XPC + real process acceptance. No real plugin, credential or installed app is touched. */
const root = resolve('.')
const id = randomUUID().replaceAll('-', '')
const evidence = join(root, 'apps/macos/build', `shared-runtime-${id}`)
const service = `dev.craft-hub.fixture.${id}`
const domain = `gui/${process.getuid!()}`
const children = new Set<ChildProcess>()
const identities = new Map<number, string>()
const checks: string[] = []
let registered = false
let launchctlRegistered = false
let cleanupTask: Promise<void> | undefined
let client = ''
let serverRequirement = ''
let clientRequirement = ''
let stoppedBySignal = false

async function run(command: string, args: string[], options: { allowFailure?: boolean, onSpawn?: (child: ChildProcess) => void } = {}): Promise<{ output: string, code: number }> {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(command, args, { cwd: root, shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.add(child)
  options.onSpawn?.(child)
  let output = ''
  child.stdout!.on('data', data => output += data)
  child.stderr!.on('data', data => output += data)
  const timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 60_000)
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => {
        if (!options.allowFailure && code !== 0)
          reject(new Error(`${command} failed (${code}): ${output.slice(-4000)}`))
        else
          resolve({ output, code: code ?? -1 })
      })
    })
  }
  finally {
    clearTimeout(timer)
    children.delete(child)
  }
}

async function identity(pid: number): Promise<string> {
  return (await run('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'comm='], { allowFailure: true })).output.trim()
}

async function record(pid: number): Promise<void> {
  const value = await identity(pid)
  assert(value, `Process ${pid} must exist`)
  identities.set(pid, value)
}

async function killRecorded(pid: number): Promise<void> {
  const current = await identity(pid)
  if (current && current === identities.get(pid))
    process.kill(pid, 'SIGKILL')
}

async function brokerPid(): Promise<number | undefined> {
  const result = await run('/bin/launchctl', ['print', `${domain}/${service}`], { allowFailure: true })
  const pid = /\n\s*pid = (\d+)/.exec(result.output)?.[1]
  return pid ? Number(pid) : undefined
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  do {
    if (await check())
      return
    await setTimeout(50)
  } while (Date.now() < deadline)
  throw new Error(`Timed out: ${label}`)
}

async function call(request: Record<string, unknown>, executable = client, requirement = serverRequirement): Promise<any> {
  const result = await run(executable, ['call', service, requirement, JSON.stringify(request)])
  // Framework diagnostics may precede the single JSON reply on stderr.
  const line = result.output.trim().split('\n').findLast(line => line.startsWith('{'))
  assert(line, result.output)
  return JSON.parse(line)
}

async function accepted(request: Record<string, unknown>): Promise<any> {
  const reply = await call(request)
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.result
}

async function hello(): Promise<any> {
  const result = await accepted({ method: 'hello', protocol: 1 })
  await record(result.pid)
  const pid = await brokerPid()
  assert(pid)
  await record(pid)
  return result
}

async function prepare(targetId = 'fake:normal'): Promise<Record<string, unknown>> {
  const text = '中文记录\nElectron 已退出 🌿'
  const review = await accepted({ method: 'capture.prepare', targetId, text })
  return { method: 'capture.commit', reviewId: review.reviewId, targetId, text, attemptId: randomUUID() }
}

function passed(label: string): void {
  checks.push(label)
  process.stdout.write(`PASS ${label}\n`)
}

async function cleanup(): Promise<void> {
  return cleanupTask ??= performCleanup()
}

async function performCleanup(): Promise<void> {
  const results: Record<string, unknown> = {}
  if (registered) {
    results.unregister = await run(client, ['unregister', `${service}.plist`], { allowFailure: true }).catch(String)
    registered = false
  }
  if (launchctlRegistered) {
    results.bootout = await run('/bin/launchctl', ['bootout', `${domain}/${service}`], { allowFailure: true }).catch(String)
    launchctlRegistered = false
  }
  for (const child of [...children]) {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null)
        resolve()
      else
        child.once('exit', () => resolve())
    })
  }
  // Allow EOF cleanup, then only terminate the exact PID/executable/start-time recorded for this run.
  await setTimeout(300)
  for (const [pid, expected] of identities) {
    const current = await identity(pid)
    if (current && current === expected) {
      await killRecorded(pid)
      await waitFor(async () => await identity(pid) !== expected, `cleanup ${pid}`)
    }
    results[pid] = { identity: expected, exited: await identity(pid) !== expected }
  }
  const job = await run('/bin/launchctl', ['print', `${domain}/${service}`], { allowFailure: true })
  results.serviceAbsent = job.code !== 0
  await writeFile(join(evidence, 'cleanup.json'), `${JSON.stringify(results, null, 2)}\n`, { mode: 0o600 })
  assert(results.serviceAbsent, 'Temporary runtime service must be unregistered')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stoppedBySignal = true
    void cleanup().finally(() => process.exit(1))
  })
}

async function main(): Promise<void> {
  assert.equal(process.platform, 'darwin', 'This acceptance requires macOS')
  await mkdir(evidence, { recursive: true, mode: 0o700 })
  process.stdout.write(`Evidence: ${evidence}\n`)
  if (!process.argv.includes('--skip-build')) {
    await run('pnpm', ['--filter', '@craft-hub/runtime...', 'build'])
    await run('swift', ['build', '--package-path', 'apps/runtime-macos'])
  }
  const app = join(evidence, 'Runtime Fixture.app')
  const macos = join(app, 'Contents/MacOS')
  const agents = join(app, 'Contents/Library/LaunchAgents')
  await mkdir(macos, { recursive: true })
  await mkdir(agents, { recursive: true })
  client = join(macos, 'CraftHubRuntimeClient')
  const broker = join(macos, 'CraftHubRuntimeBroker')
  const native = join(root, 'apps/runtime-macos/.build/debug')
  await copyFile(join(native, 'CraftHubRuntimeClient'), client)
  await copyFile(join(native, 'CraftHubRuntimeBroker'), broker)
  const plist = (values: Record<string, unknown>): string => JSON.stringify(values)
  // plutil handles XML escaping, including paths with spaces.
  const info = join(app, 'Contents/Info.plist')
  await writeFile(info, plist({ CFBundleIdentifier: service, CFBundleExecutable: 'CraftHubRuntimeClient', CFBundleName: 'Runtime Fixture', CFBundlePackageType: 'APPL', CFBundleVersion: '1', LSUIElement: true, LSMinimumSystemVersion: '13.0' }))
  await run('/usr/bin/plutil', ['-convert', 'xml1', info])
  await run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', `${service}.broker`, broker])
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app])
  const hashRequirement = async (path: string): Promise<string> => {
    const details = await run('/usr/bin/codesign', ['-dvvv', path])
    const hash = /\bCDHash=([a-f0-9]+)/.exec(details.output)?.[1]
    assert(hash, details.output)
    return `cdhash H"${hash}"`
  }
  serverRequirement = await hashRequirement(broker)
  clientRequirement = await hashRequirement(client)
  const workerPath = join(root, 'apps/runtime/dist/worker.mjs')
  const workerConfigPath = join(evidence, 'worker.json')
  const dataDir = join(evidence, 'data')
  await writeFile(workerConfigPath, plist({ fixtureOnly: true, dataDir, configDir: join(evidence, 'config'), idleMs: 1800, requestMs: 2500 }), { mode: 0o600 })
  const hash = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex')
  const brokerConfig = join(evidence, 'broker.json')
  await writeFile(brokerConfig, plist({ fixtureOnly: true, serviceName: service, clientRequirement, nodePath: process.execPath, nodeSHA256: await hash(process.execPath), workerPath, workerSHA256: await hash(workerPath), workerConfigPath }), { mode: 0o600 })
  const agentPath = join(agents, `${service}.plist`)
  await writeFile(agentPath, plist({ Label: service, BundleProgram: 'Contents/MacOS/CraftHubRuntimeBroker', ProgramArguments: [broker, brokerConfig], MachServices: { [service]: true }, KeepAlive: false, RunAtLoad: false, ThrottleInterval: 0, StandardOutPath: join(evidence, 'broker.stdout.log'), StandardErrorPath: join(evidence, 'broker.stderr.log') }))
  await run('/usr/bin/plutil', ['-convert', 'xml1', agentPath])
  // Sign after creating all resources; do not mutate the app after registration.
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app])
  clientRequirement = await hashRequirement(client)
  const finalConfig = JSON.parse(await readFile(brokerConfig, 'utf8'))
  finalConfig.clientRequirement = clientRequirement
  await writeFile(brokerConfig, plist(finalConfig), { mode: 0o600 })
  await run('/usr/bin/codesign', ['--verify', '--strict', app])
  const registration = await run(client, ['register', `${service}.plist`], { allowFailure: true })
  registered = registration.code === 0
  await writeFile(join(evidence, 'registration.json'), `${JSON.stringify({ ...registration, signing: 'ad-hoc acceptance only' }, null, 2)}\n`)
  if (!registered || !registration.output.includes('"status":1')) {
    if (registered) {
      await run(client, ['unregister', `${service}.plist`], { allowFailure: true })
      registered = false
    }
    // Explicit development adapter. It does not claim SMAppService approval/distribution acceptance.
    const developmentAgent = join(evidence, `${service}.plist`)
    await writeFile(developmentAgent, plist({ Label: service, ProgramArguments: [broker, brokerConfig], MachServices: { [service]: true }, KeepAlive: false, RunAtLoad: false, ThrottleInterval: 0, StandardOutPath: join(evidence, 'broker.stdout.log'), StandardErrorPath: join(evidence, 'broker.stderr.log') }))
    await run('/usr/bin/plutil', ['-convert', 'xml1', developmentAgent])
    await run('/bin/launchctl', ['bootstrap', domain, developmentAgent])
    launchctlRegistered = true
  }
  assert.equal(await brokerPid(), undefined)
  passed('registration does not launch an idle worker')

  const concurrent = await Promise.all(Array.from({ length: 12 }, () => accepted({ method: 'hello', protocol: 1 })))
  assert.equal(new Set(concurrent.map(value => value.generation)).size, 1)
  assert.equal(new Set(concurrent.map(value => value.pid)).size, 1)
  let current = await hello()
  assert.equal((await accepted({ method: 'doctor' })).providerLoaded, false)
  passed('12 concurrent cold clients share one lazy worker')

  const rejected = join(evidence, 'RejectedClient')
  await copyFile(client, rejected)
  await run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', `${service}.untrusted`, rejected])
  assert.equal((await call({ method: 'hello', protocol: 1 }, rejected)).ok, false)
  assert.equal((await call({ method: 'hello', protocol: 1 }, client, clientRequirement)).ok, false)
  assert.equal((await call({ method: 'hello', protocol: 99 })).ok, false)
  passed('XPC rejects an unapproved client, wrong server signature and protocol')

  const electronConfig = join(evidence, 'electron.json')
  await writeFile(electronConfig, plist({ client, service, serverRequirement }))
  const electron = createRequire(join(root, 'apps/desktop/package.json'))('electron') as string
  let electronPid = 0
  const electronIdentities: Array<Promise<void>> = []
  const electronPids = new Set<number>()
  const electronResult = await run(electron, [join(root, 'apps/runtime/test/fixtures/electron-client.cjs'), `--runtime-fixture=${electronConfig}`, `--user-data-dir=${join(evidence, 'electron-profile')}`], { onSpawn: (child) => {
    electronPid = child.pid!
    let buffer = ''
    child.stdout!.on('data', (data) => {
      buffer += String(data)
      const complete = buffer.split('\n')
      buffer = complete.pop()!
      for (const line of complete) {
        if (!line.startsWith('{'))
          continue
        const event = JSON.parse(line)
        if (event.event === 'electron-processes') {
          for (const pid of event.pids as number[]) {
            electronPids.add(pid)
            electronIdentities.push(record(pid))
          }
        }
      }
    })
  } })
  assert(electronResult.output.includes('"ok":true'), electronResult.output)
  await Promise.all(electronIdentities)
  assert(electronPids.size >= 2, 'Electron main and helper processes were exercised')
  for (const pid of electronPids)
    await waitFor(async () => await identity(pid) !== identities.get(pid), `Electron process ${pid} exits`)
  assert.equal(await identity(electronPid), '')
  current = await hello()
  const command = await prepare()
  const receipts = await Promise.all(Array.from({ length: 8 }, () => accepted(command)))
  assert(receipts.some(receipt => receipt.status === 'succeeded'))
  assert.equal((await accepted({ method: 'capture.receipt', attemptId: command.attemptId })).status, 'succeeded')
  assert.equal((await call({ ...command, text: 'changed content' })).ok, false)
  passed('real Electron exits, then native capture commits once under concurrent calls')

  const slow = await prepare('fake:slow')
  let disconnectedClient: ChildProcess | undefined
  const interrupted = run(client, ['call', service, serverRequirement, JSON.stringify(slow)], { allowFailure: true, onSpawn: (child) => {
    disconnectedClient = child
  } })
  await waitFor(async () => (await accepted({ method: 'capture.receipt', attemptId: slow.attemptId }).catch(() => ({}))).status === 'dispatching', 'accepted slow write')
  disconnectedClient!.kill('SIGKILL')
  await interrupted
  await waitFor(async () => (await accepted({ method: 'capture.receipt', attemptId: slow.attemptId })).status === 'succeeded', 'disconnected write completes')
  passed('accepted writes survive the caller exiting')

  const lost = await prepare('fake:lost-reply')
  assert.equal((await accepted(lost)).status, 'uncertain')
  assert.equal((await accepted(lost)).status, 'uncertain')
  const hanging = await prepare('fake:hang')
  assert.equal((await accepted(hanging)).status, 'uncertain')
  passed('lost replies and request deadlines stay uncertain without replay')

  for (const failure of ['worker', 'broker'] as const) {
    current = await hello()
    const crash = await prepare('fake:hang')
    const request = call(crash)
    await waitFor(async () => (await accepted({ method: 'capture.receipt', attemptId: crash.attemptId }).catch(() => ({}))).status === 'dispatching', 'crash write accepted')
    const pid = failure === 'worker' ? current.pid : await brokerPid()
    assert(pid)
    await record(pid)
    await killRecorded(pid)
    assert.equal((await request).ok, false)
    await waitFor(async () => await identity(current.pid) !== identities.get(current.pid), 'old worker exits')
    await waitFor(async () => !(await brokerPid()), 'broker exits after failure')
    const next = await hello()
    assert.notEqual(next.generation, current.generation)
    assert.equal((await accepted({ method: 'capture.receipt', attemptId: crash.attemptId })).status, 'uncertain')
    assert.equal((await accepted(crash)).status, 'uncertain')
    passed(`${failure} crash recovers the same attempt without replay or orphan worker`)
  }

  const notes = (await readFile(join(dataDir, 'fake-remote-notes.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(notes.length, 3)
  assert.equal(new Set(notes.map(note => note.attemptId)).size, 3)
  current = await hello()
  const workerIdentity = identities.get(current.pid)
  await waitFor(async () => await identity(current.pid) !== workerIdentity && !(await brokerPid()), 'idle processes released')
  await setTimeout(2500)
  assert.equal(await brokerPid(), undefined)
  passed('idle broker and worker exit and remain stopped without requests')
  await writeFile(join(evidence, 'acceptance.json'), `${JSON.stringify({ checks, electronPid, electronPids: [...electronPids], identities: Object.fromEntries(identities), registration: registered ? 'SMAppService enabled (ad-hoc)' : 'explicit development launchctl adapter', productionSigningAccepted: false, cloudAccess: false, service, stoppedBySignal }, null, 2)}\n`, { mode: 0o600 })
}

try {
  await main()
}
catch (error) {
  await mkdir(evidence, { recursive: true, mode: 0o700 })
  await writeFile(join(evidence, 'failure.json'), `${JSON.stringify({ error: String(error), checks }, null, 2)}\n`)
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
}
finally {
  await cleanup()
}
