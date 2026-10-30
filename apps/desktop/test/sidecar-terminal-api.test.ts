import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime, startCraftHubServer } from 'craft-hub'
import { expect, it, vi } from 'vitest'
import { createProjectLaunchService } from '../src/project-launch.ts'
import { createSessionGuard, createSidecarRequestHandler } from '../src/sidecar-host.ts'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-terminal-')))
  const projectPath = join(root, 'project with spaces')
  const commandPath = join(projectPath, 'packages', 'widget')
  await mkdir(commandPath, { recursive: true })
  await writeFile(join(projectPath, 'package.json'), '{}')
  const runtime = new CraftHubRuntime({
    dataDir: join(root, 'data'),
    configDir: join(root, 'config'),
    capabilityProviders: [{
      id: 'terminal-fixture',
      discover: async () => [{
        id: 'terminal:fixture',
        kind: 'command',
        name: 'Fixture command',
        source: 'package.json',
        invocation: { command: 'never-run-fixture', args: ['do-not-execute'], cwd: commandPath, requiredEnv: [] },
      }],
    }],
  })
  const guard = createSessionGuard('a'.repeat(64), 'b'.repeat(64))
  const openTerminal = vi.fn(async (_path: string, _application?: string) => {})
  const launch = createProjectLaunchService(() => runtime, {
    openURL: vi.fn(async () => {}),
    openPath: vi.fn(async () => {}),
    listInstalledTerminals: () => ['Terminal', 'Ghostty'],
    openTerminal,
  })
  const handler = createSidecarRequestHandler(guard, () => runtime, undefined, undefined, undefined, launch)
  const settingsWatch = vi.spyOn(runtime.settings, 'startWatching').mockResolvedValue()
  const configWatch = vi.spyOn(runtime.userConfig, 'startWatching').mockResolvedValue()
  const server = await startCraftHubServer({ host: '127.0.0.1', port: 0, runtime, authorizeRequest: guard.authorize, handleHostRequest: handler })
  guard.setOrigin(server.url)
  const project = await runtime.addProject(projectPath)
  const headers = { 'authorization': `Bearer ${'b'.repeat(64)}`, 'content-type': 'application/json', 'origin': server.url }
  async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', selectedHeaders = headers) {
    return fetch(`${server.url}${path}`, { headers: selectedHeaders, method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) })
  }
  async function close() {
    await server.close({ processExiting: true })
    settingsWatch.mockRestore()
    configWatch.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
  return { root, projectPath, commandPath, runtime, project, server, headers, openTerminal, request, close }
}

it('lists native terminals and opens only registered runtime-derived directories without execution', async () => {
  const f = await fixture()
  try {
    const run = vi.spyOn(f.runtime, 'run')
    const list = await f.request('/api/native-host/terminal-applications')
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ version: 1, applications: ['Terminal', 'Ghostty'] })
    const root = await f.request('/api/native-host/open-project-terminal', { projectId: f.project.id, application: 'Terminal' })
    expect(root.status).toBe(200)
    expect(await root.json()).toEqual({ version: 1, destination: 'terminal', application: 'Terminal' })
    const nested = await f.request('/api/native-host/open-project-terminal', { projectId: f.project.id, capabilityId: 'terminal:fixture', application: 'Ghostty' })
    expect(nested.status).toBe(200)
    expect(await nested.json()).toEqual({ version: 1, destination: 'terminal', application: 'Ghostty' })
    expect(f.openTerminal.mock.calls).toEqual([[f.projectPath, 'Terminal'], [f.commandPath, 'Ghostty']])
    expect(run).not.toHaveBeenCalled()
    expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
    expect(await f.runtime.runs()).toEqual([])
    expect(await f.runtime.agentTasks.list()).toEqual([])
  }
  finally { await f.close() }
})

