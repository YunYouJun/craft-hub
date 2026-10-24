import type { ProfileMigrationPreview } from 'craft-hub'
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { acquireProfileLease, applyProfileMigration, previewProfileMigration, previewProfileRecovery, previewProfileRollback, recoverProfileMigration, rollbackProfileMigration } from 'craft-hub'

// All paths and processes belong to this fixture. The real installed hosts and profiles remain untouched.
assert.equal(process.platform, 'darwin', 'This verifier requires macOS')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const sidecar = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
const cli = join(dirname(sidecar), 'cli.mjs')
await access(sidecar)
await access(cli)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-migration-')))
const paths = { sourceData: join(root, 'electron'), sourceConfig: join(root, 'portable'), target: join(root, 'native') }
const home = join(root, 'home')
const env = { HOME: home, TMPDIR: join(root, 'temporary'), CRAFT_HUB_SIDECAR_DIR: paths.target, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }
let child: ReturnType<typeof spawn> | undefined
async function closedFixture() {
  assert(Object.values(paths).every(path => path.startsWith(`${root}/`)))
  assert(!child || child.exitCode !== null || child.signalCode !== null, 'The fixture sidecar is still running')
}
try {
  await Promise.all([home, env.TMPDIR, paths.sourceData, paths.sourceConfig, join(paths.target, 'runtime'), join(paths.target, 'native'), join(root, 'project')].map(path => mkdir(path, { recursive: true })))
  const projects = [{ id: 'migration-fixture', name: 'Migration fixture', path: join(root, 'project'), trust: 'untrusted', addedAt: '2026-01-01T00:00:00Z' }]
  const config = '// Migration keeps comments\n{"schemaVersion":1,"workspaceOrder":[],"groups":[],"workspaceGroups":{}}\n'
  await writeFile(join(paths.sourceData, 'projects.json'), JSON.stringify(projects))
  await writeFile(join(paths.sourceData, 'settings.json'), '{"workbench.locale":"en"}')
  await writeFile(join(paths.sourceData, 'Cookies'), 'fixture browser credentials must not transfer')
  const browserFiles = ['DIPS-wal', 'declarative_performance_observer.db', '.dev.craft-hub.desktop.Network Persistent State.aB3dE6']
  for (const name of browserFiles)
    await writeFile(join(paths.sourceData, name), 'browser-only-fixture')
  await mkdir(join(paths.sourceData, 'WebStorage'))
  await writeFile(join(paths.sourceData, 'WebStorage/state'), 'browser-only-fixture')
  await writeFile(join(paths.sourceConfig, 'config.jsonc'), config)
  await writeFile(join(paths.target, 'runtime/projects.json'), '[]')
  await writeFile(join(paths.target, 'native/capture-draft.json'), '{"text":"unsent fixture draft"}')
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'profile:preflight', paths.sourceData, paths.sourceConfig, paths.target], { env, cwd: home, timeout: 20000, maxBuffer: 1024 * 1024 })
  const review = JSON.parse(stdout) as ProfileMigrationPreview
  assert.deepEqual(review.blockers, [])
  assert.deepEqual(review.excluded, ['Cookies', 'WebStorage', ...browserFiles].sort())
  assert(!stdout.includes('browser-only-fixture'))
  assert.deepEqual(await readdir(home), [], 'Packaged preflight initialized HOME state')
  assert.equal(review.revision, (await previewProfileMigration(paths)).revision)
  // The offline runtime API uses a fixture-specific quiescence check. The interactive CLI also refuses real legacy hosts.
  const receipt = await applyProfileMigration(paths, review.revision, closedFixture)
  assert.equal(receipt.phase, 'complete')
  assert.equal((await applyProfileMigration(paths, review.revision, closedFixture)).alreadyApplied, true)
  assert.equal(await readFile(join(paths.target, 'config/config.jsonc'), 'utf8'), config)
  await assert.rejects(access(join(paths.target, 'runtime/Cookies')), { code: 'ENOENT' })
  for (const name of [...browserFiles, 'WebStorage'])
    await assert.rejects(access(join(paths.target, 'runtime', name)), { code: 'ENOENT' })
  for (const name of [...browserFiles, 'WebStorage/state'])
    assert.equal(await readFile(join(paths.sourceData, name), 'utf8'), 'browser-only-fixture')
  child = spawn(process.execPath, [sidecar], { cwd: home, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false })
  const running = child
  const handshake = await new Promise<{ version: number, url: string, nativeApiToken: string }>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Sidecar handshake timed out')), 20000)
    const fail = () => {
      clearTimeout(timer)
      reject(new Error('Sidecar exited before its handshake'))
    }
    running.once('error', fail)
    running.once('exit', fail)
    running.stdout!.setEncoding('utf8')
    const receive = (chunk: string) => {
      output += chunk
      if (output.length > 16384) {
        fail()
        return
      }
      const newline = output.indexOf('\n')
      if (newline < 0)
        return
      clearTimeout(timer)
      running.removeListener('exit', fail)
      running.stdout!.removeListener('data', receive)
      try {
        resolve(JSON.parse(output.slice(0, newline)))
      }
      catch { reject(new Error('Invalid sidecar handshake')) }
    }
    running.stdout!.on('data', receive)
  })
  assert.equal(handshake.version, 1)
  const origin = new URL(handshake.url).origin
  async function get<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, origin), { headers: { origin, authorization: `Bearer ${handshake.nativeApiToken}` }, redirect: 'error', signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, 200, path)
    return await response.json() as T
  }
  const loaded = await get<{ projects: typeof projects }>('/api/projects')
  assert.equal(loaded.projects.length, 1)
  assert.equal(loaded.projects[0]!.trust, 'untrusted')
  assert.equal(loaded.projects[0]!.id, projects[0]!.id)
  assert.equal((await get<{ settings: Record<string, unknown> }>('/api/settings')).settings['workbench.locale'], 'en')
  await get('/api/marketplace/overview')
  await get('/api/diagnostics')
  assert.deepEqual(await get('/api/runs'), [])
  assert.deepEqual(await get('/api/agent-tasks'), [])
  // Different HOME/TMPDIR must not split the lock identity between the parent and its actual packaged sidecar.
  await assert.rejects(acquireProfileLease([join(paths.target, 'runtime')], 'migration'), /profile is in use/)
  await assert.rejects(rollbackProfileMigration(receipt.transaction, (await previewProfileRollback(receipt.transaction)).revision, closedFixture), /profile is in use/)
  const exited = once(running, 'exit', { signal: AbortSignal.timeout(10000) })
  running.stdin!.end()
  const [code] = await exited
  assert.equal(code, 0)
  const unlocked = await acquireProfileLease([join(paths.target, 'runtime')], 'migration')
  unlocked.release()
  const recovery = await previewProfileRecovery(receipt.transaction)
  assert.equal((await recoverProfileMigration(receipt.transaction, closedFixture, recovery.reviewRevision)).alreadyApplied, true)
  await writeFile(join(paths.target, 'runtime/settings.json'), '{"nativeFixtureEdit":true}')
  await assert.rejects(rollbackProfileMigration(receipt.transaction, recovery.revision, closedFixture, recovery.reviewRevision), /Recovery review changed/)
  const rollback = await previewProfileRecovery(receipt.transaction)
  assert.equal((await rollbackProfileMigration(receipt.transaction, rollback.revision, closedFixture, rollback.reviewRevision)).phase, 'rolled-back')
  const archived = (await readdir(receipt.transaction)).find(name => name.startsWith('returned-candidate-'))
  assert(archived)
  assert.equal(await readFile(join(receipt.transaction, archived, 'runtime/settings.json'), 'utf8'), '{"nativeFixtureEdit":true}')
  assert.equal(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8'), '[]')
  assert.equal((await previewProfileMigration(paths)).sourceRevision, review.sourceRevision)
  console.log(JSON.stringify({ packagedPreflight: 'read-only', browserState: 'Chromium storage and network temporaries excluded; source preserved', migration: 'copied and repeated', projectTrust: 'untrusted', nativeAPIs: 'settings, plugins and diagnostics', execution: 'no runs or agent tasks', lock: 'live sidecar blocks migration across TMPDIR environments', exit: code, recovery: 'reviewed completed receipt; stale rollback review rejected', rollback: 'previous candidate restored; later edits archived', source: 'unchanged' }))
}
finally {
  if (child?.exitCode === null && child.signalCode === null && child.pid) {
    const exited = once(child, 'exit')
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch { /* Only this verifier's owned process group is eligible for cleanup. */ }
    await exited.catch(() => {})
  }
  await rm(root, { recursive: true, force: true })
}
