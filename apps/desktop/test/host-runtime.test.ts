import type { CraftHubPlugin } from 'craft-hub'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communityDistribution, HostExtensionManager } from 'craft-hub'
import { afterEach, expect, it, vi } from 'vitest'
import { bundledHostExtensionControls, createBuiltinHostPlugins, createDesktopHostRuntime, hasMicrosoftTodoConnection, optionalHostPluginStatus } from '../src/host-runtime'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string, hostExtensions: HostExtensionManager, load: ReturnType<typeof vi.spyOn> }> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-runtime-'))
  directories.push(root)
  const hostExtensions = new HostExtensionManager(join(root, 'data'))
  return { root, hostExtensions, load: vi.spyOn(hostExtensions, 'load') }
}

const builtins: CraftHubPlugin[] = [{ id: 'builtin.alpha', name: 'Alpha' }, { id: 'builtin.beta', name: 'Beta' }]

it('composes the built-in plugins for a host without a distribution', async () => {
  const { root, hostExtensions, load } = await fixture()
  const logError = vi.fn()
  const runtime = await createDesktopHostRuntime({ builtinPlugins: builtins, configDir: join(root, 'config'), dataDir: join(root, 'data'), distribution: communityDistribution, hostExtensions, logError })
  expect(load).toHaveBeenCalledWith(builtins, [])
  expect(runtime.distribution).toBe(communityDistribution)
  expect(logError).not.toHaveBeenCalled()
  await runtime.close()
})

it('lets a distribution plugin replace the built-in plugin with the same id', async () => {
  const { root, hostExtensions, load } = await fixture()
  const manifestPath = join(root, 'distribution.json')
  await writeFile(join(root, 'beta.mjs'), 'export default { id: \'builtin.beta\', name: \'Distribution Beta\' }\n')
  const runtime = await createDesktopHostRuntime({
    builtinPlugins: builtins,
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
    distribution: communityDistribution,
    distributionPlugins: { id: 'example', name: 'Example', manifestPath, modules: ['./beta.mjs'] },
    hostExtensions,
    logError: vi.fn(),
  })
  const [plugins] = load.mock.calls[0] as [CraftHubPlugin[]]
  expect(plugins.map(plugin => `${plugin.id}:${plugin.name}`)).toEqual(['builtin.beta:Distribution Beta', 'builtin.alpha:Alpha'])
  await runtime.close()
})

it('reports a distribution plugin that fails to load and keeps the built-in plugins', async () => {
  const { root, hostExtensions, load } = await fixture()
  const logError = vi.fn()
  const runtime = await createDesktopHostRuntime({
    builtinPlugins: builtins,
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
    distribution: communityDistribution,
    distributionPlugins: { id: 'example', name: 'Example', manifestPath: join(root, 'distribution.json'), modules: ['./missing.mjs'] },
    hostExtensions,
    logError,
  })
  expect(load).toHaveBeenCalledWith(builtins, [])
  expect(logError).toHaveBeenCalledWith(expect.stringMatching(/^Host Plugin .+ failed to load: /))
  expect(runtime.getPluginDiagnostics().length).toBeGreaterThan(0)
  await runtime.close()
})

it('loads an optional plugin only when enabled, defaulting to existing use', async () => {
  const { root, hostExtensions, load } = await fixture()
  const optional = { id: 'microsoft-todo', name: 'Microsoft To Do', plugin: { id: 'optional.todo', name: 'To Do', version: '0.1.0' }, enabledByDefault: vi.fn(async () => true) }
  const options = { builtinPlugins: builtins, configDir: join(root, 'config'), dataDir: join(root, 'data'), distribution: communityDistribution, hostExtensions, logError: vi.fn(), optionalPlugins: [optional] }
  let runtime = await createDesktopHostRuntime(options)
  expect((load.mock.calls[0] as [CraftHubPlugin[]])[0].map(plugin => plugin.id)).toEqual(['builtin.alpha', 'builtin.beta', 'optional.todo'])
  expect(await optionalHostPluginStatus(hostExtensions, [optional])).toEqual([{ id: 'microsoft-todo', name: 'Microsoft To Do', version: '0.1.0', optional: true, enabled: true }])
  await runtime.close()

  // The user's explicit choice wins over the default.
  await hostExtensions.setBundledEnabled('microsoft-todo', false)
  runtime = await createDesktopHostRuntime(options)
  expect((load.mock.calls[1] as [CraftHubPlugin[]])[0].map(plugin => plugin.id)).toEqual(['builtin.alpha', 'builtin.beta'])
  await runtime.close()
})

it('treats an enabled To Do connection as existing use', async () => {
  const { root } = await fixture()
  const dataDir = join(root, 'data')
  expect(await hasMicrosoftTodoConnection(dataDir)).toBe(false)
  await mkdir(join(dataDir, 'integrations', 'microsoft-todo'), { recursive: true })
  await writeFile(join(dataDir, 'integrations', 'microsoft-todo', 'connection.json'), JSON.stringify({ enabled: false }))
  expect(await hasMicrosoftTodoConnection(dataDir)).toBe(false)
  await writeFile(join(dataDir, 'integrations', 'microsoft-todo', 'connection.json'), JSON.stringify({ enabled: true, account: 'me@example.com' }))
  expect(await hasMicrosoftTodoConnection(dataDir)).toBe(true)
  await writeFile(join(dataDir, 'integrations', 'microsoft-todo', 'connection.json'), '{ not json')
  expect(await hasMicrosoftTodoConnection(dataDir)).toBe(false)
})

it('native bundled controls cannot enable arbitrary modules or grant project trust', async () => {
  const { root, hostExtensions } = await fixture()
  const builtin = createBuiltinHostPlugins({ workstationDirectory: root, dataDir: join(root, 'data') })
  const runtime = await createDesktopHostRuntime({ builtinPlugins: builtins, configDir: join(root, 'config'), dataDir: join(root, 'data'), distribution: communityDistribution, hostExtensions, logError: vi.fn() })
  const project = await runtime.projects.add(root)
  try {
    const controls = bundledHostExtensionControls(hostExtensions, builtin)
    expect((await controls.status()).bundledExtensions).toContainEqual(expect.objectContaining({ id: 'microsoft-todo', enabled: false }))
    await expect(controls.setEnabled('/tmp/unreviewed.mjs', true)).rejects.toThrow('Only optional plugins')
    await expect(controls.setEnabled('workstation', false)).rejects.toThrow('Only optional plugins')
    const enabled = await controls.setEnabled('microsoft-todo', true)
    expect(enabled.restartRequired).toBe(true)
    expect(enabled.bundledExtensions).toContainEqual(expect.objectContaining({ id: 'microsoft-todo', enabled: true }))
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await Promise.allSettled(builtin.closeConnections())
    await runtime.close()
  }
})
