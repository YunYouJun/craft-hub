import type { ConfigurationManagementItem, ConfigurationManagementPage } from '../src/configuration-management'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { configurationItemWritable, presentConfigurationManagement } from '../src/configuration-management'
import { CraftHubRuntime } from '../src/runtime'

const item: ConfigurationManagementItem = {
  id: 'shell',
  title: 'Shell',
  kind: 'terminal',
  owner: 'user',
  origin: 'private',
  manager: 'fixture',
  localPath: '/fixture/home/.shellrc',
  sourcePath: '/fixture/config/shellrc',
  status: 'conflict',
  revision: 'revision',
  local: 'local preview',
  source: 'source preview',
  fields: [],
}

it('shares ownership affordances without changing content or trusting provider presentation flags', () => {
  const excluded: Partial<ConfigurationManagementItem>[] = [
    { sourcePath: undefined },
    { owner: 'installer' },
    { origin: 'installer' },
    { origin: 'external' },
    { origin: 'project' },
    { manager: 'unknown' },
    { manager: 'external' },
    { manager: 'skills-cli' },
    { status: 'error' },
    { status: 'read-only' },
    { status: 'ownership-conflict' },
  ]
  expect(configurationItemWritable(item, 'fixture')).toBe(true)
  expect(configurationItemWritable(item, 'another-provider')).toBe(false)
  expect(configurationItemWritable({ ...item, manager: undefined }, 'fixture')).toBe(true)
  for (const override of excluded) expect(configurationItemWritable({ ...item, ...override }, 'fixture')).toBe(false)
  const page: ConfigurationManagementPage = { configuration: true, items: [item, { ...item, id: 'protected', owner: 'installer' }], presentation: { version: 1, writableItemIds: ['protected'] } }
  const presented = presentConfigurationManagement(page, 'fixture')
  expect(presented.presentation).toEqual({ version: 1, writableItemIds: ['shell'] })
  expect(presented.items).toBe(page.items)
  expect(page.presentation?.writableItemIds).toEqual(['protected'])
})

it('adds presentation to declared reads and confirmed writes while preserving local-host, confirmation and project trust checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-configuration-presentation-'))
  const read = vi.fn(async (): Promise<ConfigurationManagementPage> => ({ configuration: true, items: [item] }))
  const update = vi.fn(async (): Promise<ConfigurationManagementPage> => ({ configuration: true, items: [item] }))
  const options = {
    dataDir: join(root, 'runtime'),
    configDir: join(root, 'config'),
    plugins: [{ id: 'configuration-fixture', integrationProviders: [{ id: 'fixture', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }), configurationManagement: { read, update, execute: update } }], integrations: [{
      id: 'fixture',
      provider: { id: 'fixture', requires: '^1.0.0' },
      actions: [
        { id: 'read', title: 'Read', operation: 'configuration.read' as const, effect: 'local-read' as const, confirmation: 'never' as const },
        { id: 'update', title: 'Update', operation: 'configuration.update' as const, effect: 'local-write' as const, confirmation: 'always' as const },
      ],
      views: [],
    }] }],
  }
  const runtime = new CraftHubRuntime(options)
  try {
    const project = await runtime.addProject(root)
    expect((await runtime.integrationContributions()).integrations.map(value => value.id)).toContain('fixture')
    expect(read).not.toHaveBeenCalled()
    expect(await runtime.invokeIntegrationAction({ integrationId: 'fixture', actionId: 'read', projectId: project.id })).toMatchObject({ presentation: { version: 1, writableItemIds: ['shell'] } })
    expect(update).not.toHaveBeenCalled()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'fixture', actionId: 'update' })).rejects.toThrow('confirmation')
    await expect(runtime.invokeIntegrationAction({ integrationId: 'fixture', actionId: 'update', projectId: project.id, confirmed: true })).rejects.toThrow('Trust the project')
    expect(update).not.toHaveBeenCalled()
    expect(await runtime.invokeIntegrationAction({ integrationId: 'fixture', actionId: 'update', confirmed: true, input: { operation: 'preview' } })).toMatchObject({ presentation: { writableItemIds: ['shell'] } })
    expect(update).toHaveBeenCalledTimes(1)
    const hosted = new CraftHubRuntime({ ...options, hostEnvironment: 'hosted' })
    await expect(hosted.invokeIntegrationAction({ integrationId: 'fixture', actionId: 'read' })).rejects.toThrow('local service')
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('derives backup source eligibility for both clients without mixing private audiences', () => {
  const page: ConfigurationManagementPage = {
    configuration: true,
    items: [],
    registry: {
      version: 1,
      revision: 'registry',
      ownership: {},
      targets: [],
      sources: ['public', 'personal', 'work', 'unclassified'].map(audience => ({ id: audience, name: audience, root: `/fixture/${audience}`, kind: 'dotfiles' as const, audience: audience as 'public' | 'personal' | 'work' | 'unclassified', enabled: true })),
    },
    presentation: { version: 1, writableItemIds: [], backupSourceIds: { personal: ['work'], work: ['personal'] } },
  }
  expect(presentConfigurationManagement(page, 'fixture').presentation?.backupSourceIds).toEqual({ personal: ['public', 'personal'], work: ['public', 'work'] })
  expect(page.presentation?.backupSourceIds?.personal).toEqual(['work'])
})
