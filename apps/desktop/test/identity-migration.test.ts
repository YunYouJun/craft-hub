import type { IdentityMigrationReview } from '../src/identity-migration.ts'
import type { IdentityRecipientClient } from '../src/identity-recipient-client.ts'
import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { IdentityTransferError } from '@craft-hub/personal-cloud'
import { acquireProfileLease, inspectProfileMigrationGuard, previewIdentityProfileRecovery, profileMigrationGuardPath } from 'craft-hub'
import { afterEach, expect, it, vi } from 'vitest'
import { DeviceVault } from '../src/device-vault.ts'
import { coordinateIdentityMigration } from '../src/identity-migration.ts'

const dependencies = vi.hoisted(() => ({ open: vi.fn(), inspect: vi.fn() }))
vi.mock('../src/identity-recipient-client.ts', () => ({ openIdentityRecipient: dependencies.open }))
vi.mock('../src/identity-transfer-recipient.ts', () => ({ inspectIdentityRecipient: dependencies.inspect }))
const fixtures: Array<{ root: string, markers: string[] }> = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const fixture of fixtures.splice(0)) {
    await Promise.all(fixture.markers.map(path => rm(path, { force: true })))
    await rm(fixture.root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-host-migration-')))
  const paths = { sourceData: join(root, 'source'), sourceConfig: join(root, 'portable'), target: join(root, 'native') }
  await Promise.all([paths.sourceData, paths.sourceConfig, join(paths.target, 'runtime')].map(path => mkdir(path, { recursive: true })))
  const roots = [paths.sourceData, paths.sourceConfig, paths.target, join(paths.target, 'runtime'), join(paths.target, 'config')]
  const legacyLocks = join(await realpath('/tmp'), `craft-hub-profile-leases-${process.getuid!()}`)
  const markers = (await Promise.all(roots.map(async path => [await profileMigrationGuardPath(path), join(legacyLocks, `${createHash('sha256').update(path).digest('hex')}.migration.json`)]))).flat()
  fixtures.push({ root, markers })
  const projects = [{ id: 'fixture-project', path: join(root, 'project'), name: 'Fixture', trust: 'untrusted', addedAt: '2026-01-01T00:00:00Z' }]
  await writeFile(join(paths.sourceData, 'projects.json'), JSON.stringify(projects))
  await writeFile(join(paths.sourceData, 'settings.json'), '{}')
  await writeFile(join(paths.target, 'runtime/projects.json'), '[]')
  let secret = ''
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString: (value: string) => {
      secret = value
      return Buffer.from('opaque-fixture')
    },
    decryptString: vi.fn(() => secret),
  }
  const vault = new DeviceVault(paths.sourceData, storage, 'darwin')
  await vault.loadOrCreate()
  const peer = { application: '/fixture/Native.app', executable: '/fixture/Native.app/Contents/MacOS/Native', sourceApplication: '/fixture/Source.app', team: 'ABCDE12345', sourceCodeHash: 'a'.repeat(40), recipientCodeHash: 'b'.repeat(40) }
  dependencies.inspect.mockResolvedValue(peer)
  let state: 'empty' | 'staged' | 'activated' | 'active' = 'empty'
  let unavailable = false
  const available = (): void => {
    if (unavailable)
      throw new IdentityTransferError()
  }
  const client = {
    assertHostsStopped: vi.fn(),
    prepare: vi.fn(async () => ({
      ...await vault.previewTransfer()!,
      version: 1 as const,
      targetProfile: paths.target,
      endpoint: 'https://api.example.com',
      webOrigin: 'https://cloud.example.com',
      recipientKey: generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
      expiresAt: Date.now() + 120_000,
      challenge: 'c'.repeat(64),
    })),
    resume: vi.fn(async () => { available() }),
    inspect: vi.fn(async () => {
      available()
      return state
    }),
    stage: vi.fn(async () => {
      available()
      state = 'staged'
    }),
    activate: vi.fn(async () => {
      available()
      state = 'activated'
    }),
    finish: vi.fn(async () => {
      available()
      state = 'active'
    }),
    rollback: vi.fn(async () => {
      available()
      state = 'empty'
    }),
    close: vi.fn(),
  }
  dependencies.open.mockImplementation(async () => {
    unavailable = false
    return client as IdentityRecipientClient
  })
  const options = { vault, sourceData: paths.sourceData, sourceConfig: paths.sourceConfig, endpoint: 'https://api.example.com', webOrigin: 'https://cloud.example.com', confirm: vi.fn(async (_review: IdentityMigrationReview) => true) }
  const command = { version: 1 as const, action: 'migrate' as const, application: peer.application, targetProfile: paths.target }
  return { root, roots, paths, projects, storage, vault, peer, client, options, command, disconnect: () => {
    unavailable = true
  }, state: () => state }
}

