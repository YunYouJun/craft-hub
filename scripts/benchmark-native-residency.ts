import type { ProcessUsage } from './macos-idle-metrics.ts'
import type { PerformanceProcess } from './macos-performance.ts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'
import { readUsageSamples, usageInterval } from './macos-idle-metrics.ts'
import { attributedWebKitServices, isWebKitService, parsePerformanceProcesses, performanceProcessTree, samePerformanceProcess } from './macos-performance.ts'

const run = promisify(execFile)
const { values } = parseArgs({ options: {
  'app': { type: 'string' },
  'output': { type: 'string' },
  'idle-seconds': { type: 'string', default: '60' },
  'settle-seconds': { type: 'string', default: '30' },
} })
if (process.platform !== 'darwin' || !values.app || !values.output)
  throw new Error('Usage: tsx scripts/benchmark-native-residency.ts --app <Release.app> --output <new-directory>')
const idleSeconds = Number(values['idle-seconds'])
const settleSeconds = Number(values['settle-seconds'])
if (!Number.isInteger(idleSeconds) || idleSeconds < 30 || idleSeconds > 600 || !Number.isInteger(settleSeconds) || settleSeconds < 0 || settleSeconds > 120)
  throw new Error('Idle must be 30–600 seconds and settling 0–120 seconds')
