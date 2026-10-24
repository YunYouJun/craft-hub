import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectLaunchService } from '../src/project-launch'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { createSessionGuard, createSidecarRequestHandler, externalUrl } from '../src/sidecar-host'

const origin = 'http://127.0.0.1:49218'
const secret = 'a'.repeat(64)

function request(path: string, headers: Record<string, string> = {}, method = 'GET', body?: string): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [body])
  return Object.assign(stream, { url: path, method, headers: { host: '127.0.0.1:49218', ...headers } }) as unknown as IncomingMessage
}

function response(): { result: () => { status?: number, headers?: Record<string, string>, body?: any }, value: ServerResponse } {
  const state: { status?: number, headers?: Record<string, string>, body?: any } = {}
  const value = {
    writeHead(status: number, headers: Record<string, string>) {
      state.status = status
      state.headers = headers
    },
    end(text?: string) {
      state.body = text ? JSON.parse(text) : undefined
    },
  } as unknown as ServerResponse
  return { result: () => state, value }
}

it('rejects direct, wrong-host and cross-origin access before any route', () => {
  const guard = createSessionGuard(secret)
  guard.setOrigin(origin)
  expect(guard.authorize(request('/api/projects'))).toBe(false)
  expect(guard.authorize(request(`/__craft_hub_host/bootstrap?token=${secret}`))).toBe(true)
  expect(guard.authorize(request('/__craft_hub_host/bootstrap?token=bad'))).toBe(false)
  const cookie = `craft-hub-host-session=${secret}`
  expect(guard.authorize(request('/api/projects', { cookie, host: 'evil.example' }))).toBe(false)
  expect(guard.authorize(request('/api/projects', { cookie, origin: 'https://evil.example' }))).toBe(false)
  expect(guard.authorize(request('/api/projects', { cookie, origin }))).toBe(true)
})

