import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { expect, it } from 'vitest'
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
