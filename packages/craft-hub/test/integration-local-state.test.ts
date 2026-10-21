import type { IntegrationEntityPage, IntegrationProviderContext } from '../src/integrations'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { IntegrationLocalState } from '../src/integration-local-state'
import { IntegrationConfirmationRequiredError } from '../src/integrations'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture(options: { cacheReads?: boolean, listConfirmation?: 'never' | 'always' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'integration-local-'))
  directories.push(root)
  let account = 'first'
  let connected = true
  let unavailable = false
  let probeUnavailable = false
  let writes = 0
  let afterWrite: (() => void) | undefined
  let read: (() => Promise<IntegrationEntityPage>) | undefined
  const statusContexts: IntegrationProviderContext[] = []
  const page: IntegrationEntityPage = { currentUser: { id: 'me' }, items: [{ id: 'one', title: 'A private task', status: 'open', statusUpdateAvailable: true }] }
  const makeRuntime = () => new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{
    id: 'tasks',
    integrations: [{ id: 'tasks', provider: { id: 'tasks', requires: '^1.0.0' }, actions: [
      { id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
      { id: 'list', title: 'Tasks', operation: 'work-items.list', effect: 'remote-read', confirmation: options.listConfirmation ?? 'never' },
      { id: 'update', title: 'Update', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always' },
    ], views: [{ id: 'todos', title: 'Todos', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'list', type: 'entity-list', actionId: 'list' }] }] }],
    integrationProviders: [{ id: 'tasks', apiVersion: '1.0.0', connectionStatus: async (context) => {
      statusContexts.push(context)
      if (probeUnavailable)
        throw new Error('Connection probe unavailable')
      return { connected, ...(options.cacheReads === false ? {} : { session: { cacheKey: account, cacheReads: true } }) }
    }, workItems: {
      list: async () => {
        if (unavailable || !connected)
          throw new Error('Source unavailable')
        if (read)
          return read()
        return structuredClone(page)
      },
      search: async () => ({ items: [] }),
      updateStatus: async () => {
        writes++
        afterWrite?.()
        return { id: 'one', title: 'Updated', status: 'done' }
      },
    } }],
  }] })
  return {
    root,
    makeRuntime,
    changeAccount: (value: string) => account = value,
    disconnect: () => connected = false,
    offline: () => unavailable = true,
    failProbe: () => probeUnavailable = true,
    restoreProbe: () => probeUnavailable = false,
    afterWrite: (callback: () => void) => afterWrite = callback,
    readWith: (callback: () => Promise<IntegrationEntityPage>) => read = callback,
    writes: () => writes,
    statusContexts: () => statusContexts,
  }
}

