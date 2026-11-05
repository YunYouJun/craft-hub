import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanProjectSpace } from '../src/project-space'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, opendir: vi.fn(actual.opendir) }
})

const roots: string[] = []
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'craft-hub-space-')))
  roots.push(root)
  const path = join(root, 'project')
  await fs.mkdir(path)
  return { id: 'fixture', path, root }
}
async function file(root: string, path: string, content: string) {
  const parts = path.split('/')
  await fs.mkdir(join(root, ...parts.slice(0, -1)), { recursive: true })
  await fs.writeFile(join(root, path), content)
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('project-local space analysis', () => {
  it('accounts for nested packages once, classifies by the outermost recognized directory and preserves files', async () => {
    const project = await fixture()
    const files = {
      'src/main.ts': 'source',
      'apps/web/node_modules/a/dist/index.js': 'dependency',
      'apps/web/dist/index.js': 'output',
      '.turbo/cache': 'cache',
      '.git/objects/object': 'git',
    }
    for (const [path, content] of Object.entries(files))
      await file(project.path, path, content)
    const snapshot = await scanProjectSpace(project)
    expect(snapshot.status).toBe('complete')
    expect(snapshot.fileCount).toBe(5)
    expect(snapshot.totalBytes).toBe(30)
    expect(Object.fromEntries(snapshot.categories.map(item => [item.category, item.bytes]))).toEqual({ dependencies: 10, build: 6, cache: 5, git: 3, other: 6 })
    expect(snapshot.entries.find(entry => entry.path === 'apps')).toMatchObject({ bytes: 16, fileCount: 2, incomplete: false })
    expect(snapshot.categories.reduce((sum, category) => sum + category.bytes, 0)).toBe(snapshot.totalBytes)
    expect(snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0)).toBe(snapshot.totalBytes)
    for (const [path, content] of Object.entries(files))
      expect(await fs.readFile(join(project.path, path), 'utf8')).toBe(content)
  })

  it('does not follow internal, external or cyclic links and counts hard-linked files once', async () => {
    const project = await fixture()
    await file(project.path, 'src/original', 'data')
    await fs.link(join(project.path, 'src/original'), join(project.path, 'src/copy'))
    await file(project.root, 'outside/secret', 'external content')
    await fs.symlink(join(project.root, 'outside'), join(project.path, 'outside-link'))
    await fs.symlink(join(project.path, 'src'), join(project.path, 'inside-link'))
    await fs.symlink(project.path, join(project.path, 'src/cycle'))
    const snapshot = await scanProjectSpace(project)
    expect(snapshot).toMatchObject({ status: 'complete', totalBytes: 4, fileCount: 1, skippedSymlinks: 3, duplicateFiles: 1 })
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('reports partial coverage on entry, time and depth limits instead of claiming an empty complete scan', async () => {
    const project = await fixture()
    await file(project.path, 'a/one', 'a')
    await file(project.path, 'b/two', 'b')
    for (const [options, reason] of [
      [{ maxEntries: 1 }, 'entry-limit'],
      [{ maxDurationMs: 0 }, 'time-limit'],
      [{ maxDepth: 0 }, 'depth-limit'],
    ] as const) {
      const snapshot = await scanProjectSpace(project, options)
      expect(snapshot.status).toBe('partial')
      expect(snapshot.issues).toContainEqual(expect.objectContaining({ reason }))
      expect(snapshot.totalBytes).toBe(0)
    }
  })

  it('keeps unreadable scope explicit and bounds both the entry list and diagnostics', async () => {
    const project = await fixture()
    for (let index = 0; index < 16; index++)
      await file(project.path, `directory-${index}/file`, 'x')
    const snapshot = await scanProjectSpace(project, { maxDepth: 0 })
    expect(snapshot.entries).toHaveLength(12)
    expect(snapshot.omittedEntries).toBe(4)
    expect(snapshot.issues).toHaveLength(12)
    expect(snapshot.omittedIssues).toBe(4)
    vi.mocked(fs.opendir).mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))
    expect(await scanProjectSpace(project)).toMatchObject({ status: 'partial', issues: [{ path: '.', reason: 'unreadable' }] })
  })

  it('rejects a registered root replaced by a link and respects cancellation before any scan', async () => {
    const project = await fixture()
    await fs.rename(project.path, join(project.root, 'moved'))
    await fs.symlink(join(project.root, 'moved'), project.path)
    await expect(scanProjectSpace(project)).rejects.toMatchObject({ status: 409 })
    const controller = new AbortController()
    controller.abort()
    await expect(scanProjectSpace(project, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
