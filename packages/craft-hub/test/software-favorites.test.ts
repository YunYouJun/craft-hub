import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createSoftwareFavorite, findSoftwareFavorite } from '../src/personal-workbench'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const source = { id: 'fixture', title: 'Fixture', url: 'https://example.com/catalog' }
const item = { id: 'terminal', title: { en: 'Terminal', zh: '终端' }, group: { id: 'tools', title: { en: 'Tools', zh: '工具' } }, url: 'https://ghostty.org/', downloadUrl: 'https://ghostty.org/download', status: 'unknown' as const, installation: { kind: 'download' as const } }

it('shares website normalization, separate downloads and known launcher mapping across clients', () => {
  const favorite = createSoftwareFavorite(item, 'zh-CN', 'software:fixture')
  expect(favorite).toMatchObject({ title: '终端', group: '工具', launch: { application: 'ghostty' } })
  expect(findSoftwareFavorite([favorite], { ...item, url: 'https://www.ghostty.org/#docs' })).toBe(favorite)
  expect(findSoftwareFavorite([favorite], { ...item, downloadUrl: 'https://ghostty.org/another' })).toBeUndefined()
  expect(findSoftwareFavorite([{ ...favorite, id: 'custom' }], { ...item, downloadUrl: 'https://ghostty.org/another' })).toBeDefined()
})

it('adds/removes one favorite with settings concurrency while leaving discovery, execution trust and unrelated home data intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-software-favorites-'))
  const read = vi.fn(async () => ({ version: 1 as const, source, items: [item] }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'favorite-fixture', softwareCatalogProviders: [{ ...source, read }] }] })
  const app = await startCraftHubServer({ runtime, port: 0 })
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${app.url}/api/software-favorites`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  try {
    const project = await runtime.addProject(root)
    const original = await runtime.settings.get()
    const home = { tools: [], pinnedProjectIds: [project.id], workItems: { groupByList: false, density: 'compact', showEmptyLists: true } }
    const seeded = await runtime.settings.update({ 'workbench.home': home }, original.revision)
    const catalog = await runtime.softwareCatalogSnapshot()
    expect(catalog.favorites).toMatchObject({ revision: seeded.revision, tools: [], matches: [] })
    expect((await runtime.settings.get()).revision).toBe(seeded.revision)
    const input = { action: 'add', sourceId: source.id, softwareId: item.id, revision: seeded.revision, locale: 'zh-CN' }
    const rejectedHeaders: Record<string, string>[] = [{ origin: 'https://unrelated.example' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]
    for (const headers of rejectedHeaders) expect((await post(input, headers)).status).toBe(403)
    expect((await post({ ...input, launch: { application: 'arbitrary' } })).status).toBe(400)
    expect((await post({ ...input, softwareId: 'missing' })).status).toBe(404)
    const response = await post(input)
    expect(response.status).toBe(200)
    const favorite = await response.json()
    expect(favorite.tools).toHaveLength(1)
    expect(favorite.matches).toContainEqual({ sourceId: source.id, softwareId: item.id, toolId: favorite.tools[0].id })
    expect((await runtime.settings.get()).settings['workbench.home']).toMatchObject({ pinnedProjectIds: [project.id], workItems: home.workItems })
    expect((await post(input)).status).toBe(409)
    const duplicate = await (await post({ ...input, revision: favorite.revision })).json()
    expect(duplicate.tools).toHaveLength(1)
    expect((await post({ action: 'remove', toolId: favorite.tools[0].id, revision: seeded.revision })).status).toBe(409)
    const removed = await post({ action: 'remove', toolId: favorite.tools[0].id, revision: duplicate.revision })
    expect(removed.status).toBe(200)
    expect((await removed.json()).tools).toEqual([])
    expect((await runtime.settings.get()).settings['workbench.home']).toEqual(home)
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
    expect(read).toHaveBeenCalled()
  }
  finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('limits favorites to 100 and rejects hosted writes without changing settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-favorite-limit-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', softwareCatalogProviders: [{ ...source, read: async () => ({ version: 1, source, items: [item] }) }] }] })
  const hosted = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted'), configDir: join(root, 'hosted-config') })
  try {
    const initial = await runtime.settings.get()
    const full = await runtime.settings.update({ 'workbench.home': { tools: Array.from({ length: 100 }, (_, index) => ({ id: `fixture-${index}`, title: 'Fixture', group: 'Tools', url: `https://example.com/${index}` })) } }, initial.revision)
    await expect(runtime.updateSoftwareFavorite({ action: 'add', sourceId: source.id, softwareId: item.id, revision: full.revision, locale: 'en' })).rejects.toThrow()
    expect((await runtime.settings.get()).revision).toBe(full.revision)
    const hostSettings = await hosted.settings.get()
    await expect(hosted.updateSoftwareFavorite({ action: 'remove', toolId: 'missing', revision: hostSettings.revision })).rejects.toMatchObject({ status: 403 })
    expect((await hosted.settings.get()).revision).toBe(hostSettings.revision)
  }
  finally {
    await Promise.all([runtime.close(), hosted.close()])
    await rm(root, { recursive: true, force: true })
  }
})

