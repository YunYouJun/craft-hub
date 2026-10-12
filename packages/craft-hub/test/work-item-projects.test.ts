import type { ChildProcess } from 'node:child_process'
import type { WorkItemContainerRef, WorkItemSourceRef } from '../src/work-items'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ProjectRegistry } from '../src/projects'
import { CraftHubStore } from '../src/store'
import { WorkItemProjectConflictError, WorkItemProjectService } from '../src/work-item-projects'

const roots: string[] = []
const children: ChildProcess[] = []
const ref: WorkItemSourceRef = { providerId: 'tasks', instanceId: 'personal-tasks', accountId: 'account-one', containerId: 'inbox', kind: 'task', itemId: '7' }
const container: WorkItemContainerRef = { providerId: ref.providerId, instanceId: ref.instanceId, accountId: ref.accountId, containerId: ref.containerId, kind: ref.kind }

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const store = new CraftHubStore(dataDir)
  const projects = new ProjectRegistry(store)
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const project = await projects.add(projectPath)
  return { root, dataDir, store, projects, project, service: new WorkItemProjectService(dataDir, () => store.listProjects()) }
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGKILL')
  })
}

async function startLockedWriter(root: string, dataDir: string, revision: string): Promise<ChildProcess> {
  const scriptPath = join(root, 'locked-writer.mjs')
  await writeFile(scriptPath, `
    import { WorkItemProjectService } from ${JSON.stringify(new URL('../src/work-item-projects.ts', import.meta.url).href)}
    setInterval(() => {}, 1000)
    // Retain the pending catalog read so GC cannot finalize the held SQLite connection.
    globalThis.lockedWriterProjects = new Promise(() => {})
    const service = new WorkItemProjectService(process.argv[2], async () => {
      process.stdout.write('locked\\n')
      await globalThis.lockedWriterProjects
    })
    await service.upsert({ revision: process.argv[3], target: { type: 'item', ref: JSON.parse(process.argv[4]) }, projectId: null })
  `)
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), scriptPath, dataDir, revision, JSON.stringify(ref)], { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  children.push(child)
  await new Promise<void>((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Writer did not acquire its lock: ${output}`)), 5000)
    child.stderr?.on('data', chunk => output += String(chunk))
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('locked\n')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`Writer exited before acquiring its lock (${code ?? signal}): ${output}`))
    })
  })
  return child
}

it('starts with a read-only empty v1 snapshot and persists precise bindings across service restarts', async () => {
  const { dataDir, store, project, service } = await fixture()
  const first = await service.snapshot()
  expect(first).toEqual({ version: 1, revision: expect.any(String), associations: [] })
  await expect(access(join(dataDir, 'work-item-projects.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  const saved = await service.upsert({ revision: first.revision, target: { type: 'item', ref }, projectId: project.id })
  expect(saved.revision).not.toBe(first.revision)
  expect(saved.associations[0]?.resolution).toEqual({ status: 'available', project: { id: project.id, name: project.name, trust: 'untrusted' } })
  const restarted = new WorkItemProjectService(dataDir, () => store.listProjects())
  expect(await restarted.snapshot()).toEqual(saved)
  expect(await restarted.resolve(ref)).toMatchObject({ source: 'item', projectId: project.id, resolution: { status: 'available' } })
  const text = await readFile(join(dataDir, 'work-item-projects.json'), 'utf8')
  expect(JSON.parse(text)).toEqual({ version: 1, associations: [{ target: { type: 'item', ref }, projectId: project.id }] })
  expect(text).not.toContain(project.path)
  expect(await readdir(dataDir)).not.toContain('work-item-projects.json.lock')
  expect((await store.listProjects())[0]?.trust).toBe('untrusted')
})

it('prioritizes item overrides including explicit null and restores defaults when overrides are deleted', async () => {
  const { root, project, projects, service } = await fixture()
  const otherPath = join(root, 'other')
  await mkdir(otherPath)
  const other = await projects.add(otherPath)
  expect(await service.resolve(ref)).toEqual({ source: 'none', projectId: null, resolution: { status: 'unlinked' } })
  let snapshot = await service.upsert({ revision: (await service.snapshot()).revision, target: { type: 'container', ref: container }, projectId: project.id })
  expect(await service.resolve(ref)).toMatchObject({ source: 'container', projectId: project.id })
  snapshot = await service.upsert({ revision: snapshot.revision, target: { type: 'item', ref }, projectId: other.id })
  expect(await service.resolve(ref)).toMatchObject({ source: 'item', projectId: other.id })
  snapshot = await service.upsert({ revision: snapshot.revision, target: { type: 'item', ref }, projectId: null })
  expect(await service.resolve(ref)).toEqual({ source: 'item', projectId: null, resolution: { status: 'unlinked' } })
  snapshot = await service.remove({ revision: snapshot.revision, target: { type: 'item', ref } })
  expect(await service.resolve(ref)).toMatchObject({ source: 'container', projectId: project.id })
  await service.upsert({ revision: snapshot.revision, target: { type: 'container', ref: container }, projectId: null })
  expect(await service.resolve(ref)).toEqual({ source: 'container', projectId: null, resolution: { status: 'unlinked' } })
})

it('isolates identical item IDs by provider installation, account, typed container, and item kind', async () => {
  const { project, service } = await fixture()
  await service.upsert({ revision: (await service.snapshot()).revision, target: { type: 'item', ref }, projectId: project.id })
  for (const changed of [
    { providerId: 'other-provider' },
    { instanceId: 'other-installation' },
    { accountId: 'other-account' },
    { containerId: 'other-list' },
    { kind: 'issue' },
  ]) {
    expect(await service.resolve({ ...ref, ...changed })).toMatchObject({ source: 'none', resolution: { status: 'unlinked' } })
  }
})

it('retains unavailable associations after project removal or directory loss and never inherits another project', async () => {
  const { root, project, projects, service } = await fixture()
  const fallbackPath = join(root, 'fallback')
  await mkdir(fallbackPath)
  const fallback = await projects.add(fallbackPath)
  let snapshot = await service.upsert({ revision: (await service.snapshot()).revision, target: { type: 'container', ref: container }, projectId: fallback.id })
  snapshot = await service.upsert({ revision: snapshot.revision, target: { type: 'item', ref }, projectId: project.id })
  await rm(project.path, { recursive: true })
  expect(await service.resolve(ref)).toMatchObject({ source: 'item', projectId: project.id, resolution: { status: 'unavailable', reason: 'directory-unavailable' } })
  await expect(service.upsert({ revision: snapshot.revision, target: { type: 'item', ref }, projectId: project.id })).rejects.toMatchObject({ status: 400 })
  await projects.remove(project.id)
  expect(await service.resolve(ref)).toMatchObject({ source: 'item', projectId: project.id, resolution: { status: 'unavailable', reason: 'project-unregistered' } })
  await expect(service.upsert({ revision: snapshot.revision, target: { type: 'item', ref }, projectId: project.id })).rejects.toMatchObject({ status: 404 })
  expect((await service.snapshot()).associations).toHaveLength(2)
})

it('validates catalog directory paths and rejects unknown projects without changing saved state', async () => {
  const { store, project, service } = await fixture()
  const initial = await service.snapshot()
  await expect(service.upsert({ revision: initial.revision, target: { type: 'item', ref }, projectId: 'unknown' })).rejects.toMatchObject({ status: 404 })
  await store.saveProjects([{ ...project, path: '../relative' }])
  await expect(service.upsert({ revision: initial.revision, target: { type: 'item', ref }, projectId: project.id })).rejects.toMatchObject({ status: 400 })
  expect(await service.snapshot()).toEqual(initial)
})

it('marks a saved binding unavailable when its catalog path becomes invalid without changing trust', async () => {
  const { store, project, service } = await fixture()
  const saved = await service.upsert({ revision: (await service.snapshot()).revision, target: { type: 'item', ref }, projectId: project.id })
  await store.saveProjects([{ ...project, path: 'relative/path' }])
  expect(await service.resolve(ref)).toMatchObject({ source: 'item', projectId: project.id, resolution: { status: 'unavailable', reason: 'invalid-project-path' } })
  expect((await service.snapshot()).revision).toBe(saved.revision)
  expect((await store.listProjects())[0]?.trust).toBe('untrusted')
})

it('serializes separate service instances and rejects stale concurrent writers without losing either choice', async () => {
  const { dataDir, store, project, service } = await fixture()
  const other = new WorkItemProjectService(dataDir, () => store.listProjects())
  const initial = await service.snapshot()
  const targets = [{ type: 'item' as const, ref }, { type: 'item' as const, ref: { ...ref, itemId: '8' } }]
  const results = await Promise.allSettled([
    service.upsert({ revision: initial.revision, target: targets[0]!, projectId: project.id }),
    other.upsert({ revision: initial.revision, target: targets[1]!, projectId: project.id }),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(rejected.reason).toBeInstanceOf(WorkItemProjectConflictError)
  const current = await other.snapshot()
  expect(rejected.reason.actualRevision).toBe(current.revision)
  const savedId = current.associations[0]!.target.ref
  const retryTarget = targets.find(target => target.ref.itemId !== ('itemId' in savedId ? savedId.itemId : undefined))!
  const retried = await other.upsert({ revision: current.revision, target: retryTarget, projectId: project.id })
  expect(retried.associations).toHaveLength(2)
  await expect(service.remove({ revision: initial.revision, target: targets[0]! })).rejects.toBeInstanceOf(WorkItemProjectConflictError)
  expect((await service.snapshot()).associations).toHaveLength(2)
})

it('releases a cross-process writer lock after abrupt termination and preserves the last committed JSON', async () => {
  const { root, dataDir, project, service } = await fixture()
  const saved = await service.upsert({ revision: (await service.snapshot()).revision, target: { type: 'item', ref }, projectId: project.id })
  const statePath = join(dataDir, 'work-item-projects.json')
  const bytesBefore = await readFile(statePath, 'utf8')
  const child = await startLockedWriter(root, dataDir, saved.revision)
  await expect(service.upsert({ revision: saved.revision, target: { type: 'container', ref: container }, projectId: null }))
    .rejects
    .toMatchObject({ status: 503, message: expect.stringContaining('another writer') })
  expect(await readFile(statePath, 'utf8')).toBe(bytesBefore)
  expect((await service.snapshot()).revision).toBe(saved.revision)
  await stopChild(child)

  const recovered = await service.upsert({ revision: saved.revision, target: { type: 'container', ref: container }, projectId: null })
  expect(recovered.associations).toHaveLength(2)
  expect(await service.resolve(ref)).toMatchObject({ source: 'item', projectId: project.id })
  expect((await readdir(dataDir)).some(file => file.endsWith('.lock.sqlite'))).toBe(true)
}, 10_000)

it.each([
  '{invalid',
  JSON.stringify({ version: 2, associations: [] }),
  JSON.stringify({ associations: [] }),
  JSON.stringify({ version: 1, associations: [{ target: { type: 'item', ref }, projectId: null }, { target: { type: 'item', ref }, projectId: null }] }),
])('reports corrupt or unsupported state and preserves its original bytes (%#)', async (content) => {
  const { dataDir, project, service } = await fixture()
  const initial = await service.snapshot()
  const path = join(dataDir, 'work-item-projects.json')
  await writeFile(path, content)
  await expect(service.snapshot()).rejects.toMatchObject({ status: 500 })
  await expect(service.upsert({ revision: initial.revision, target: { type: 'item', ref }, projectId: project.id })).rejects.toMatchObject({ status: 500 })
  expect(await readFile(path, 'utf8')).toBe(content)
})

it('rejects path or credential fields supplied as association metadata', async () => {
  const { project, service } = await fixture()
  const initial = await service.snapshot()
  const request = { revision: initial.revision, target: { type: 'item' as const, ref }, projectId: project.id, token: 'private-value', projectPath: project.path }
  await expect(service.upsert(request)).rejects.toThrow()
  expect(await service.snapshot()).toEqual(initial)
})
