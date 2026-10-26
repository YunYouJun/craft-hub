import type { ProfileIdentityBinding, ProfileIdentityCheckpoint, ProfileMigrationPaths } from '../src/profile-migration'
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { acquireProfileLease, inspectProfileMigrationGuard, profileMigrationGuardPath } from '../src/profile-lease'
import { applyIdentityProfileMigration, applyProfileMigration, previewIdentityProfileRecovery, previewProfileMigration, ProfileIdentityRecoveryError, recoverIdentityProfileMigration, recoverProfileMigration, rollbackIdentityProfileMigration, rollbackProfileMigration } from '../src/profile-migration'
import { CraftHubRuntime } from '../src/runtime'
import { stopMigrationFixture, waitForMigrationCheckpoint } from './fixtures/migration-process'
import { fixtureIdentityParticipant } from './fixtures/profile-identity-participant'

const fixtures: Array<{ root: string, markers: string[] }> = []
// Complete durable filesystem transactions can exceed the default deadline on hosted Windows disks.
const transactionTimeout = process.platform === 'win32' ? 15_000 : 5000
const protectedPaths = (paths: ProfileMigrationPaths) => [paths.sourceData, paths.sourceConfig, paths.target, join(paths.target, 'runtime'), join(paths.target, 'config')]
async function stopped() {}
afterEach(async () => {
  for (const { root, markers } of fixtures.splice(0)) {
    for (const marker of markers)
      await rm(marker, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-identity-migration-')))
  const paths = { sourceData: join(root, 'source'), sourceConfig: join(root, 'portable'), target: join(root, 'native') }
  await Promise.all([paths.sourceData, paths.sourceConfig, join(paths.target, 'runtime')].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  const projects = [{ id: 'fixture-project', path: join(root, 'project'), name: 'Fixture', trust: 'untrusted', addedAt: '2026-01-01T00:00:00Z' }]
  await writeFile(join(paths.sourceData, 'projects.json'), JSON.stringify(projects))
  await writeFile(join(paths.sourceData, 'settings.json'), '{}')
  await writeFile(join(paths.target, 'runtime/projects.json'), '[]')
  const ciphertext = JSON.stringify({ encryptedPrivateKey: 'opaque fixture ciphertext' })
  await writeFile(join(paths.sourceData, 'personal-cloud-device.json'), ciphertext, { mode: 0o600 })
  const identity: ProfileIdentityBinding = {
    id: randomBytes(32).toString('hex'),
    sourceRevision: createHash('sha256').update(ciphertext).digest('hex'),
    publicKey: generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    deviceId: 'fixture-device',
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
  }
  const lockDirectory = join(await realpath(process.platform === 'win32' ? tmpdir() : '/tmp'), `craft-hub-profile-leases-${process.getuid?.() ?? 'user'}`)
  const markers: string[] = []
  for (const path of protectedPaths(paths))
    markers.push(await profileMigrationGuardPath(path), join(lockDirectory, `${createHash('sha256').update(path).digest('hex')}.migration.json`))
  fixtures.push({ root, markers })
  const stateFile = join(root, 'participant.json')
  const participant = fixtureIdentityParticipant(stateFile)
  return { root, paths, identity, participant, stateFile, projects, ciphertext, markers }
}

it('commits data and identity together, retains the source gate, repeats safely and rolls back reviewed later edits', { timeout: transactionTimeout }, async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  await expect(applyProfileMigration(f.paths, preview.revision, stopped)).rejects.toThrow('unresolved blockers')
  const receipt = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)
  const context = await previewIdentityProfileRecovery(receipt.transaction)
  expect(context).toMatchObject({ phase: 'complete', decision: 'commit', settled: true })
  expect(await f.participant.inspect({ transaction: context.transaction, paths: context.paths, identity: context.identity })).toBe('active')
  expect((await inspectProfileMigrationGuard(f.paths.sourceData))?.state).toBe('source-retained')
  expect(await inspectProfileMigrationGuard(f.paths.target)).toBeUndefined()
  await expect(acquireProfileLease([f.paths.sourceData])).rejects.toThrow('identity migration')
  const runtime = new CraftHubRuntime({ dataDir: join(f.paths.target, 'runtime'), configDir: join(f.paths.target, 'config') })
  try {
    expect(await runtime.store.listProjects()).toEqual(f.projects)
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally { await runtime.close() }
  await expect(access(join(f.paths.target, 'runtime/personal-cloud-device.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(f.paths.sourceData, 'personal-cloud-device.json'), 'utf8')).toBe(f.ciphertext)
  await writeFile(join(f.paths.target, 'runtime/settings.json'), '{"laterEdit":true}')
  expect((await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)).alreadyApplied).toBe(true)
  await expect(rollbackIdentityProfileMigration(receipt.transaction, 'stale', f.participant, stopped)).rejects.toThrow(ProfileIdentityRecoveryError)
  const rollback = await previewIdentityProfileRecovery(receipt.transaction)
  expect((await rollbackIdentityProfileMigration(receipt.transaction, rollback.revision, f.participant, stopped)).phase).toBe('rolled-back')
  expect(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  const archive = (await readdir(receipt.transaction)).find(name => name.startsWith('returned-candidate-'))!
  expect(await readFile(join(receipt.transaction, archive, 'runtime/settings.json'), 'utf8')).toContain('laterEdit')
  expect((await previewIdentityProfileRecovery(receipt.transaction)).settled).toBe(true)
  expect((await recoverIdentityProfileMigration(receipt.transaction, f.participant, stopped)).alreadyApplied).toBe(true)
  for (const path of protectedPaths(f.paths))
    expect(await inspectProfileMigrationGuard(path)).toBeUndefined()
})

it('invalidates an interactive recovery approval when its journal changes even if the candidate hash stays the same', { timeout: transactionTimeout }, async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const receipt = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)
  const reviewed = await previewIdentityProfileRecovery(receipt.transaction)
  const path = join(receipt.transaction, 'journal.json')
  const journal = JSON.parse(await readFile(path, 'utf8'))
  journal.identity.settled = false
  await writeFile(path, JSON.stringify(journal), { mode: 0o600 })
  const current = await previewIdentityProfileRecovery(receipt.transaction)
  expect(current.revision).toBe(reviewed.revision)
  expect(current.reviewRevision).not.toBe(reviewed.reviewRevision)
  await expect(recoverIdentityProfileMigration(receipt.transaction, f.participant, stopped, reviewed.reviewRevision)).rejects.toThrow(ProfileIdentityRecoveryError)
  expect(await previewIdentityProfileRecovery(receipt.transaction)).toMatchObject({ settled: false, decision: 'commit' })
  const recovered = await recoverIdentityProfileMigration(receipt.transaction, f.participant, stopped, current.reviewRevision)
  expect(recovered.phase).toBe('complete')
  expect(JSON.parse(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8'))).toEqual(f.projects)
})

it('refuses a busy source, unrelated destination and non-identity blockers before staging', async () => {
  const f = await fixture()
  let stages = 0
  const participant = { ...f.participant, stage: async () => {
    stages += 1
  } }
  const preview = await previewProfileMigration(f.paths)
  const lease = await acquireProfileLease([f.paths.sourceData])
  try {
    await expect(applyIdentityProfileMigration(f.paths, preview.revision, f.identity, participant, stopped)).rejects.toThrow('profile is in use')
  }
  finally { lease.release() }
  await expect(applyIdentityProfileMigration(f.paths, preview.revision, f.identity, { ...participant, inspect: async () => 'active' }, stopped)).rejects.toThrow('not empty')
  await writeFile(join(f.paths.sourceData, 'unknown'), 'retain this unknown file')
  const blocked = await previewProfileMigration(f.paths)
  await expect(applyIdentityProfileMigration(f.paths, blocked.revision, f.identity, participant, stopped)).rejects.toThrow('non-identity blockers')
  expect(stages).toBe(0)
  expect((await readdir(f.root)).some(name => name.startsWith('.native.migration-'))).toBe(false)
})

it('reconciles a lost staging reply by aborting the matching reservation and retaining the old profile', async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const participant = { ...f.participant, stage: async (context: Parameters<typeof f.participant.stage>[0]) => {
    await f.participant.stage(context)
    throw new Error('private adapter details must not escape')
  } }
  const error = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, participant, stopped).catch(error => error)
  expect(error).toBeInstanceOf(ProfileIdentityRecoveryError)
  expect(error.message).not.toContain('private adapter')
  expect(await previewIdentityProfileRecovery(error.transaction)).toMatchObject({ phase: 'aborted', decision: 'rollback', settled: true })
  expect(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  expect(await inspectProfileMigrationGuard(f.paths.sourceData)).toBeUndefined()
})

it('keeps both hosts gated after a lost finish reply and recovers the committed decision without retransferring', async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const participant = { ...f.participant, finish: async (context: Parameters<typeof f.participant.finish>[0]) => {
    await f.participant.finish(context)
    throw new Error('lost reply')
  } }
  const error = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, participant, stopped).catch(error => error)
  expect(error).toBeInstanceOf(ProfileIdentityRecoveryError)
  expect(await previewIdentityProfileRecovery(error.transaction)).toMatchObject({ decision: 'commit', settled: false })
  for (const path of protectedPaths(f.paths))
    await expect(acquireProfileLease([path])).rejects.toThrow('identity migration')
  const recovery = { ...f.participant, stage: async () => {
    throw new Error('must not transfer again')
  }, finish: async () => {
    throw new Error('already finished')
  } }
  expect((await recoverIdentityProfileMigration(error.transaction, recovery, stopped)).phase).toBe('complete')
  // Even if markers were manually lost, the data-only recovery API must never bypass the identity journal.
  for (const marker of f.markers)
    await rm(marker, { force: true })
  await expect(recoverProfileMigration(error.transaction, stopped)).rejects.toThrow('authenticated profile and identity recovery')
  await expect(rollbackProfileMigration(error.transaction, 'unused', stopped)).rejects.toThrow('authenticated profile and identity recovery')
})

it('preserves the native identity if its retained encrypted source changes before rollback', async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const receipt = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)
  const review = await previewIdentityProfileRecovery(receipt.transaction)
  await writeFile(join(f.paths.sourceData, 'personal-cloud-device.json'), 'changed source')
  await expect(rollbackIdentityProfileMigration(receipt.transaction, review.revision, f.participant, stopped)).rejects.toThrow(ProfileIdentityRecoveryError)
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).state).toBe('active')
  expect(await previewIdentityProfileRecovery(receipt.transaction)).toMatchObject({ decision: 'commit', settled: true })
  expect((await inspectProfileMigrationGuard(f.paths.sourceData))?.state).toBe('source-retained')
})