it('cancels after a public review without launching a recipient, decrypting or changing either profile', async () => {
  const f = await fixture()
  const before = await readFile(f.vault.path)
  f.options.confirm.mockImplementation(async (review) => {
    expect(review.kind).toBe('migrate')
    expect(JSON.stringify(review)).not.toContain('recipientKey')
    expect(JSON.stringify(review)).not.toContain('encryptedPrivateKey')
    review.peer.recipientCodeHash = 'untrusted callback edit'
    return false
  })
  expect(await coordinateIdentityMigration(f.command, f.options)).toEqual({ status: 'cancelled' })
  expect(dependencies.open).not.toHaveBeenCalled()
  expect(f.storage.decryptString).not.toHaveBeenCalled()
  expect(await readFile(f.vault.path)).toEqual(before)
  expect(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  expect(await inspectProfileMigrationGuard(f.paths.sourceData)).toBeUndefined()
})

it('seals only under all coordinator leases, keeps trust unchanged and rolls back later native edits after review', async () => {
  const f = await fixture()
  const seal = f.vault.sealTransfer.bind(f.vault)
  vi.spyOn(f.vault, 'sealTransfer').mockImplementation(async (...args) => {
    await expect(acquireProfileLease(f.roots, 'migration')).rejects.toThrow()
    expect(await inspectProfileMigrationGuard(f.paths.sourceData)).toMatchObject({ state: 'pending' })
    return seal(...args)
  })
  f.options.confirm.mockImplementation(async (review) => {
    review.peer.recipientCodeHash = 'untrusted callback edit'
    return true
  })
  const original = await readFile(f.vault.path)
  const result = await coordinateIdentityMigration(f.command, f.options)
  expect(result.status).toBe('complete')
  if (result.status !== 'complete')
    throw new Error('Expected a receipt')
  expect(dependencies.open).toHaveBeenCalledWith(f.peer, undefined)
  expect(f.client.prepare).toHaveBeenCalledWith(f.paths, f.options.endpoint, f.options.webOrigin)
  expect(f.storage.decryptString).toHaveBeenCalledOnce()
  expect(f.state()).toBe('active')
  expect(JSON.parse(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8'))).toEqual(f.projects)
  expect(await readFile(f.vault.path)).toEqual(original)
  expect((await inspectProfileMigrationGuard(f.paths.sourceData))?.state).toBe('source-retained')
  await writeFile(join(f.paths.target, 'later.txt'), 'retain this later edit')
  const rollback = await coordinateIdentityMigration({ version: 1, action: 'rollback', application: f.peer.application, transaction: result.receipt.transaction }, f.options)
  expect(rollback).toMatchObject({ status: 'complete', receipt: { phase: 'rolled-back' } })
  expect(f.client.prepare).toHaveBeenCalledOnce()
  expect(f.client.resume).toHaveBeenCalledOnce()
  expect(f.state()).toBe('empty')
  expect(f.storage.decryptString).toHaveBeenCalledOnce()
  expect(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  expect(await inspectProfileMigrationGuard(f.paths.sourceData)).toBeUndefined()
  expect(f.client.close).toHaveBeenCalledTimes(2)
})

it.each(['profile', 'identity', 'hosts'])('rejects a changed %s after approval before decrypting the source', async (changed) => {
  const f = await fixture()
  f.options.confirm.mockImplementation(async () => {
    if (changed === 'profile') {
      await writeFile(join(f.paths.sourceData, 'settings.json'), '{"theme":"dark"}')
    }
    else if (changed === 'identity') {
      await writeFile(f.vault.path, `${await readFile(f.vault.path, 'utf8')}\n`)
    }
    else {
      f.client.assertHostsStopped.mockImplementation(() => {
        throw new Error('Another host is running')
      })
    }
    return true
  })
  await expect(coordinateIdentityMigration(f.command, f.options)).rejects.toThrow(IdentityTransferError)
  expect(f.storage.decryptString).not.toHaveBeenCalled()
  expect(f.client.stage).not.toHaveBeenCalled()
  expect(f.client.close).toHaveBeenCalledOnce()
  expect(await readFile(join(f.paths.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
})

it.each(['stage', 'finish'] as const)('recovers an uncertain %s acknowledgement through the existing journal without another key or decryption', async (operation) => {
  const f = await fixture()
  const original = f.client[operation].getMockImplementation()!
  f.client[operation].mockImplementationOnce(async () => {
    await original()
    f.disconnect()
    throw new IdentityTransferError()
  })
  const interrupted = await coordinateIdentityMigration(f.command, f.options)
  expect(interrupted.status).toBe('recovery-required')
  if (interrupted.status !== 'recovery-required')
    throw new Error('Expected recovery')
  expect(await previewIdentityProfileRecovery(interrupted.transaction)).toMatchObject({ decision: operation === 'finish' ? 'commit' : 'rollback', settled: false })
  const result = await coordinateIdentityMigration({ version: 1, action: 'recover', application: f.peer.application, transaction: interrupted.transaction }, f.options)
  expect(result).toMatchObject({ status: 'complete', receipt: { phase: operation === 'finish' ? 'complete' : 'aborted' } })
  expect(f.client.prepare).toHaveBeenCalledOnce()
  expect(f.client.resume).toHaveBeenCalledOnce()
  expect(f.storage.decryptString).toHaveBeenCalledOnce()
  expect(f.state()).toBe(operation === 'finish' ? 'active' : 'empty')
})

it('rechecks the reviewed journal and candidate inside the runtime lease even if they change while opening the recipient', async () => {
  const f = await fixture()
  const completed = await coordinateIdentityMigration(f.command, f.options)
  if (completed.status !== 'complete')
    throw new Error('Expected receipt')
  f.client.resume.mockImplementationOnce(async () => {
    await writeFile(join(f.paths.target, 'new.txt'), 'changed after the host recheck')
  })
  const outcome = await coordinateIdentityMigration({ version: 1, action: 'rollback', application: f.peer.application, transaction: completed.receipt.transaction }, f.options)
  expect(outcome).toEqual({ status: 'recovery-required', transaction: completed.receipt.transaction })
  expect(f.client.rollback).not.toHaveBeenCalled()
  expect(await previewIdentityProfileRecovery(completed.receipt.transaction)).toMatchObject({ decision: 'commit', settled: true })
  expect(await readFile(join(f.paths.target, 'new.txt'), 'utf8')).toBe('changed after the host recheck')
})

it('rejects another source or cloud scope before offering recovery approval', async () => {
  const f = await fixture()
  const completed = await coordinateIdentityMigration(f.command, f.options)
  if (completed.status !== 'complete')
    throw new Error('Expected receipt')
  f.options.confirm.mockClear()
  dependencies.open.mockClear()
  for (const different of [{ sourceConfig: join(f.root, 'other') }, { endpoint: 'https://different.example.com' }]) {
    await expect(coordinateIdentityMigration({ version: 1, action: 'recover', application: f.peer.application, transaction: completed.receipt.transaction }, { ...f.options, ...different })).rejects.toThrow(IdentityTransferError)
  }
  expect(f.options.confirm).not.toHaveBeenCalled()
  expect(dependencies.open).not.toHaveBeenCalled()
})
