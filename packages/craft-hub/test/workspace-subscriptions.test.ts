import type { WorkspaceRepositoryProvider } from '../src/workspace-repository'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { parseWorkspaceRepositoryUrl, readWorkspaceGitTree } from '../src/workspace-repository'
import { readWorkspaceSource } from '../src/workspace-source'

const roots: string[] = []
const url = 'https://git.example.com/team/source/tree/main/craft-hub'
const workspace = (id = 'dev', name = 'Development') => ({ schemaVersion: 1 as const, id, name, primaryProject: 'https://git.example.com/team/project', members: [{ project: 'https://git.example.com/team/project', label: 'Project' }] })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'source-subscriptions-'))
  roots.push(root)
  let source = { schemaVersion: 1, id: 'environment', name: 'Environment', workspaces: [workspace(), workspace('tools', 'Tools')] }
  let revision = 'commit-one'
  let offline = false
  const provider: WorkspaceRepositoryProvider = {
    id: 'test-git',
    name: 'Test Git',
    accepts: value => value.startsWith('https://git.example.com/'),
    read: async (value) => {
      if (offline)
        throw new Error('Offline')
      return { ...parseWorkspaceRepositoryUrl(value), revision, files: { 'source.jsonc': JSON.stringify(source) } }
    },
  }
  const options = { dataDir: join(root, 'data'), configDir: join(root, 'config'), workspaceRepositoryProviders: [provider], publicWorkspaceRepositories: false }
  const runtime = new CraftHubRuntime(options)
  return { root, runtime, options, change: (workspaces: ReturnType<typeof workspace>[]) => {
    source = { ...source, workspaces }
    revision = 'commit-two'
  }, offline: () => { offline = true } }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('workspace source subscriptions', () => {
  it('saves named sources without applying them, previews selected workspaces and preserves local trust', async () => {
    const { root, runtime } = await setup()
    const project = await runtime.projects.add(root)
    const saved = await runtime.workspaceSubscriptions.configure({ url, name: 'My environment' })
    expect(await runtime.workspaces.list()).toEqual([])
    expect(saved.name).toBe('My environment')
    await expect(runtime.workspaceSubscriptions.configure({ id: saved.id, url, name: 'Changed', expectedSourceRevision: 'stale' })).rejects.toMatchObject({ status: 409 })
    const preview = await runtime.workspaceSubscriptions.preview(undefined, saved.id)
    expect(preview.workspaces).toHaveLength(2)
    await runtime.workspaceSubscriptions.apply({ id: saved.id, expectedRevision: preview.revision, selectedWorkspaceIds: ['tools'] })
    const workspaces = await runtime.workspaces.list()
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]?.name).toBe('Tools')
    expect(workspaces[0]?.subscription?.id).toBe(saved.id)
    expect(await runtime.projects.list()).toEqual([project])
    expect(project.trust).toBe('untrusted')
    expect((await runtime.workspaces.portableSnapshot()).workspaces).toEqual([])
  })

  it('isolates same-named workspaces across sources and rejects stale remote and local revisions', async () => {
    const { runtime, change } = await setup()
    const first = await runtime.workspaceSubscriptions.preview(url)
    change([workspace('dev', 'Changed')])
    await expect(runtime.workspaceSubscriptions.apply({ url, expectedRevision: first.revision })).rejects.toMatchObject({ status: 409 })
    expect(await runtime.workspaces.list()).toEqual([])
    const current = await runtime.workspaceSubscriptions.preview(url)
    await runtime.workspaceSubscriptions.apply({ url, expectedRevision: current.revision })
    const secondUrl = url.replace('/source/', '/other/')
    const second = await runtime.workspaceSubscriptions.preview(secondUrl)
    const stale = await runtime.workspaceSubscriptions.preview(url)
    await runtime.workspaceSubscriptions.apply({ url: secondUrl, expectedRevision: second.revision })
    await expect(runtime.workspaceSubscriptions.apply({ url, expectedRevision: stale.revision })).rejects.toMatchObject({ status: 409 })
    const workspaces = await runtime.workspaces.list()
    expect(workspaces).toHaveLength(2)
    expect(new Set(workspaces.map(item => item.id)).size).toBe(2)
  })

  it('keeps the applied snapshot across restarts and offline errors; copies are editable and survive unsubscribe', async () => {
    const { runtime, options, offline, change } = await setup()
    const preview = await runtime.workspaceSubscriptions.preview(url)
    await runtime.workspaceSubscriptions.apply({ url, expectedRevision: preview.revision })
    const id = preview.subscription.id
    const original = (await runtime.workspaces.list())[0]!
    await expect(runtime.workspaces.delete(original.id, original.revision)).rejects.toMatchObject({ status: 409 })
    await expect(runtime.workspaces.save({ manifest: { ...workspace(), id: original.id }, revision: original.revision })).rejects.toMatchObject({ status: 409 })
    const copy = await runtime.workspaceSubscriptions.copy(id, 'dev')
    await runtime.workspaces.save({ manifest: { ...workspace(), id: copy.id, name: 'My edit' }, revision: copy.revision })
    change([workspace('dev', 'Updated')])
    const update = await runtime.workspaceSubscriptions.preview(undefined, id)
    expect(update.removedWorkspaceIds).toEqual(['tools'])
    await runtime.workspaceSubscriptions.apply({ id, expectedRevision: update.revision })
    offline()
    const restored = new CraftHubRuntime(options)
    await expect(restored.workspaceSubscriptions.preview(undefined, id)).rejects.toThrow('Offline')
    expect((await restored.workspaceSubscriptions.export(id)).snapshot.workspaces[0]?.name).toBe('Updated')
    expect((await restored.workspaces.list()).map(item => item.name)).toEqual(expect.arrayContaining(['Updated', 'My edit']))
    await restored.workspaceSubscriptions.remove(id)
    expect((await restored.workspaces.list()).map(item => item.name)).toEqual(['My edit'])
  })

  it('rejects concurrent runtime writes and permits an explicitly empty upstream source', async () => {
    const { runtime, options, change } = await setup()
    const preview = await runtime.workspaceSubscriptions.preview(url)
    const other = new CraftHubRuntime(options)
    const results = await Promise.allSettled([runtime, other].map(item => item.workspaceSubscriptions.apply({ url, expectedRevision: preview.revision })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await runtime.workspaceSubscriptions.list()).toHaveLength(1)
    change([])
    const removed = await runtime.workspaceSubscriptions.preview(url)
    expect(removed.removedWorkspaceIds).toEqual(['dev', 'tools'])
    await runtime.workspaceSubscriptions.apply({ url, expectedRevision: removed.revision, selectedWorkspaceIds: [] })
    expect(await runtime.workspaces.list()).toEqual([])
  })

  it('resolves existing repository identities without granting trust and rejects mismatched directories', async () => {
    const { root, runtime } = await setup()
    const execute = promisify(execFile)
    await execute('git', ['-C', root, 'init', '--quiet'])
    await execute('git', ['-C', root, 'remote', 'add', 'origin', 'https://git.example.com/team/project.git'])
    const project = await runtime.projects.add(root)
    const preview = await runtime.workspaceSubscriptions.preview(url)
    await runtime.workspaceSubscriptions.apply({ url, expectedRevision: preview.revision, selectedWorkspaceIds: ['dev'] })
    const [subscribed] = await runtime.workspaces.list()
    expect(subscribed!.members[0]?.projectId).toBe(project.id)
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    await expect(runtime.workspaces.bind('https://git.example.com/team/different', project.id)).rejects.toThrow('does not match')
    const copy = await runtime.workspaceSubscriptions.copy(preview.subscription.id, 'dev')
    expect(copy.members[0]?.projectId).toBe(project.id)
  })

  it('rejects a local file collision before changing the applied snapshot', async () => {
    const { root, runtime, change } = await setup()
    const preview = await runtime.workspaceSubscriptions.preview(url)
    await runtime.workspaceSubscriptions.apply({ url, expectedRevision: preview.revision })
    const [projected] = await runtime.workspaces.list()
    const conflictPath = join(root, 'config', 'workspaces', `${projected!.id}.jsonc`)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'config', 'workspaces'), { recursive: true })
    await writeFile(conflictPath, JSON.stringify({ ...workspace(), id: projected!.id, name: 'Local file edit' }))
    change([workspace('dev', 'Incoming')])
    const update = await runtime.workspaceSubscriptions.preview(url)
    await expect(runtime.workspaceSubscriptions.apply({ url, expectedRevision: update.revision })).rejects.toMatchObject({ status: 409 })
    expect(await readFile(conflictPath, 'utf8')).toContain('Local file edit')
    expect((await runtime.workspaceSubscriptions.export(preview.subscription.id)).lastRevision).toBe('commit-one')
  })
})

