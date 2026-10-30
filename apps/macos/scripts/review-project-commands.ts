import type { CommandFixtureProcess } from './project-command-fixture.ts'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, cp, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { commandFixtureExecutions, commandFixtureProcesses, commandFixtureSignal, prepareCommandFixture, withCommandFixtureSidecar } from './project-command-fixture.ts'

// Lifecycle and fixture preparation only. Real UI actions are performed separately with the approved UI tool.
assert.equal(process.platform, 'darwin', 'Native command UI acceptance requires macOS')
const exec = promisify(execFile)
const source = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
await access(join(source, 'Contents/MacOS/CraftHubMac'))
const parent = resolve(process.argv[3] ?? fileURLToPath(new URL('../build/project-command-verification', import.meta.url)))
await mkdir(parent, { recursive: true })
const root = await realpath(await mkdtemp(join(parent, 'ui-')))
const app = join(root, 'Craft Hub Commands Acceptance.app')
const executable = join(app, 'Contents/MacOS/CraftHubMac')
const home = join(root, 'home')
const profile = join(root, 'profile')
const trace = join(root, 'readiness.jsonl')
const stopFile = join(root, 'stop-session')
const bundleID = `dev.craft-hub.commands-acceptance.${randomUUID().toLowerCase()}`
const fixture = await prepareCommandFixture(root)
const owned = new Map<number, CommandFixtureProcess>()
const before = await commandFixtureProcesses()
const dailyPID = process.env.CRAFT_HUB_ACCEPTANCE_DAILY_PID ? Number(process.env.CRAFT_HUB_ACCEPTANCE_DAILY_PID) : undefined
const daily = dailyPID ? before.find(item => item.pid === dailyPID) : undefined
if (dailyPID)
  assert(daily, 'The requested daily-use App PID is not running')
let child: ReturnType<typeof spawn> | undefined
let stopped = false
let failure: string | undefined
let registration: { id: string, trust: string } | undefined
async function captureOwned() {
  const rows = await commandFixtureProcesses()
  const previous = child?.pid ? owned.get(child.pid) : undefined
  const current = rows.find(item => item.pid === child?.pid && item.executable === executable && (!previous || item.startedAt === previous.startedAt))
  const descendants = new Set<number>(current ? [current.pid] : [])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (descendants.has(row.parent) && !descendants.has(row.pid)) {
        descendants.add(row.pid)
        changed = true
      }
    }
  }
  for (const row of rows) {
    if (descendants.has(row.pid))
      owned.set(row.pid, row)
  }
  return rows
}
function onSignal() {
  stopped = true
}
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)
try {
  await withCommandFixtureSidecar(source, root, async ({ request }) => {
    const response = await request('/api/projects', 'POST', { path: fixture.project })
    assert.equal(response.status, 201)
    registration = await response.json() as { id: string, trust: string }
    assert.equal(registration.trust, 'untrusted')
    assert.deepEqual(await (await request('/api/runs')).json(), [])
    assert.deepEqual(await commandFixtureExecutions(fixture.marker), [])
  })
  await cp(source, app, { recursive: true, verbatimSymlinks: true })
  const plist = join(app, 'Contents/Info.plist')
  for (const [key, value] of [['CFBundleIdentifier', bundleID], ['CFBundleName', 'Craft Hub Commands Acceptance'], ['CFBundleDisplayName', 'Craft Hub Commands Acceptance']])
    await exec('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
  await exec('/usr/bin/codesign', ['--force', '--sign', '-', app], { timeout: 30000 })
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 10000 })
  child = spawn(executable, [], {
    env: { ...process.env, HOME: home, CRAFT_HUB_NATIVE_DATA_DIR: profile, CRAFT_HUB_NODE: process.execPath, CRAFT_HUB_PERFORMANCE_TRACE: trace, CRAFT_HUB_CLOUD_ENDPOINT: '', CRAFT_HUB_CLOUD_ORIGIN: '', PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` },
    stdio: 'ignore',
    shell: false,
  })
  assert(child.pid)
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const rows = await captureOwned()
    const host = rows.find(item => item.pid === child!.pid)
    if (host)
      assert.equal(host.executable, executable)
    const markers = await readFile(trace, 'utf8').catch(() => '')
    if (markers.split('\n').filter(Boolean).some((line) => {
      const value = JSON.parse(line) as { event: string, pid: number }
      return value.event === 'runtime-ready' && value.pid === child!.pid
    })) {
      break
    }
    assert.equal(child.exitCode, null, 'Acceptance App exited before runtime readiness')
    await delay(100)
  }
  const readiness = await readFile(trace, 'utf8')
  assert(readiness.includes('"runtime-ready"'), 'Acceptance runtime did not become ready')
  await writeFile(join(root, 'session.json'), JSON.stringify({ source, app, executable, bundleID, root, profile, home, project: fixture.project, projectId: registration!.id, marker: fixture.marker, stopFile, trace, host: owned.get(child.pid), daily }, null, 2))
  console.log(JSON.stringify({ ready: true, bundleID, app, pid: child.pid, root, projectId: registration!.id, project: fixture.project, marker: fixture.marker, stopFile, trace, session: join(root, 'session.json') }))
  // The UI operator may quit normally or create this fixture-only stop file after collecting screenshots/evidence.
  const sessionDeadline = Date.now() + 20 * 60_000
  while (child.exitCode === null && child.signalCode === null) {
    if (stopped)
      break
    if (await access(stopFile).then(() => true, () => false))
      break
    assert(Date.now() < sessionDeadline, 'The bounded acceptance session expired')
    await captureOwned()
    await delay(1000)
  }
}
catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error)
  process.exitCode = 1
}
finally {
  await captureOwned()
  const host = child?.pid ? owned.get(child.pid) : undefined
  if (host && child?.exitCode === null && child.signalCode === null)
    await commandFixtureSignal(host, 'SIGTERM')
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const current = await commandFixtureProcesses()
    if (![...owned.values()].some(item => current.some(row => row.pid === item.pid && row.startedAt === item.startedAt && row.executable === item.executable)))
      break
    await delay(100)
  }
  for (const recorded of [...owned.values()].reverse())
    await commandFixtureSignal(recorded, 'SIGKILL')
  await delay(200)
  const after = await commandFixtureProcesses()
  const remaining = [...owned.values()].filter(item => after.some(row => row.pid === item.pid && row.startedAt === item.startedAt && row.executable === item.executable))
  const dailyPreserved = !daily || after.some(row => row.pid === daily.pid && row.startedAt === daily.startedAt && row.executable === daily.executable)
  const projects = JSON.parse(await readFile(join(profile, 'runtime/projects.json'), 'utf8').catch(() => '[]'))
  const report = { source, app, root, owned: [...owned.values()], remaining, daily, dailyPreserved, projects, executions: await commandFixtureExecutions(fixture.marker), failure, finishedAt: new Date().toISOString(), evidencePreserved: true }
  await writeFile(join(root, 'cleanup.json'), JSON.stringify(report, null, 2))
  process.removeListener('SIGINT', onSignal)
  process.removeListener('SIGTERM', onSignal)
  console.log(JSON.stringify({ finished: true, root, remaining: remaining.length, dailyPreserved, failure, report: join(root, 'cleanup.json') }))
  if (remaining.length || !dailyPreserved)
    process.exitCode = 1
}