it('recovers a lost rollback reply without restoring or deleting an unrelated later identity', async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const receipt = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)
  const review = await previewIdentityProfileRecovery(receipt.transaction)
  const participant = { ...f.participant, rollback: async (context: Parameters<typeof f.participant.rollback>[0]) => {
    await f.participant.rollback(context)
    throw new Error('lost rollback reply')
  } }
  await expect(rollbackIdentityProfileMigration(receipt.transaction, review.revision, participant, stopped)).rejects.toThrow(ProfileIdentityRecoveryError)
  expect(await previewIdentityProfileRecovery(receipt.transaction)).toMatchObject({ decision: 'rollback', phase: 'rolled-back', settled: false })
  await expect(acquireProfileLease([f.paths.sourceData])).rejects.toThrow('identity migration')
  const recovery = { ...f.participant, rollback: async () => {
    throw new Error('already removed; must not delete again')
  } }
  expect((await recoverIdentityProfileMigration(receipt.transaction, recovery, stopped)).phase).toBe('rolled-back')
  expect(await inspectProfileMigrationGuard(f.paths.sourceData)).toBeUndefined()
  // A completed retry only returns its receipt; it cannot roll back a newly created identity.
  const later = { ...f.participant, inspect: async () => {
    throw new Error('later unrelated identity')
  } }
  expect((await recoverIdentityProfileMigration(receipt.transaction, later, stopped)).alreadyApplied).toBe(true)
})