it('rejects browser cookies, incorrect credentials, Host and Origin before terminal discovery or opening', async () => {
  const f = await fixture()
  try {
    const denied: Record<string, string>[] = [
      {},
      { cookie: `craft-hub-host-session=${'a'.repeat(64)}`, origin: f.server.url },
      { authorization: `Bearer ${'a'.repeat(64)}` },
      { ...f.headers, origin: 'https://example.invalid' },
      { ...f.headers, 'sec-fetch-site': 'cross-site' },
    ]
    for (const selected of denied) {
      const list = await fetch(`${f.server.url}/api/native-host/terminal-applications`, { headers: selected })
      expect(list.status, JSON.stringify(selected)).toBe(403)
      const open = await fetch(`${f.server.url}/api/native-host/open-project-terminal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...selected },
        body: JSON.stringify({ projectId: f.project.id, application: 'Terminal' }),
      })
      expect(open.status).toBe(403)
    }
    // Fetch normalizes Host itself; use the actual HTTP boundary for a mismatched authority.
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${f.server.url}/api/native-host/terminal-applications`, { headers: { ...f.headers, host: 'example.invalid' } }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
      request.once('error', reject)
      request.end()
    })
    expect(wrongHost).toBe(403)
    expect(f.openTerminal).not.toHaveBeenCalled()
    expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
    expect(await f.runtime.runs()).toEqual([])
  }
  finally { await f.close() }
})

it('rejects arbitrary paths, commands, URLs, run IDs, invalid selections and malformed native requests', async () => {
  const f = await fixture()
  try {
    const base = { projectId: f.project.id, application: 'Terminal' }
    for (const body of [
      { ...base, path: f.commandPath },
      { ...base, command: 'sh' },
      { ...base, args: ['-c', 'anything'] },
      { ...base, url: 'file:///tmp/example' },
      { ...base, runId: 'active-run' },
      { ...base, application: '/tmp/arbitrary.app' },
      { ...base, application: 'Missing' },
      { ...base, projectId: '' },
      { ...base, projectId: 'unknown-project' },
      { ...base, capabilityId: 'unknown-capability' },
      { ...base, capabilityId: '' },
      { ...base, capabilityId: 42 },
      { ...base, projectId: 'bad\nidentifier' },
      [],
      null,
    ])
      expect((await f.request('/api/native-host/open-project-terminal', body)).status).toBe(400)
    expect((await f.request('/api/native-host/terminal-applications?application=Terminal')).status).toBe(400)
    expect((await f.request('/api/native-host/open-project-terminal?projectId=other', base)).status).toBe(400)
    expect((await f.request('/api/native-host/terminal-applications', {}, 'POST')).status).toBe(405)
    expect((await f.request('/api/native-host/open-project-terminal')).status).toBe(405)
    const wrongType = await f.request('/api/native-host/open-project-terminal', base, 'POST', { ...f.headers, 'content-type': 'text/plain' })
    expect(wrongType.status).toBe(405)
    f.openTerminal.mockRejectedValueOnce(new Error('Fixture terminal cannot open'))
    const failed = await f.request('/api/native-host/open-project-terminal', base)
    expect(failed.status).toBe(400)
    expect(await failed.json()).toMatchObject({ error: 'Fixture terminal cannot open' })
    expect(f.openTerminal).toHaveBeenCalledTimes(1)
    expect(await f.runtime.runs()).toEqual([])
  }
  finally { await f.close() }
})

it('refuses a runtime command cwd that resolves outside the registered project', async () => {
  const f = await fixture()
  try {
    const outside = join(f.root, 'outside')
    const linked = join(f.projectPath, 'linked')
    await mkdir(outside)
    await symlink(outside, linked)
    const capabilities = await f.runtime.capabilities(f.project.id)
    const command = capabilities.find(item => item.kind === 'command')!
    const discovery = vi.spyOn(f.runtime, 'capabilities')
    try {
      for (const cwd of [outside, linked, join(f.projectPath, 'package.json')]) {
        discovery.mockResolvedValue([{ ...command, invocation: { ...command.invocation, cwd } }])
        const response = await f.request('/api/native-host/open-project-terminal', { projectId: f.project.id, capabilityId: command.id, application: 'Terminal' })
        expect(response.status).toBe(400)
      }
      expect(f.openTerminal).not.toHaveBeenCalled()
      expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
      expect(await f.runtime.runs()).toEqual([])
    }
    finally { discovery.mockRestore() }
  }
  finally { await f.close() }
})
