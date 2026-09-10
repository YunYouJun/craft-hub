import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { integrationContributionSchema, IntegrationRegistry } from '../../craft-hub/src/integrations'
import { configSnapshot, writePluginConfiguration } from '../src/config-file'
import { createCodexConfigurationPlugin } from '../src/index'

vi.mock('../src/client', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client')>(),
  openCodexReader: vi.fn(async (_executable, _timeout, home: string) => ({
    editPlugin: async () => writeFile(join(home, 'config.toml'), '# preserved\n[plugins."test@local"]\nenabled = true\n'),
    close: vi.fn(),
  })),
}))
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'craft-toggle-test-'))
  dirs.push(dir)
  const file = join(dir, 'config.toml')
  await writeFile(file, '# original\n')
  return { dir, file }
}

describe('scoped configuration updates', () => {
  it('uses an isolated editor and rejects stale revisions and symlinks', async () => {
    const { dir, file } = await fixture()
    const snapshot = await configSnapshot(file)
    await writePluginConfiguration(file, 'test@local', true, snapshot.revision)
    expect(await readFile(file, 'utf8')).toContain('enabled = true')
    await expect(writePluginConfiguration(file, 'test@local', false, snapshot.revision)).rejects.toThrow('Configuration changed')
    const link = join(dir, 'link.toml')
    await symlink(file, link)
    await expect(configSnapshot(link)).rejects.toThrow('regular file')
  })

  it('requires confirmation and only writes the server-selected global or project path', async () => {
    const { dir, file } = await fixture()
    const id = 'test@local'
    const config = { config: { plugins: { [id]: { enabled: true } } }, layers: [{ name: { type: 'user', file }, config: { plugins: { [id]: { enabled: true } } } }] }
    const inventory = { marketplaces: [{ name: 'local', plugins: [{ id, installed: true, enabled: true }] }] }
    const writer = vi.fn(async () => {})
    const plugin = createCodexConfigurationPlugin(async () => ({ read: vi.fn(async method => method === 'config/read' ? config : inventory), close: vi.fn() }), writer)
    const adapter = plugin.integrationProviders![0]!.configuration!
    const row = (await adapter.list({})).items[0]!
    const input = { id, enabled: false, revision: row.configurationToggle!.revision, filePath: '/arbitrary/config.toml' }
    await expect(adapter.update!({}, input)).rejects.toThrow('Invalid')
    await adapter.update!({ confirmed: true }, input)
    expect(writer).toHaveBeenLastCalledWith(file, id, false, input.revision)
    await adapter.list({ projectPath: dir })
    await adapter.update!({ confirmed: true, projectPath: dir }, { ...input, enabled: null, revision: 'missing' })
    expect(writer).toHaveBeenLastCalledWith(join(dir, '.codex/config.toml'), id, null, 'missing')
    await expect(adapter.update!({ confirmed: true }, { ...input, id: 'unknown@local' })).rejects.toThrow('not editable')
    await expect(adapter.update!({ confirmed: true }, { ...input, enabled: null })).rejects.toThrow('Only project')
    await expect(adapter.update!({ confirmed: true }, { ...input, revision: 'old' })).rejects.toThrow('changed')
  })

  it('updates and restores inheritance without querying the catalog again, even after TTL', async () => {
    const { dir, file } = await fixture()
    const id = 'test@local'
    let override: boolean | undefined = true
    let globalEnabled = false
    const read = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method !== 'config/read')
        return { marketplaces: [{ name: 'local', plugins: [{ id, installed: true, enabled: true }] }] }
      const user = { name: { type: 'user', file }, config: { plugins: { [id]: { enabled: globalEnabled } } } }
      const project = { name: { type: 'project', dotCodexFolder: join(dir, '.codex') }, config: { plugins: { [id]: override === undefined ? {} : { enabled: override } } } }
      return params.cwd === dir
        ? { config: { plugins: { [id]: { enabled: override ?? globalEnabled } } }, layers: [project, user] }
        : { config: user.config, layers: [user] }
    })
    const writer = vi.fn(async (_path: string, _id: string, value: boolean | null) => {
      override = value ?? undefined
    })
    const clock = vi.spyOn(Date, 'now')
    const plugin = createCodexConfigurationPlugin(async () => ({ read, close: vi.fn() }), writer)
    const adapter = plugin.integrationProviders![0]!.configuration!
    const context = { confirmed: true, projectPath: dir }
    await adapter.list(context)
    read.mockClear()
    const now = Date.now()
    clock.mockReturnValue(now + 120000)
    try {
      const off = await adapter.update!(context, { id, enabled: false, revision: 'missing' })
      expect(off.items[0]!.configurationToggle?.enabled).toBe(false)
      globalEnabled = true
      const inherited = await adapter.update!(context, { id, enabled: null, revision: 'missing' })
      expect(inherited.items[0]!.configurationToggle).toMatchObject({ enabled: true, inherited: true })
      expect(read.mock.calls.every(([method]) => method === 'config/read')).toBe(true)
    }
    finally {
      clock.mockRestore()
    }
  })

  it('keeps write actions behind a confirmation floor and prevents write previews', async () => {
    const plugin = createCodexConfigurationPlugin()
    const contribution = plugin.integrations![0]!
    const update = contribution.actions.find(action => action.operation === 'configuration.update')!
    expect(() => integrationContributionSchema.parse({ ...contribution, actions: [{ ...update, effect: 'local-read' }] })).toThrow()
    const registry = new IntegrationRegistry(plugin.integrationProviders)
    const resolved = registry.resolve([{ ...contribution, pluginId: plugin.id, source: 'host:test' }]).integrations[0]!
    expect(resolved.actions.find(action => action.id === update.id)?.effectiveConfirmation).toBe('risk-based')
    await expect(registry.invoke({ contribution: resolved, actionId: update.id })).rejects.toThrow('confirmation')
    expect(() => integrationContributionSchema.parse({ ...contribution, views: [{ ...contribution.views[0], blocks: [{ id: 'write', type: 'entity-list', actionId: update.id, previewInput: { enabled: true } }] }] })).toThrow('Preview')
  })
})
