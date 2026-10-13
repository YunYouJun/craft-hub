import type { SoftwareCatalogManifest } from '../src/software-catalog'
import type { SoftwareRepositoryReader } from '../src/software-sources'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundledSoftwareCatalog } from '../src/bundled-software-catalog'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { SoftwareCatalogService } from '../src/software-catalog'
import { parseSoftwareConfig } from '../src/software-config'
import { SoftwareSourceService } from '../src/software-sources'
import { readLocalRepositoryCatalogFile, readRepositoryCatalogFile } from '../src/workspace-repository'

const repository = 'https://github.com/example/catalog'
const catalogPath = 'software.config.ts'
const commit = 'a'.repeat(40)
function manifest(name = 'Editor') {
  const content = { version: 1 as const, source: { id: 'sample', title: 'Sample', url: repository }, items: [{ id: 'editor', title: { en: name }, group: { id: 'coding', title: { en: 'Coding' } }, url: 'https://example.com/editor', installation: { kind: 'download' as const } }] }
  return { ...content, revision: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}
function config(catalog: SoftwareCatalogManifest = manifest()) {
  const groups = catalog.items.map(item => ({ id: item.group.id, label: item.group.title, items: [{
    id: item.id,
    name: item.title,
    url: item.url,
    downloadUrl: item.downloadUrl,
    repositoryUrl: item.repositoryUrl,
    note: item.description,
    cask: item.installation.kind === 'brew-cask' ? item.installation.packageId : undefined,
    formula: item.installation.kind === 'brew-formula' ? item.installation.packageId : undefined,
  }] }))
  const merged = [...new Map(groups.map(group => [group.id, { ...group, items: groups.filter(other => other.id === group.id).flatMap(other => other.items) }])).values()]
  return `export const softwareGroups = ${JSON.stringify(merged)} as const; throw new Error('Repository TS must never be imported')`
}
let root: string
let reader: SoftwareRepositoryReader
let service: SoftwareSourceService
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'software-sources-'))
  reader = { remote: vi.fn(async () => ({ content: config(), commit })), local: vi.fn(async () => ({ content: config(manifest('Local editor')), localPath: join(root, 'checkout'), repository, commit })) }
  service = new SoftwareSourceService(join(root, 'data'), true, reader)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('software repository sources', () => {
  it('previews without saving, links online and local locations as one source and preserves the selected reading mode', async () => {
    const first = await service.preview({ repository: 'https://github.com/Example/Catalog.git', mode: 'remote' })
    expect((await service.snapshot()).sources).toEqual([])
    expect(first.source.repository).toBe(repository)
    const initial = await service.apply(first.previewId)
    const linked = await service.preview({ mode: 'local', localPath: join(root, 'checkout') })
    expect(linked.replaces).toBe(initial.sources[0]!.id)
    expect(linked.source.repository).toBe(repository)
    expect(linked.catalog.items[0]!.title.en).toBe('Local editor')
    const applied = await service.apply(linked.previewId)
    expect(applied.sources).toHaveLength(1)
    expect(applied.sources[0]).toMatchObject({ id: first.source.id, mode: 'local', repository, localPath: join(root, 'checkout') })
    vi.mocked(reader.local).mockRejectedValue(new Error('checkout temporarily disconnected'))
    const online = await service.preview({ id: first.source.id, mode: 'remote' })
    expect(online.source.localPath).toBe(join(root, 'checkout'))
    await service.apply(online.previewId)
    expect((await service.snapshot()).sources[0]!.mode).toBe('remote')
  })

  it('refreshes valid data, retains cache on failures and can browse after a restart without repository IO', async () => {
    const preview = await service.preview({ repository, mode: 'remote' })
    await service.apply(preview.previewId)
    vi.mocked(reader.remote).mockResolvedValueOnce({ content: config(manifest('New editor')), commit: 'b'.repeat(40) })
    const fresh = await service.refresh(preview.source.id)
    expect(fresh.sources[0]!.cache.commit).toBe('b'.repeat(40))
    vi.mocked(reader.remote).mockRejectedValue(new Error('private credential diagnostic'))
    const failed = await service.refresh(preview.source.id)
    expect(failed.sources[0]!.cache).toEqual(fresh.sources[0]!.cache)
    expect(failed.sources[0]!.error).toBe('unavailable')
    const restarted = new SoftwareSourceService(join(root, 'data'), true, reader)
    expect((await restarted.catalogs())[0]!.catalog.items[0]!.title.en).toBe('New editor')
    expect(await restarted.snapshot()).toEqual(failed)
    expect(reader.remote).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(failed)).not.toContain('credential')
  })

  it('rejects mismatched local origin, stale previews, arbitrary browser contents and unsafe URLs', async () => {
    await expect(service.preview({ mode: 'local', localPath: join(root, 'checkout'), repository: 'https://github.com/another/repo' })).rejects.toMatchObject({ status: 409 })
    for (const url of ['file:///tmp/repo', 'https://user:token@example.com/repo', 'https://example.com/repo?token=secret'])
      await expect(service.preview({ mode: 'remote', repository: url })).rejects.toThrow()
    const a = await service.preview({ repository, mode: 'remote' })
    const b = await service.preview({ repository, mode: 'remote' })
    await service.apply(a.previewId)
    await expect(service.apply(b.previewId)).rejects.toMatchObject({ status: 409 })
    await expect(service.apply(a.previewId)).rejects.toMatchObject({ status: 409 })
    await expect(service.preview({ repository, mode: 'remote', catalogPath: '../private.json' })).rejects.toThrow()
    vi.mocked(reader.remote).mockResolvedValueOnce({ content: 'export const softwareGroups = readFromNetwork()', commit })
    await expect(service.preview({ repository, mode: 'remote' })).rejects.toMatchObject({ status: 503 })
    expect((await service.snapshot()).sources).toHaveLength(1)
  })

  it('keeps third-party catalog IDs from impersonating builtin management and removes only subscribed metadata', async () => {
    vi.mocked(reader.remote).mockResolvedValue({ content: config(bundledSoftwareCatalog), commit })
    const foreign = await service.preview({ repository, mode: 'remote' })
    await service.apply(foreign.previewId)
    const catalogs = new SoftwareCatalogService([], [bundledSoftwareCatalog])
    const snapshot = await catalogs.snapshot({ repositories: await service.catalogs() })
    expect(snapshot.sources).toHaveLength(2)
    expect(snapshot.sources[1]!.id).toBe(`repository-${foreign.source.id}`)
    expect(snapshot.sources[1]!.canManage).not.toBe(true)
    const state = await service.snapshot()
    await service.remove(foreign.source.id, state.revision)
    expect((await catalogs.snapshot({ repositories: await service.catalogs() })).sources).toHaveLength(1)
  })

  it('merges the canonical Workstation source with builtin data and overlays only plugin observations', async () => {
    const manifest = structuredClone(bundledSoftwareCatalog)
    manifest.items[0]!.title.en = 'Reviewed local title'
    const { version, source, items } = manifest
    manifest.revision = createHash('sha256').update(JSON.stringify({ version, source, items })).digest('hex')
    vi.mocked(reader.remote).mockResolvedValue({ content: config(manifest), commit })
    const preview = await service.preview({ repository: manifest.source.url!, mode: 'remote' })
    await service.apply(preview.previewId)
    const read = vi.fn(async () => ({ version: 1 as const, source, items: [{ ...bundledSoftwareCatalog.items[0]!, status: 'detected' as const, canOpen: true }] }))
    const catalogs = new SoftwareCatalogService([{ ...source, url: source.url!, read }], [bundledSoftwareCatalog])
    const snapshot = await catalogs.snapshot({ repositories: await service.catalogs() })
    expect(snapshot.sources).toHaveLength(1)
    expect(snapshot.sources[0]!.items[0]).toMatchObject({ title: { en: 'Reviewed local title' }, status: 'detected' })
    read.mockRejectedValueOnce(new Error('plugin missing'))
    const fallback = await catalogs.snapshot({ repositories: await service.catalogs() })
    expect(fallback.sources[0]!.items[0]).toMatchObject({ status: 'unknown', canOpen: false, iconUrl: bundledSoftwareCatalog.items[0]!.iconUrl })
  })

  it('keeps hosted sources online-only and never invokes a local reader', async () => {
    const hosted = new SoftwareSourceService(join(root, 'hosted'), false, reader)
    await expect(hosted.preview({ mode: 'local', localPath: root })).rejects.toMatchObject({ status: 403 })
    await expect(hosted.preview({ mode: 'remote', repository, localPath: root })).rejects.toMatchObject({ status: 403 })
    const preview = await hosted.preview({ mode: 'remote', repository })
    const state = await hosted.apply(preview.previewId)
    expect(state.localAvailable).toBe(false)
    expect(reader.local).not.toHaveBeenCalled()
    expect((await hosted.catalogs())[0]!.catalog.items[0]!.id).toBe('editor')
  })

  it('serializes competing processes and preserves a readable cache if persistence is corrupted', async () => {
    const second = new SoftwareSourceService(join(root, 'data'), true, reader)
    const [a, b] = await Promise.all([service.preview({ repository, mode: 'remote' }), second.preview({ repository, mode: 'remote' })])
    const results = await Promise.allSettled([service.apply(a.previewId), second.apply(b.previewId)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect((await service.snapshot()).sources).toHaveLength(1)
    await writeFile(join(root, 'data/software-sources.v1.json'), '{broken')
    await expect(service.snapshot()).rejects.toMatchObject({ status: 503 })
    expect(await service.catalogs()).toEqual([])
  })

  it('changes an existing legacy path through preview without losing bindings, cache or identity', async () => {
    const preview = await service.preview({ mode: 'local', localPath: join(root, 'checkout') })
    await service.apply(preview.previewId)
    const path = join(root, 'data/software-sources.v1.json')
    const legacy = JSON.parse(await readFile(path, 'utf8'))
    legacy.sources[0].catalogPath = '.craft-hub/software-catalog.v1.json'
    await writeFile(path, JSON.stringify(legacy))
    expect((await service.catalogs())[0]!.catalog.items).toHaveLength(1)
    const migrated = await service.preview({ id: preview.source.id, mode: 'remote', catalogPath: 'software.config.ts' })
    expect(migrated.replaces).toBe(preview.source.id)
    expect((await service.snapshot()).sources[0]!.catalogPath).toBe('.craft-hub/software-catalog.v1.json')
    const saved = await service.apply(migrated.previewId)
    expect(saved.sources).toHaveLength(1)
    expect(saved.sources[0]).toMatchObject({ id: preview.source.id, catalogPath: 'software.config.ts', repository, localPath: join(root, 'checkout') })
  })

  it('supports a local-only repository without a fabricated source website', async () => {
    vi.mocked(reader.local).mockResolvedValue({ content: config(), localPath: join(root, 'checkout') })
    const preview = await service.preview({ mode: 'local', localPath: join(root, 'checkout') })
    expect(preview.source.repository).toBeUndefined()
    expect(preview.catalog.source.url).toBeUndefined()
    await service.apply(preview.previewId)
    expect((await service.catalogs())[0]!.catalog.items).toHaveLength(1)
  })

  it('recovers a source lock left by an exited process', async () => {
    const preview = await service.preview({ repository, mode: 'remote' })
    await mkdir(join(root, 'data'), { recursive: true })
    await writeFile(join(root, 'data/software-sources.v1.json.lock'), '99999999')
    expect((await service.apply(preview.previewId)).sources).toHaveLength(1)
  })
})

describe('local catalog IO and HTTP workflow', () => {
  async function checkout() {
    const path = join(root, 'checkout')
    await mkdir(join(path, '.craft-hub'), { recursive: true })
    execFileSync('git', ['init', '--quiet', path])
    execFileSync('git', ['-C', path, 'remote', 'add', 'origin', 'git@github.com:example/catalog.git'])
    await writeFile(join(path, catalogPath), config())
    return path
  }

  it('reads uncommitted TypeScript without touching the checkout and rejects symlinks, escapes and non-Git paths', async () => {
    const path = await checkout()
    const read = await readLocalRepositoryCatalogFile(path, catalogPath)
    expect(read.repository).toBe(repository)
    expect(read.content).toBe(config())
    await writeFile(join(path, catalogPath), config(manifest('Uncommitted')))
    expect(parseSoftwareConfig((await readLocalRepositoryCatalogFile(path, catalogPath)).content, manifest().source).items[0]!.title.en).toBe('Uncommitted')
    await expect(readLocalRepositoryCatalogFile(path, '../secret.json')).rejects.toThrow()
    await expect(readLocalRepositoryCatalogFile(root, catalogPath)).rejects.toThrow()
    await rm(join(path, catalogPath))
    await writeFile(join(root, 'outside.ts'), config())
    await symlink(join(root, 'outside.ts'), join(path, catalogPath))
    await expect(readLocalRepositoryCatalogFile(path, catalogPath)).rejects.toThrow()
  })

  it('rejects unsafe remote protocols and branch selectors before contacting Git', async () => {
    for (const [url, branch, path] of [['file:///tmp/repo', 'main', catalogPath], [repository, '--upload-pack=anything', catalogPath], [repository, 'main', '../private.json']])
      await expect(readRepositoryCatalogFile(url!, branch!, path!)).rejects.toThrow()
  })

  it('previews, applies, refreshes and removes through guarded HTTP without granting project trust', async () => {
    const path = await checkout()
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'runtime'), configDir: join(root, 'config') })
    const app = await startCraftHubServer({ runtime, port: 0 })
    const post = (body: unknown, headers = {}) => fetch(`${app.url}/api/software-sources`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    try {
      const project = await runtime.addProject(path)
      expect((await post({ operation: 'preview', input: { mode: 'local', localPath: path } }, { origin: 'https://other.example.com' })).status).toBe(403)
      expect((await post({ operation: 'preview', input: { mode: 'local', localPath: path, command: 'anything' } })).status).toBe(400)
      const preview = await (await post({ operation: 'preview', input: { mode: 'local', localPath: path } })).json()
      expect((await runtime.softwareSources.snapshot()).sources).toHaveLength(0)
      const applied = await (await post({ operation: 'apply', previewId: preview.previewId })).json()
      expect(applied.sources).toHaveLength(1)
      expect((await runtime.softwareCatalogSnapshot()).sources).toHaveLength(2)
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      await rm(join(path, catalogPath))
      const failed = await (await post({ operation: 'refresh', id: applied.sources[0].id })).json()
      expect(failed.sources[0].error).toBe('unavailable')
      expect((await post({ operation: 'remove', id: applied.sources[0].id, revision: failed.revision })).status).toBe(200)
      expect((await runtime.softwareCatalogSnapshot()).sources).toHaveLength(1)
      expect(execFileSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('')
    }
    finally { await app.close() }
  })
})
