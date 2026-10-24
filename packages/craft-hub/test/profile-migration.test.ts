import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { acquireProfileLease } from '../src/profile-lease'
import { applyProfileMigration, previewProfileMigration, previewProfileRecovery, previewProfileRollback, ProfileMigrationRecoveryError, recoverProfileMigration, rollbackProfileMigration } from '../src/profile-migration'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const roots: string[] = []
async function stopped() {}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-migration-fixture-'))
  roots.push(root)
  const paths = { sourceData: join(root, 'electron'), sourceConfig: join(root, 'portable'), target: join(root, 'native') }
  await Promise.all([paths.sourceData, paths.sourceConfig, join(paths.target, 'runtime'), join(paths.target, 'native')].map(path => mkdir(path, { recursive: true })))
  const projects = [{ id: 'project-one', path: join(root, 'project'), name: 'Fixture', trust: 'untrusted', addedAt: '2026-01-01T00:00:00Z' }]
  await writeFile(join(paths.sourceData, 'projects.json'), JSON.stringify(projects))
  await writeFile(join(paths.sourceData, 'settings.json'), '{"workbench.locale":"en"}')
  await writeFile(join(paths.sourceData, 'Cookies'), 'browser session must stay behind')
  await writeFile(join(paths.sourceConfig, 'config.jsonc'), '// keep comments\n{"schemaVersion":1,"workspaceOrder":[],"groups":[],"workspaceGroups":{}}\n')
  await writeFile(join(paths.target, 'runtime/projects.json'), '[]')
  await writeFile(join(paths.target, 'native/capture-draft.json'), '{"text":"unsent native draft"}')
  return { root, paths, projects }
}