it('returns to an absent native profile on rollback when no candidate existed before migration', async () => {
  const f = await fixture()
  await rm(f.paths.target, { recursive: true })
  const preview = await previewProfileMigration(f.paths)
  const receipt = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped)
  const review = await previewIdentityProfileRecovery(receipt.transaction)
  await rollbackIdentityProfileMigration(receipt.transaction, review.revision, f.participant, stopped)
  await expect(access(f.paths.target)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).state).toBe('empty')
  expect((await readdir(receipt.transaction)).some(name => name.startsWith('returned-candidate-'))).toBe(true)
})

it('keeps a staged identity when the source changes during copying and only aborts after the source is restored', async () => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const error = await applyIdentityProfileMigration(f.paths, preview.revision, f.identity, f.participant, stopped, async (phase) => {
    if (phase === 'staged') {
      await writeFile(join(f.paths.sourceData, 'personal-cloud-device.json'), 'changed source')
      throw new Error('interrupted after source replacement')
    }
  }).catch(error => error)
  expect(error).toBeInstanceOf(ProfileIdentityRecoveryError)
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).state).toBe('staged')
  expect(await previewIdentityProfileRecovery(error.transaction)).toMatchObject({ decision: 'rollback', settled: false })
  for (const path of protectedPaths(f.paths))
    await expect(acquireProfileLease([path])).rejects.toThrow('identity migration')
  await writeFile(join(f.paths.sourceData, 'personal-cloud-device.json'), f.ciphertext)
  expect((await recoverIdentityProfileMigration(error.transaction, f.participant, stopped)).phase).toBe('aborted')
  expect(JSON.parse(await readFile(f.stateFile, 'utf8')).state).toBe('empty')
})

