import type { DeviceIdentity } from './controller'
import { Buffer } from 'node:buffer'
import { createCipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { personalCloudOrigin } from './cloud-http'

/** Public review metadata; neither ciphertext nor decrypted device material belongs in this object. */
export interface IdentityTransferReview {
  sourceData: string
  sourceRevision: string
  deviceId?: string
  publicKey: string
}

/** A short-lived, single-receiver request bound to the exact source review and destination scope. */
export interface IdentityTransferRequest extends IdentityTransferReview {
  version: 1
  targetProfile: string
  endpoint: string
  webOrigin: string
  challenge: string
  recipientKey: string
  expiresAt: number
}

/** Encrypted only for the in-memory native recipient key; not a portable key backup format. */
export interface IdentityTransferEnvelope {
  version: 1
  challenge: string
  senderKey: string
  sealed: string
}

/** Provider/crypto/JSON errors must never expose source contents or private key material. */
export class IdentityTransferError extends Error {
  constructor() { super('Device identity transfer was rejected. Review the source and destination again.') }
}

/** Validate the existing Ed25519 PEM contract before storing, signing or transferring it. */
export function validateDeviceIdentity(value: unknown): DeviceIdentity {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new IdentityTransferError()
    const identity = value as DeviceIdentity
    if (Object.keys(value).some(key => !['deviceId', 'privateKey', 'publicKey'].includes(key))
      || typeof identity.privateKey !== 'string' || identity.privateKey.length > 1024
      || typeof identity.publicKey !== 'string' || identity.publicKey.length > 1024
      || (identity.deviceId !== undefined && (typeof identity.deviceId !== 'string' || !/^[\w.-]{1,128}$/.test(identity.deviceId)))) {
      throw new IdentityTransferError()
    }
    const secret = createPrivateKey(identity.privateKey)
    const publicKey = createPublicKey(identity.publicKey)
    if (secret.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519'
      || !createPublicKey(secret).equals(publicKey)
      || secret.export({ format: 'pem', type: 'pkcs8' }) !== identity.privateKey
      || publicKey.export({ format: 'pem', type: 'spki' }) !== identity.publicKey) {
      throw new IdentityTransferError()
    }
    return { ...(identity.deviceId === undefined ? {} : { deviceId: identity.deviceId }), privateKey: identity.privateKey, publicKey: identity.publicKey }
  }
  catch { throw new IdentityTransferError() }
}

/** Exact bounded request validation. Paths are canonicalized and checked again by both filesystem owners. */
export function validateIdentityTransferRequest(value: unknown, now = Date.now()): IdentityTransferRequest {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new IdentityTransferError()
    const request = value as IdentityTransferRequest
    const required = ['version', 'sourceData', 'sourceRevision', 'publicKey', 'targetProfile', 'endpoint', 'webOrigin', 'challenge', 'recipientKey', 'expiresAt']
    if (Object.keys(value).some(key => ![...required, 'deviceId'].includes(key)) || required.some(key => !(key in value))
      || request.version !== 1 || !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now || request.expiresAt > now + 120_000
      || typeof request.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(request.challenge)
      || typeof request.sourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(request.sourceRevision)
      || [request.sourceData, request.targetProfile].some(path => typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || /[\r\n\0]/.test(path))
      || typeof request.publicKey !== 'string' || request.publicKey.length > 1024
      || (request.deviceId !== undefined && (typeof request.deviceId !== 'string' || !/^[\w.-]{1,128}$/.test(request.deviceId)))
      || typeof request.recipientKey !== 'string' || !/^[A-Z0-9+/]{43}=$/i.test(request.recipientKey)
      || Buffer.from(request.recipientKey, 'base64').toString('base64') !== request.recipientKey
      || typeof request.endpoint !== 'string' || request.endpoint.length > 2048 || personalCloudOrigin(request.endpoint) !== request.endpoint
      || typeof request.webOrigin !== 'string' || request.webOrigin.length > 2048 || personalCloudOrigin(request.webOrigin) !== request.webOrigin) {
      throw new IdentityTransferError()
    }
    if (createPublicKey(request.publicKey).asymmetricKeyType !== 'ed25519')
      throw new IdentityTransferError()
    return { ...request }
  }
  catch { throw new IdentityTransferError() }
}

/** UTF-8 length-prefix encoding shared with Swift; every review field is authenticated. */
export function identityTransferContext(request: IdentityTransferRequest): Buffer {
  return Buffer.from([
    'CRAFT-HUB-IDENTITY-TRANSFER-V1',
    request.sourceData,
    request.sourceRevision,
    request.deviceId ?? '',
    request.publicKey,
    request.targetProfile,
    request.endpoint,
    request.webOrigin,
    request.challenge,
    request.recipientKey,
    String(request.expiresAt),
  ].map(value => `${Buffer.byteLength(value)}:${value}`).join(''))
}

/** Call only after the source host has checked the reviewed ciphertext and its configured cloud origins. */
export function sealIdentityTransfer(input: unknown, value: unknown, now = Date.now()): IdentityTransferEnvelope {
  try {
    const request = validateIdentityTransferRequest(input, now)
    const identity = validateDeviceIdentity(value)
    if (identity.deviceId !== request.deviceId || identity.publicKey !== request.publicKey)
      throw new IdentityTransferError()
    const recipient = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(request.recipientKey, 'base64')]), format: 'der', type: 'spki' })
    const sender = generateKeyPairSync('x25519')
    const secret = diffieHellman({ privateKey: sender.privateKey, publicKey: recipient })
    const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(request.challenge, 'hex'), Buffer.from('CRAFT-HUB-IDENTITY-TRANSFER-V1'), 32))
    const plain = Buffer.from(JSON.stringify(identity))
    try {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(identityTransferContext(request))
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
      return {
        version: 1,
        challenge: request.challenge,
        senderKey: sender.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
        sealed: Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString('base64'),
      }
    }
    finally {
      plain.fill(0)
      secret.fill(0)
      key.fill(0)
    }
  }
  catch { throw new IdentityTransferError() }
}
