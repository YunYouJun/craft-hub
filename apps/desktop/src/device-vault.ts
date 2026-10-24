import type { DeviceIdentity, IdentityTransferEnvelope, IdentityTransferReview } from '@craft-hub/personal-cloud'
import { Buffer } from 'node:buffer'
import { createHash, createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import process from 'node:process'
import { IdentityTransferError, personalCloudOrigin, sealIdentityTransfer, validateDeviceIdentity, validateIdentityTransferRequest } from '@craft-hub/personal-cloud'
import { canonicalProfilePath } from 'craft-hub'

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
      const snapshot = await this.readSnapshot()
      if (!snapshot)
        return undefined
      return this.decrypt(snapshot.stored)
    }
    catch { throw new IdentityTransferError() }
  }

  /** Read-only review. Does not decrypt, create an identity or ask for system authentication. */
  async previewTransfer(): Promise<IdentityTransferReview | undefined> {
    try {
      const snapshot = await this.readSnapshot()
      if (!snapshot)
        return undefined
      return {
        sourceData: await canonicalProfilePath(dirname(this.path)),
        sourceRevision: snapshot.revision,
        publicKey: snapshot.stored.publicKey,
        ...(snapshot.stored.deviceId === undefined ? {} : { deviceId: snapshot.stored.deviceId }),
      }
    }
    catch { throw new IdentityTransferError() }
  }

  /** Host-only transfer after explicit review, while the coordinator holds exclusive source/target leases. */
  async sealTransfer(input: unknown, configured: { endpoint: string, webOrigin: string }): Promise<IdentityTransferEnvelope> {
    try {
      const request = validateIdentityTransferRequest(input)
      const source = await canonicalProfilePath(dirname(this.path))
      const target = await canonicalProfilePath(request.targetProfile)
      if (source === sep || target === sep || request.sourceData !== source || request.targetProfile !== target || source === target
        || source.startsWith(target + sep) || target.startsWith(source + sep)
        || personalCloudOrigin(configured.endpoint) !== request.endpoint || personalCloudOrigin(configured.webOrigin) !== request.webOrigin) {
        throw new IdentityTransferError()
      }
      const snapshot = await this.readSnapshot()
      if (!snapshot || snapshot.revision !== request.sourceRevision
        || snapshot.stored.publicKey !== request.publicKey || snapshot.stored.deviceId !== request.deviceId) {
        throw new IdentityTransferError()
      }
      this.assertSecureStorage()
      const identity = this.decrypt(snapshot.stored)
      if ((await this.readSnapshot())?.revision !== request.sourceRevision)
        throw new IdentityTransferError()
      return sealIdentityTransfer(request, identity)
    }
    catch { throw new IdentityTransferError() }
  }

  private decrypt(stored: StoredDeviceIdentity): DeviceIdentity {
    return validateDeviceIdentity({
      ...(stored.deviceId === undefined ? {} : { deviceId: stored.deviceId }),
      publicKey: stored.publicKey,
      privateKey: this.storage.decryptString(Buffer.from(stored.encryptedPrivateKey, 'base64')),
    })
  }

  private async readSnapshot(): Promise<{ stored: StoredDeviceIdentity, revision: string } | undefined> {
    // O_NOFOLLOW is unavailable on Windows. Verify the pathname and opened identity on every host.
    const entry = await lstat(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
    })
    if (!entry)
      return undefined
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new IdentityTransferError()
    const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
    })
    if (!file)
      return undefined
    try {
      const info = await file.stat()
      if (!info.isFile() || info.dev !== entry.dev || info.ino !== entry.ino || info.nlink !== 1 || info.size > 16 * 1024 || (process.getuid && info.uid !== process.getuid()))
        throw new IdentityTransferError()
      // Bound the read even if a non-cooperating writer grows the file after stat.
      const buffer = Buffer.alloc(16 * 1024 + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const current = await lstat(this.path)
      if (bytesRead > 16 * 1024 || !current.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino || current.ctimeMs !== info.ctimeMs)
        throw new IdentityTransferError()
      const bytes = buffer.subarray(0, bytesRead)
      const stored = JSON.parse(bytes.toString('utf8')) as StoredDeviceIdentity
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)
        || Object.keys(stored).some(key => !['schemaVersion', 'deviceId', 'publicKey', 'encryptedPrivateKey'].includes(key))
        || stored.schemaVersion !== 1 || typeof stored.publicKey !== 'string' || stored.publicKey.length > 1024
        || createPublicKey(stored.publicKey).asymmetricKeyType !== 'ed25519'
        || (stored.deviceId !== undefined && (typeof stored.deviceId !== 'string' || !/^[\w.-]{1,128}$/.test(stored.deviceId)))
        || typeof stored.encryptedPrivateKey !== 'string' || !stored.encryptedPrivateKey
        || Buffer.from(stored.encryptedPrivateKey, 'base64').toString('base64') !== stored.encryptedPrivateKey) {
        throw new IdentityTransferError()
      }
      return { stored, revision: createHash('sha256').update(bytes).digest('hex') }
    }
    finally { await file.close() }
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
    validateDeviceIdentity(identity)
    const stored: StoredDeviceIdentity = {
      schemaVersion: 1,
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      encryptedPrivateKey: this.storage.encryptString(identity.privateKey).toString('base64'),
    }
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, this.path)
  }
}
