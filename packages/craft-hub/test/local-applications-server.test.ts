import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('opens only the fixed shortcut after a same-origin local JSON request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-application-shortcut-'))
  const launch = vi.fn().mockResolvedValue(undefined)
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const hostedRuntime = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted-data'), configDir: join(root, 'hosted-config') })
  const apps = await Promise.all([runtime, hostedRuntime].map(runtime => startCraftHubServer({ runtime, port: 0, applicationLauncher: launch, publicOrigin: 'https://example.com' })))
  const endpoint = '/api/applications/microsoft-todo/open'
  const post = (path = endpoint, body = '{}', headers: Record<string, string> = {}, app = 0) => fetch(`${apps[app].url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  })
  try {
    const project = await runtime.addProject(root)
    expect((await fetch(`${apps[0].url}/api/health`)).status).toBe(200)
    expect((await fetch(`${apps[0].url}${endpoint}`)).status).toBe(405)
    const rejectedHeaders: Record<string, string>[] = [
      { origin: 'https://unrelated.example.com' },
      { origin: 'https://example.com' },
      { 'sec-fetch-site': 'cross-site' },
      { 'content-type': 'text/plain' },
    ]
    for (const headers of rejectedHeaders)
      expect((await post(endpoint, '{}', headers)).status).toBe(403)
    for (const body of ['null', '[]', '"command"', '{', '{"url":"https://example.com"}', '{"command":"arbitrary"}', '{"applicationId":"other"}'])
      expect((await post(endpoint, body)).status, body).toBe(400)
    expect((await post(endpoint, JSON.stringify({ command: 'x'.repeat(1024) }))).status).toBe(413)
    expect((await post(`${endpoint}?url=https://example.com`)).status).toBe(400)
    expect((await post('/api/applications/unknown/open')).status).toBe(404)
    expect((await post(`${endpoint}/extra`)).status).toBe(404)
    expect((await post(endpoint, '{}', {}, 1)).status).toBe(403)
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${apps[0].url}${endpoint}`, { method: 'POST', headers: { 'host': 'unrelated.example.com', 'content-type': 'application/json' } }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode))
      })
      request.once('error', reject)
      request.end('{}')
    })
    expect(reboundStatus).toBe(403)
    expect(launch).not.toHaveBeenCalled()

    const opened = await post(endpoint, '{}', { origin: apps[0].url })
    expect(opened.status).toBe(200)
    expect(await opened.json()).toEqual({ destination: process.platform === 'darwin' ? 'application' : 'website' })
    expect(launch).toHaveBeenCalledOnce()
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await Promise.all(apps.map(app => app.close()))
    await rm(root, { recursive: true, force: true })
  }
})