it('turns the one-use bootstrap URL into an HttpOnly SameSite session cookie', () => {
  const guard = createSessionGuard(secret)
  guard.setOrigin(origin)
  const sent = response()
  guard.bootstrap(sent.value)
  expect(sent.result().status).toBe(303)
  expect(sent.result().headers?.location).toBe('/overview')
  expect(sent.result().headers?.['set-cookie']).toMatch(/HttpOnly; SameSite=Strict; Path=\//)
  expect(guard.authorize(request(`/__craft_hub_host/bootstrap?token=${secret}`))).toBe(false)
})

it('refuses to serve anything but IPv4 loopback', () => {
  expect(() => createSessionGuard(secret).setOrigin('http://localhost:49218')).toThrow('loopback')
})

it('authenticates native API requests without granting browser or host access', () => {
  const nativeToken = 'b'.repeat(64)
  const guard = createSessionGuard(secret, nativeToken)
  guard.setOrigin(origin)
  const headers = { authorization: `Bearer ${nativeToken}` }
  expect(guard.authorize(request('/api/environment', headers))).toBe(true)
  expect(guard.authorize(request('/api/software/source/open', headers, 'POST'))).toBe(true)
  expect(guard.authorize(request('/api/environment', { ...headers, host: 'evil.example' }))).toBe(false)
  expect(guard.authorize(request('/api/environment', { ...headers, origin: 'https://evil.example' }))).toBe(false)
  for (const path of ['/', '/overview', '/__craft_hub_host/open-workbench-tool', '/__craft_hub_host/host-extensions', '/__craft_hub_host/set-host-extension-enabled', `/__craft_hub_host/bootstrap?token=${secret}`])
    expect(guard.authorize(request(path, headers))).toBe(false)
  for (const authorization of ['Bearer bad', `Bearer ${secret}`, nativeToken])
    expect(guard.authorize(request('/api/environment', { authorization }))).toBe(false)
  expect(guard.authorize(request('/api/environment', { cookie: `craft-hub-host-session=${nativeToken}` }))).toBe(false)
  const restarted = createSessionGuard(secret, 'c'.repeat(64))
  restarted.setOrigin(origin)
  expect(restarted.authorize(request('/api/environment', headers))).toBe(false)
})

it('accepts only credential-free HTTPS destinations for the browser', () => {
  expect(externalUrl('https://example.com/tools')).toBe('https://example.com/tools')
  for (const value of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/\n'])
    expect(() => externalUrl(value)).toThrow()
})

it('demands explicit JSON and the same-origin header for host actions', async () => {
  const handler = createSidecarRequestHandler(createSessionGuard(secret), () => {
    throw new Error('must not dispatch')
  })
  const sent = response()
  expect(await handler(request('/__craft_hub_host/open-workbench-tool', {}, 'POST'), sent.value)).toBe(true)
  expect(sent.result().status).toBe(403)
  expect(sent.result().body.error).toMatch(/same-origin JSON/)
})

it('opens the saved tool entry, never a destination from the page', async () => {
  const tool = { id: 'saved', url: 'https://example.com', title: 'Saved', group: 'Tools' }
  let opened: unknown
  const runtime = { settings: { get: async () => ({ settings: { 'workbench.home': { tools: [tool] } } }) } } as never
  const handler = createSidecarRequestHandler(createSessionGuard(secret), () => runtime, async (value) => {
    opened = value
    return { destination: 'website', contextTransferred: false } as never
  })
  const sent = response()
  const headers = { 'content-type': 'application/json', 'x-craft-hub-host': '1' }
  await handler(request('/__craft_hub_host/open-workbench-tool', headers, 'POST', JSON.stringify({ toolId: 'saved', url: 'https://evil.example' })), sent.value)
  expect(opened).toEqual(tool)
  expect(sent.result().body.value).toEqual({ destination: 'website', contextTransferred: false })

  const unknown = response()
  await handler(request('/__craft_hub_host/open-workbench-tool', headers, 'POST', JSON.stringify({ toolId: 'missing' })), unknown.value)
  expect(unknown.result().status).toBe(400)
})

it('leaves ordinary runtime routes to the shared server', async () => {
  const handler = createSidecarRequestHandler(createSessionGuard(secret), () => {
    throw new Error('must not dispatch')
  })
  expect(await handler(request('/api/projects'), response().value)).toBe(false)
})

it('requires a guarded JSON request and typed inputs to change a bundled extension', async () => {
  const status = { extensions: [], diagnostics: [], restartRequired: false }
  const controls = { status: vi.fn(async () => status), setEnabled: vi.fn(async () => status) }
  const handler = createSidecarRequestHandler(createSessionGuard(secret), () => {
    throw new Error('must not dispatch')
  }, undefined, undefined, controls)
  const headers = { 'content-type': 'application/json', 'x-craft-hub-host': '1' }
  const endpoint = '/__craft_hub_host/set-host-extension-enabled'
  const invalid = response()
  await handler(request(endpoint, headers, 'POST', JSON.stringify({ id: 'microsoft-todo', enabled: 'true' })), invalid.value)
  expect(invalid.result().status).toBe(400)
  expect(controls.setEnabled).not.toHaveBeenCalled()
  const denied = response()
  await handler(request(endpoint, {}, 'POST', JSON.stringify({ id: 'microsoft-todo', enabled: true })), denied.value)
  expect(denied.result().status).toBe(403)
  expect(controls.setEnabled).not.toHaveBeenCalled()
  const allowed = response()
  await handler(request(endpoint, headers, 'POST', JSON.stringify({ id: 'microsoft-todo', enabled: true })), allowed.value)
  expect(allowed.result().status).toBe(200)
  expect(controls.setEnabled).toHaveBeenCalledWith('microsoft-todo', true)
})

it('dispatches only typed project launch actions behind the host session boundary', async () => {
  const launch = { openProjectDirectory: vi.fn(async () => {}) } as unknown as ProjectLaunchService
  const guard = createSessionGuard(secret, 'native-token')
  guard.setOrigin(origin)
  const handler = createSidecarRequestHandler(guard, () => {
    throw new Error('unused')
  }, undefined, undefined, undefined, launch)
  const path = '/__craft_hub_host/open-project-directory'
  const headers = { 'content-type': 'application/json', 'x-craft-hub-host': '1' }
  expect(guard.authorize(request(path, { ...headers, authorization: 'Bearer native-token' }, 'POST'))).toBe(false)
  expect(guard.authorize(request(path, { ...headers, cookie: `craft-hub-host-session=${secret}` }, 'POST'))).toBe(true)
  for (const body of ['null', '[]', '{bad', '{"projectId":42}']) {
    const sent = response()
    await handler(request(path, headers, 'POST', body), sent.value)
    expect(sent.result().status).toBe(400)
  }
  expect(launch.openProjectDirectory).not.toHaveBeenCalled()
  const allowed = response()
  await handler(request(path, headers, 'POST', '{"projectId":"registered","path":"/ignored"}'), allowed.value)
  expect(allowed.result().status).toBe(200)
  expect(launch.openProjectDirectory).toHaveBeenCalledExactlyOnceWith('registered')
  const unknown = response()
  await handler(request('/__craft_hub_host/constructor', headers, 'POST', '{}'), unknown.value)
  expect(unknown.result().status).toBe(404)
})

it('limits native extension access to its bearer and bundled typed choices', async () => {
  const token = 'b'.repeat(64)
  const guard = createSessionGuard(secret, token)
  guard.setOrigin(origin)
  const status = { extensions: [], diagnostics: [], restartRequired: false }
  const controls = { status: vi.fn(async () => status), setEnabled: vi.fn(async () => status) }
  const handler = createSidecarRequestHandler(guard, () => {
    throw new Error('unrelated runtime access')
  }, undefined, undefined, controls)
  const endpoint = '/api/native-host/extensions'
  const deniedHeaders: Record<string, string>[] = [{}, { cookie: `craft-hub-host-session=${secret}` }, { authorization: `Bearer ${secret}` }, { authorization: `Bearer ${token}`, origin: 'https://other.example' }]
  for (const headers of deniedHeaders) {
    const sent = response()
    await handler(request(endpoint, headers), sent.value)
    expect(sent.result().status).toBe(403)
  }
  expect(controls.status).not.toHaveBeenCalled()
  const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }
  const read = response()
  await handler(request(endpoint, headers), read.value)
  expect(read.result()).toMatchObject({ status: 200, body: status })
  const invalid = response()
  await handler(request(endpoint, headers, 'PUT', JSON.stringify({ id: 'optional', enabled: 'true' })), invalid.value)
  expect(invalid.result().status).toBe(400)
  expect(controls.setEnabled).not.toHaveBeenCalled()
  const write = response()
  await handler(request(endpoint, headers, 'PUT', JSON.stringify({ id: 'optional', enabled: true })), write.value)
  expect(write.result().status).toBe(200)
  expect(controls.setEnabled).toHaveBeenCalledExactlyOnceWith('optional', true)
  const register = response()
  await handler(request(endpoint, headers, 'POST', JSON.stringify({ modules: ['/tmp/code.mjs'] })), register.value)
  expect(register.result().status).toBe(405)
})

it('opens a saved native favorite only with its bearer and identifier, rejecting client launch overrides', async () => {
  const guard = createSessionGuard(secret, 'b'.repeat(64))
  guard.setOrigin(origin)
  const tool = { id: 'saved', title: 'Saved', group: 'Tools', url: 'https://example.com' }
  const open = vi.fn(async () => ({ destination: 'website' as const, contextTransferred: false as const }))
  const runtime = { settings: { get: async () => ({ settings: { 'workbench.home': { tools: [tool] } } }) } } as any
  const handler = createSidecarRequestHandler(guard, () => runtime, open)
  const path = '/api/native-host/open-workbench-tool'
  const headers = { 'authorization': `Bearer ${'b'.repeat(64)}`, origin, 'content-type': 'application/json' }
  for (const [requestHeaders, body, status] of [
    [{ 'cookie': `craft-hub-host-session=${secret}`, origin, 'content-type': 'application/json' }, { toolId: 'saved' }, 403],
    [headers, { toolId: 'saved', url: 'https://unreviewed.example' }, 400],
    [headers, { toolId: 'missing' }, 400],
  ] as const) {
    const sent = response()
    await handler(request(path, requestHeaders, 'POST', JSON.stringify(body)), sent.value)
    expect(sent.result().status).toBe(status)
  }
  expect(open).not.toHaveBeenCalled()
  const query = response()
  await handler(request(`${path}?toolId=other`, headers, 'POST', JSON.stringify({ toolId: 'saved' })), query.value)
  expect(query.result().status).toBe(400)
  expect(open).not.toHaveBeenCalled()
  const sent = response()
  await handler(request(path, headers, 'POST', JSON.stringify({ toolId: 'saved' })), sent.value)
  expect(sent.result().status).toBe(200)
  expect(open).toHaveBeenCalledWith(tool, expect.any(Function))
})