describe('local integration continuity', () => {
  it('restores a snapshot after restart, scoped to its account and query, and disables writes', async () => {
    const f = await fixture()
    const call = { integrationId: 'tasks', actionId: 'list', input: { workspace: 'one' } }
    const fresh = await f.makeRuntime().invokeIntegrationAction(call)
    expect(fresh).toMatchObject({ items: [{ statusUpdateAvailable: true }] })
    f.offline()
    const runtime = f.makeRuntime()
    const cached = await runtime.invokeIntegrationAction(call)
    expect(cached).toMatchObject({ fetchedAt: expect.any(String), cache: { readOnly: true, reason: 'offline' }, items: [{ statusUpdateAvailable: false }] })
    await expect(runtime.invokeIntegrationAction({ ...call, input: { workspace: 'two' } })).rejects.toThrow('Source unavailable')
    f.disconnect()
    expect(await runtime.invokeIntegrationAction(call)).toMatchObject({ cache: { reason: 'authorization' } })
    f.changeAccount('second')
    expect(await runtime.invokeIntegrationAction({ ...call, input: { ...call.input, cacheOnly: true } })).toEqual({ items: [] })
    await expect(runtime.invokeIntegrationAction(call)).rejects.toThrow('Source unavailable')
  })

  it('requires confirmation for writes and invalidates saved snapshots after a successful write', async () => {
    const f = await fixture()
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'update' })).rejects.toThrow(/confirmation/i)
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'update', confirmed: true })
    f.offline()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).rejects.toThrow('Source unavailable')
  })

  it.each([false, true])('requires the read confirmation before using a saved snapshot (cacheOnly: %s)', async (cacheOnly) => {
    const f = await fixture({ listConfirmation: 'always' })
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list', confirmed: true })
    const probes = f.statusContexts().length
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list', input: cacheOnly ? { cacheOnly: true } : undefined })).rejects.toBeInstanceOf(IntegrationConfirmationRequiredError)
    expect(f.statusContexts()).toHaveLength(probes)
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list', input: { cacheOnly: true }, confirmed: true })).resolves.toMatchObject({ items: [{ id: 'one' }], cache: { readOnly: true, reason: 'preview' } })
  })

  it('keeps a successful write authoritative and invalidates its account when the subsequent probe fails', async () => {
    const f = await fixture()
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    f.afterWrite(f.failProbe)
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'update', confirmed: true })).resolves.toMatchObject({ id: 'one', status: 'done' })
    expect(f.writes()).toBe(1)
    f.restoreProbe()
    f.offline()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).rejects.toThrow('Source unavailable')
  })

  it('continues an uncached provider read when its optional connection probe fails', async () => {
    const f = await fixture({ cacheReads: false })
    f.failProbe()
    const runtime = f.makeRuntime()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).resolves.toMatchObject({ items: [{ id: 'one' }] })
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list', input: { cacheOnly: true } })).resolves.toEqual({ items: [] })
  })

  it('invalidates both observed accounts if the active account changes during a write', async () => {
    const f = await fixture()
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    f.changeAccount('second')
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    f.changeAccount('first')
    f.afterWrite(() => f.changeAccount('second'))
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'update', confirmed: true })
    f.offline()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).rejects.toThrow('Source unavailable')
    f.changeAccount('first')
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).rejects.toThrow('Source unavailable')
  })

  it.each([undefined, {}, [null], [{ title: 'Missing identity' }]])('ignores structurally corrupt cache items %j and still reads the source', async (items) => {
    const f = await fixture()
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    const stateRoot = join(f.root, 'data', 'integration-state')
    const [directory] = await readdir(stateRoot)
    const [name] = await readdir(join(stateRoot, directory!))
    await writeFile(join(stateRoot, directory!, name!), JSON.stringify({ fetchedAt: new Date().toISOString(), items }))
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list', input: { cacheOnly: true } })).resolves.toEqual({ items: [] })
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).resolves.toMatchObject({ items: [{ id: 'one', title: 'A private task' }] })
  })

  it('does not restore a snapshot from a read that was in flight when a write completed', async () => {
    const f = await fixture()
    const runtime = f.makeRuntime()
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    let finish!: (page: IntegrationEntityPage) => void
    let markStarted!: () => void
    const started = new Promise<void>(resolve => markStarted = resolve)
    f.readWith(() => {
      markStarted()
      return new Promise(resolve => finish = resolve)
    })
    const pending = runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })
    await started
    await runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'update', confirmed: true })
    finish({ items: [{ id: 'one', title: 'Old read', status: 'open' }] })
    await pending
    f.offline()
    await expect(runtime.invokeIntegrationAction({ integrationId: 'tasks', actionId: 'list' })).rejects.toThrow('Source unavailable')
  })

  it('persists only validated view filters across server restart and rejects cross-site writes', async () => {
    const f = await fixture()
    const filters = { query: 'capability', status: 'active', assignee: 'current-user' }
    const options = { integrationId: 'tasks', viewId: 'todos', blockId: 'list', accountKey: 'first' }
    await f.makeRuntime().integrationViewFilters({ ...options, filters })
    expect(f.statusContexts()).toContainEqual(expect.objectContaining({ hostEnvironment: 'local' }))
    expect(await f.makeRuntime().integrationViewFilters(options)).toEqual(filters)
    f.changeAccount('second')
    expect(await f.makeRuntime().integrationViewFilters({ ...options, accountKey: 'second' })).toBeUndefined()
    await expect(f.makeRuntime().integrationViewFilters({ ...options, filters })).rejects.toThrow(/Account changed/)
    await expect(f.makeRuntime().integrationViewFilters({ ...options, accountKey: 'second', filters: { ...filters, token: 'secret' } })).rejects.toThrow()
    await expect(f.makeRuntime().integrationViewFilters({ ...options, blockId: 'missing' })).rejects.toThrow(/unavailable/)
    const server = await startCraftHubServer({ runtime: f.makeRuntime(), port: 0 })
    try {
      const response = await fetch(`${server.url}/api/integrations/tasks/view-filters`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ ...options, filters }) })
      expect(response.status).toBe(403)
    }
    finally { await server.close() }
  })

  it('discards expired and corrupt cache files and stores private snapshots with restrictive permissions', async () => {
    const f = await fixture()
    const local = new IntegrationLocalState(f.root)
    const page: IntegrationEntityPage = { items: [{ id: '1', title: 'Task' }], fetchedAt: new Date().toISOString() }
    await local.savePage('tasks', 'account', ['scope'], page, 0)
    const [directory] = await readdir(join(f.root, 'integration-state'))
    const [name] = await readdir(join(f.root, 'integration-state', directory!))
    const path = join(f.root, 'integration-state', directory!, name!)
    // Windows permissions use ACLs rather than POSIX mode bits.
    if (process.platform !== 'win32')
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject(page)
    await writeFile(path, JSON.stringify({ ...page, fetchedAt: new Date(0).toISOString() }))
    expect(await local.cached('tasks', 'account', ['scope'], 'offline')).toBeUndefined()
    await writeFile(path, 'broken json')
    expect(await local.cached('tasks', 'account', ['scope'], 'offline')).toBeUndefined()
    await local.invalidate('tasks', 'account')
    await local.savePage('tasks', 'account', ['scope'], page, 0)
    expect(await local.cached('tasks', 'account', ['scope'], 'offline')).toBeUndefined()
  })
})
