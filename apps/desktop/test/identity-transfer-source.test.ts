import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { IdentityTransferError } from '@craft-hub/personal-cloud'
import { acquireProfileLease, canonicalProfilePath } from 'craft-hub'
import { afterEach, expect, it, vi } from 'vitest'
import { DeviceVault } from '../src/device-vault.ts'
import { operateIdentityTransferSource, readIdentityTransferInput } from '../src/identity-transfer-source.ts'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-identity-source-test-'))
  roots.push(root)
  let secret = ''
  const storage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString: (plain: string) => {
      secret = plain
      return Buffer.from('opaque fixture ciphertext')
    },
    decryptString: vi.fn(() => secret),
  }
  const vault = new DeviceVault(join(root, 'source'), storage, 'darwin')
  await vault.loadOrCreate()
  const request = {
    ...await vault.previewTransfer(),
    version: 1 as const,
    targetProfile: await canonicalProfilePath(join(root, 'native')),
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
    challenge: randomBytes(32).toString('hex'),
    expiresAt: Date.now() + 60_000,
    recipientKey: generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
  }
  const options = {
    vault,
    sourceData: request.sourceData!,
    endpoint: request.endpoint,
    webOrigin: request.webOrigin,
    assertHostsStopped: vi.fn(async () => {}),
    confirm: vi.fn(async () => true),
  }
  return { storage, vault, request, options }
}

it('previews without decrypting or confirming, rejects extra fields and bounds private input', async () => {
  const { storage, options, request } = await fixture()
  await expect(operateIdentityTransferSource({ version: 1, action: 'preview' }, options)).resolves.toMatchObject({ sourceRevision: request.sourceRevision })
  expect(storage.decryptString).not.toHaveBeenCalled()
  expect(options.confirm).not.toHaveBeenCalled()
  await expect(operateIdentityTransferSource({ version: 1, action: 'preview', yes: true }, options)).rejects.toThrow(IdentityTransferError)
  await expect(readIdentityTransferInput(Readable.from(['{"version":', '1}']))).resolves.toEqual({ version: 1 })
  await expect(readIdentityTransferInput(Readable.from(['sensitive invalid payload']))).rejects.toThrow(new IdentityTransferError().message)
  await expect(readIdentityTransferInput(Readable.from([Buffer.alloc(16 * 1024 + 1)]))).rejects.toThrow(IdentityTransferError)
  vi.useFakeTimers()
  const input = new PassThrough()
  const pending = expect(readIdentityTransferInput(input)).rejects.toThrow(IdentityTransferError)
  await vi.advanceTimersByTimeAsync(10_000)
  await pending
})

it('holds source and destination leases through explicit confirmation and releases them on rejection', async () => {
  const { storage, options, request } = await fixture()
  const busy = await acquireProfileLease([options.sourceData])
  await expect(operateIdentityTransferSource({ version: 1, action: 'seal', request }, options)).rejects.toThrow(IdentityTransferError)
  expect(options.confirm).not.toHaveBeenCalled()
  busy.release()
  options.confirm.mockImplementation(async () => {
    await expect(acquireProfileLease([options.sourceData])).rejects.toThrow('in use')
    await expect(acquireProfileLease([request.targetProfile])).rejects.toThrow('in use')
    await expect(acquireProfileLease([join(request.targetProfile, 'runtime')])).rejects.toThrow('in use')
    return false
  })
  await expect(operateIdentityTransferSource({ version: 1, action: 'seal', request }, options)).rejects.toThrow(IdentityTransferError)
  expect(storage.decryptString).not.toHaveBeenCalled()
  const released = await acquireProfileLease([options.sourceData, request.targetProfile], 'migration')
  released.release()
})

it('checks the exact source and cloud before prompting and rechecks source changes after approval', async () => {
  const { storage, options, request, vault } = await fixture()
  for (const bad of [{ ...request, endpoint: 'https://other.example.com' }, { ...request, sourceRevision: '0'.repeat(64) }, { ...request, targetProfile: '/' }]) {
    await expect(operateIdentityTransferSource({ version: 1, action: 'seal', request: bad }, options)).rejects.toThrow(IdentityTransferError)
  }
  expect(options.confirm).not.toHaveBeenCalled()
  const before = await readFile(vault.path)
  options.confirm.mockImplementation(async () => {
    await writeFile(vault.path, `${before}\n`)
    return true
  })
  await expect(operateIdentityTransferSource({ version: 1, action: 'seal', request }, options)).rejects.toThrow(IdentityTransferError)
  expect(storage.decryptString).not.toHaveBeenCalled()
})

it('returns only the reviewed encrypted envelope and leaves the original identity intact', async () => {
  const { storage, options, request, vault } = await fixture()
  const before = await readFile(vault.path)
  const envelope = await operateIdentityTransferSource({ version: 1, action: 'seal', request }, options)
  expect(Object.keys(envelope!).sort()).toEqual(['challenge', 'sealed', 'senderKey', 'version'])
  expect(storage.decryptString).toHaveBeenCalledOnce()
  expect(options.assertHostsStopped).toHaveBeenCalledTimes(2)
  expect(options.confirm).toHaveBeenCalledOnce()
  expect(await readFile(vault.path)).toEqual(before)
})
