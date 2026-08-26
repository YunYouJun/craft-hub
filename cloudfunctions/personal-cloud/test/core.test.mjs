import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createPersonalCloudServer, signingMessage } = require('../core.cjs')
const { MemoryPersonalCloudRepository } = require('../memory-repository.cjs')

const origin = 'https://cloud.craft-hub.test'
let server

afterEach(async () => {
  if (server)
    await new Promise(resolve => server.close(resolve))
  server = undefined
})

async function setup(userId = 'user-1') {
  const repository = new MemoryPersonalCloudRepository()
  const sessions = new Map()
  const sessionService = {
    async create(input) {
      const token = 'session-token-000000000000000000000000000000'
      const session = { userId: input.userId, appId: input.appId }
      sessions.set(token, session)
      return { token, session }
    },
    async validate(token) {
      const session = sessions.get(token)
      return session ? { ok: true, session } : { ok: false, reason: 'invalid' }
    },
    async revoke(token) {
      sessions.delete(token)
    },
  }
  server = createPersonalCloudServer({
    appId: 'craft-hub',
    allowedSubjects: new Set(['user-1']),
    deriveCsrf: token => `csrf:${token}`,
    verifyCsrf: (csrf, token) => csrf === `csrf:${token}`,
    verifyIdentity: async () => ({ userId }),
    repository,
    sessionService,
    origin,
    now: () => Date.now(),
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { repository, base: `http://127.0.0.1:${address.port}` }
}

async function json(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, init)
  return { response, body: await response.json() }
}

describe('personal cloud HTTP contract', () => {
  it('registers a signed device and delivers one command envelope once', async () => {
    const { base } = await setup()
    const login = await json(base, '/v1/session/login', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ proof: true }),
    })
    expect(login.response.status).toBe(200)
    const cookie = login.response.headers.get('set-cookie').split(';')[0]
    const csrf = login.body.csrf
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const challenge = 'challenge-00000000000000000000000000000000'
    const bootstrap = await json(base, '/v1/device-bootstrap', {
      method: 'POST',
      headers: { origin, cookie, 'x-craft-csrf': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey, challenge }),
    })
    expect(bootstrap.response.status, JSON.stringify(bootstrap.body)).toBe(201)

    const timestamp = Date.now()
    const nonce = 'adopt-nonce-0000000000000000000000000000'
    const unsigned = JSON.stringify({ code: bootstrap.body.code, challenge, timestamp, nonce })
    const signature = sign(null, Buffer.from(signingMessage('POST', '/v1/devices/adopt', timestamp, nonce, unsigned)), privateKey).toString('base64url')
    const adopted = await json(base, '/v1/devices/adopt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: bootstrap.body.code, challenge, timestamp, nonce, signature, name: 'Mac', platform: 'darwin' }),
    })
    expect(adopted.response.status).toBe(201)
    const deviceId = adopted.body.device.deviceId

    const created = await json(base, '/v1/requests', {
      method: 'POST',
      headers: { origin, cookie, 'x-craft-csrf': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ targetDeviceId: deviceId, projectKey: 'project', capabilityId: 'package.json:build' }),
    })
    expect(created.response.status).toBe(201)

    const signed = signedRequest(privateKey, deviceId, '/v1/device-requests/claim', '{}')
    const claimed = await json(base, '/v1/device-requests/claim', signed)
    expect(claimed.response.status).toBe(200)
    expect(claimed.body).toHaveLength(1)
    expect(claimed.body[0]).toMatchObject({ status: 'claimed', projectKey: 'project', capabilityId: 'package.json:build' })
    expect(claimed.body[0]).not.toHaveProperty('command')
    expect(claimed.body[0]).not.toHaveProperty('prompt')

    const replay = await json(base, '/v1/device-requests/claim', signed)
    expect(replay.response.status).toBe(409)
    expect(replay.body.error).toBe('NONCE_REPLAYED')
  })

  it('rejects unapproved origins and never exposes runtime request metadata', async () => {
    const { base } = await setup()
    const rejected = await json(base, '/v1/session/login', {
      method: 'POST',
      headers: { 'origin': 'https://evil.test', 'content-type': 'application/json', 'x-cloudbase-context': 'secret' },
      body: '{}',
    })
    expect(rejected.response.status).toBe(403)
    expect(JSON.stringify(rejected.body)).not.toContain('secret')
    expect(JSON.stringify(rejected.body)).not.toContain('x-cloudbase-context')
  })

  it('rejects non-allowlisted identities and missing CSRF proof', async () => {
    const denied = await setup('user-2')
    const login = await json(denied.base, '/v1/session/login', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(login.response.status).toBe(403)
    await new Promise(resolve => server.close(resolve))
    server = undefined

    const allowed = await setup()
    const session = await json(allowed.base, '/v1/session/login', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    })
    const cookie = session.response.headers.get('set-cookie').split(';')[0]
    const bootstrap = await json(allowed.base, '/v1/device-bootstrap', {
      method: 'POST',
      headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: 'invalid', challenge: 'challenge-00000000000000000000000000000000' }),
    })
    expect(bootstrap.response.status).toBe(403)
    expect(bootstrap.body.error).toBe('CSRF_REJECTED')
  })

  it('rejects signed requests from a revoked device', async () => {
    const { base, repository } = await setup()
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    const device = await repository.createDevice({ userId: 'user-1', publicKey, name: 'Mac', platform: 'darwin', now: Date.now() })
    await repository.revokeDevice(device.deviceId, Date.now())

    const claimed = await json(base, '/v1/device-requests/claim', signedRequest(privateKey, device.deviceId, '/v1/device-requests/claim', '{}'))
    expect(claimed.response.status).toBe(401)
    expect(claimed.body.error).toBe('DEVICE_REVOKED')
  })
})

