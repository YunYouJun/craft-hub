import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('discovers configured sources without registering projects or changing execution trust', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-catalog-'))
  const catalog = { schemaVersion: 1 as const, id: 'example', name: 'Example', entries: [{ id: 'dev', name: 'Dev', publisher: 'Maintainer', configurationUrl: 'https://git.example.com/config' }] }
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), distribution: { id: 'example', name: 'Example', workspaceMarkets: [{ enabled: true, catalog }] } })
  const project = await runtime.projects.add(root)
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    const response = await fetch(`${server.url}/api/workspace-catalogs`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([catalog])
    expect(await runtime.projects.list()).toEqual([project])
    expect(project.trust).toBe('untrusted')
    expect(await runtime.workspaces.list()).toEqual([])
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