it('keeps preflight read-only and copies reviewed state with backups, native drafts and unchanged project trust', async () => {
  const { root, paths, projects } = await fixture()
  await mkdir(join(paths.sourceData, 'plugins/packages/fixture/1'), { recursive: true })
  await writeFile(join(paths.sourceData, 'plugins/packages/fixture/1/package.json'), '{"name":"fixture","version":"1"}')
  await writeFile(join(paths.sourceData, 'plugins.json'), JSON.stringify({ installed: [{ packagePath: join(paths.sourceData, 'plugins/packages/fixture/1') }], linked: [] }))
  const before = await readdir(root)
  const preview = await previewProfileMigration(paths)
  expect(await readdir(root)).toEqual(before)
  expect(preview.blockers).toEqual([])
  expect(preview.excluded).toEqual(['Cookies'])
  expect(JSON.stringify(preview)).not.toContain('unsent native draft')
  const receipt = await applyProfileMigration(paths, preview.revision, stopped)
  expect(receipt.phase).toBe('complete')
  expect(await readFile(join(paths.target, 'config/config.jsonc'), 'utf8')).toContain('// keep comments')
  expect(await readFile(join(paths.target, 'native/capture-draft.json'), 'utf8')).toContain('unsent native draft')
  expect(JSON.parse(await readFile(join(paths.target, 'runtime/plugins.json'), 'utf8')).installed[0].packagePath).toBe(join(preview.paths.target, 'runtime/plugins/packages/fixture/1'))
  expect(await readFile(join(receipt.transaction, 'previous/runtime/projects.json'), 'utf8')).toBe('[]')
  expect(JSON.parse(await readFile(join(receipt.transaction, 'source/runtime/projects.json'), 'utf8'))).toEqual(projects)
  expect(JSON.parse(await readFile(join(paths.sourceData, 'projects.json'), 'utf8'))).toEqual(projects)
  await expect(stat(join(paths.target, 'runtime/Cookies'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await stat(join(paths.target, 'runtime/projects.json'))).mode & 0o777).toBe(0o600)
  const runtime = new CraftHubRuntime({ dataDir: join(paths.target, 'runtime'), configDir: join(paths.target, 'config') })
  try {
    expect(await runtime.store.listProjects()).toEqual(projects)
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
    expect((await applyProfileMigration(paths, preview.revision, stopped)).alreadyApplied).toBe(true)
  }
  finally { await runtime.close() }
  await writeFile(join(paths.target, 'runtime/settings.json'), '{"nativeEdit":true}')
  const rollback = await previewProfileRollback(receipt.transaction)
  await expect(rollbackProfileMigration(receipt.transaction, 'stale', stopped)).rejects.toThrow('review changed')
  expect((await rollbackProfileMigration(receipt.transaction, rollback.revision, stopped)).phase).toBe('rolled-back')
  expect(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  const archived = (await readdir(receipt.transaction)).find(name => name.startsWith('returned-candidate-'))!
  expect(await readFile(join(receipt.transaction, archived, 'runtime/settings.json'), 'utf8')).toContain('nativeEdit')
  expect((await rollbackProfileMigration(receipt.transaction, rollback.revision, stopped)).alreadyApplied).toBe(true)
})

it('blocks changed reviews, active hosts, unknown files, encrypted identities and unresolved native retries', async () => {
  const { paths } = await fixture()
  const original = await previewProfileMigration(paths)
  await writeFile(join(paths.sourceData, 'settings.json'), '{"workbench.locale":"zh-CN"}')
  await expect(applyProfileMigration(paths, original.revision, stopped)).rejects.toThrow('review changed')
  const fresh = await previewProfileMigration(paths)
  await expect(applyProfileMigration(paths, fresh.revision, async () => {
    throw new Error('Legacy host running')
  })).rejects.toThrow('Legacy host running')
  const runtime = new CraftHubRuntime({ dataDir: paths.sourceData, configDir: paths.sourceConfig })
  const app = await startCraftHubServer({ runtime, port: 0 })
  try {
    await expect(applyProfileMigration(paths, fresh.revision, stopped)).rejects.toThrow('profile is in use')
  }
  finally { await app.close() }
  await writeFile(join(paths.sourceData, 'personal-cloud-device.json'), '{"encryptedPrivateKey":"do-not-display"}')
  await writeFile(join(paths.sourceData, 'unknown.bin'), 'unknown')
  await writeFile(join(paths.target, 'native/capture-draft.json'), '{"requestID":"pending"}')
  const blocked = await previewProfileMigration(paths)
  expect(blocked.blockers.join(' ')).toMatch(/Keychain.*Unclassified.*retry/)
  expect(JSON.stringify(blocked)).not.toContain('do-not-display')
  await expect(applyProfileMigration(paths, blocked.revision, stopped)).rejects.toThrow('unresolved blockers')
})

it('leaves Chromium storage and network temporary files at the source without copying browser state or changing trust', async () => {
  const { paths, projects } = await fixture()
  const names = [
    'DIPS',
    'DIPS-wal',
    'DIPS-shm',
    'DIPS-journal',
    'SharedStorage',
    'SharedStorage-wal',
    'SharedStorage-journal',
    'declarative_performance_observer.db',
    'declarative_performance_observer.db-journal',
    'declarative_performance_observer.db-wal',
    'declarative_performance_observer.db-shm',
    'DevToolsActivePort',
    '.dev.craft-hub.desktop.Network Persistent State.aB3dE6',
    '.dev.craft-hub.desktop.TransportSecurity.Z9y8X7',
  ]
  const browserContent = 'browser-only-private-fixture'
  for (const name of names)
    await writeFile(join(paths.sourceData, name), browserContent)
  await mkdir(join(paths.sourceData, 'WebStorage'), { recursive: true })
  await writeFile(join(paths.sourceData, 'WebStorage/state'), browserContent)
  const sourceNames = await readdir(paths.sourceData)
  const preview = await previewProfileMigration(paths)
  expect(preview.blockers).toEqual([])
  expect(preview.excluded).toEqual([...names, 'WebStorage', 'Cookies'].sort())
  expect(JSON.stringify(preview)).not.toContain(browserContent)
  expect(await readdir(paths.sourceData)).toEqual(sourceNames)
  const receipt = await applyProfileMigration(paths, preview.revision, stopped)
  expect(receipt.phase).toBe('complete')
  for (const name of names) {
    expect(await readFile(join(paths.sourceData, name), 'utf8')).toBe(browserContent)
    await expect(stat(join(paths.target, 'runtime', name))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  expect(await readFile(join(paths.sourceData, 'WebStorage/state'), 'utf8')).toBe(browserContent)
  await expect(stat(join(paths.target, 'runtime/WebStorage'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8'))).toEqual(projects)
  for (const name of ['runs', 'agent-tasks'])
    await expect(stat(join(paths.target, 'runtime', name))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps near-matching browser names, business state, backups and incomplete runtime writes blocked', async () => {
  const { paths } = await fixture()
  const names = [
    'DIPS.backup',
    'SharedStorage-custom',
    'WebStorage.json',
    'DevToolsActivePort.backup',
    'declarative_performance_observer.db.backup',
    'collection-state.json',
    'plugins.json.before-link',
    'plugins.json.12345678-1234-1234-1234-123456789012.tmp',
    '.dev.craft-hub.desktop.settings.json.aB3dE6',
    '.dev.craft-hub.desktop.personal-cloud-device.json.aB3dE6',
    '.dev.craft-hub.desktop.Network Persistent State.short',
    '.dev.craft-hub.desktop.network persistent state.aB3dE6',
    '.dev.craft-hub.desktop.Network Persistent State.aB3dE6.backup',
    '.dev.craft-hub.desktop.TransportSecurity.long123',
  ]
  for (const name of names)
    await writeFile(join(paths.sourceData, name), 'preserve unknown data')
  const preview = await previewProfileMigration(paths)
  expect(preview.blockers).toEqual(names.sort().map(name => `Unclassified runtime entry needs a migration policy: ${name}`))
  await expect(applyProfileMigration(paths, preview.revision, stopped)).rejects.toThrow('unresolved blockers')
  expect(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  for (const name of names)
    expect(await readFile(join(paths.sourceData, name), 'utf8')).toBe('preserve unknown data')
})

it('restores the prior candidate after an installation failure and retains all recovery data', async () => {
  const { root, paths } = await fixture()
  const preview = await previewProfileMigration(paths)
  await expect(applyProfileMigration(paths, preview.revision, stopped, async (phase) => {
    if (phase === 'installed')
      throw new Error('Injected verification failure')
  })).rejects.toBeInstanceOf(ProfileMigrationRecoveryError)
  expect(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  const transaction = join(root, (await readdir(root)).find(name => name.startsWith('.native.migration-'))!)
  expect((await recoverProfileMigration(transaction, stopped)).phase).toBe('rolled-back')
  expect((await readdir(transaction)).some(name => name.startsWith('returned-candidate-'))).toBe(true)
})

it.each(['journal', 'candidate', 'previous', 'stage', 'empty-stage'])('binds data-only recovery approval to the reviewed %s under the migration lease', async (changed) => {
  const { paths } = await fixture()
  const review = await previewProfileMigration(paths)
  const receipt = await applyProfileMigration(paths, review.revision, stopped)
  const recovery = await previewProfileRecovery(receipt.transaction)
  expect(recovery.phase).toBe('complete')
  expect(recovery.paths).toEqual(review.paths)
  expect(JSON.stringify(recovery)).not.toContain('unsent native draft')
  if (changed === 'journal') {
    const path = join(receipt.transaction, 'journal.json')
    const journal = JSON.parse(await readFile(path, 'utf8'))
    journal.phase = 'installed'
    await writeFile(path, JSON.stringify(journal), { mode: 0o600 })
  }
  else {
    const directory = changed === 'candidate' ? paths.target : join(receipt.transaction, changed === 'empty-stage' ? 'stage' : changed)
    await mkdir(directory, { recursive: true })
    if (changed !== 'empty-stage')
      await writeFile(join(directory, 'later.txt'), 'retain edit')
  }
  const before = await readFile(join(receipt.transaction, 'journal.json'))
  await expect(recoverProfileMigration(receipt.transaction, stopped, recovery.reviewRevision)).rejects.toThrow('Recovery review changed')
  await expect(rollbackProfileMigration(receipt.transaction, recovery.revision, stopped, recovery.reviewRevision)).rejects.toThrow('Recovery review changed')
  expect(await readFile(join(receipt.transaction, 'journal.json'))).toEqual(before)
  expect(JSON.parse(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8'))[0].trust).toBe('untrusted')
})

it('returns an explicit retained recovery path when copying fails after journal creation', async () => {
  const { paths } = await fixture()
  const review = await previewProfileMigration(paths)
  let retained: ProfileMigrationRecoveryError | undefined
  try {
    await applyProfileMigration(paths, review.revision, stopped, async () => {
      throw new Error('fixture failure')
    })
  }
  catch (error) {
    expect(error).toBeInstanceOf(ProfileMigrationRecoveryError)
    retained = error as ProfileMigrationRecoveryError
  }
  expect(retained).toBeDefined()
  const recovery = await previewProfileRecovery(retained!.transaction)
  expect((await recoverProfileMigration(recovery.transaction, stopped, recovery.reviewRevision)).phase).toBe('aborted')
  expect(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
})

it('refuses identity journals before offering a data-only recovery review', async () => {
  const { paths } = await fixture()
  const review = await previewProfileMigration(paths)
  const receipt = await applyProfileMigration(paths, review.revision, stopped)
  const path = join(receipt.transaction, 'journal.json')
  const journal = JSON.parse(await readFile(path, 'utf8'))
  journal.identity = {
    binding: { id: 'd'.repeat(64), sourceRevision: review.sourceRevision, publicKey: 'public-fixture', endpoint: 'https://api.example.com', webOrigin: 'https://cloud.example.com' },
    decision: 'commit',
    settled: true,
  }
  await writeFile(path, JSON.stringify(journal), { mode: 0o600 })
  const before = await readFile(path)
  await expect(previewProfileRecovery(receipt.transaction)).rejects.toThrow('authenticated profile and identity recovery')
  await expect(recoverProfileMigration(receipt.transaction, stopped)).rejects.toThrow('authenticated profile and identity recovery')
  await expect(rollbackProfileMigration(receipt.transaction, 'unreviewed', stopped)).rejects.toThrow('authenticated profile and identity recovery')
  expect(await readFile(path)).toEqual(before)
})

it('rejects malformed configuration and journals without displaying their contents', async () => {
  const { paths } = await fixture()
  await writeFile(join(paths.sourceConfig, 'config.jsonc'), '{"schemaVersion": 1, private-fixture-value}')
  const blocked = await previewProfileMigration(paths)
  expect(blocked.blockers).toEqual(['Invalid portable configuration needs repair before migration: config.jsonc'])
  expect(JSON.stringify(blocked)).not.toContain('private-fixture-value')
  await writeFile(join(paths.sourceConfig, 'config.jsonc'), '{"schemaVersion":1,"workspaceOrder":[]}')
  await writeFile(join(paths.sourceData, 'settings.json'), 'private-fixture-value')
  await expect(previewProfileMigration(paths)).rejects.toThrow(/^Invalid migration JSON: settings.json$/)
  await writeFile(join(paths.sourceData, 'settings.json'), '{}')
  const review = await previewProfileMigration(paths)
  const receipt = await applyProfileMigration(paths, review.revision, stopped)
  const journalPath = join(receipt.transaction, 'journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  await writeFile(journalPath, JSON.stringify({ ...journal, hadTarget: 'false', phase: 'private-fixture-value' }))
  await expect(recoverProfileMigration(receipt.transaction, stopped)).rejects.toThrow(/^Invalid migration journal format$/)
  await writeFile(journalPath, JSON.stringify({ ...journal, phase: 'installed' }))
  await expect(applyProfileMigration(paths, review.revision, stopped)).rejects.toThrow('journal recovery')
  expect((await recoverProfileMigration(receipt.transaction, stopped)).phase).toBe('complete')
  expect((await applyProfileMigration(paths, review.revision, stopped)).alreadyApplied).toBe(true)
})

it('rejects external links, hard links, overlapping roots and unfinished run records', async () => {
  const { root, paths } = await fixture()
  await expect(previewProfileMigration({ ...paths, target: join(paths.sourceData, 'nested') })).rejects.toThrow('non-overlapping')
  await mkdir(join(paths.sourceData, 'plugin-data'))
  await writeFile(join(root, 'outside'), 'private fixture')
  await symlink('../../outside', join(paths.sourceData, 'plugin-data/escape'))
  await expect(previewProfileMigration(paths)).rejects.toThrow('link')
  await rm(join(paths.sourceData, 'plugin-data/escape'))
  await link(join(root, 'outside'), join(paths.sourceData, 'plugin-data/hardlink'))
  await expect(previewProfileMigration(paths)).rejects.toThrow('linked')
  await rm(join(paths.sourceData, 'plugin-data/hardlink'))
  await mkdir(join(paths.sourceData, 'runs'))
  await writeFile(join(paths.sourceData, 'runs/active.json'), '{"status":"running"}')
  expect((await previewProfileMigration(paths)).blockers).toContain('An unfinished operation needs recovery before migration: runs/active.json')
})

it('shares active client barriers but excludes migration and releases kernel locks after a killed process', async () => {
  const { paths } = await fixture()
  const first = await acquireProfileLease([paths.sourceData])
  const second = await acquireProfileLease([paths.sourceData])
  try {
    await expect(acquireProfileLease([paths.sourceData], 'migration')).rejects.toThrow('profile is in use')
  }
  finally {
    first.release()
    second.release()
  }
  const modulePath = fileURLToPath(new URL('../src/profile-lease.ts', import.meta.url))
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {acquireProfileLease} from ${JSON.stringify(modulePath)}; await acquireProfileLease([process.argv[1]], 'migration'); process.send('locked'); setInterval(()=>{},1000)`, paths.sourceData], { cwd: resolve('.'), env: { ...process.env, TMPDIR: paths.sourceConfig }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  try {
    await once(child, 'message', { signal: AbortSignal.timeout(10000) })
    await expect(acquireProfileLease([paths.sourceData])).rejects.toThrow('profile is in use')
  }
  finally {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  const recovered = await acquireProfileLease([paths.sourceData], 'migration')
  recovered.release()
})

it.each(['target-saved', 'installed'] as const)('recovers a real process crash at %s using the durable journal', async (crashPhase) => {
  const { root, paths } = await fixture()
  const review = await previewProfileMigration(paths)
  const reviewPath = join(root, 'review.json')
  await writeFile(reviewPath, JSON.stringify(review))
  const modulePath = fileURLToPath(new URL('../src/profile-migration.ts', import.meta.url))
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import {readFile} from 'node:fs/promises'; import {applyProfileMigration} from ${JSON.stringify(modulePath)}; const p=JSON.parse(await readFile(process.argv[1])); await applyProfileMigration(p.paths,p.revision,async()=>{},async phase=>{if(phase===process.argv[2]){setInterval(()=>{},1000);process.send('saved');await new Promise(()=>{})}})`, reviewPath, crashPhase], { cwd: resolve('.'), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  try {
    await once(child, 'message', { signal: AbortSignal.timeout(10000) })
  }
  finally {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  const transaction = join(root, (await readdir(root)).find(name => name.startsWith('.native.migration-'))!)
  expect((await recoverProfileMigration(transaction, stopped)).phase).toBe(crashPhase === 'installed' ? 'complete' : 'rolled-back')
  if (crashPhase === 'target-saved')
    expect(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  else
    expect((await applyProfileMigration(paths, review.revision, stopped)).alreadyApplied).toBe(true)
  expect(JSON.parse(await readFile(join(paths.sourceData, 'projects.json'), 'utf8'))[0].trust).toBe('untrusted')
}, 15000)
