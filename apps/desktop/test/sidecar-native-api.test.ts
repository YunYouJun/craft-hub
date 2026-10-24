import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AgentConnectionService } from '../../../packages/craft-hub/src/agent-connection'
import { CraftHubRuntime } from '../../../packages/craft-hub/src/runtime'
import { startCraftHubServer } from '../../../packages/craft-hub/src/server'
import { createSessionGuard } from '../src/sidecar-host'

it('accepts scoped agent reads without a native session and rejects writes, browser calls and revoked grants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-agent-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const guard = createSessionGuard('a'.repeat(64), 'b'.repeat(64))
  const server = await startCraftHubServer({ host: '127.0.0.1', port: 0, runtime, authorizeRequest: guard.authorize })
  guard.setOrigin(server.url)
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'shared', scripts: { test: 'echo unused' } }))
    await mkdir(join(root, 'private'))
    const shared = await runtime.addProject(root)
    const privateProject = await runtime.addProject(join(root, 'private'))
    const service = new AgentConnectionService(runtime)
    await service.update({ enabled: true, projectIds: [shared.id] })
    const { token } = JSON.parse(await readFile(service.credentialPath, 'utf8'))
    const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' }
    const call = (name: string, args = {}) => fetch(`${server.url}/api/agent-access`, { method: 'POST', headers, body: JSON.stringify({ name, arguments: args }) })
    expect(await call('craft_hub_projects').then(r => r.json())).toEqual([shared])
    expect(await call('craft_hub_project_context', { projectId: shared.id }).then(r => r.json())).toMatchObject({ project: shared, capabilities: [{ name: 'test' }] })
    expect((await call('craft_hub_project_context', { projectId: privateProject.id })).status).toBe(403)
    expect((await call('craft_hub_run_command', { projectId: shared.id })).status).toBe(403)
    for (const path of ['/api/projects', '/api/agent-connection', '/api/native-host/extensions', '/__craft_hub_host/bootstrap'])
      expect((await fetch(`${server.url}${path}`, { headers })).status).toBe(403)
    const browserRequests: Record<string, string>[] = [{ origin: server.url }, { 'sec-fetch-site': 'same-origin' }]
    for (const browserHeaders of browserRequests)
      expect((await fetch(`${server.url}/api/agent-access`, { method: 'POST', headers: { ...headers, ...browserHeaders }, body: '{"name":"check"}' })).status).toBe(403)
    await service.update({ enabled: false })
    expect((await call('check')).status).toBe(401)
    expect(await runtime.runs()).toEqual([])
    expect((await runtime.projects.get(shared.id)).trust).toBe('untrusted')
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('serves native discovery through the public API while preserving the project trust boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-native-api-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'native-fixture', scripts: { check: 'node --version' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const guard = createSessionGuard('a'.repeat(64), 'b'.repeat(64))
  const server = await startCraftHubServer({ host: '127.0.0.1', port: 0, runtime, authorizeRequest: guard.authorize })
  guard.setOrigin(server.url)
  const headers = { 'authorization': `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json', 'origin': server.url }
  try {
    const project = await runtime.addProject(root)
    expect(project.trust).toBe('untrusted')
    const capabilities = await runtime.capabilities(project.id)
    const command = capabilities.find(item => item.kind === 'command')!
    expect(command).toBeDefined()
    expect((await fetch(`${server.url}/api/software`)).status).toBe(403)
    const catalog = await fetch(`${server.url}/api/software`, { headers })
    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toMatchObject({ version: 1, sources: expect.any(Array) })
    const preview = await fetch(`${server.url}/api/projects/${project.id}/preview-command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilityId: command.id }),
    })
    expect(preview.status).toBe(200)
    const marketplace = await fetch(`${server.url}/api/marketplace/overview`, { headers })
    expect(marketplace.status).toBe(200)
    expect(await marketplace.json()).toMatchObject({ version: 1, catalog: expect.any(Array), installed: [], sources: expect.any(Array) })
    const diagnostics = await fetch(`${server.url}/api/diagnostics`, { headers })
    expect(diagnostics.status).toBe(200)
    expect(await diagnostics.json()).toMatchObject({ diagnostics: expect.any(Array), summary: { errors: expect.any(Number), warnings: expect.any(Number) } })
    const denied = await fetch(`${server.url}/api/projects/${project.id}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ capabilityId: command.id }),
    })
    expect(denied.ok).toBe(false)
    expect(await denied.json()).toMatchObject({ error: expect.stringMatching(/trust/i) })
    expect(await runtime.runs()).toEqual([])
    expect((await runtime.projects.get(project.id))?.trust).toBe('untrusted')
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
