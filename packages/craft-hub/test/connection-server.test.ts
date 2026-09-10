import { mkdtemp, rm } from 'node:fs/promises'
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
