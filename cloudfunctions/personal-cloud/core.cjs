const { Buffer } = require('node:buffer')
const { createHash, randomBytes, verify } = require('node:crypto')
const http = require('node:http')

const COOKIE_NAME = '__Host-craft_hub_session'
const DEVICE_CLOCK_WINDOW_MS = 60_000
const MAX_BODY_BYTES = 64 * 1024

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function createPersonalCloudServer(options) {
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin
    const cors = origin === options.origin
      ? {
          'Access-Control-Allow-Origin': options.origin,
          'Access-Control-Allow-Credentials': 'true',
          'Vary': 'Origin',
        }
      : {}
    try {
      if (request.method === 'OPTIONS') {
        if (!cors['Access-Control-Allow-Origin'])
          throw new HttpError(403, 'ORIGIN_REJECTED', 'Origin is not allowed')
        response.writeHead(204, {
          ...cors,
          'Access-Control-Allow-Headers': 'Content-Type, X-Craft-CSRF, X-Craft-Device, X-Craft-Timestamp, X-Craft-Nonce, X-Craft-Signature',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        })
        return response.end()
      }

      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const rawBody = await readBody(request)
      const body = parseJson(rawBody)
      const result = await route({ ...options, request, url, body, rawBody, cors })
      sendJson(response, result.status || 200, result.body, { ...cors, ...(result.headers || {}) })
    }
    catch (error) {
      const known = error instanceof HttpError
      sendJson(response, known ? error.status : 500, {
        error: known ? error.code : 'INTERNAL_ERROR',
        message: known ? error.message : 'Personal cloud request failed',
      }, cors)
    }
  })
  return server
}

async function route(context) {
  const { request, url } = context
  if (request.method === 'GET' && url.pathname === '/health')
    return { body: { ok: true } }

  if (url.pathname.startsWith('/v1/session')
    || url.pathname === '/v1/devices'
    || url.pathname === '/v1/device-bootstrap'
    || url.pathname === '/v1/requests'
    || /^\/v1\/requests\/[^/]+\/cancel$/.test(url.pathname)) {
    requireWebOrigin(context)
  }

  if (request.method === 'POST' && url.pathname === '/v1/session/login')
    return login(context)
  if (request.method === 'POST' && url.pathname === '/v1/devices/adopt')
    return adoptDevice(context)

  if (request.method === 'POST' && (url.pathname === '/v1/device-requests/claim' || /^\/v1\/device-requests\/[^/]+\/status$/.test(url.pathname)))
    return signedDeviceRoute(context)
  if (request.method === 'POST' && (url.pathname === '/v1/devices/heartbeat' || url.pathname === '/v1/devices/revoke'))
    return signedDeviceRoute(context)
  if (request.method === 'POST' && url.pathname === '/v1/sync')
    return signedDeviceRoute(context)

  const session = await requireSession(context)
  if (request.method === 'GET' && url.pathname === '/v1/session')
    return { body: { user: publicUser(session), csrf: context.deriveCsrf(session.token) } }
  if (request.method === 'POST' && url.pathname === '/v1/session/logout') {
    requireCsrf(context, session)
    await context.sessionService.revoke(session.token)
    return { body: { ok: true }, headers: { 'Set-Cookie': clearCookie() } }
  }
  if (request.method === 'GET' && url.pathname === '/v1/devices')
    return { body: { devices: await context.repository.listDevices(session.userId) } }
  if (request.method === 'POST' && url.pathname === '/v1/device-bootstrap') {
    requireCsrf(context, session)
    return createBootstrap(context, session)
  }
  if (request.method === 'GET' && url.pathname === '/v1/requests')
    return { body: { requests: await context.repository.listRequests(session.userId) } }
  if (request.method === 'POST' && url.pathname === '/v1/requests') {
    requireCsrf(context, session)
    return createRemoteRequest(context, session)
  }
  if (request.method === 'POST' && /^\/v1\/requests\/[^/]+\/cancel$/.test(url.pathname)) {
    requireCsrf(context, session)
    const requestId = decodeURIComponent(url.pathname.split('/')[3])
    return { body: { request: await context.repository.cancelRequest(session.userId, requestId, context.now()) } }
  }

  throw new HttpError(404, 'NOT_FOUND', 'Route not found')
}

async function login(context) {
  assertRecord(context.body)
  const identity = await context.verifyIdentity(context.body)
  if (!context.allowedSubjects.has(identity.userId))
    throw new HttpError(403, 'FORBIDDEN', 'Account is not enabled for personal cloud')
  const issued = await context.sessionService.create({ appId: context.appId, userId: identity.userId })
  return {
    body: { user: publicUser({ ...issued.session, token: issued.token }), csrf: context.deriveCsrf(issued.token) },
    headers: { 'Set-Cookie': sessionCookie(issued.token) },
  }
}

