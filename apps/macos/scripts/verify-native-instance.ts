import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { access, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { acquireProfileLease, clearProfileMigrationGuard, profileMigrationGuardPath, setProfileMigrationGuard } from 'craft-hub'

// A separately identified copy exercises the real App and Launch Services without replacing an installed app.
assert.equal(process.platform, 'darwin')
const source = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-instance-')))
const app = join(root, 'Craft Hub Instance Fixture.app')
const executable = join(app, 'Contents/MacOS/CraftHubMac')
const profile = join(root, 'profile')
const home = join(root, 'home')
const trace = join(root, 'trace.jsonl')
const bundleID = `dev.craft-hub.instance-fixture.${randomUUID().toLowerCase()}`
const run = promisify(execFile)
const children: ReturnType<typeof spawn>[] = []
const observedPIDs = new Set<number>()
const profiles = [profile, join(root, 'migration-blocked'), join(root, 'orphan-profile'), join(root, 'durable-guarded')]
const guardMarkers: string[] = []
const env = { ...process.env, HOME: home, CRAFT_HUB_NATIVE_DATA_DIR: profile, CRAFT_HUB_NODE: process.execPath, CRAFT_HUB_PERFORMANCE_TRACE: trace, CRAFT_HUB_CLOUD_ENDPOINT: '', CRAFT_HUB_CLOUD_ORIGIN: '' }
interface Marker { event: string, pid: number }
async function markers(): Promise<Marker[]> {
  const text = await readFile(trace, 'utf8').catch(() => '')
  return text.split('\n').filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as Marker]
    }
    catch { return [] }
  })
}
async function waitFor<T>(description: string, read: () => Promise<T | undefined>, timeout = 25000): Promise<T> {
  const deadline = Date.now() + timeout
  do {
    const result = await read()
    if (result !== undefined)
      return result
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error(`Timed out: ${description}`)
}
async function processRows(): Promise<{ pid: number, parent: number, command: string }[]> {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,command='], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3]! }] : []
  })
}
function launch(selected = profile) {
  const child = spawn(executable, [], { env: { ...env, CRAFT_HUB_NATIVE_DATA_DIR: selected }, detached: true, stdio: 'ignore', shell: false })
  children.push(child)
  return child
}
async function stop(child: ReturnType<typeof spawn>, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) })
  child.kill(signal)
  await exited
}
try {
  await cp(source, app, { recursive: true, verbatimSymlinks: true })
  await mkdir(home)
  await run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundleID}`, join(app, 'Contents/Info.plist')])
  await run('/usr/bin/codesign', ['--force', '--sign', '-', app], { timeout: 30000 })
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 10000 })
  const primary = launch()
  assert(primary.pid)
  await waitFor('primary runtime ready', async () => (await markers()).find(item => item.pid === primary.pid && item.event === 'runtime-ready'))
  const sidecars = (await processRows()).filter(row => row.parent === primary.pid && row.command.includes('sidecar.mjs'))
  assert.equal(sidecars.length, 1)
  observedPIDs.add(sidecars[0]!.pid)
  await assert.rejects(acquireProfileLease([profile], 'migration'), /profile is in use/)
  const secondary = launch()
  await waitFor('duplicate exits after handoff', async () => secondary.exitCode !== null ? secondary.exitCode : undefined, 10000)
  assert.equal(secondary.exitCode, 0)
  assert((await markers()).some(item => item.pid === secondary.pid && item.event === 'instance-forwarded'))
  assert(!(await markers()).some(item => item.pid === secondary.pid && item.event === 'instance-primary'))
  assert.equal((await processRows()).filter(row => row.parent === primary.pid && row.command.includes('sidecar.mjs')).length, 1)

  const project = join(root, 'project')
  await mkdir(project)
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'native-instance-fixture', private: true, scripts: { hello: 'node --version' } }))
  const launchArguments = ['-n', '-g', '-a', app, '--env', `HOME=${home}`, '--env', `CRAFT_HUB_NATIVE_DATA_DIR=${profile}`, '--env', `CRAFT_HUB_NODE=${process.execPath}`, '--env', `CRAFT_HUB_PERFORMANCE_TRACE=${trace}`]
  await run('/usr/bin/open', [...launchArguments, project], { timeout: 10000 })
  const saved = await waitFor('folder handoff reaches the primary', async () => {
    const entries = JSON.parse(await readFile(join(profile, 'runtime/projects.json'), 'utf8').catch(() => '[]')) as { path: string, trust: string }[]
    return entries.find(item => item.path === project)
  })
  assert.equal(saved.trust, 'untrusted')
  await run('/usr/bin/open', [...launchArguments, '--url', 'craft-hub-native://open?v=1&view=marketplace'], { timeout: 10000 })
  const defaultsDomain = `dev.craft-hub.macos-prototype.profile.${createHash('sha256').update(profile).digest('hex')}`
  await waitFor('URL handoff selects the native marketplace', async () => {
    const result = await run('/usr/bin/defaults', ['read', defaultsDomain, 'lastDestination']).catch(() => undefined)
    return result?.stdout.trim() === 'marketplace' ? true : undefined
  })
  assert.equal((await markers()).filter(item => item.event === 'instance-primary').length, 1)
  const runtimeState = await readFile(join(profile, 'runtime/projects.json'), 'utf8')
  assert(!runtimeState.includes('"trusted"'))
  for (const directory of ['runs', 'agent-tasks']) {
    const entries = await readdir(join(profile, 'runtime', directory)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return []
      throw error
    })
    assert.deepEqual(entries, [], 'Navigation created a command or agent execution record')
  }

  // Kill only the fixture primary. Its actual sidecar must drain before the profile is available again.
  await stop(primary, 'SIGKILL')
  await waitFor('orphan sidecar exits after parent pipe closes', async () => (await processRows()).some(row => row.pid === sidecars[0]!.pid) ? undefined : true)
  const released = await acquireProfileLease([profile, join(profile, 'runtime'), join(profile, 'config')], 'migration')
  released.release()

  const blockedProfile = profiles[1]!
  const migration = await acquireProfileLease([blockedProfile], 'migration')
  try {
    const blocked = launch(blockedProfile)
    await waitFor('migration prevents native startup', async () => (await markers()).find(item => item.pid === blocked.pid && item.event === 'instance-blocked'))
    await assert.rejects(access(blockedProfile), { code: 'ENOENT' })
    assert.equal((await processRows()).filter(row => row.parent === blocked.pid && row.command.includes('sidecar.mjs')).length, 0)
    await stop(blocked)
  }
  finally { migration.release() }

  // A durable interlock still blocks this packaged Swift host after the coordinator's SQLite lease is gone.
  const guardedProfile = profiles[3]!
  const transaction = join(root, 'guard-transaction')
  const durable = await profileMigrationGuardPath(guardedProfile)
  const legacy = join(await realpath('/tmp'), `craft-hub-profile-leases-${process.getuid!()}`, `${createHash('sha256').update(guardedProfile).digest('hex')}.migration.json`)
  guardMarkers.push(durable, legacy)
  const preparing = await acquireProfileLease([guardedProfile], 'migration')
  try {
    await setProfileMigrationGuard(preparing, guardedProfile, transaction)
  }
  finally { preparing.release() }
  await rm(legacy)
  const guarded = launch(guardedProfile)
  await waitFor('durable guard prevents native startup without a temporary marker', async () => (await markers()).find(item => item.pid === guarded.pid && item.event === 'instance-blocked'))
  await assert.rejects(access(guardedProfile), { code: 'ENOENT' })
  assert.equal((await processRows()).filter(row => row.parent === guarded.pid && row.command.includes('sidecar.mjs')).length, 0)
  await stop(guarded)
  const recovery = await acquireProfileLease([guardedProfile], 'migration', transaction)
  try {
    await clearProfileMigrationGuard(recovery, guardedProfile, transaction)
  }
  finally { recovery.release() }
  const recovered = launch(guardedProfile)
  await waitFor('native runtime starts after matching guard recovery', async () => (await markers()).find(item => item.pid === recovered.pid && item.event === 'runtime-ready'))
  for (const row of (await processRows()).filter(row => row.parent === recovered.pid && row.command.includes('sidecar.mjs')))
    observedPIDs.add(row.pid)
  await stop(recovered)

  const orphanProfile = profiles[2]!
  const backend = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
  const orphan = spawn(process.execPath, [backend], { env: { HOME: home, CRAFT_HUB_SIDECAR_DIR: orphanProfile, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore'], shell: false })
  children.push(orphan)
  const data = await once(orphan.stdout!, 'data', { signal: AbortSignal.timeout(20000) })
  assert(data[0].toString().startsWith('{'), 'Standalone sidecar did not become ready')
  const blockedByOrphan = launch(orphanProfile)
  await waitFor('draining sidecar prevents replacement host startup', async () => (await markers()).find(item => item.pid === blockedByOrphan.pid && item.event === 'instance-blocked'))
  await assert.rejects(access(join(orphanProfile, 'native')), { code: 'ENOENT' })
  await stop(blockedByOrphan)
  const orphanExit = once(orphan, 'exit', { signal: AbortSignal.timeout(10000) })
  orphan.stdin!.end()
  assert.equal((await orphanExit)[0], 0)
  const replacement = launch(orphanProfile)
  await waitFor('replacement starts after previous sidecar exits', async () => (await markers()).find(item => item.pid === replacement.pid && item.event === 'runtime-ready'))
  for (const row of (await processRows()).filter(row => row.parent === replacement.pid && row.command.includes('sidecar.mjs')))
    observedPIDs.add(row.pid)
  await stop(replacement)
  console.log(JSON.stringify({ duplicateLaunch: 'forwarded; one primary and sidecar', folderHandoff: 'registered untrusted without execution', urlHandoff: 'native marketplace selected', forceQuit: 'sidecar drained and locks released', migration: 'blocked before profile creation', durableGuard: 'blocked after legacy marker loss; matching recovery permits startup', orphanWriter: 'replacement blocked until shutdown', profile: 'disposable; installed apps unchanged' }))
}
finally {
  for (const child of children)
    await stop(child, 'SIGKILL').catch(() => {})
  // Include Launch Services relays and descendants only when their command contains this unique fixture bundle path.
  for (const row of await processRows()) {
    if (row.command.startsWith(executable) || (observedPIDs.has(row.pid) && row.command.includes(app))) {
      try {
        process.kill(row.pid, 'SIGKILL')
      }
      catch {}
    }
  }
  for (const selected of profiles) {
    const domain = `dev.craft-hub.macos-prototype.profile.${createHash('sha256').update(selected).digest('hex')}`
    await run('/usr/bin/defaults', ['delete', domain]).catch(() => {})
  }
  await run('/usr/bin/defaults', ['delete', bundleID]).catch(() => {})
  for (const marker of guardMarkers)
    await rm(marker, { force: true })
  await rm(root, { recursive: true, force: true })
}
