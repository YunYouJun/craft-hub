import type { ResolvedIntegrationContribution } from '../src/integrations'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentConnectionService } from '../src/agent-connection'
import { callAgentHost } from '../src/agent-mcp'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse())
    await close()
  vi.restoreAllMocks()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-agent-connection-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const projects = []
  for (const name of ['shared', 'private']) {
    const path = join(root, name)
    await mkdir(path)
    await writeFile(join(path, 'package.json'), JSON.stringify({ name, scripts: { test: 'echo verification' } }))
    projects.push(await runtime.addProject(path))
  }
  const app = await startCraftHubServer({ runtime, port: 0 })
  cleanup.push(() => app.close())
  const service = new AgentConnectionService(runtime)
  const configure = (body: unknown, headers = {}) => fetch(`${app.url}/api/agent-connection`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const options = { url: app.url, credentialFile: service.credentialPath }
  return { root, runtime, projects, app, service, configure, options }
}

describe('local agent connection', () => {
  it('shares only selected projects, discovers without trust and never exposes the credential to the browser', async () => {
    const { runtime, projects, app, service, configure, options } = await fixture()
    expect((await fetch(`${app.url}/api/agent-connection`).then(r => r.json())).enabled).toBe(false)
    const response = await configure({ enabled: true, projectIds: [projects[0]!.id] })
    const status = await response.json()
    expect(response.status, JSON.stringify(status)).toBe(200)
    const credential = JSON.parse(await readFile(service.credentialPath, 'utf8'))
    expect(JSON.stringify(status)).not.toContain(credential.token)
    // Windows permissions use ACLs rather than POSIX mode bits.
    if (process.platform !== 'win32')
      expect((await stat(service.credentialPath)).mode & 0o777).toBe(0o600)
    expect(status.mcpConfig.mcpServers['craft-hub'].args).toContain('mcp')
    const list = await callAgentHost(options, 'craft_hub_projects')
    expect(list).toMatchObject([{ id: projects[0]!.id, trust: 'untrusted' }])
    expect(list).toHaveLength(1)
    expect(await callAgentHost(options, 'craft_hub_project_context', { projectId: projects[0]!.id })).toMatchObject({ capabilities: [{ name: 'test' }] })
    await expect(callAgentHost(options, 'craft_hub_project_context', { projectId: projects[1]!.id })).rejects.toThrow(/not shared/)
    await expect(callAgentHost(options, 'craft_hub_integrations')).rejects.toThrow(/not been granted/)
    await expect(callAgentHost(options, 'craft_hub_run_command', { projectId: projects[0]!.id })).rejects.toThrow(/read tools/)
    expect((await runtime.projects.get(projects[0]!.id)).trust).toBe('untrusted')
  })

  it('rejects browser credential calls and cross-origin management, rotates and revokes immediately', async () => {
    const { projects, app, service, configure, options } = await fixture()
    expect((await configure({ enabled: true }, { origin: 'https://example.com' })).status).toBe(403)
    await configure({ enabled: true, projectIds: [projects[0]!.id] })
    const old = JSON.parse(await readFile(service.credentialPath, 'utf8'))
    const invoke = (headers = {}) => fetch(`${app.url}/api/agent-access`, { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': `Bearer ${old.token}`, ...headers }, body: JSON.stringify({ name: 'check' }) })
    expect((await invoke({ origin: app.url })).status).toBe(403)
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${app.url}/api/agent-access`, { method: 'POST', headers: { host: 'example.com', authorization: `Bearer ${old.token}` } }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
      request.on('error', reject)
      request.end()
    })
    expect(reboundStatus).toBe(403)
    expect((await invoke()).status).toBe(200)
    await configure({ enabled: true, projectIds: [projects[0]!.id] })
    expect((await invoke()).status).toBe(401)
    expect(await callAgentHost(options, 'check')).toMatchObject({ connected: true })
    await configure({ enabled: false })
    await expect(callAgentHost(options, 'check')).rejects.toThrow()
    expect((await invoke()).status).toBe(401)
  })

  it('hides tasks involving unshared projects and checks identifiers before accessing storage', async () => {
    const { runtime, projects, configure, options } = await fixture()
    await configure({ enabled: true, projectIds: [projects[0]!.id] })
    await runtime.store.saveAgentTask({ id: 'mixed', provider: 'fixture', projectIds: projects.map(p => p.id), primaryProjectId: projects[0]!.id, prompt: 'Private context', status: 'completed', startedAt: new Date().toISOString() })
    expect(await callAgentHost(options, 'craft_hub_runs')).toMatchObject({ tasks: [] })
    await expect(callAgentHost(options, 'craft_hub_task', { taskId: 'mixed' })).rejects.toThrow(/not shared/)
    await expect(callAgentHost(options, 'craft_hub_task', { taskId: '../credential' })).rejects.toThrow()
    await expect(callAgentHost({ ...options, url: 'https://example.com' }, 'check')).rejects.toThrow(/loopback/)
  })

  it('allows only declared reads and forwards a restricted project catalog to plugins', async () => {
    const { projects, runtime, configure, options } = await fixture()
    const resolved: ResolvedIntegrationContribution = { id: 'example', pluginId: 'example', source: 'fixture', provider: { id: 'example', requires: '^1.0.0' }, providerVersion: '1.0.0', views: [], actions: [
      { id: 'read', title: 'Read', confirmation: 'never', effectiveConfirmation: 'never', operation: 'resources.read', effect: 'remote-read' },
      { id: 'write', title: 'Write', confirmation: 'always', effectiveConfirmation: 'always', operation: 'resources.update', effect: 'local-write' },
      { id: 'forged', title: 'Malformed', confirmation: 'never', effectiveConfirmation: 'never', operation: 'resources.execute', effect: 'remote-read' },
    ] }
    vi.spyOn(runtime, 'integrationContributions').mockResolvedValue({ integrations: [resolved], diagnostics: [] })
    const invoke = vi.spyOn(runtime.integrationRegistry, 'invoke').mockResolvedValue({ kind: 'resource-page', title: 'Example', input: {} })
    await configure({ enabled: true, projectIds: [projects[0]!.id], integrationRead: true })
    await callAgentHost(options, 'craft_hub_read_integration', { integrationId: 'example', actionId: 'read' })
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ confirmed: false, context: { hostEnvironment: 'local', projects: [projects[0]] } }))
    for (const actionId of ['write', 'forged'])
      await expect(callAgentHost(options, 'craft_hub_read_integration', { integrationId: 'example', actionId })).rejects.toThrow(/requires a write/)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('serves real MCP discovery and calls through the generated configuration', async () => {
    const { projects, configure } = await fixture()
    const status = await configure({ enabled: true, projectIds: [projects[0]!.id] }).then(r => r.json())
    const client = new Client({ name: 'fixture', version: '1.0.0' })
    const transport = new StdioClientTransport({ ...status.mcpConfig.mcpServers['craft-hub'], stderr: 'pipe' })
    cleanup.push(() => client.close())
    await client.connect(transport)
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('craft_hub_projects')
    const result = await client.callTool({ name: 'craft_hub_projects', arguments: {} })
    expect(JSON.stringify(result)).toContain(projects[0]!.id)
  }, 20_000)

  it('does not expose local credentials on hosted runtimes', async () => {
    const { root } = await fixture()
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'hosted'), hostEnvironment: 'hosted' })
    const service = new AgentConnectionService(runtime)
    expect(await service.status('http://127.0.0.1:1234')).toEqual({ available: false, enabled: false, projectIds: [], integrationRead: false })
    await expect(service.update({ enabled: true })).rejects.toThrow(/local Craft Hub/)
  })
})
