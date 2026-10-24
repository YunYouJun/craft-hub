import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it } from 'vitest'
import { acquireProfileLease, clearProfileMigrationGuard, inspectProfileMigrationGuard, ProfileMigrationGuardError, profileMigrationGuardPath, setProfileMigrationGuard } from '../src/profile-lease'
import { previewProfileMigration } from '../src/profile-migration'
import { CraftHubRuntime } from '../src/runtime'

const roots: Array<{ root: string, marker: string, durable: string }> = []
afterEach(async () => {
  for (const { root, marker, durable } of roots.splice(0)) {
    await rm(marker, { force: true })
    await rm(durable, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-identity-guard-')))
  const lockDirectory = join(await realpath(process.platform === 'win32' ? tmpdir() : '/tmp'), `craft-hub-profile-leases-${process.getuid?.() ?? 'user'}`)
  const marker = join(lockDirectory, `${createHash('sha256').update(root).digest('hex')}.migration.json`)
  const durable = await profileMigrationGuardPath(root)
  roots.push({ root, marker, durable })
  return { root, marker, durable, transaction: join(root, 'transaction') }
}

it('retains the migration barrier when its own legacy temporary marker is lost', async () => {
  const { root, marker, durable, transaction } = await fixture()
  const lease = await acquireProfileLease([root], 'migration')
  try {
    await setProfileMigrationGuard(lease, root, transaction)
  }
  finally { lease.release() }
  expect(durable).not.toBe(marker)
  expect(await readFile(durable, 'utf8')).toBe(await readFile(marker, 'utf8'))
  await rm(marker)
  expect(await inspectProfileMigrationGuard(root)).toMatchObject({ root, transaction, state: 'pending' })
  await expect(acquireProfileLease([root])).rejects.toThrow(ProfileMigrationGuardError)
  await expect(acquireProfileLease([root], 'migration')).rejects.toThrow(ProfileMigrationGuardError)
  const recovery = await acquireProfileLease([root], 'migration', transaction)
  try {
    await setProfileMigrationGuard(recovery, root, transaction, 'source-retained')
    expect(await readFile(durable, 'utf8')).toBe(await readFile(marker, 'utf8'))
    await clearProfileMigrationGuard(recovery, root, transaction)
  }
  finally { recovery.release() }
  await expect(readFile(durable)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  const reopened = await acquireProfileLease([root])
  reopened.release()
})

it('rejects conflicting guard owners and lets the same owner reconcile interrupted state transitions', async () => {
  const { root, marker, durable, transaction } = await fixture()
  const lease = await acquireProfileLease([root], 'migration')
  try {
    await setProfileMigrationGuard(lease, root, transaction)
  }
  finally { lease.release() }
  const original = await readFile(durable, 'utf8')
  await writeFile(marker, JSON.stringify({ version: 1, root, transaction: join(root, 'other'), state: 'pending' }))
  await expect(acquireProfileLease([root], 'migration', transaction)).rejects.toThrow(ProfileMigrationGuardError)
  await expect(inspectProfileMigrationGuard(root)).rejects.toThrow(ProfileMigrationGuardError)
  expect(await readFile(durable, 'utf8')).toBe(original)
  await writeFile(marker, JSON.stringify({ version: 1, root, transaction, state: 'source-retained' }))
  await expect(acquireProfileLease([root])).rejects.toThrow(ProfileMigrationGuardError)
  const recovery = await acquireProfileLease([root], 'migration', transaction)
  try {
    await clearProfileMigrationGuard(recovery, root, transaction)
  }
  finally { recovery.release() }
  expect(await inspectProfileMigrationGuard(root)).toBeUndefined()
})

it('keeps clients and unrelated maintenance stopped after the coordinator releases its kernel lease', async () => {
  const { root, marker, transaction } = await fixture()
  expect(await inspectProfileMigrationGuard(root)).toBeUndefined()
  const lease = await acquireProfileLease([root], 'migration')
  await setProfileMigrationGuard(lease, root, transaction)
  lease.release()
  await expect(acquireProfileLease([root])).rejects.toThrow(ProfileMigrationGuardError)
  await expect(acquireProfileLease([root], 'migration')).rejects.toThrow(ProfileMigrationGuardError)
  await expect(acquireProfileLease([root], 'migration', join(root, 'other'))).rejects.toThrow(ProfileMigrationGuardError)
  await expect(acquireProfileLease([root], 'client', transaction)).rejects.toThrow(ProfileMigrationGuardError)
  const reviewed = await acquireProfileLease([root], 'migration', transaction)
  await expect(clearProfileMigrationGuard(reviewed, root, join(root, 'other'))).rejects.toThrow(ProfileMigrationGuardError)
  await setProfileMigrationGuard(reviewed, root, transaction, 'source-retained')
  expect((await inspectProfileMigrationGuard(root))?.state).toBe('source-retained')
  await clearProfileMigrationGuard(reviewed, root, transaction)
  reviewed.release()
  await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  const reopened = await acquireProfileLease([root])
  reopened.release()
})

it('requires an owned live exclusive lease and retains it through an already-started guard write', async () => {
  const { root, transaction } = await fixture()
  const shared = await acquireProfileLease([root])
  await expect(setProfileMigrationGuard(shared, root, transaction)).rejects.toThrow(ProfileMigrationGuardError)
  shared.release()
  await expect(setProfileMigrationGuard({ paths: [root], release() {} }, root, transaction)).rejects.toThrow(ProfileMigrationGuardError)
  const exclusive = await acquireProfileLease([root], 'migration')
  await expect(setProfileMigrationGuard(exclusive, join(root, 'unleased'), transaction)).rejects.toThrow(ProfileMigrationGuardError)
  const installing = setProfileMigrationGuard(exclusive, root, transaction)
  exclusive.release()
  await installing
  await expect(setProfileMigrationGuard(exclusive, root, transaction)).rejects.toThrow(ProfileMigrationGuardError)
  const recovered = await acquireProfileLease([root], 'migration', transaction)
  await clearProfileMigrationGuard(recovered, root, transaction)
  recovered.release()
})

it.each(['marker', 'durable'] as const)('blocks corrupt %s metadata and runtime startup without repairing files, creating runs or changing trust', async (copy) => {
  const state = await fixture()
  const { root, transaction } = state
  const marker = state[copy]
  const lease = await acquireProfileLease([root], 'migration')
  await setProfileMigrationGuard(lease, root, transaction)
  lease.release()
  const paths = { sourceData: root, sourceConfig: join(root, '..', `${root.split('/').at(-1)}-config`), target: join(root, '..', `${root.split('/').at(-1)}-target`) }
  const preview = await previewProfileMigration(paths)
  expect(preview.blockers).toContain('A pending or retained device identity migration must be recovered before copying this profile.')
  const runtime = new CraftHubRuntime({ dataDir: root, configDir: paths.sourceConfig })
  await expect(runtime.protectProfile()).rejects.toThrow(ProfileMigrationGuardError)
  await runtime.close()
  await expect(readdir(root)).resolves.toEqual([])
  const valid = await readFile(marker)
  await writeFile(marker, 'invalid private fixture metadata')
  await expect(acquireProfileLease([root], 'migration', transaction)).rejects.toThrow(ProfileMigrationGuardError)
  expect(await readFile(marker, 'utf8')).toBe('invalid private fixture metadata')
  await writeFile(marker, valid)
  const repairedFixture = await acquireProfileLease([root], 'migration', transaction)
  await clearProfileMigrationGuard(repairedFixture, root, transaction)
  repairedFixture.release()
})
