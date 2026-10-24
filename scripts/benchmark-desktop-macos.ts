import type { PerformanceProcess } from './macos-performance.ts'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'
import { attributedWebKitServices, isWebKitService, parsePerformanceProcesses, performanceProcessTree, readFootprintMeasurement, samePerformanceProcess, samePerformanceProcesses } from './macos-performance.ts'

const run = promisify(execFile)
const { values } = parseArgs({ options: {
  output: { type: 'string', default: 'apps/macos/build/performance' },
  iterations: { type: 'string', default: '3' },
  native: { type: 'string', default: 'apps/macos/build/Craft Hub Prototype.app' },
  electron: { type: 'string', default: 'release/Craft Hub-darwin-arm64/Craft Hub.app' },
} })
if (process.platform !== 'darwin')
  throw new Error('This acceptance runner requires macOS and already-built Release apps')
const iterations = Number(values.iterations)
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10)
  throw new Error('iterations must be between 1 and 10')
const output = resolve(values.output)
if (await access(join(output, 'report.json')).then(() => true, () => false))
  throw new Error('Choose a new output directory to preserve the previous benchmark report')
await mkdir(output, { recursive: true })
interface Marker { host: string, event: string, pid: number, wallTimeMs: number, uptimeMs: number }
async function processes(): Promise<PerformanceProcess[]> {
  return parsePerformanceProcesses((await run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,lstart=,comm='], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })).stdout)
}
const responsibilityHelper = join(output, 'process-responsibility')
await run('/usr/bin/xcrun', ['swiftc', '-O', resolve('scripts/macos-process-responsibility.swift'), '-o', responsibilityHelper], { timeout: 60_000 })
async function responsibilities(rows: PerformanceProcess[]): Promise<{ available: boolean, owners: Map<number, number> }> {
  const candidates = rows.filter(isWebKitService)
  try {
    const report = JSON.parse((await run(responsibilityHelper, candidates.map(row => String(row.pid)), { timeout: 5000 })).stdout) as { available: boolean, processes: Array<{ pid: number, responsiblePID?: number }> }
    return { available: report.available && report.processes.length === candidates.length && report.processes.every(item => Number.isSafeInteger(item.responsiblePID) && item.responsiblePID! > 0), owners: new Map(report.processes.filter(item => item.responsiblePID).map(item => [item.pid, item.responsiblePID!])) }
  }
  catch { return { available: false, owners: new Map() } }
}
async function markers(file: string): Promise<Marker[]> {
  const content = await readFile(file, 'utf8').catch(() => '')
  return content.split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as Marker]
    }
    catch { return [] } // An append may still be in flight; the next read will see the complete line.
  })
}
const results: object[] = []
const fixtures = new Map<string, { application: string, executable: string }>()
const artifacts: object[] = []
for (const [host, source] of [['macos', values.native], ['electron', values.electron]]) {
  const bundle = resolve(source!)
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
  const signature = (await run('/usr/bin/codesign', ['--display', '--verbose=4', bundle])).stderr
  artifacts.push({ host, bundle, signature: signature.split('\n').filter(line => /^(?:Identifier|CDHash|TeamIdentifier)=/.test(line)) })
  const application = join(output, `${host}-fixture.app`)
  await mkdir(application) // Reserve a new fixture; never overwrite another run's app.
  await run('/usr/bin/ditto', [bundle, application])
  const plist = join(application, 'Contents/Info.plist')
  const info = JSON.parse((await run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist])).stdout) as Record<string, unknown>
  // Preserve CFBundleName: Electron derives its Helper lookup from it.
  info.CFBundleIdentifier = `dev.craft-hub.benchmark.${host}.${randomUUID().toLowerCase()}`
  delete info.CFBundleURLTypes
  delete info.CFBundleDocumentTypes
  delete info.LSEnvironment
  await writeFile(plist, JSON.stringify(info))
  await run('/usr/bin/plutil', ['-convert', 'xml1', plist])
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', application])
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
  fixtures.set(host!, { application, executable: join(application, 'Contents/MacOS', String(info.CFBundleExecutable)) })
}
let failure: unknown
try {
  for (let iteration = 1; iteration <= iterations; iteration++) {
  // Alternate order to reduce the influence of shared filesystem and framework cache warming.
    const hosts = iteration % 2 === 1 ? ['macos', 'electron'] as const : ['electron', 'macos'] as const
    for (const host of hosts) {
      const directory = join(output, `${host}-${iteration}-${Date.now()}`)
      // A short private path also stays within Chromium/Unix socket limits.
      const profileRoot = await realpath(await mkdtemp(join(tmpdir(), 'chb-')))
      const data = join(profileRoot, 'runtime')
      const trace = join(directory, 'trace.jsonl')
      const fixture = fixtures.get(host)!
      const home = join(profileRoot, 'home')
      const temporary = join(profileRoot, 'tmp')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      for (const path of [data, home, temporary])
        await mkdir(path, { recursive: true, mode: 0o700 })
      // Both are empty, unconnected profiles, with the same optional plugins disabled.
      const environment = {
        HOME: home,
        // Foundation resolves the account home independently of HOME on macOS.
        CFFIXED_USER_HOME: home,
        TMPDIR: temporary,
        CODEX_HOME: join(home, '.codex'),
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_DATA_HOME: join(home, '.local/share'),
        XDG_CACHE_HOME: join(home, '.cache'),
        CRAFT_HUB_CONFIG_DIR: join(profileRoot, 'config'),
        CRAFT_HUB_CLOUD_ENDPOINT: '',
        CRAFT_HUB_CLOUD_ORIGIN: '',
        CRAFT_HUB_PERFORMANCE_TRACE: trace,
        ...(host === 'macos'
          ? { CRAFT_HUB_NATIVE_DATA_DIR: data, CRAFT_HUB_NODE: process.env.CRAFT_HUB_NODE ?? process.execPath }
          : { CRAFT_HUB_DATA_DIR: data, CRAFT_HUB_DESKTOP_PROFILE_DIR: join(profileRoot, 'chromium') }),
      }
      const before = new Set((await processes()).map(row => row.pid))
      const launchedAt = Date.now()
      let owned: PerformanceProcess[] = []
      let observedWebKit: PerformanceProcess[] = []
      let observed: Marker[] = []
      const cleanup: { forced: number[], remaining: number[], webKitRemaining: number[] } = { forced: [], remaining: [], webKitRemaining: [] }
      try {
        await run('/usr/bin/open', ['-n', ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]), fixture.application])
        while (Date.now() - launchedAt < 45000) {
          observed = await markers(trace)
          const pid = observed[0]?.pid
          if (pid && !before.has(pid)) {
            const current = await processes()
            if (current.some(row => row.pid === pid && row.executable === fixture.executable))
              owned = performanceProcessTree(current, pid)
          }
          if (observed.some(marker => marker.event === 'web-ready') && owned.length)
            break
          await delay(50)
        }
        if (!observed.some(marker => marker.event === 'web-ready') || !owned.length)
          throw new Error(`${host} did not reach web-ready in its isolated profile; inspect ${directory}`)
        await delay(2000)
        const rows = await processes()
        const root = owned.find(row => row.executable === fixture.executable)
        if (!root || !rows.some(row => samePerformanceProcess(root, row)))
          throw new Error(`${host} exited or changed identity before memory sampling; inspect ${directory}`)
        owned = performanceProcessTree(rows, observed[0]!.pid)
        const attribution = await responsibilities(rows)
        const webkit = attributedWebKitServices(rows, attribution.owners, observed[0]!.pid)
        observedWebKit = webkit
        const measured = [...new Map([...owned, ...webkit].map(row => [row.pid, row])).values()]
        let footprint = readFootprintMeasurement(undefined, measured.map(row => row.pid))
        try {
          const file = join(directory, 'footprint.json')
          await run('/usr/bin/footprint', [...measured.flatMap(row => ['-p', String(row.pid)]), '--noCategories', '-j', file], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })
          footprint = readFootprintMeasurement(JSON.parse(await readFile(file, 'utf8')), measured.map(row => row.pid))
        }
        catch { /* Missing permission/output is incomplete measurement, never zero memory. */ }
        const afterFootprint = await processes()
        const afterAttribution = await responsibilities(afterFootprint)
        const stable = samePerformanceProcesses(owned, performanceProcessTree(afterFootprint, root.pid))
          && samePerformanceProcesses(webkit, attributedWebKitServices(afterFootprint, afterAttribution.owners, root.pid))
        const attributionComplete = host === 'electron' || (attribution.available && afterAttribution.available && webkit.some(row => row.executable.endsWith('/com.apple.WebKit.WebContent')))
        results.push({
          host,
          iteration,
          launchedAt,
          directory,
          profileRoot,
          markers: observed.map(marker => ({ event: marker.event, sinceLaunchRequestMs: marker.wallTimeMs - launchedAt })),
          descendantRSS: owned,
          memory: { attribution: 'exact responsible PID via optional macOS SPI; host/descendants via ps', attributionComplete, stable, webkit, footprint, complete: stable && attributionComplete && footprint.complete },
          cleanup,
        })
        console.log(`${host} ${iteration}: ${observed.map(marker => `${marker.event}=${Math.round(marker.wallTimeMs - launchedAt)}ms`).join(', ')}`)
      }
      finally {
      // Only stop processes proven to belong to this run; never match apps by name or kill a pre-existing app.
        let current = await processes()
        // A startup failure can occur before its first marker. The unique fixture path still proves ownership.
        if (!owned.length) {
          const root = current.find(row => !before.has(row.pid) && row.executable === fixture.executable)
          if (root)
            owned = performanceProcessTree(current, root.pid)
        }
        const root = owned.find(row => row.executable === fixture.executable)
        const pid = root?.pid
        if (root && pid && !before.has(pid) && current.some(row => samePerformanceProcess(root, row))) {
          try {
            process.kill(pid, 'SIGTERM')
          }
          catch { /* The benchmark instance may have already exited. */ }
          for (let attempt = 0; attempt < 200; attempt++) {
            current = await processes()
            if (![...owned, ...observedWebKit].some(row => current.some(item => samePerformanceProcess(row, item))))
              break
            await delay(50)
          }
          const remaining = await processes()
          for (const row of owned) {
            if (remaining.some(current => samePerformanceProcess(row, current))) {
              try {
                process.kill(row.pid, 'SIGKILL')
                cleanup.forced.push(row.pid)
              }
              catch { /* Already exited. */ }
            }
          }
        }
        if (host === 'macos') {
          const domain = `dev.craft-hub.macos-prototype.profile.${createHash('sha256').update(data).digest('hex')}`
          await run('/usr/bin/defaults', ['delete', domain]).catch(() => {})
        }
        const after = await processes()
        cleanup.remaining = owned.filter(row => after.some(item => samePerformanceProcess(row, item))).map(row => row.pid)
        cleanup.webKitRemaining = observedWebKit.filter(row => after.some(item => samePerformanceProcess(row, item))).map(row => row.pid)
        if (!cleanup.remaining.length && !cleanup.webKitRemaining.length && !after.some(row => row.executable.startsWith(`${fixture.application}/`)))
          await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
      }
    }
  }
}
catch (error) { failure = error }
const sizes = await Promise.all([values.native, values.electron].map(async bundle => ({
  bundle: resolve(bundle),
  allocatedKiB: Number((await run('/usr/bin/du', ['-sk', resolve(bundle)])).stdout.split(/\s/)[0]),
})))
const report = {
  completed: failure === undefined,
  ...(failure === undefined ? {} : { failure: failure instanceof Error ? failure.message : 'Benchmark failed' }),
  measuredAt: new Date().toISOString(),
  revision: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  dirty: Boolean((await run('git', ['status', '--porcelain'])).stdout.trim()),
  artifacts,
  nativeNode: { path: process.env.CRAFT_HUB_NODE ?? process.execPath, version: (await run(process.env.CRAFT_HUB_NODE ?? process.execPath, ['--version'])).stdout.trim() },
  os: (await run('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim(),
  hardware: (await run('/usr/sbin/sysctl', ['-n', 'hw.model'])).stdout.trim(),
  scope: 'Independent ad hoc copies; fresh isolated HOME/config/data/browser profiles, cloud disabled, existing native Node, Launch Services startup with warm OS caches. Readiness callbacks are not first pixels. Physical footprint is the sum of per-process phys_footprint for host/descendants and exact-responsibility WebKit services; shared system services are excluded. Incomplete attribution or sampling is explicitly marked. SIGTERM cleanup is not a normal-quit test.',
  sizes,
  results,
}
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
const remaining = await processes()
for (const fixture of fixtures.values()) {
  if (!remaining.some(row => row.executable.startsWith(`${fixture.application}/`)))
    await rm(fixture.application, { recursive: true, force: true })
}
console.log(`Saved ${join(output, 'report.json')}`)
if (failure)
  throw failure
