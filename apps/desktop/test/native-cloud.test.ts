import type { RemoteCommandReview } from '@craft-hub/personal-cloud'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime, startCraftHubServer } from 'craft-hub'
import { expect, it, vi } from 'vitest'
import { NativeCloudApprovals, NativeCloudService } from '../src/native-cloud'
import { createSessionGuard } from '../src/sidecar-host'

function review(): RemoteCommandReview {
  return { projectId: 'fixture', projectPath: '/fixture', capabilityId: 'check', expiresAt: new Date(Date.now() + 30000).toISOString(), invocation: { command: 'node', args: ['--version'], cwd: '/fixture', requiredEnv: [] } }
}

it('keeps reviews immutable, rejects stale or replayed decisions and drains on close', async () => {
  const queue = new NativeCloudApprovals()
  const original = review()
  const signal = new AbortController()
  const decision = queue.request('Fixture', 'Check', original, signal.signal)
  original.invocation.args[0] = 'changed'
  const item = queue.list()[0]!
  expect(item.review.invocation.args).toEqual(['--version'])
  item.review.invocation.args[0] = 'changed again'
  expect(queue.list()[0]!.review.invocation.args).toEqual(['--version'])
  signal.abort()
  expect(queue.decide(item.id, true)).toBe(false)
  expect(await decision).toBe(false)
  const accepted = queue.request('Fixture', 'Check', review(), new AbortController().signal)
  const id = queue.list()[0]!.id
  expect(queue.decide(id, true)).toBe(true)
  expect(queue.decide(id, true)).toBe(false)
  expect(await accepted).toBe(true)
  const pending = queue.request('Fixture', 'Check', review(), new AbortController().signal)
  queue.close()
  expect(await pending).toBe(false)
  expect(await queue.request('Fixture', 'Check', review(), new AbortController().signal)).toBe(false)
})

it('bounds queued approvals and rejects oversized and expired reviews', async () => {
  const queue = new NativeCloudApprovals()
  const signal = new AbortController().signal
  expect(await queue.request('Fixture', 'Check', { ...review(), expiresAt: 'invalid' }, signal)).toBe(false)
  expect(await queue.request('Fixture', 'Check', { ...review(), expiresAt: new Date(0).toISOString() }, signal)).toBe(false)
  expect(await queue.request('x'.repeat(65536), 'Check', review(), signal)).toBe(false)
  const pending = Array.from({ length: 8 }, () => queue.request('Fixture', 'Check', review(), signal))
  expect(await queue.request('Fixture', 'Check', review(), signal)).toBe(false)
  queue.close()
  expect(await Promise.all(pending)).toEqual(Array.from({ length: 8 }).fill(false))
})

it('exposes account controls and approval only to the native bearer, without identity material', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-cloud-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'runtime'), configDir: join(root, 'config') })
  const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const vault = { load: vi.fn(async () => undefined), loadOrCreate: vi.fn(async () => keys), register: vi.fn(), clear: vi.fn(async () => {}) }
  const openExternal = vi.fn(async (_url: string) => {})
  const cloud = new NativeCloudService({ runtime, dataDir: runtime.store.dataDir, platform: 'darwin', vault, openExternal, endpoint: 'https://api.example.com', webOrigin: 'https://cloud.example.com', callbackScheme: 'craft-hub-native' })
  const guard = createSessionGuard('a'.repeat(64), 'b'.repeat(64))
  const server = await startCraftHubServer({ runtime, host: '127.0.0.1', port: 0, authorizeRequest: guard.authorize, handleHostRequest: (request, response) => cloud.handle(request, response, guard) })
  guard.setOrigin(server.url)
  const path = `${server.url}/api/native-host/cloud`
  const headers = { 'origin': server.url, 'authorization': `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json' }
  try {
    await cloud.controller.start()
    const approval = cloud.approvals.request('Fixture', 'Check', review(), new AbortController().signal)
    const id = cloud.approvals.list()[0]!.id
    const credentials: Record<string, string>[] = [{}, { cookie: `craft-hub-host-session=${'a'.repeat(64)}` }, { authorization: `Bearer ${'a'.repeat(64)}` }]
    for (const credential of credentials) {
      const response = await fetch(path, { method: 'POST', headers: { 'origin': server.url, 'content-type': 'application/json', ...credential }, body: JSON.stringify({ action: 'approve', id, accepted: true }) })
      expect(response.status).toBe(403)
      expect(cloud.approvals.list()).toHaveLength(1)
    }
    const snapshot = await (await fetch(path, { headers })).json()
    expect(snapshot.approvals[0].review.invocation.command).toBe('node')
    expect(JSON.stringify(snapshot)).not.toMatch(/privateKey|publicKey|PRIVATE KEY/)
    const accepted = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'approve', id, accepted: false }) })
    expect(accepted.status).toBe(200)
    expect(await approval).toBe(false)
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'approve', id, accepted: true }) })).status).toBe(409)
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'connect', privateKey: 'injected' }) })).status).toBe(400)
    expect(vault.loadOrCreate).not.toHaveBeenCalled()
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'connect' }) })).status).toBe(200)
    const login = new URL(openExternal.mock.calls[0]![0])
    expect(login.origin).toBe('https://cloud.example.com')
    expect(login.searchParams.get('callback')).toBe('craft-hub-native://cloud/connect')
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'callback', url: 'craft-hub-native://cloud/connect?code=private-fixture' }) })).status).toBe(400)
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ action: 'disconnect' }) })).status).toBe(200)
    expect(vault.clear).toHaveBeenCalledOnce()
    expect(await runtime.runs()).toEqual([])
  }
  finally {
    await cloud.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
