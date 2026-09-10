import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { loadCraftHubPlugins } from '../../../packages/craft-hub/src/plugins'
import { packageHostPlugins } from '../../../scripts/package-host-plugins'

it('packages host adapters and dependencies so normal startup can load their providers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-package-'))
  const source = join(root, 'distribution')
  const host = join(source, 'packages/host')
  const target = join(root, 'desktop')
  await mkdir(join(host, 'dist'), { recursive: true })
  await mkdir(join(host, 'node_modules/provider'), { recursive: true })
  await writeFile(join(host, 'package.json'), JSON.stringify({ name: '@acme/host' }))
  await writeFile(join(host, 'node_modules/provider/package.json'), JSON.stringify({ name: 'provider', type: 'module', exports: './index.js' }))
  await writeFile(join(host, 'node_modules/provider/index.js'), 'export default { id: "example", version: "1.0.0", operations: [], execute() {} }')
  await writeFile(join(host, 'dist/plugin.mjs'), 'import provider from "provider"; export default { id: "example-host", integrationProviders: [provider] }')
  const specifiers = ['./packages/host/dist/plugin.mjs']
  expect((await loadCraftHubPlugins(specifiers, { baseDir: target })).diagnostics).toHaveLength(1)
  const deploy = vi.fn(async (directory: string, destination: string) => cp(directory, destination, { recursive: true }))
  await packageHostPlugins(join(source, 'distribution.json'), target, specifiers, deploy)
  const loaded = await loadCraftHubPlugins(specifiers, { baseDir: target })
  expect(loaded.diagnostics).toEqual([])
  expect(loaded.plugins[0]?.integrationProviders?.[0]?.id).toBe('example')
  expect(deploy).toHaveBeenCalledExactlyOnceWith(host, join(target, 'packages/host'), '@acme/host')
})
