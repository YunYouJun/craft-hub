import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { requestSigningMessage, signDeviceRequest, verifyDeviceRequest } from '../src/device-signing'

describe('device request signing', () => {
  it('signs a canonical request and rejects modified content', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    })
    const identity = { deviceId: 'device-1', nonce: 'nonce-1', timestamp: 1234 }
    const headers = signDeviceRequest(identity, 'post', '/v1/sync', '{}', privateKey)
    const message = requestSigningMessage('POST', '/v1/sync', identity.timestamp, identity.nonce, '{}')

    expect(headers['X-Craft-Device']).toBe(identity.deviceId)
    expect(verifyDeviceRequest(headers['X-Craft-Signature'], message, publicKey)).toBe(true)
    expect(verifyDeviceRequest(headers['X-Craft-Signature'], `${message}changed`, publicKey)).toBe(false)
    expect(() => requestSigningMessage('POST', 'relative', 1, 'nonce', '')).toThrow('absolute')
  })
})
