import type { DeviceIdentity } from '@craft-hub/personal-cloud'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface SecureStorage {
  decryptString: (encrypted: Buffer) => string
  encryptString: (plainText: string) => Buffer
  getSelectedStorageBackend: () => string
  isEncryptionAvailable: () => boolean
}

interface StoredDeviceIdentity {
  schemaVersion: 1
  deviceId?: string
  publicKey: string
  encryptedPrivateKey: string
}

/** Persist a device private key only through Electron safeStorage. */
export class DeviceVault {
  readonly path: string
  private readonly storage: SecureStorage
  private readonly platform: NodeJS.Platform

  constructor(dataDir: string, storage: SecureStorage, platform: NodeJS.Platform) {
    this.path = join(dataDir, 'personal-cloud-device.json')
    this.storage = storage
    this.platform = platform
  }

  async load(): Promise<DeviceIdentity | undefined> {
    this.assertSecureStorage()
    try {
      const stored = JSON.parse(await readFile(this.path, 'utf8')) as StoredDeviceIdentity
      if (stored.schemaVersion !== 1 || typeof stored.publicKey !== 'string' || typeof stored.encryptedPrivateKey !== 'string')
        throw new Error('Stored personal cloud device is invalid')
      return {
        deviceId: stored.deviceId,
        publicKey: stored.publicKey,
        privateKey: this.storage.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64')),
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
  }

  async loadOrCreate(): Promise<DeviceIdentity> {
    const existing = await this.load()
    if (existing)
      return existing
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    })
    const identity = { privateKey, publicKey }
    await this.save(identity)
    return identity
  }

  async register(identity: DeviceIdentity, deviceId: string): Promise<DeviceIdentity> {
    if (!deviceId)
      throw new Error('Device id is required')
    const registered = { ...identity, deviceId }
    await this.save(registered)
    return registered
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
  }

  private assertSecureStorage(): void {
    if (!this.storage.isEncryptionAvailable())
      throw new Error('Operating-system secure storage is unavailable')
    if (this.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text')
      throw new Error('Electron safeStorage is using the insecure basic_text backend')
  }

  private async save(identity: DeviceIdentity): Promise<void> {
    this.assertSecureStorage()
    const stored: StoredDeviceIdentity = {
      schemaVersion: 1,
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      encryptedPrivateKey: this.storage.encryptString(identity.privateKey).toString('base64'),
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}
