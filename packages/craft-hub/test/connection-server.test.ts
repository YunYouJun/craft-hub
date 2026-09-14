import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('serves a state-bound callback without exposing tokens and rejects cross-site setup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connection-server-'))
  const complete = vi.fn(async () => ({ connected: true, message: 'private-token-value' }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{
    id: 'setup',
    integrations: [{ id: 'setup', provider: { id: 'setup', requires: '^1.0.0' }, actions: [{ id: 'connect', title: 'Connect', operation: 'connection.update', effect: 'local-write', confirmation: 'always' }], views: [] }],
    integrationProviders: [{ id: 'setup', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: false }), connection: {
      update: async context => ({ connected: false, authorizationUrl: `https://example.com/oauth?state=one-time&redirect_uri=${encodeURIComponent(context.callbackUrl!)}` }),
      complete,
    } }],
  }] })
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    const endpoint = `${server.url}/api/integrations/setup/actions/connect`
    const body = JSON.stringify({ confirmed: true, input: { callbackUrl: 'https://evil.example' } })
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).status).toBe(403)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403)
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(409)
    const started = await (await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json() as { authorizationUrl: string }
    const callback = new URL(started.authorizationUrl).searchParams.get('redirect_uri')!
    expect(callback).toBe(`${server.url}/api/integrations/setup/callback`)
    expect((await fetch(`${callback}?state=invalid&code=code`)).status).toBe(400)
    expect(complete).not.toHaveBeenCalled()
    const response = await fetch(`${callback}?state=one-time&code=code`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('private-token-value')
    expect(complete).toHaveBeenCalledOnce()
    expect((await fetch(`${callback}?state=one-time&code=code`)).status).toBe(400)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('derives the callback origin from declared configuration or a Host that addresses this socket', async () => {
  const root = await mkdtemp(join(tmpdir(), 'connection-origin-'))
  const createRuntime = (): CraftHubRuntime => new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{
    id: 'origin',
    integrations: [{ id: 'origin', provider: { id: 'origin', requires: '^1.0.0' }, actions: [{ id: 'connect', title: 'Connect', operation: 'connection.update', effect: 'local-write', confirmation: 'always' }], views: [] }],
    integrationProviders: [{ id: 'origin', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: false }), connection: {
      update: async context => ({ connected: false, authorizationUrl: `https://example.com/oauth?state=one-time&redirect_uri=${encodeURIComponent(context.callbackUrl!)}` }),
      complete: async () => ({ connected: true }),
    } }],
  }] })
  // A raw client is required because fetch normalizes away a caller-supplied Host header.
  const redirectUriFor = async (origin: string, host?: string): Promise<string> => {
    const target = new URL('/api/integrations/origin/actions/connect', origin)
    const body = JSON.stringify({ confirmed: true })
    const started = await new Promise<string>((resolve, reject) => {
      const call = request({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(host ? { host } : {}) },
      }, (response) => {
        let payload = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          payload += chunk
        })
        response.on('end', () => resolve(payload))
      })
      call.on('error', reject)
      call.end(body)
    })
    const authorizationUrl = (JSON.parse(started) as { authorizationUrl: string }).authorizationUrl
    return new URL(authorizationUrl).searchParams.get('redirect_uri')!
  }

  const server = await startCraftHubServer({ runtime: createRuntime(), port: 0 })
  const port = new URL(server.url).port
  try {
    expect(await redirectUriFor(server.url)).toBe(`${server.url}/api/integrations/origin/callback`)
    // A Host naming another device must not become the OAuth redirect target.
    expect(await redirectUriFor(server.url, 'evil.example')).toBe(`${server.url}/api/integrations/origin/callback`)
    // Loopback aliases normalize to the historical address so an OAuth app registered for it keeps working.
    expect(await redirectUriFor(server.url, `localhost:${port}`)).toBe(`${server.url}/api/integrations/origin/callback`)
  }
  finally {
    await server.close()
  }

  const proxied = await startCraftHubServer({ runtime: createRuntime(), port: 0, publicOrigin: 'https://workbench.example.com' })
  try {
    expect(await redirectUriFor(proxied.url)).toBe('https://workbench.example.com/api/integrations/origin/callback')
  }
  finally {
    await proxied.close()
    await rm(root, { recursive: true, force: true })
  }
})
