import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { createWorkstationPlugin } from '../src/index'

const transport = () => vi.fn(async (request: Record<string, unknown>) => ({ version: 1, ...(request.operation === 'inspect' ? { items: [] } : request.operation === 'history' ? { plans: [] } : { repositories: [] }) }))

describe('workstation host adapter', () => {
  it('resolves its own declaration and keeps discovery read only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-config-'))
    try {
      const call = transport()
      const runtime = new CraftHubRuntime({ dataDir: directory, plugins: [createWorkstationPlugin(call)] })
      const result = await runtime.integrationContributions()
      expect(result.diagnostics).toEqual([])
      expect(result.integrations[0].views[0].title).toBe('开发环境')
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
