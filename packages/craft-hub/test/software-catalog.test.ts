import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bundledSoftwareCatalog } from '../src/bundled-software-catalog'
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
      { ...catalog, items: [{ ...item, iconUrl: 'file:///private/icon.png' }] },
      { ...catalog, items: [{ ...item, iconUrl: 'https://user:password@example.com/icon.png' }] },
      { ...catalog, items: [{ ...item, installCommand: 'arbitrary command' }] },
    ]) expect(softwareCatalogSchema.safeParse(malformed).success).toBe(false)
  })

  it('validates bounded capability reports and intersects them with item observations', async () => {
    const operationSupport = { state: 'available' as const, cliVersion: '1.0.0', platform: 'linux', operations: {
      catalog: { supported: true },
      preview: { supported: true },
      install: { supported: false, reason: 'unsupported-platform' },
      open: { supported: false, reason: 'unsupported-platform' },
    } }
    const observed = { ...catalog, operationSupport, items: [{ ...item, canInstall: true, canOpen: true }] }
    const service = new SoftwareCatalogService([{ ...source, read: async () => observed }])
    expect((await service.snapshot()).sources[0]).toMatchObject({ operationSupport, items: [{ canInstall: false, canOpen: false }] })
    const permitted = new SoftwareCatalogService([{ ...source, read: async () => ({ ...observed, operationSupport: { ...operationSupport, operations: { preview: { supported: true }, install: { supported: true }, open: { supported: true } } } }) }])
    expect((await permitted.snapshot()).sources[0]!.items[0]).toMatchObject({ canInstall: true, canOpen: true })
    const legacy = new SoftwareCatalogService([{ ...source, read: async () => ({ ...catalog, items: observed.items }) }])
    expect((await legacy.snapshot()).sources[0]!.items[0]).toMatchObject({ canInstall: true, canOpen: true })
    for (const malformed of [
      { ...operationSupport, state: 'unexpected' },
      { ...operationSupport, operations: { open: { supported: 'yes' } } },
      { ...operationSupport, operations: { open: { supported: true, executable: 'open' } } },
      { ...operationSupport, operations: { 'shell command': { supported: true } } },
      { ...operationSupport, message: 'x'.repeat(1025) },
      { ...operationSupport, operations: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`operation-${index}`, { supported: true }])) },
    ]) expect(softwareCatalogSchema.safeParse({ ...observed, operationSupport: malformed }).success).toBe(false)
  })

  it.each(['unsupported', 'unavailable'] as const)('does not expose item writes for %s capability reports', async (state) => {
    const operationSupport = { state, operations: { preview: { supported: true }, install: { supported: true }, open: { supported: true } } }
    const result = await new SoftwareCatalogService([{ ...source, read: async () => ({ ...catalog, operationSupport, items: [{ ...item, canInstall: true, canOpen: true }] }) }]).snapshot()
    expect(result.sources[0]!.operationSupport).toEqual(operationSupport)
    expect(result.sources[0]!.items[0]).toMatchObject({ canInstall: false, canOpen: false })
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

  it('allows catalog browsing without project trust; hosted browsing never invokes local discovery', async () => {
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
      expect(await response.json()).toMatchObject({ version: 1, sources: [{ id: 'workstation', bundled: true }, { ...source, items: [item] }] })
      expect((await local.projects.get(project.id)).trust).toBe('untrusted')
      expect((await fetch(`${apps[0].url}/api/software?operation=install`)).status).toBe(400)
      const hostedResponse = await fetch(`${apps[1].url}/api/software`)
      expect(hostedResponse.status).toBe(200)
      expect(await hostedResponse.json()).toMatchObject({ sources: [{ id: 'workstation', bundled: true }] })
      expect((await hosted.softwareCatalogSnapshot()).sources).toHaveLength(1)
      const metadataOnly = await fetch(`${apps[0].url}/api/software?discovery=none`)
      expect(metadataOnly.status).toBe(200)
      expect(await metadataOnly.json()).toMatchObject({ sources: [{ id: 'workstation', bundled: true }] })
      expect(read).toHaveBeenCalledOnce()
      expect((await fetch(`${apps[0].url}/api/software?discovery=none&operation=install`)).status).toBe(400)
    }
    finally {
      await Promise.all(apps.map(app => app.close()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('browses bundled metadata without a plugin and never offers execution', async () => {
    const service = new SoftwareCatalogService([], [bundledSoftwareCatalog])
    const snapshot = await service.snapshot()
    expect(snapshot.sources).toHaveLength(1)
    expect(snapshot.sources[0]).toMatchObject({ id: 'workstation', bundled: true })
    expect(snapshot.sources[0]!.canManage).not.toBe(true)
    expect(snapshot.sources[0]!.items).toHaveLength(bundledSoftwareCatalog.items.length)
    expect(snapshot.sources[0]!.items.every(item => item.status === 'unknown' && item.canInstall === false && item.canOpen === false)).toBe(true)
    expect(snapshot.sources[0]!.items.find(item => item.id === 'ghostty')).toMatchObject({
      title: { en: 'Ghostty' },
      group: { id: 'terminal-editor' },
      url: 'https://ghostty.org/',
      installation: { kind: 'brew-cask', packageId: 'ghostty' },
    })
    await expect(service.preview('workstation', [bundledSoftwareCatalog.items[0]!.id])).rejects.toMatchObject({ status: 503 })
    await expect(service.open('workstation', bundledSoftwareCatalog.items[0]!.id)).rejects.toMatchObject({ status: 503 })
  })

  it('preserves native artwork for older plugins only when application and icon identities match', async () => {
    const { iconUrl, macosIconUrl, iconStyle, iconScale, ...metadata } = bundledSoftwareCatalog.items.find(item => item.macosIconUrl && item.iconScale !== undefined)!
    expect(macosIconUrl).toBeTruthy()
    const read = vi.fn(async () => ({ version: 1 as const, source: bundledSoftwareCatalog.source, items: [{ ...metadata, iconUrl, status: 'detected' as const }] }))
    const service = new SoftwareCatalogService([{ ...bundledSoftwareCatalog.source, url: bundledSoftwareCatalog.source.url!, read }], [bundledSoftwareCatalog])
    const liveItem = async () => (await service.snapshot()).sources[0]!.items.find(item => item.id === metadata.id)!
    expect(await liveItem()).toMatchObject({ iconUrl, macosIconUrl, iconScale, ...(iconStyle ? { iconStyle } : {}) })
    read.mockResolvedValueOnce({ version: 1, source: bundledSoftwareCatalog.source, items: [{ ...metadata, iconUrl: 'https://example.com/custom.svg', status: 'detected' }] })
    const custom = await liveItem()
    expect(custom).not.toHaveProperty('macosIconUrl')
    expect(custom).not.toHaveProperty('iconScale')
    read.mockResolvedValueOnce({ version: 1, source: bundledSoftwareCatalog.source, items: [{ ...metadata, iconUrl, url: 'https://different.example.com/', status: 'detected' }] })
    const different = await liveItem()
    expect(different).not.toHaveProperty('macosIconUrl')
    expect(different).not.toHaveProperty('iconScale')
  })

  it('merges live entries by identity and restores the static catalog when discovery fails', async () => {
    const metadata = bundledSoftwareCatalog.items[0]!
    const read = vi.fn(async () => ({ version: 1 as const, source: bundledSoftwareCatalog.source, items: [{ ...metadata, status: 'detected' as const, canOpen: true }] }))
    const service = new SoftwareCatalogService([{ ...bundledSoftwareCatalog.source, url: bundledSoftwareCatalog.source.url!, read }], [bundledSoftwareCatalog])
    const live = (await service.snapshot()).sources[0]!
    expect(live.bundled).not.toBe(true)
    expect(live.items).toHaveLength(bundledSoftwareCatalog.items.length)
    expect(live.items[0]).toMatchObject({ id: metadata.id, status: 'detected', canOpen: true })
    expect(live.items[1]).toMatchObject({ status: 'unknown', canInstall: false, canOpen: false })
    read.mockRejectedValueOnce(new Error('local CLI unavailable'))
    const fallback = (await service.snapshot()).sources[0]!
    expect(fallback).toMatchObject({ bundled: true })
    expect(fallback.canManage).not.toBe(true)
    expect(fallback.items[0]).toMatchObject({ status: 'unknown', canOpen: false })
    expect((await service.snapshot()).sources[0]!.items).toEqual(live.items)
  })
})