describe('repository configuration reading', () => {
  it('parses branch paths and rejects unsafe URL input and credential-bearing documents', () => {
    expect(parseWorkspaceRepositoryUrl(url.replace('/tree/', '/-/tree/')).repository).toBe('https://git.example.com/team/source')
    expect(parseWorkspaceRepositoryUrl(url.replace('/main/', '/feature/topic/')).branch).toBe('feature/topic')
    for (const value of ['file:///tmp/repository', url.replace('https:', 'http:'), url.replace('https://', 'https://user:secret@'), `${url}?token=secret`, url.replace('/main/', '/%2F/')])
      expect(() => parseWorkspaceRepositoryUrl(value)).toThrow()
    for (const extra of [{ trust: 'trusted' }, { ownerScopeId: 'other' }, { command: 'execute' }])
      expect(() => readWorkspaceSource({ 'dev.json': JSON.stringify({ ...workspace(), ...extra }) })).toThrow()
    expect(() => readWorkspaceSource({ 'dev.json': JSON.stringify({ ...workspace(), members: [{ project: '/tmp/private' }] }) })).toThrow()
    expect(readWorkspaceSource({ 'dev.jsonc': `// comment\n${JSON.stringify(workspace())}` }).workspaces).toHaveLength(1)
  })

  it('reads committed Git blobs without executing hooks or accepting symlink configuration', async () => {
    const { root } = await setup()
    const exec = promisify(execFile)
    const git = async (...args: string[]) => (await exec('git', ['-C', root, ...args])).stdout.trim()
    const { mkdir, symlink } = await import('node:fs/promises')
    await mkdir(join(root, 'craft-hub'))
    await git('init', '--quiet')
    await writeFile(join(root, 'craft-hub', 'dev.jsonc'), JSON.stringify(workspace()))
    await git('add', '.')
    await git('-c', 'user.name=Example', '-c', 'user.email=example@example.com', 'commit', '-qm', 'configuration')
    const head = await git('rev-parse', 'HEAD')
    expect(Object.keys(await readWorkspaceGitTree(root, head, 'craft-hub'))).toEqual(['dev.jsonc'])
    await symlink('dev.jsonc', join(root, 'craft-hub', 'link.jsonc'))
    await git('add', '.')
    await git('-c', 'user.name=Example', '-c', 'user.email=example@example.com', 'commit', '-qm', 'symlink')
    await expect(readWorkspaceGitTree(root, await git('rev-parse', 'HEAD'), 'craft-hub')).rejects.toThrow('regular Git blobs')
  })
})
