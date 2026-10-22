import type { CraftHubPlugin } from 'craft-hub'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { communityDistribution, HostExtensionManager } from 'craft-hub'
import { afterEach, expect, it, vi } from 'vitest'
import { createDesktopHostRuntime } from '../src/host-runtime'

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
