import { Buffer } from 'node:buffer'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceVault } from '../src/device-vault.ts'

function secureStorage(backend = 'keychain') {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').slice('encrypted:'.length),
  }
}

describe('personal cloud device vault', () => {
  it('persists only an encrypted private key and registered device id', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-device-vault-'))
    const vault = new DeviceVault(dataDir, secureStorage(), 'darwin')
    const identity = await vault.loadOrCreate()
    const registered = await vault.register(identity, 'device-1')
    const raw = await readFile(vault.path, 'utf8')

    expect(raw).not.toContain(identity.privateKey)
    expect(raw).toContain('encryptedPrivateKey')
    await expect(vault.load()).resolves.toEqual(registered)
  })

  it('rejects Linux basic_text storage instead of writing plaintext', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-device-vault-'))
    const vault = new DeviceVault(dataDir, secureStorage('basic_text'), 'linux')
    await expect(vault.loadOrCreate()).rejects.toThrow('basic_text')
  })
})