async function createBootstrap(context, session) {
  assertRecord(context.body)
  const publicKey = readPublicKey(context.body.publicKey)
  const challenge = boundedToken(context.body.challenge, 'challenge', 32, 128)
  const code = randomBytes(32).toString('base64url')
  await context.repository.createBootstrap({
    codeHash: sha256(code),
    userId: session.userId,
    publicKey,
    challenge,
    expiresAt: context.now() + 60_000,
  })
  return { status: 201, body: { code, challenge, expiresIn: 60 } }
}

async function adoptDevice(context) {
  assertRecord(context.body)
  const code = boundedToken(context.body.code, 'code', 43, 43)
  const challenge = boundedToken(context.body.challenge, 'challenge', 32, 128)
  const timestamp = safeInteger(context.body.timestamp, 'timestamp')
  const nonce = boundedToken(context.body.nonce, 'nonce', 16, 128)
  const signature = boundedToken(context.body.signature, 'signature', 64, 256)
  const bootstrap = await context.repository.findBootstrap(sha256(code))
  if (!bootstrap || bootstrap.usedAt || bootstrap.expiresAt <= context.now() || bootstrap.challenge !== challenge)
    throw new HttpError(401, 'INVALID_BOOTSTRAP', 'Device bootstrap is invalid')
  requireFreshTimestamp(timestamp, context.now())
  const unsignedBody = JSON.stringify({ code, challenge, timestamp, nonce })
  const message = signingMessage('POST', '/v1/devices/adopt', timestamp, nonce, unsignedBody)
  if (!verify(null, Buffer.from(message), bootstrap.publicKey, Buffer.from(signature, 'base64url')))
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Device signature is invalid')
  if (!await context.repository.consumeBootstrap(bootstrap.codeHash, context.now()))
    throw new HttpError(409, 'BOOTSTRAP_USED', 'Device bootstrap was already used')
  const device = await context.repository.createDevice({
    userId: bootstrap.userId,
    publicKey: bootstrap.publicKey,
    name: optionalBoundedString(context.body.name, 80) || 'Craft Hub',
    platform: optionalBoundedString(context.body.platform, 32) || 'unknown',
    now: context.now(),
  })
  return { status: 201, body: { device } }
}

async function signedDeviceRoute(context) {
  const deviceId = header(context.request, 'x-craft-device')
  const timestamp = Number(header(context.request, 'x-craft-timestamp'))
  const nonce = header(context.request, 'x-craft-nonce')
  const signature = header(context.request, 'x-craft-signature')
  if (!deviceId || !nonce || !signature || !Number.isSafeInteger(timestamp))
    throw new HttpError(401, 'DEVICE_AUTH_REQUIRED', 'Signed device request is required')
  requireFreshTimestamp(timestamp, context.now())
  const device = await context.repository.getDevice(deviceId)
  if (!device || device.revokedAt)
    throw new HttpError(401, 'DEVICE_REVOKED', 'Device is unknown or revoked')
  const message = signingMessage(context.request.method, context.url.pathname, timestamp, nonce, context.rawBody)
  if (!verify(null, Buffer.from(message), device.publicKey, Buffer.from(signature, 'base64url')))
    throw new HttpError(401, 'INVALID_SIGNATURE', 'Device signature is invalid')
  if (!await context.repository.consumeNonce(deviceId, sha256(nonce), context.now() + DEVICE_CLOCK_WINDOW_MS))
    throw new HttpError(409, 'NONCE_REPLAYED', 'Device nonce was already used')

  if (context.url.pathname === '/v1/devices/heartbeat') {
    await context.repository.touchDevice(deviceId, context.now())
    return { body: { ok: true } }
  }
  if (context.url.pathname === '/v1/devices/revoke') {
    await context.repository.revokeDevice(deviceId, context.now())
    return { body: { ok: true } }
  }
  if (context.url.pathname === '/v1/sync') {
    const documents = readDocuments(context.body)
    return { body: await context.repository.synchronize(device.userId, deviceId, documents, context.now()) }
  }
  if (context.url.pathname === '/v1/device-requests/claim')
    return { body: await context.repository.claimRequests(device.userId, deviceId, context.now()) }
  const statusMatch = context.url.pathname.match(/^\/v1\/device-requests\/([^/]+)\/status$/)
  if (statusMatch) {
    assertRecord(context.body)
    const requestId = decodeURIComponent(statusMatch[1])
    if (context.body.requestId !== requestId)
      throw new HttpError(400, 'INVALID_REQUEST', 'Request id does not match route')
    return { body: await context.repository.updateRequest(device.userId, deviceId, context.body, context.now()) }
  }
  throw new HttpError(404, 'NOT_FOUND', 'Device route not found')
}

