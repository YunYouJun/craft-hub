import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostExtensionManager } from '../src/host-extensions'
import { IntegrationRegistry } from '../src/integrations'
import { CraftHubRuntime } from '../src/runtime'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-host-extension-'))
  roots.push(root)
  const marker = join(root, 'executed')
  const modulePath = join(root, 'host.mjs')
  await writeFile(modulePath, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default { id: 'acme', integrationProviders: [{ id: 'example', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }) }] }`)
  const manager = new HostExtensionManager(join(root, 'data'))
  const extension = manager.prepare({ id: 'acme', name: 'Acme', manifestPath: join(root, 'distribution.json'), modules: ['./host.mjs'] })
  return { root, manager, marker, extension, modulePath }
}

describe('persistent host extensions', () => {
  it('only loads explicitly trusted installations and restores providers after an ordinary restart', async () => {
    const { root, manager, marker, extension } = await fixture()
    expect((await manager.load()).plugins).toEqual([])
    await manager.install(extension)
    await manager.status()
    await expect(access(marker)).rejects.toThrow()
    expect((await manager.status()).restartRequired).toBe(true)

    const restarted = new HostExtensionManager(join(root, 'data'))
    const loaded = await restarted.load()
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.plugins[0]?.integrationProviders?.[0]?.id).toBe('example')
    expect((await restarted.status()).restartRequired).toBe(false)
    await expect(access(marker)).resolves.toBeUndefined()

    const runtime = new CraftHubRuntime({ dataDir: join(root, 'runtime'), configDir: join(root, 'config'), plugins: loaded.plugins })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'example', scripts: { hello: 'node --version' } }))
    const project = await runtime.addProject(root)
    expect(project.trust).toBe('untrusted')
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
    expect(command).toBeDefined()
    await expect(runtime.run(project.id, command.id)).rejects.toThrow(/untrusted/)
    const registry = new IntegrationRegistry(loaded.plugins.flatMap(plugin => plugin.integrationProviders ?? []))
    expect(registry.resolve([{
      id: 'example',
      pluginId: 'acme-ui',
      source: 'plugin:acme-ui',
      provider: { id: 'example', requires: '^1.0.0' },
      actions: [],
      views: [],
    }]).diagnostics).toEqual([])
  })

  it('does not import disabled or removed extensions on subsequent startups', async () => {
    const { root, manager, marker, extension } = await fixture()
    await manager.install(extension)
    await manager.setEnabled(extension.id, false)
    expect((await new HostExtensionManager(join(root, 'data')).load()).plugins).toEqual([])
    await expect(access(marker)).rejects.toThrow()
    await manager.remove(extension.id)
    expect((await new HostExtensionManager(join(root, 'data')).status()).extensions).toEqual([])
    await expect(access(marker)).rejects.toThrow()
  })

  it('snapshots the approved module list instead of executing additions to a changed manifest', async () => {
    const { root, manager, extension, marker } = await fixture()
    await manager.install(extension)
    await writeFile(extension.manifestPath, JSON.stringify({ hostPlugins: ['./unexpected.mjs'] }))
    await writeFile(join(root, 'unexpected.mjs'), 'throw new Error("unapproved code ran")')
    expect((await new HostExtensionManager(join(root, 'data')).load()).diagnostics).toEqual([])
    await expect(access(marker)).resolves.toBeUndefined()
  })

  it('reports missing modules without crashing or removing the installation', async () => {
    const { root, manager, extension, modulePath } = await fixture()
    await manager.install(extension)
    await rm(modulePath)
    const next = new HostExtensionManager(join(root, 'data'))
    const loaded = await next.load([{ id: 'builtin' }])
    expect(loaded.plugins.map(plugin => plugin.id)).toEqual(['builtin'])
    expect(loaded.diagnostics).toEqual([expect.objectContaining({ pluginId: 'acme', phase: 'load' })])
    expect((await next.status()).extensions).toEqual([extension])
  })

  it('preserves corrupt state and keeps builtin plugins available', async () => {
    const { manager, extension } = await fixture()
    await manager.install(extension)
    await writeFile(manager.path, 'broken-json')
    const loaded = await manager.load([{ id: 'builtin' }])
    expect(loaded.plugins.map(plugin => plugin.id)).toEqual(['builtin'])
    expect(loaded.diagnostics).toHaveLength(1)
    await expect(manager.install(extension)).rejects.toThrow()
    expect(await readFile(manager.path, 'utf8')).toBe('broken-json')
  })

  it('isolates duplicate providers and failed extensions without replacing host-owned providers', async () => {
    const { manager, extension } = await fixture()
    await manager.install(extension)
    const builtin = { id: 'builtin', integrationProviders: [{ id: 'example', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }) }] }
    const loaded = await manager.load([builtin])
    expect(loaded.plugins).toEqual([builtin])
    expect(loaded.diagnostics[0]?.message).toMatch(/conflicts/)
  })

  it('serializes concurrent installation edits without losing entries', async () => {
    const { manager, extension } = await fixture()
    await Promise.all([manager.install(extension), manager.install({ ...extension, id: 'other' })])
    expect((await manager.status()).extensions.map(item => item.id)).toEqual(['acme', 'other'])
  })

  it('does not register the same module twice when a distribution also loads it explicitly', async () => {
    const { manager, extension, modulePath } = await fixture()
    await manager.install(extension)
    const configured = { id: 'acme' }
    expect(await manager.load([configured], [modulePath])).toEqual({ plugins: [configured], diagnostics: [] })
  })
})