describe('personal cloud repository semantics', () => {
  it('returns cloud documents absent from a new device and pulls across multiple remote revisions', async () => {
    const repository = new MemoryPersonalCloudRepository()
    const base = { key: 'workspaces/team', schemaVersion: 1, revision: 'base-revision-0001', payload: { name: 'Team' } }
    await repository.synchronize('user-1', 'device-a', [base], 1)
    await repository.synchronize('user-1', 'device-a', [{ ...base, revision: 'remote-revision-01', parentRevision: base.revision, payload: { name: 'Team A' } }], 2)
    await repository.synchronize('user-1', 'device-a', [{ ...base, revision: 'remote-revision-02', parentRevision: 'remote-revision-01', payload: { name: 'Team B' } }], 3)

    const restored = await repository.synchronize('user-1', 'device-b', [], 4)
    expect(restored.documents).toEqual([expect.objectContaining({ key: 'workspaces/team', revision: 'remote-revision-02' })])

    const pulled = await repository.synchronize('user-1', 'device-b', [{ ...base, parentRevision: base.revision }], 5)
    expect(pulled.conflicts).toEqual([])
    expect(pulled.documents).toEqual([expect.objectContaining({ revision: 'remote-revision-02' })])
  })

  it('reclaims an expired pre-run lease but never reclaims a running request', async () => {
    const repository = new MemoryPersonalCloudRepository()
    const request = await repository.createRequest({
      userId: 'user-1',
      targetDeviceId: 'device-1',
      projectKey: 'project',
      capabilityId: 'build',
      now: 1_000,
      expiresAt: 1_000_000,
    })
    const firstClaim = (await repository.claimRequests('user-1', 'device-1', 1_000))[0]
    await expect(repository.claimRequests('user-1', 'device-1', 30_999)).resolves.toEqual([])
    const secondClaim = (await repository.claimRequests('user-1', 'device-1', 31_000))[0]
    await expect(repository.updateRequest('user-1', 'device-1', { requestId: request.requestId, claimId: firstClaim.claimId, status: 'running' }, 31_000)).rejects.toThrow('Stale')
    await repository.updateRequest('user-1', 'device-1', { requestId: request.requestId, claimId: secondClaim.claimId, status: 'awaiting_approval' }, 31_000)
    await expect(repository.claimRequests('user-1', 'device-1', 330_999)).resolves.toEqual([])
    const thirdClaim = (await repository.claimRequests('user-1', 'device-1', 331_000))[0]
    await repository.updateRequest('user-1', 'device-1', { requestId: request.requestId, claimId: thirdClaim.claimId, status: 'running' }, 331_000)
    await expect(repository.claimRequests('user-1', 'device-1', 500_000)).resolves.toEqual([])
  })
})

function signedRequest(privateKey, deviceId, pathname, body) {
  const timestamp = Date.now()
  const nonce = createHash('sha256').update(`${timestamp}:${Math.random()}`).digest('base64url')
  const signature = sign(null, Buffer.from(signingMessage('POST', pathname, timestamp, nonce, body)), privateKey).toString('base64url')
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-craft-device': deviceId,
      'x-craft-timestamp': String(timestamp),
      'x-craft-nonce': nonce,
      'x-craft-signature': signature,
    },
    body,
  }
}
