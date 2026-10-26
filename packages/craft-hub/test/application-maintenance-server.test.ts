import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('restricts discovery and Finder actions to local same-origin requests with server-owned IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'application-guidance-server-'))
  const runtimes = ['local', 'hosted'].map((kind, index) => new CraftHubRuntime({ hostEnvironment: kind as 'local' | 'hosted', dataDir: join(root, `${index}/data`), configDir: join(root, `${index}/config`) }))
  const scan = vi.spyOn(runtimes[0]!.applicationMaintenance, 'snapshot').mockResolvedValue({ version: 1, supported: true, applications: [], incomplete: false })
  const reveal = vi.spyOn(runtimes[0]!.applicationMaintenance, 'reveal').mockResolvedValue({ version: 1, destination: 'finder' })
  const hosts = await Promise.all(runtimes.map(runtime => startCraftHubServer({ runtime, port: 0 })))
  const path = '/api/application-maintenance'
  try {
    expect((await fetch(hosts[0]!.url + path)).status).toBe(200)
    expect(scan).toHaveBeenCalledOnce()
    const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' }]
    for (const headers of rejectedHeaders)
      expect((await fetch(hosts[0]!.url + path, { headers })).status).toBe(403)
    expect((await fetch(hosts[1]!.url + path)).status).toBe(403)
    expect((await fetch(`${hosts[0]!.url + path}?path=/Applications`)).status).toBe(400)
    const rebinding = await new Promise((resolve) => {
      const req = request(hosts[0]!.url + path, { headers: { host: 'attacker.example.com' } }, (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      req.end()
    })
    expect(rebinding).toBe(403)
    const post = (body: string, contentType = 'application/json') => fetch(`${hosts[0]!.url}${path}/${'a'.repeat(64)}/reveal`, { method: 'POST', headers: { 'content-type': contentType }, body })
    for (const body of ['{"path":"/tmp/file"}', '{"command":"uninstall"}', '{"candidateId":"../file"}', 'null', '[]'])
      expect((await post(body)).status).toBe(400)
    expect((await post('{}', 'text/plain')).status).toBe(403)
    expect(reveal).not.toHaveBeenCalled()
    expect((await post('{}')).status).toBe(200)
    expect(reveal).toHaveBeenCalledExactlyOnceWith('a'.repeat(64), undefined)
  }
  finally {
    await Promise.all(hosts.map(host => host.close()))
    await rm(root, { recursive: true, force: true })
  }
})