async function createRemoteRequest(context, session) {
  assertRecord(context.body)
  const targetDeviceId = boundedToken(context.body.targetDeviceId, 'targetDeviceId', 8, 128)
  const device = await context.repository.getDevice(targetDeviceId)
  if (!device || device.userId !== session.userId || device.revokedAt)
    throw new HttpError(404, 'DEVICE_NOT_FOUND', 'Target device is unavailable')
  const request = await context.repository.createRequest({
    userId: session.userId,
    targetDeviceId,
    projectKey: boundedToken(context.body.projectKey, 'projectKey', 1, 128),
    capabilityId: boundedString(context.body.capabilityId, 'capabilityId', 256),
    expiresAt: context.now() + Math.min(safeInteger(context.body.ttlMs || 300_000, 'ttlMs'), 900_000),
    now: context.now(),
  })
  return { status: 201, body: { request } }
}

async function requireSession(context) {
  const token = cookie(context.request.headers.cookie || '')[COOKIE_NAME]
  if (!token)
    throw new HttpError(401, 'AUTH_REQUIRED', 'Application session is required')
  const validation = await context.sessionService.validate(token)
  if (!validation.ok)
    throw new HttpError(401, 'AUTH_REQUIRED', 'Application session is invalid')
  return { ...validation.session, token, userId: validation.session.userId }
}

function requireCsrf(context, session) {
  if (!context.verifyCsrf(header(context.request, 'x-craft-csrf'), session.token))
    throw new HttpError(403, 'CSRF_REJECTED', 'CSRF token is invalid')
}

function requireWebOrigin(context) {
  if (context.request.headers.origin !== context.origin)
    throw new HttpError(403, 'ORIGIN_REJECTED', 'Origin is not allowed')
}

function readDocuments(body) {
  assertRecord(body)
  if (!Array.isArray(body.documents) || body.documents.length > 100)
    throw new HttpError(400, 'INVALID_DOCUMENTS', 'Documents must be a bounded array')
  return body.documents.map((document) => {
    assertRecord(document)
    return {
      key: boundedToken(document.key, 'key', 1, 256),
      schemaVersion: document.schemaVersion === 1 ? 1 : invalid('schemaVersion'),
      revision: boundedToken(document.revision, 'revision', 16, 128),
      ...(document.parentRevision ? { parentRevision: boundedToken(document.parentRevision, 'parentRevision', 16, 128) } : {}),
      payload: document.payload,
    }
  })
}

function signingMessage(method, pathname, timestamp, nonce, body) {
  return ['CRAFT-HUB-V1', method.toUpperCase(), pathname, String(timestamp), nonce, sha256(body)].join('\n')
}

function requireFreshTimestamp(timestamp, now) {
  if (Math.abs(now - timestamp) > DEVICE_CLOCK_WINDOW_MS)
    throw new HttpError(401, 'STALE_SIGNATURE', 'Device signature timestamp is stale')
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_BODY_BYTES)
        reject(new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large'))
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function parseJson(raw) {
  if (!raw)
    return {}
  try {
    return JSON.parse(raw)
  }
  catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be JSON')
  }
}

function cookie(raw) {
  return Object.fromEntries(raw.split(';').map(part => part.trim().split('=')).filter(parts => parts.length === 2))
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function publicUser(session) {
  return { userId: session.userId }
}

function header(request, name) {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be an object')
}

function boundedString(value, name, max) {
  if (typeof value !== 'string' || !value || value.length > max || [...value].some(character => character.charCodeAt(0) <= 0x1F))
    throw new HttpError(400, 'INVALID_REQUEST', `${name} is invalid`)
  return value
}

function readPublicKey(value) {
  if (typeof value !== 'string'
    || value.length > 2048
    || !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/.test(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'publicKey is invalid')
  }
  return value
}

function optionalBoundedString(value, max) {
  return value === undefined ? '' : boundedString(value, 'value', max)
}

function boundedToken(value, name, min, max) {
  const token = boundedString(value, name, max)
  if (token.length < min || !/^[\w.:-]+$/.test(token))
    throw new HttpError(400, 'INVALID_REQUEST', `${name} is invalid`)
  return token
}

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new HttpError(400, 'INVALID_REQUEST', `${name} is invalid`)
  return value
}

function invalid(name) {
  throw new HttpError(400, 'INVALID_REQUEST', `${name} is invalid`)
}

module.exports = { COOKIE_NAME, HttpError, createPersonalCloudServer, signingMessage }
