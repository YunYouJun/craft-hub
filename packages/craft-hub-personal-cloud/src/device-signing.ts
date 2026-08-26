import { Buffer } from 'node:buffer'
import { createHash, sign, verify } from 'node:crypto'

export interface SignedRequestHeaders {
  'X-Craft-Device': string
  'X-Craft-Timestamp': string
  'X-Craft-Nonce': string
  'X-Craft-Signature': string
}

export interface DeviceRequestIdentity {
  deviceId: string
  nonce: string
  timestamp: number
}

export function requestSigningMessage(method: string, pathname: string, timestamp: number, nonce: string, body: string): string {
  if (!pathname.startsWith('/'))
    throw new Error('Signed request pathname must be absolute')
  return [
    'CRAFT-HUB-V1',
    method.toUpperCase(),
    pathname,
    String(timestamp),
    nonce,
    createHash('sha256').update(body).digest('hex'),
  ].join('\n')
}

export function signDeviceRequest(identity: DeviceRequestIdentity, method: string, pathname: string, body: string, privateKey: string): SignedRequestHeaders {
  const message = requestSigningMessage(method, pathname, identity.timestamp, identity.nonce, body)
  return {
    'X-Craft-Device': identity.deviceId,
    'X-Craft-Timestamp': String(identity.timestamp),
    'X-Craft-Nonce': identity.nonce,
    'X-Craft-Signature': sign(null, Buffer.from(message), privateKey).toString('base64url'),
  }
}

export function verifyDeviceRequest(signature: string, message: string, publicKey: string): boolean {
  return verify(null, Buffer.from(message), publicKey, Buffer.from(signature, 'base64url'))
}
