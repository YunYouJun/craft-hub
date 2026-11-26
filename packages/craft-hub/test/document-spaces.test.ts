import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  computeDocumentRevision,
  DocumentSpaceError,
  DocumentSpaceService,
  LocalDocumentSpaceStore,
  LocalFilesystemDocumentSpaceProvider,
  normalizeDocumentPath,
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from '../src/document-spaces'

const tempDirs: string[] = []
const services: DocumentSpaceService[] = []
const providers: LocalFilesystemDocumentSpaceProvider[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(service => service.close()))
  await Promise.allSettled(providers.splice(0).map(provider => provider.close()))
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('document spaces', () => {
  it('normalizes relative POSIX paths and rejects traversal and hidden system directories', () => {
    expect(normalizeDocumentPath('notes\\daily\\2026-11-27.md')).toBe('notes/daily/2026-11-27.md')
    expect(normalizeDocumentPath('', { allowEmpty: true })).toBe('')
    expect(() => normalizeDocumentPath('')).toThrow(DocumentSpaceError)
    expect(() => normalizeDocumentPath('/etc/passwd')).toThrow(/relative/)
    expect(() => normalizeDocumentPath('C:\\Users\\demo\\doc.md')).toThrow(/relative/)
    expect(() => normalizeDocumentPath('../secret.md')).toThrow(/Invalid/)
    expect(() => normalizeDocumentPath('notes/../secret.md')).toThrow(/Invalid/)
    expect(() => normalizeDocumentPath('.git/config')).toThrow(/forbidden/)
    expect(() => normalizeDocumentPath('sub/node_modules/pkg.md')).toThrow(/forbidden/)
  })

  it('round-trips Markdown and YAML frontmatter cleanly', () => {
    const frontmatter = { title: '创作笔记', tags: ['draft', 'video'], count: 3, pinned: true }
    const body = '# 标题\n\n正文段落。\n\n> [!NOTE]\n> 提示卡片\n'
    const serialized = serializeMarkdownDocument(body, frontmatter)
    expect(parseMarkdownDocument(serialized)).toEqual({ frontmatter, markdown: body })

    expect(parseMarkdownDocument('# Plain\n\nNo frontmatter')).toEqual({
      frontmatter: {},
      markdown: '# Plain\n\nNo frontmatter',
    })
    expect(serializeMarkdownDocument('# Plain', {})).toBe('# Plain')
    expect(parseMarkdownDocument('---\r\ntitle: CRLF\r\n---\r\n\r\nBody\r\n')).toEqual({
      frontmatter: { title: 'CRLF' },
      markdown: 'Body\r\n',
    })
  })

  it('registers local spaces, discovers folder bundles and inline cards, and preserves files on unregister', async () => {
    const dataDir = await createTempDir('craft-hub-ds-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-root-')

    await mkdir(join(spaceRoot, 'campaigns', 'launch'), { recursive: true })
    await mkdir(join(spaceRoot, 'notes'), { recursive: true })
    await writeFile(join(spaceRoot, 'campaigns', 'launch', 'brief.md'), '---\ntitle: Launch Brief\nstatus: active\nicon: rocket\n---\n\nMain campaign plan.\n\n::card[../../notes/ideas.md "Extra Ideas"]\n', 'utf8')
    await writeFile(join(spaceRoot, 'campaigns', 'launch', 'script.md'), '# Narration Script\n\nHello world.\n', 'utf8')
    await writeFile(join(spaceRoot, 'notes', 'ideas.md'), '---\nsummary: Fresh brainstorm notes\n---\n\n# Ideas\n', 'utf8')

    const service = new DocumentSpaceService(dataDir)
    services.push(service)
    const added = await service.addLocalSpace({ path: spaceRoot, title: 'Studio Docs' })
    expect(added.title).toBe('Studio Docs')
    expect(added.kind).toBe('local')

    const topNodes = await service.listNodes(added.id)
    expect(topNodes.map(node => ({ path: node.path, kind: node.kind }))).toEqual([
      { path: 'campaigns', kind: 'folder' },
      { path: 'notes', kind: 'folder' },
    ])

    const campaignNodes = await service.listNodes(added.id, 'campaigns')
    expect(campaignNodes).toHaveLength(1)
    expect(campaignNodes[0]).toMatchObject({
      path: 'campaigns/launch',
      kind: 'bundle',
      title: 'Launch Brief',
      status: 'active',
      icon: 'rocket',
      primaryDocumentPath: 'campaigns/launch/brief.md',
      childCount: 1,
    })

    const brief = await service.readDocument(added.id, 'campaigns/launch')
    expect(brief.path).toBe('campaigns/launch/brief.md')
    expect(brief.title).toBe('Launch Brief')
    expect(brief.cards.map(card => ({ path: card.path, title: card.title }))).toEqual([
      { path: 'campaigns/launch/script.md', title: 'Narration Script' },
      { path: 'notes/ideas.md', title: 'Extra Ideas' },
    ])
    expect(brief.breadcrumbs).toEqual([
      { path: 'campaigns', title: 'campaigns' },
      { path: 'campaigns/launch/brief.md', title: 'Launch Brief' },
    ])

    await service.removeLocalSpace(added.id)
    expect(await service.listSpaces()).toEqual([])
    expect(await readFile(join(spaceRoot, 'notes', 'ideas.md'), 'utf8')).toContain('# Ideas')
  })

  it('enforces optimistic revision checks and returns current disk content on conflict', async () => {
    const dataDir = await createTempDir('craft-hub-ds-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-root-')
    await writeFile(join(spaceRoot, 'draft.md'), '# Initial\n', 'utf8')

    const service = new DocumentSpaceService(dataDir)
    services.push(service)
    const space = await service.addLocalSpace({ path: spaceRoot })

    const loaded = await service.readDocument(space.id, 'draft.md')
    expect(loaded.revision).toBe(computeDocumentRevision('# Initial\n'))

    await writeFile(join(spaceRoot, 'draft.md'), '# External Edit\n', 'utf8')
    const conflictResult = await service.writeDocument(space.id, 'draft.md', {
      markdown: '# Stale Desktop Edit\n',
      expectedRevision: loaded.revision,
    })
    expect(conflictResult.status).toBe('conflict')
    if (conflictResult.status === 'conflict')
      expect(conflictResult.current.markdown).toBe('# External Edit\n')

    expect(await readFile(join(spaceRoot, 'draft.md'), 'utf8')).toBe('# External Edit\n')

    const savedResult = await service.writeDocument(space.id, 'draft.md', {
      markdown: '# Merged Edit\n',
      frontmatter: { title: 'Merged' },
      expectedRevision: conflictResult.status === 'conflict' ? conflictResult.current.revision : undefined,
    })
    expect(savedResult.status).toBe('saved')
    if (savedResult.status === 'saved')
      expect(savedResult.document.title).toBe('Merged')
  })

  it('creates documents, folder bundles, daily notes, moves, and deletes safely', async () => {
    const dataDir = await createTempDir('craft-hub-ds-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-root-')

    const service = new DocumentSpaceService(dataDir)
    services.push(service)
    const space = await service.addLocalSpace({ path: spaceRoot })

    const doc = await service.createDocument(space.id, { name: 'scratch', title: 'Scratchpad' })
    expect(doc.path).toBe('scratch.md')
    expect(doc.title).toBe('Scratchpad')

    await expect(service.createDocument(space.id, { name: 'scratch' })).rejects.toMatchObject({ status: 409 })

    const bundle = await service.createDocument(space.id, { name: 'episode-01', kind: 'bundle', title: 'Episode 01' })
    expect(bundle.path).toBe('episode-01/index.md')

    const moved = await service.moveDocument(space.id, { fromPath: 'scratch.md', toPath: 'episode-01/notes.md' })
    expect(moved.path).toBe('episode-01/notes.md')

    const daily1 = await service.openOrCreateDailyNote(space.id, '2026-11-27')
    expect(daily1.path).toBe('daily/2026-11-27.md')
    await service.writeDocument(space.id, daily1.path, {
      markdown: '# 2026-11-27\n\nKeep me.\n',
      frontmatter: daily1.frontmatter,
      expectedRevision: daily1.revision,
    })
    const daily2 = await service.openOrCreateDailyNote(space.id, '2026-11-27')
    expect(daily2.markdown).toContain('Keep me.')

    await service.deleteDocument(space.id, 'episode-01/notes.md')
    await expect(service.readDocument(space.id, 'episode-01/notes.md')).rejects.toMatchObject({ status: 404 })
  })

  it('resolves safe assets, blocks symlink escapes, and enforces hosted restrictions', async () => {
    const dataDir = await createTempDir('craft-hub-ds-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-root-')
    const outsideDir = await createTempDir('craft-hub-ds-outside-')

    await writeFile(join(spaceRoot, 'cover.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47]))
    await writeFile(join(spaceRoot, 'secret.txt'), 'not an asset', 'utf8')
    await writeFile(join(outsideDir, 'escape.md'), '# Secret', 'utf8')
    if (process.platform !== 'win32')
      await symlink(join(outsideDir, 'escape.md'), join(spaceRoot, 'linked.md'), 'file')

    const localService = new DocumentSpaceService(dataDir, [], true)
    services.push(localService)
    const space = await localService.addLocalSpace({ path: spaceRoot })

    const asset = await localService.resolveAsset(space.id, 'cover.png')
    expect(asset).toMatchObject({ mimeType: 'image/png', filename: 'cover.png' })
    await expect(localService.resolveAsset(space.id, 'secret.txt')).rejects.toMatchObject({ status: 403 })
    if (process.platform !== 'win32')
      await expect(localService.readDocument(space.id, 'linked.md')).rejects.toMatchObject({ status: 403 })

    const hostedService = new DocumentSpaceService(dataDir, [], false)
    services.push(hostedService)
    await expect(hostedService.addLocalSpace({ path: spaceRoot })).rejects.toMatchObject({ status: 403 })
    await expect(hostedService.removeLocalSpace(space.id)).rejects.toMatchObject({ status: 403 })
  })

  it('emits coalesced change events when external files change', async () => {
    const dataDir = await createTempDir('craft-hub-ds-data-')
    const spaceRoot = await createTempDir('craft-hub-ds-root-')
    await writeFile(join(spaceRoot, 'watch.md'), '# Before\n', 'utf8')

    const store = new LocalDocumentSpaceStore(dataDir)
    const provider = new LocalFilesystemDocumentSpaceProvider(store, 50)
    providers.push(provider)
    const space = await provider.addSpace({ path: spaceRoot })

    const seen: string[][] = []
    const unsubscribe = provider.subscribe((event) => {
      if (event.spaceId === space.id)
        seen.push(event.paths)
    })

    await writeFile(join(spaceRoot, 'watch.md'), '# After\n', 'utf8')
    await new Promise<void>((resolveWait, rejectWait) => {
      const deadline = setTimeout(() => rejectWait(new Error('Timed out waiting for watcher event')), 5000)
      const poll = setInterval(() => {
        if (seen.some(paths => paths.includes('watch.md'))) {
          clearInterval(poll)
          clearTimeout(deadline)
          resolveWait()
        }
      }, 25)
    })
    unsubscribe()
    expect(seen.flat()).toContain('watch.md')
  })
})
