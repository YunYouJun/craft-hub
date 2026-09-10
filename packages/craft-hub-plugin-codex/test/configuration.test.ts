import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { integrationContributionSchema } from '../../craft-hub/src/integrations'
import { CraftHubRuntime } from '../../craft-hub/src/runtime'
import { CodexMethodUnavailableError } from '../src/client'
import { configurationRows, createCodexConfigurationPlugin } from '../src/index'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const id = 'ios@official'
const layer = (type: string, value: boolean, disabledReason?: string) => ({ name: type === 'project' ? { type, dotCodexFolder: '/project/.codex' } : { type, file: '/home/.codex/config.toml' }, config: { plugins: { [id]: { enabled: value } } }, disabledReason })
const global = { config: { plugins: { [id]: { enabled: false } }, secret: 'do-not-expose' }, layers: [layer('user', false)] }
const project = { config: { plugins: { [id]: { enabled: true } } }, layers: [layer('project', true), layer('user', false)] }
const inventory = { marketplaces: [{ name: 'official', plugins: [{ id, name: 'Build iOS', installed: true, enabled: true, localVersion: '1.0.0', version: '2.0.0' }] }] }

describe('codex configuration inspector', () => {
  it('does not allow unrelated operations to claim the local configuration read effect', () => {
    const plugin = createCodexConfigurationPlugin()
    const contribution = plugin.integrations![0]!
    expect(() => integrationContributionSchema.parse({ ...contribution, actions: [{ ...contribution.actions[0], operation: 'issues.list' }] })).toThrow('Local read is reserved')
  })

  it('renders Chinese state labels and exposes typed source paths', () => {
    const row = configurationRows(global, project, inventory, 'zh-CN').items[0]!
    expect(row.status).toBe('配置已开启')
    expect(row.details).toContainEqual({ label: '全局配置', value: '关闭' })
    expect(row.details?.find(detail => detail.label === '项目覆盖')?.value).toContain('开启')
    expect(row.details?.find(detail => detail.label === '生效来源')?.sourcePath).toBe(join('/project', '.codex', 'config.toml'))
  })

  it('reuses catalog results while re-reading changed enable configuration', async () => {
    let config = global
    const read = vi.fn(async (method: string) => method === 'plugin/installed' ? inventory : config)
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close: vi.fn() }))
    const list = plugin.integrationProviders![0]!.configuration!.list
    expect((await list({})).items[0]?.status).toBe('Disabled')
    config = { ...global, config: { ...global.config, plugins: { [id]: { enabled: true } } } }
    expect((await list({})).items[0]?.status).toBe('Configured enabled')
    expect(read.mock.calls.filter(call => call[0] === 'plugin/installed')).toHaveLength(1)
    expect(read.mock.calls.filter(call => call[0] === 'config/read')).toHaveLength(2)
  })

  it('returns preview config without waiting for any installed catalog', async () => {
    const read = vi.fn(async () => global)
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close: vi.fn() }))
    const result = await plugin.integrationProviders![0]!.configuration!.list({}, { preview: true })
    expect(result.items[0]?.status).toBe('Checking installation')
    expect(read.mock.calls).toHaveLength(1)
  })

  it('falls back only when an older Codex lacks the installed endpoint', async () => {
    const read = vi.fn(async (method: string) => {
      if (method === 'config/read')
        return global
      if (method === 'plugin/installed')
        throw new CodexMethodUnavailableError()
      return inventory
    })
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close: vi.fn() }))
    await plugin.integrationProviders![0]!.configuration!.list({})
    expect(read.mock.calls.map(call => call[0])).toEqual(['config/read', 'plugin/installed', 'plugin/list'])
  })

  it('does not retry an installed-query failure with a larger market request', async () => {
    const read = vi.fn(async (method: string) => {
      if (method === 'config/read')
        return global
      throw new Error('connection failed')
    })
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close: vi.fn() }))
    await expect(plugin.integrationProviders![0]!.configuration!.list({})).rejects.toThrow('connection failed')
    expect(read.mock.calls.map(call => call[0])).toEqual(['config/read', 'plugin/installed'])
  })

  it('prefers project config over global config and catalog status, using the installed version', () => {
    const row = configurationRows(global, project, inventory).items[0]!
    expect(row.status).toBe('Configured enabled')
    expect(row.details).toContainEqual({ label: 'Installed version', value: '1.0.0' })
    expect(row.details).toContainEqual({ label: 'Global configuration', value: 'Disabled' })
    expect(row.details?.find(detail => detail.label === 'Project override')?.value).toContain('Enabled')
    expect(configurationRows(global, global, inventory).items[0]?.status).toBe('Disabled')
    expect(JSON.stringify(row)).not.toContain('do-not-expose')
  })

  it('shows ignored untrusted overrides without treating them as effective', () => {
    const result = configurationRows(global, { ...global, layers: [layer('project', true, 'untrusted'), layer('user', false)] }, inventory)
    expect(result.items[0]?.title).toBe('Project configuration ignored')
    expect(result.items[1]?.status).toBe('Disabled')
    expect(result.items[1]?.details?.find(detail => detail.label === 'Project override')?.value).toContain('(ignored)')
  })

  it('keeps config-only entries and reports incomplete catalogs without leaking raw errors', () => {
    const result = configurationRows(global, project, { marketplaces: [], marketplaceLoadErrors: [{ message: 'secret-token' }] })
    expect(result.items[0]?.title).toBe('Plugin catalog is incomplete')
    expect(result.items[1]?.status).toBe('Not confirmed installed')
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('rejects unsupported response shapes instead of showing a false empty state', () => {
    expect(() => configurationRows({}, {}, {})).toThrow('Unsupported')
  })

  it('exposes the Host Plugin view through the runtime and only makes read calls', async () => {
    const close = vi.fn()
    const read = vi.fn().mockResolvedValueOnce(global).mockResolvedValueOnce(inventory)
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close }))
    const dataDir = await mkdtemp(join(tmpdir(), 'codex-config-test-'))
    directories.push(dataDir)
    const runtime = new CraftHubRuntime({ dataDir, configDir: join(dataDir, 'config'), plugins: [plugin] })
    const { integrations } = await runtime.integrationContributions()
    expect(integrations.find(item => item.id === 'codex-configuration')?.source).toBe(`host:${plugin.id}`)
    const result = await runtime.invokeIntegrationAction({ integrationId: 'codex-configuration', actionId: 'configuration' })
    expect(result).toMatchObject(configurationRows(global, global, inventory))
    expect(read.mock.calls.map(call => call[0])).toEqual(['config/read', 'plugin/installed'])
    expect(close).toHaveBeenCalledOnce()
    read.mockResolvedValueOnce(global)
    const sourceIndex = configurationRows(global, global, inventory).items[0]!.details!.findIndex(detail => detail.label === 'Global source')
    await expect(runtime.integrationSourcePath('codex-configuration', 'configuration', id, sourceIndex)).resolves.toBe('/home/.codex/config.toml')
    await expect(runtime.integrationSourcePath('codex-configuration', 'configuration', id, -1)).rejects.toThrow('Invalid configuration source')
    read.mockResolvedValueOnce(global)
    await expect(runtime.integrationSourcePath('codex-configuration', 'configuration', 'forged-entity', 0)).rejects.toThrow('unavailable')
  })

  it('closes the reader on configuration failure', async () => {
    const close = vi.fn()
    const plugin = createCodexConfigurationPlugin(async () => ({ read: vi.fn().mockRejectedValue(new Error('invalid config')), close }))
    await expect(plugin.integrationProviders![0]!.configuration!.list({ projectPath: '/project' })).rejects.toThrow('invalid config')
    expect(close).toHaveBeenCalledOnce()
  })
})