const output = resolve(values.output)
await mkdir(output) // A new directory preserves previous evidence and profiles.
const source = resolve(values.app)
const application = join(output, 'Craft Hub Residency Review.app')
const helper = join(output, 'process-usage')
const responsibility = join(output, 'process-responsibility')
const trace = join(output, 'trace.jsonl')
const abort = new AbortController()
const interrupt = () => abort.abort()
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)
const deadline = setTimeout(interrupt, 15 * 60_000)
const input = createInterface({ input: process.stdin })
interface Point { timeMs: number, processes: PerformanceProcess[], usage: ProcessUsage[], nodePids: number[], webkitPids: number[] }
const points: Point[] = []
const intervals: object[] = []
let executable = ''
let bundleIdentifier = ''
let owned: PerformanceProcess[] = []
let observedWebKit: PerformanceProcess[] = []
let failure: string | undefined
const cleanup = { forced: [] as number[], remaining: [] as number[], webKitRemaining: [] as number[] }
async function processes(): Promise<PerformanceProcess[]> {
  return parsePerformanceProcesses((await run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,lstart=,comm='], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })).stdout)
}
async function webKit(rows: PerformanceProcess[], pid: number): Promise<PerformanceProcess[]> {
  const candidates = rows.filter(isWebKitService)
  const report = JSON.parse((await run(responsibility, candidates.map(row => String(row.pid)), { timeout: 5000 })).stdout) as { available: boolean, processes: Array<{ pid: number, responsiblePID?: number }> }
  if (!report.available || report.processes.length !== candidates.length || report.processes.some(row => !Number.isSafeInteger(row.responsiblePID) || row.responsiblePID! <= 0))
    throw new Error('Exact WebKit ownership is unavailable')
  return attributedWebKitServices(rows, new Map(report.processes.map(row => [row.pid, row.responsiblePID!])), pid)
}
function remember(rows: PerformanceProcess[], services: PerformanceProcess[]): void {
  owned = [...new Map([...owned, ...rows].map(row => [row.pid, row])).values()]
  observedWebKit = [...new Map([...observedWebKit, ...services].map(row => [row.pid, row])).values()]
}
async function collect(root: PerformanceProcess): Promise<Point> {
  const rows = await processes()
  if (!rows.some(row => samePerformanceProcess(root, row)))
    throw new Error('The measured host exited or changed identity')
  const descendants = performanceProcessTree(rows, root.pid)
  const services = await webKit(rows, root.pid)
  remember(descendants, services)
  const measured = [...new Map([...descendants, ...services].map(row => [row.pid, row])).values()]
  const pids = measured.map(row => row.pid)
  const usage = readUsageSamples(JSON.parse((await run(helper, pids.map(String), { timeout: 5000 })).stdout), pids)
  return { timeMs: performance.now(), processes: measured, usage, nodePids: descendants.filter(row => row.executable.endsWith('/node')).map(row => row.pid), webkitPids: services.map(row => row.pid) }
}
try {
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', source])
  await run('/usr/bin/xcrun', ['clang', '-O2', '-Wall', '-Wextra', '-Werror', resolve('scripts/macos-process-usage.c'), '-o', helper])
  await run('/usr/bin/xcrun', ['swiftc', '-O', resolve('scripts/macos-process-responsibility.swift'), '-o', responsibility])
  await run('/usr/bin/ditto', [source, application])
  const plist = join(application, 'Contents/Info.plist')
  const info = JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist])).stdout) as Record<string, unknown>
  bundleIdentifier = `dev.craft-hub.residency.${randomUUID().toLowerCase()}`
  info.CFBundleIdentifier = bundleIdentifier
  delete info.CFBundleURLTypes
  delete info.CFBundleDocumentTypes
  delete info.LSEnvironment
  await writeFile(plist, JSON.stringify(info))
  await run('/usr/bin/plutil', ['-convert', 'xml1', plist])
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application])
  executable = join(application, 'Contents/MacOS', String(info.CFBundleExecutable))
  const home = join(output, 'home')
  const profile = join(output, 'profile')
  const temporary = join(output, 'tmp')
  for (const directory of [home, profile, temporary])
    await mkdir(directory, { mode: 0o700 })
  const environment = {
    HOME: home,
    CFFIXED_USER_HOME: home,
    TMPDIR: temporary,
    CODEX_HOME: join(home, '.codex'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local/share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    CRAFT_HUB_CONFIG_DIR: join(output, 'config'),
    CRAFT_HUB_CLOUD_ENDPOINT: '',
    CRAFT_HUB_CLOUD_ORIGIN: '',
    CRAFT_HUB_NATIVE_DATA_DIR: profile,
    CRAFT_HUB_NODE: process.execPath,
    CRAFT_HUB_PERFORMANCE_TRACE: trace,
  }
  const before = new Set((await processes()).map(row => row.pid))
  abort.signal.throwIfAborted()
  await run('/usr/bin/open', ['-n', ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]), application])
  let root: PerformanceProcess | undefined
  let ready = false
  for (let attempt = 0; attempt < 450; attempt++) {
    abort.signal.throwIfAborted()
    const rows = await processes()
    root = rows.find(row => !before.has(row.pid) && row.executable === executable)
    if (root) {
      remember(performanceProcessTree(rows, root.pid), await webKit(rows, root.pid))
      const events = await readFile(trace, 'utf8').catch(() => '')
      if (events.includes('native-page-appeared')) {
        ready = true
        break
      }
    }
    await delay(100, undefined, { signal: abort.signal })
  }
  if (!root || !ready)
    throw new Error('The isolated app did not start')
  await writeFile(join(output, 'session.json'), JSON.stringify({ application, bundleIdentifier, pid: root.pid, source }, null, 2))
  console.log(JSON.stringify({ phase: 'awaiting-ui', application, bundleIdentifier, pid: root.pid, instruction: 'Use the app, close its main window, then send closed on stdin. Do not reopen it during sampling.' }))
  await new Promise<void>((resolvePromise, reject) => {
    input.on('line', (line) => {
      if (line.trim() === 'closed')
        resolvePromise()
    })
    input.once('close', () => reject(new Error('UI acceptance input closed before the window-close marker')))
    abort.signal.addEventListener('abort', () => reject(new Error('Residency measurement interrupted')), { once: true })
  })
  const measuredRoot = root
  points.push(await collect(measuredRoot))
  console.log(`Window closed; settling for ${settleSeconds}s`)
  await delay(settleSeconds * 1000, undefined, { signal: abort.signal })
  let previous = await collect(measuredRoot)
  points.push(previous)
  for (let elapsed = 0; elapsed < idleSeconds; elapsed += 10) {
    await delay(Math.min(10, idleSeconds - elapsed) * 1000, undefined, { signal: abort.signal })
    const current = await collect(measuredRoot)
    points.push(current)
    const elapsedMs = current.timeMs - previous.timeMs
    intervals.push({
      elapsedMs,
      total: usageInterval(previous.usage, current.usage, elapsedMs) ?? null,
      node: usageInterval(previous.usage.filter(row => previous.nodePids.includes(row.pid)), current.usage.filter(row => current.nodePids.includes(row.pid)), elapsedMs) ?? null,
    })
    previous = current
  }
  console.log('Idle measurement complete')
}
catch (error) { failure = error instanceof Error ? error.message : 'Residency measurement failed' }
finally {
  clearTimeout(deadline)
  let current = await processes()
  const root = owned.find(row => row.executable === executable) ?? current.find(row => row.executable === executable)
  if (root && current.some(row => samePerformanceProcess(root, row))) {
    const services = await webKit(current, root.pid).catch(() => [])
    remember(performanceProcessTree(current, root.pid), services)
    process.kill(root.pid, 'SIGTERM')
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    current = await processes()
    if (![...owned, ...observedWebKit].some(row => current.some(item => samePerformanceProcess(row, item))))
      break
    await delay(100)
  }
  for (const row of owned) {
    if (current.some(item => samePerformanceProcess(row, item))) {
      try {
        process.kill(row.pid, 'SIGKILL')
        cleanup.forced.push(row.pid)
      }
      catch { /* Already exited. */ }
    }
  }
  current = await processes()
  cleanup.remaining = owned.filter(row => current.some(item => samePerformanceProcess(row, item))).map(row => row.pid)
  cleanup.webKitRemaining = observedWebKit.filter(row => current.some(item => samePerformanceProcess(row, item))).map(row => row.pid)
  const events = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  await writeFile(join(output, 'report.json'), JSON.stringify({ source, application, bundleIdentifier, idleSeconds, settleSeconds, cpuUnit: 'nanoseconds', events, points, intervals, cleanup, failure, scope: 'Fresh isolated profile; explicit real UI use followed by main-window close. Per-process libproc physical footprint and cumulative CPU/interrupt/package-idle wakeup counters. CPU 100% is one core. Only stable PID sets and matching kernel birth times produce an interval; missing intervals are not zero. Process sums are not system-wide deduplicated RAM. SIGTERM cleanup is not menu-quit acceptance.' }, null, 2))
  input.close()
  process.off('SIGINT', interrupt)
  process.off('SIGTERM', interrupt)
  console.log(JSON.stringify({ report: join(output, 'report.json'), cleanup, failure }))
}
if (failure || cleanup.remaining.length || cleanup.webKitRemaining.length)
  process.exitCode = 1