it('edits and reorders custom shortcuts without discovery, preserves home preferences and rejects unsafe or stale drafts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-tools-editor-'))
  const read = vi.fn(async () => ({ version: 1 as const, source, items: [item] }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', softwareCatalogProviders: [{ ...source, read }] }] })
  const app = await startCraftHubServer({ runtime, port: 0 })
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${app.url}/api/software-favorites`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  try {
    const project = await runtime.addProject(root)
    const original = await runtime.settings.get()
    const home = { ...original.settings['workbench.home'], pinnedProjectIds: [project.id], workItems: { groupByList: false, density: 'compact' as const, showEmptyLists: true } }
    const seeded = await runtime.settings.update({ 'workbench.home': home }, original.revision)
    const metadata = await (await fetch(`${app.url}/api/software?discovery=none`)).json()
    expect(metadata.favorites.revision).toBe(seeded.revision)
    expect(read).not.toHaveBeenCalled()
    const tools = [
      { id: 'command', title: 'Command', group: 'Work tools', url: 'https://example.com/', launch: { application: 'raycast', commandUrl: 'raycast://extensions/owner/extension/command' }, iconUrl: 'https://example.com/icon.png', macosIconUrl: 'https://example.com/mac.png', iconStyle: 'rounded', iconScale: 1.2 },
      { id: 'website', title: 'Website', group: 'AI Tools', url: 'https://example.org/', downloadUrl: 'https://example.org/download', repositoryUrl: 'https://example.org/source' },
    ]
    const input = { action: 'replace', revision: seeded.revision, tools }
    expect((await post(input, { origin: 'https://unrelated.example' })).status).toBe(403)
    const invalidTools = [
      [{ ...tools[0], url: 'file:///tmp/tool' }],
      [{ ...tools[0], url: 'https://user:password@example.com' }],
      [{ ...tools[0], launch: { application: 'arbitrary' } }],
      [{ ...tools[0], launch: { application: 'raycast', commandUrl: 'raycast://extensions/owner/extension/command?args=unreviewed' } }],
      [{ ...tools[0], launch: { application: 'orca', command: '/bin/sh' } }],
      [tools[0], tools[0]],
      Array.from({ length: 101 }, (_, index) => ({ ...tools[1], id: String(index) })),
    ]
    for (const tools of invalidTools) expect((await post({ ...input, tools })).status).toBe(400)
    expect((await runtime.settings.get()).revision).toBe(seeded.revision)
    const response = await post(input)
    expect(response.status).toBe(200)
    const saved = await response.json()
    expect(saved.tools).toEqual(tools)
    expect((await post(input)).status).toBe(409)
    const reordered = await post({ ...input, revision: saved.revision, tools: [...tools].reverse() })
    expect(reordered.status).toBe(200)
    const latest = await reordered.json()
    expect(latest.tools.map((tool: { id: string }) => tool.id)).toEqual(['website', 'command'])
    // A batch larger than the old 4 KiB request limit still accepts all 100 valid shortcuts.
    const full = Array.from({ length: 100 }, (_, index) => ({ ...tools[1], id: `tool-${index}` }))
    const fullResponse = await post({ ...input, revision: latest.revision, tools: full })
    expect(fullResponse.status).toBe(200)
    const cleared = await post({ ...input, revision: (await fullResponse.json()).revision, tools: [] })
    expect(cleared.status).toBe(200)
    expect((await runtime.settings.get()).settings['workbench.home']).toEqual({ ...home, tools: [] })
    expect(read).not.toHaveBeenCalled()
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