it.each(['guarded', 'staged', 'installed', 'commit-decided', 'finished', 'settled'] satisfies ProfileIdentityCheckpoint[])('recovers a killed coordinator at %s from durable data and participant state', async (checkpoint) => {
  const f = await fixture()
  const preview = await previewProfileMigration(f.paths)
  const inputPath = join(f.root, 'input.json')
  await writeFile(inputPath, JSON.stringify({ paths: f.paths, revision: preview.revision, identity: f.identity, stateFile: f.stateFile }))
  const implementation = new URL('../src/profile-migration.ts', import.meta.url).href
  const adapter = new URL('./fixtures/profile-identity-participant.ts', import.meta.url).href
  const code = `import {readFile} from 'node:fs/promises'; import {applyIdentityProfileMigration} from ${JSON.stringify(implementation)}; import {fixtureIdentityParticipant} from ${JSON.stringify(adapter)}; const input=JSON.parse(await readFile(process.argv[1])); await applyIdentityProfileMigration(input.paths,input.revision,input.identity,fixtureIdentityParticipant(input.stateFile),async()=>{},async phase=>{if(phase===process.argv[2]){setInterval(()=>{},1000);process.send('checkpoint');await new Promise(()=>{})}})`
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, inputPath, checkpoint], { cwd: resolve('.'), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  try {
    expect(await waitForMigrationCheckpoint(child)).toBe('checkpoint')
  }
  finally {
    await stopMigrationFixture(child)
  }
  const transaction = join(f.root, (await readdir(f.root)).find(name => name.startsWith('.native.migration-'))!)
  const committed = ['commit-decided', 'finished', 'settled'].includes(checkpoint)
  const result = await recoverIdentityProfileMigration(transaction, f.participant, stopped)
  expect(result.phase).toBe(committed ? 'complete' : checkpoint === 'installed' ? 'rolled-back' : 'aborted')
  expect((await previewIdentityProfileRecovery(transaction)).settled).toBe(true)
  expect(JSON.parse(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8'))).toEqual(committed ? f.projects : [])
  expect(await readFile(join(f.paths.sourceData, 'personal-cloud-device.json'), 'utf8')).toBe(f.ciphertext)
  if (committed) {
    expect((await inspectProfileMigrationGuard(f.paths.sourceData))?.state).toBe('source-retained')
    expect(await inspectProfileMigrationGuard(f.paths.target)).toBeUndefined()
  }
  else {
    for (const path of protectedPaths(f.paths))
      expect(await inspectProfileMigrationGuard(path)).toBeUndefined()
  }
}, 15000)
