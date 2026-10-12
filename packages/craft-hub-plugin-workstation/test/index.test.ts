import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { createWorkstationPlugin, workstationTransport } from '../src/index'

const transport = () => vi.fn(async (request: Record<string, unknown>) => ({ version: 1, ...(request.operation === 'inspect' ? { items: [] } : request.operation === 'history' ? { plans: [] } : { repositories: [] }) }))

describe('workstation host adapter', () => {
  it('reads software from its independent versioned API without requesting configuration writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-software-adapter-'))
    const call = transport()
    const catalog = { version: 1 as const, source: { id: 'workstation', title: 'Workstation', url: 'https://github.com/YunYouJun/workstation' }, items: [] }
    const software = vi.fn(async () => catalog)
    try {
      const runtime = new CraftHubRuntime({ dataDir: directory, plugins: [createWorkstationPlugin(call, software)] })
      expect(await runtime.softwareCatalogSnapshot()).toEqual({ version: 1, sources: [{ ...catalog.source, items: [], canManage: true }] })
      expect(software).toHaveBeenCalledExactlyOnceWith({ operation: 'catalog' })
      expect(call).not.toHaveBeenCalled()
      const hosted = new CraftHubRuntime({ dataDir: join(directory, 'hosted'), hostEnvironment: 'hosted', plugins: [createWorkstationPlugin(call, software)] })
      await expect(hosted.softwareCatalogSnapshot()).rejects.toThrow('hosted')
      expect(software).toHaveBeenCalledOnce()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('forwards only fixed software operations and requires confirmation at the adapter seam', async () => {
    const call = transport()
    const software = vi.fn(async (_request: Record<string, unknown>) => ({ version: 1 }))
    const management = createWorkstationPlugin(call, software).softwareCatalogProviders![0].management!
    await management.preview(['editor'])
    await management.install('reviewed-plan', true)
    await management.runs()
    await management.cancel('run-1')
    await management.open('editor')
    expect(software.mock.calls.map(args => args[0])).toEqual([
      { operation: 'preview', softwareIds: ['editor'] },
      { operation: 'install', planId: 'reviewed-plan', confirmed: true },
      { operation: 'runs' },
      { operation: 'cancel', runId: 'run-1' },
      { operation: 'open', softwareId: 'editor' },
    ])
    await expect(management.install('reviewed-plan', false as true)).rejects.toThrow('confirm')
    expect(software).toHaveBeenCalledTimes(5)
    expect(call).not.toHaveBeenCalled()
  })

  it('maps software CLI error codes without exposing external diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-software-transport-'))
    const script = join(directory, 'fixture.cjs')
    try {
      await writeFile(script, 'process.stdin.resume(); process.stdin.on(\'end\', () => process.stdout.write(JSON.stringify({ ok: false, code: \'PLAN_STALE\', error: \'private token diagnostic\' })))')
      const request = workstationTransport(process.execPath, [script], 'software-json')
      await expect(request({ operation: 'install', planId: 'plan-1', confirmed: true })).rejects.toMatchObject({ status: 409, message: 'Software plan has changed or expired. Review a new plan.' })
      await writeFile(script, 'process.stdin.resume(); process.stdin.on(\'end\', () => process.stdout.write(JSON.stringify({ ok: false, error: \'private token diagnostic\' })))')
      await expect(request({ operation: 'runs' })).rejects.toMatchObject({ status: 503, message: 'Software operation is unavailable. Check the local Workstation CLI and refresh its history.' })
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('resolves its own declaration and keeps discovery read only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: directory, plugins: [createWorkstationPlugin(call)] })
      const result = await runtime.integrationContributions()
      expect(result.diagnostics).toEqual([])
      expect(result.integrations[0].views[0].title).toBe('环境配置')
      await runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'inspect' })
      expect(call.mock.calls.map(([request]) => request.operation).sort()).toEqual(['git-status', 'history', 'inspect'])
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', input: { operation: 'apply', planId: 'unreviewed' } })).rejects.toThrow('confirmation')
      expect(call).toHaveBeenCalledTimes(3)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('does not allow browser operation selectors to turn a read into a write', async () => {
    const call = transport()
    const plugin = createWorkstationPlugin(call)
    await expect(plugin.integrationProviders![0].configurationManagement!.read({}, { operation: 'apply' })).rejects.toThrow('Unsupported read')
    await expect(plugin.integrationProviders![0].configurationManagement!.update({ confirmed: true }, { operation: 'git-action', action: 'publish' })).rejects.toThrow('Unsupported configuration')
    expect(call).not.toHaveBeenCalled()
  })

  it('denies device configuration access in a hosted runtime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: directory, hostEnvironment: 'hosted', plugins: [createWorkstationPlugin(call)] })
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'inspect' })).rejects.toThrow('local service')
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'git', confirmed: true, input: { operation: 'git-action', action: 'publish' } })).rejects.toThrow('local service')
      expect(call).not.toHaveBeenCalled()
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps project-scoped configuration mutations behind explicit project trust', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: join(directory, 'state'), plugins: [createWorkstationPlugin(call)] })
      const project = await runtime.addProject(directory)
      await expect(runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', projectId: project.id, confirmed: true, input: { operation: 'preview', decisions: [] } })).rejects.toThrow('Trust the project')
      expect(call).not.toHaveBeenCalled()
      await runtime.projects.setTrust(project.id, 'trusted')
      await runtime.invokeIntegrationAction({ integrationId: 'workstation', actionId: 'update', projectId: project.id, confirmed: true, input: { operation: 'preview', decisions: [] } })
      expect(call.mock.calls.some(([request]) => request.operation === 'preview')).toBe(true)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})
