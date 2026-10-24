import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { link, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { identityTransferContext, IdentityTransferError, validateIdentityTransferRequest } from '@craft-hub/personal-cloud'
import { canonicalProfilePath } from 'craft-hub'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceVault } from '../src/device-vault.ts'

function secureStorage(backend = 'keychain') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length),
  }
}

const roots: string[] = []
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-device-vault-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('personal cloud device vault', () => {
  it.skipIf(process.platform === 'win32')('refuses a named-pipe source without waiting for a writer', async () => {
    const root = await temporary()
    const vault = new DeviceVault(root, secureStorage(), 'darwin')
    execFileSync('mkfifo', [vault.path])
    await expect(vault.load()).rejects.toThrow(IdentityTransferError)
  })

  it('persists only an encrypted private key and registered device id', async () => {
    const dataDir = await temporary()
    const vault = new DeviceVault(dataDir, secureStorage(), 'darwin')
    const identity = await vault.loadOrCreate()
    const registered = await vault.register(identity, 'device-1')
    const raw = await readFile(vault.path, 'utf8')

    expect(raw.includes(identity.privateKey)).toBe(false)
    expect(raw).toContain('encryptedPrivateKey')
    if (process.platform !== 'win32')
      expect((await stat(vault.path)).mode & 0o777).toBe(0o600)
    await expect(vault.load()).resolves.toEqual(registered)
  })

  it('rejects Linux basic_text storage instead of writing plaintext', async () => {
    const dataDir = await temporary()
    const vault = new DeviceVault(dataDir, secureStorage('basic_text'), 'linux')
    await expect(vault.loadOrCreate()).rejects.toThrow('basic_text')
  })

  it('reviews without decrypting and seals only the unchanged identity for the reviewed receiver and scope', async () => {
    const root = await temporary()
    const storage = { ...secureStorage(), decryptString: vi.fn(secureStorage().decryptString) }
    const vault = new DeviceVault(join(root, '源'), storage, 'darwin')
    const identity = await vault.loadOrCreate()
    await vault.register(identity, 'source-device')
    storage.decryptString.mockClear()
    const preview = await vault.previewTransfer()
    expect(storage.decryptString).not.toHaveBeenCalled()
    const receiver = generateKeyPairSync('x25519')
    const request = validateIdentityTransferRequest({
      ...preview,
      version: 1,
      targetProfile: await canonicalProfilePath(join(root, '目的')),
      endpoint: 'https://api.example.com',
      webOrigin: 'https://cloud.example.com',
      challenge: randomBytes(32).toString('hex'),
      recipientKey: receiver.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
      expiresAt: Date.now() + 60_000,
    })
    const original = await readFile(vault.path)
    const envelope = await vault.sealTransfer(request, request)
    expect(JSON.stringify(envelope).includes(identity.privateKey)).toBe(false)
    const sender = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(envelope.senderKey, 'base64')]), format: 'der', type: 'spki' })
    const key = Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey: receiver.privateKey, publicKey: sender }), Buffer.from(request.challenge, 'hex'), Buffer.from('CRAFT-HUB-IDENTITY-TRANSFER-V1'), 32))
    const encrypted = Buffer.from(envelope.sealed, 'base64')
    function decrypt(context = request) {
      const cipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12))
      cipher.setAAD(identityTransferContext(context))
      cipher.setAuthTag(encrypted.subarray(-16))
      return JSON.parse(Buffer.concat([cipher.update(encrypted.subarray(12, -16)), cipher.final()]).toString('utf8'))
    }
    expect(decrypt().privateKey === identity.privateKey).toBe(true)
    for (const field of ['targetProfile', 'sourceData', 'sourceRevision', 'deviceId', 'endpoint', 'webOrigin', 'publicKey', 'recipientKey', 'challenge'] as const)
      expect(() => decrypt({ ...request, [field]: `${request[field]}changed` })).toThrow()
    expect(await readFile(vault.path)).toEqual(original)
    storage.decryptString.mockClear()
    await expect(vault.sealTransfer({ ...request, targetProfile: request.sourceData }, request)).rejects.toThrow(IdentityTransferError)
    await expect(vault.sealTransfer({ ...request, expiresAt: Date.now() - 1 }, request)).rejects.toThrow(IdentityTransferError)
    await expect(vault.sealTransfer(request, { ...request, endpoint: 'https://other.example.com' })).rejects.toThrow(IdentityTransferError)
    for (const invalid of [
      { ...request, version: true },
      { ...request, privateKey: 'must-not-be-accepted' },
      { ...request, recipientKey: 'invalid' },
      { ...request, expiresAt: Date.now() + 121_000 },
    ]) {
      await expect(vault.sealTransfer(invalid, request)).rejects.toThrow(IdentityTransferError)
    }
    await writeFile(vault.path, `${original}\n`)
    await expect(vault.sealTransfer(request, request)).rejects.toThrow(IdentityTransferError)
    expect(storage.decryptString).not.toHaveBeenCalled()
  })

  it('rejects a source replaced during decryption and a locked store without generating a new identity', async () => {
    const root = await temporary()
    const storage = secureStorage()
    const vault = new DeviceVault(join(root, 'source'), storage, 'darwin')
    await vault.loadOrCreate()
    const request = {
      ...await vault.previewTransfer(),
      version: 1,
      targetProfile: await canonicalProfilePath(join(root, 'target')),
      endpoint: 'https://api.example.com',
      webOrigin: 'https://cloud.example.com',
      challenge: randomBytes(32).toString('hex'),
      recipientKey: generateKeyPairSync('x25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
      expiresAt: Date.now() + 60_000,
    }
    const before = await readFile(vault.path)
    storage.isEncryptionAvailable = () => false
    await expect(vault.sealTransfer(request, request)).rejects.toThrow(IdentityTransferError)
    expect(await readFile(vault.path)).toEqual(before)
    storage.isEncryptionAvailable = () => true
    const decrypt = storage.decryptString
    // Removing the source synchronously models a non-cooperating writer while safeStorage is decrypting.
    storage.decryptString = (value) => {
      unlinkSync(vault.path)
      return decrypt(value)
    }
    await expect(vault.sealTransfer(request, request)).rejects.toThrow(IdentityTransferError)
    await expect(vault.previewTransfer()).resolves.toBeUndefined()
  })

  it('rejects malformed, linked, oversized and mismatched source data without returning provider details', async () => {
    const root = await temporary()
    const storage = secureStorage()
    const vault = new DeviceVault(root, storage, 'darwin')
    const original = await vault.loadOrCreate()
    const saved = await readFile(vault.path)
    const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' })
    const parsed = JSON.parse(saved.toString('utf8'))
    await writeFile(vault.path, JSON.stringify({ ...parsed, publicKey: other }))
    await expect(vault.load()).rejects.toThrow(IdentityTransferError)
    await writeFile(vault.path, 'sensitive-invalid-fixture')
    await expect(vault.previewTransfer()).rejects.toThrow(new IdentityTransferError().message)
    await writeFile(vault.path, Buffer.alloc(16 * 1024 + 1))
    await expect(vault.previewTransfer()).rejects.toThrow(IdentityTransferError)
    await writeFile(vault.path, saved)
    await link(vault.path, join(root, 'linked'))
    await expect(vault.previewTransfer()).rejects.toThrow(IdentityTransferError)
    await rm(vault.path)
    await symlink(join(root, 'linked'), vault.path)
    await expect(vault.load()).rejects.toThrow(IdentityTransferError)
    await rm(vault.path)
    await writeFile(vault.path, saved)
    storage.decryptString = () => {
      throw new Error(original.privateKey)
    }
    await expect(vault.load()).rejects.toThrow(new IdentityTransferError().message)
  })
})
