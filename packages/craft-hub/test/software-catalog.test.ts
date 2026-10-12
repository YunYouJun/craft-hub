import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { softwareCatalogSchema, SoftwareCatalogService } from '../src/software-catalog'

const source = { id: 'fixture', title: 'Fixture', url: 'https://example.com/catalog' }
const item = { id: 'editor', title: { en: 'Editor' }, group: { id: 'coding', title: { en: 'Coding' } }, url: 'https://example.com/editor', downloadUrl: 'https://example.com/download', repositoryUrl: 'https://github.com/example/editor', status: 'unknown' as const, installation: { kind: 'download' as const } }
const catalog = { version: 1 as const, source, items: [item] }

describe('read-only software catalogs', () => {
  it('validates links, unique IDs, versions and display-only metadata', () => {
    expect(softwareCatalogSchema.parse(catalog)).toEqual(catalog)
    for (const malformed of [
      { ...catalog, version: 2 },
      { ...catalog, items: [item, item] },
      { ...catalog, items: [{ ...item, downloadUrl: 'javascript:alert(1)' }] },
      { ...catalog, items: [{ ...item, repositoryUrl: 'https://user:password@example.com/' }] },
      { ...catalog, items: [{ ...item, installCommand: 'arbitrary command' }] },
    ]) expect(softwareCatalogSchema.safeParse(malformed).success).toBe(false)
  })

  it('isolates invalid and unavailable sources without forwarding external diagnostics', async () => {
    const providers = [
      { ...source, read: async () => catalog },
      { ...source, id: 'broken', read: async () => { throw new Error('private diagnostic') } },
      { ...source, id: 'mismatch', read: async () => catalog },
    ]
    expect(await new SoftwareCatalogService(providers).snapshot()).toEqual({ version: 1, sources: [
      { ...source, items: [item] },
      { ...source, id: 'broken', items: [], error: 'unavailable' },
      { ...source, id: 'mismatch', items: [], error: 'unavailable' },
    ] })
    expect(() => new SoftwareCatalogService([providers[0], providers[0]])).toThrow('unique')
  })

  it('allows local read-only discovery without project trust and denies hosted access or browser selectors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-software-'))
    const read = vi.fn(async () => catalog)
    const plugin = { id: 'software-fixture', softwareCatalogProviders: [{ ...source, read }] }
    const local = new CraftHubRuntime({ dataDir: join(root, 'local'), configDir: join(root, 'config-local'), plugins: [plugin] })
    const hosted = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted'), configDir: join(root, 'config-hosted'), plugins: [plugin] })
    const apps = await Promise.all([local, hosted].map(runtime => startCraftHubServer({ runtime, port: 0 })))
    try {
      const project = await local.addProject(root)
      const response = await fetch(`${apps[0].url}/api/software`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ version: 1, sources: [{ ...source, items: [item] }] })
      expect((await local.projects.get(project.id)).trust).toBe('untrusted')
      expect((await fetch(`${apps[0].url}/api/software?operation=install`)).status).toBe(400)
      expect((await fetch(`${apps[1].url}/api/software`)).status).toBe(403)
      await expect(hosted.softwareCatalogSnapshot()).rejects.toThrow('hosted')
      expect(read).toHaveBeenCalledOnce()
    }
    finally {
      await Promise.all(apps.map(app => app.close()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
