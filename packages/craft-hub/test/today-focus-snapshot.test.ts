import type { IntegrationEntityPage, ResolvedIntegrationContribution } from '../src/integrations'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { homeWorkSources } from '../src/home-work-sources'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { focusCandidates, rankTodayFocus } from '../src/today-focus'
import { todayFocusSnapshot } from '../src/today-focus-snapshot'
import { personalActiveWork } from '../src/work-items'

const fixtures: { root: string, runtime: CraftHubRuntime }[] = []
afterEach(async () => {
  for (const { root, runtime } of fixtures.splice(0)) {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-today-focus-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'test', scripts: { hello: 'node -e "console.log(1)"' } }))
  let connected = true
  let fail = false
  const page: IntegrationEntityPage = {
    currentUser: { id: 'me' },
    coverage: 'partial',
    nextCursor: 'next-private-cursor',
    items: [
      { id: 'urgent', title: 'Review proposal', important: true, statusCategory: 'open', assignees: [{ id: 'me', label: 'Me' }] },
      { id: 'done', title: 'Completed', statusCategory: 'done', assignees: [{ id: 'me', label: 'Me' }] },
      { id: 'other', title: 'Another account', assignees: [{ id: 'other', label: 'Other' }] },
    ],
  }
  const list = vi.fn(async () => {
    if (fail)
      throw new Error('Private provider diagnostic')
    return structuredClone(page)
  })
  const write = vi.fn(async () => ({ id: 'urgent', title: 'Updated' }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{
    id: 'fixture',
    integrations: [{ id: 'tasks', provider: { id: 'tasks', requires: '^1.0.0' }, actions: [
      { id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
      { id: 'list', title: 'Tasks', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never' },
      { id: 'update', title: 'Update', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always' },
    ], views: [{ id: 'todos', title: 'Todos', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [
      { id: 'status', type: 'connection-status', actionId: 'status' },
      { id: 'list', type: 'entity-list', actionId: 'list', input: { query: 'private-source-query' } },
    ] }] }],
    integrationProviders: [{ id: 'tasks', apiVersion: '1.0.0', connectionStatus: async () => ({ connected }), workItems: {
      list,
      search: async () => ({ items: [] }),
      updateStatus: write,
    } }],
  }] })
  fixtures.push({ root, runtime })
  return { root, runtime, list, write, page, disconnect: () => connected = false, offline: () => fail = true }
}

it('shares web ranking and personal-account filtering while keeping source inputs and cursors out of the snapshot', async () => {
  const f = await fixture()
  const now = Date.parse('2026-10-22T00:00:00Z')
  const project = await f.runtime.addProject(f.root)
  const command = (await f.runtime.capabilities(project.id)).find(item => item.kind === 'command')!
  const snapshot = await todayFocusSnapshot(f.runtime, 'en', now)
  expect(snapshot).toMatchObject({ version: 1, sourceCount: 1, total: 1, sources: [{ state: 'loaded', complete: false, cached: false, count: 1 }], items: [{ title: 'Review proposal', path: '/integrations/tasks/todos', reasons: ['Marked important'] }] })
  const source = homeWorkSources((await f.runtime.integrationContributions()).integrations, 'en')[0]!
  const webRanked = rankTodayFocus(personalActiveWork(f.page).map(item => ({ item, source })), now, false)
  expect(snapshot.items.map(item => item.title)).toEqual(webRanked.map(entry => entry.item.title))
  expect(snapshot.candidates[0]!.reasons).toEqual(focusCandidates(webRanked)[0]!.reasons)
  expect(snapshot.items[0]!.key).toBe(snapshot.candidates[0]!.key)
  expect(snapshot.items[0]!.key).toMatch(/^[a-f0-9]{64}$/)
  expect(snapshot.items[0]).toMatchObject({ sourceKey: snapshot.sources[0]!.key, statusCategory: 'open' })
  expect(snapshot.sources[0]!.browser).toMatchObject({ projectMode: false, items: [{ title: 'Review proposal', categories: ['important'] }] })
  expect(snapshot.sources[0]!.browser!.items[0]!.key).toMatch(/^[a-f0-9]{64}$/)
  expect(snapshot.items[0]!.actionTarget).toMatchObject({ integrationId: 'tasks', readOnly: false, item: { id: 'urgent', statusCategory: 'open' } })
  expect(snapshot.items[0]!.actionTarget).toEqual(snapshot.sources[0]!.browser!.items[0]!.actionTarget)
  expect(snapshot.candidates[0]).not.toHaveProperty('actionTarget')
  expect(JSON.stringify(snapshot)).not.toMatch(/private-source-query|next-private-cursor|Another account|Completed/)
  expect(f.list).toHaveBeenCalledTimes(1)
  expect(f.write).not.toHaveBeenCalled()
  expect((await f.runtime.projects.get(project.id)).trust).toBe('untrusted')
  await expect(f.runtime.run(project.id, command.id)).rejects.toThrow('untrusted')
})

it('does not read a disconnected source and does not retain a previous account snapshot after disconnect', async () => {
  const f = await fixture()
  expect((await todayFocusSnapshot(f.runtime, 'en')).total).toBe(1)
  f.disconnect()
  const snapshot = await todayFocusSnapshot(f.runtime, 'en')
  expect(snapshot).toMatchObject({ total: 0, items: [], candidates: [], sources: [{ state: 'disconnected', count: 0 }] })
  expect(snapshot.sources[0]!.browser).toBeUndefined()
  expect(f.list).toHaveBeenCalledTimes(1)
})

it('reports unavailable sources without leaking provider errors or treating them as complete empty results', async () => {
  const f = await fixture()
  f.offline()
  const snapshot = await todayFocusSnapshot(f.runtime, 'zh-CN')
  expect(snapshot).toMatchObject({ total: 0, sources: [{ state: 'error', complete: false }] })
  expect(JSON.stringify(snapshot)).not.toContain('Private provider diagnostic')
})

it('bounds source reads and concurrency, and retains a visible scope count for omitted sources', async () => {
  const contributions = Array.from({ length: 45 }, (_, index): ResolvedIntegrationContribution => ({
    id: `source-${index}`,
    pluginId: 'fixture',
    source: 'host:fixture',
    provider: { id: 'tasks', requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [{ id: 'list', title: 'List', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
    views: [{ id: 'tasks', title: 'Tasks', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'items', type: 'entity-list', actionId: 'list' }] }],
  }))
  let active = 0
  let peak = 0
  const invoke = vi.fn(async () => {
    active++
    peak = Math.max(active, peak)
    await new Promise(resolve => setTimeout(resolve, 1))
    active--
    return { items: [], coverage: 'complete' as const }
  })
  const snapshot = await todayFocusSnapshot({ integrationContributions: async () => ({ integrations: contributions, diagnostics: [] }), invokeIntegrationAction: invoke }, 'en')
  expect(snapshot.sourceCount).toBe(45)
  expect(snapshot.sources).toHaveLength(40)
  expect(invoke).toHaveBeenCalledTimes(40)
  expect(peak).toBe(4)
})

it('serves the same readonly projection over the public API and rejects invalid locales', async () => {
  const f = await fixture()
  const app = await startCraftHubServer({ port: 0, runtime: f.runtime })
  try {
    const response = await fetch(`${app.url}/api/workbench/today?locale=zh-CN`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ version: 1, items: [{ reasons: ['已标记重要'] }] })
    expect((await fetch(`${app.url}/api/workbench/today?locale=unsupported`)).status).toBe(400)
    expect(f.list).toHaveBeenCalledTimes(1)
    expect(f.write).not.toHaveBeenCalled()
  }
  finally { await app.close() }
})

it('invalidates observers after attempted writes, never discovery or denied confirmation, and releases listeners', async () => {
  const f = await fixture()
  const changed = vi.fn()
  const stop = f.runtime.onIntegrationsChanged(changed)
  await todayFocusSnapshot(f.runtime, 'en')
  const action = { integrationId: 'tasks', actionId: 'update', input: { itemId: 'urgent', statusCategory: 'done' } }
  await expect(f.runtime.invokeIntegrationAction(action)).rejects.toThrow(/confirmation/i)
  expect(changed).not.toHaveBeenCalled()
  const brokenObserver = f.runtime.onIntegrationsChanged(() => {
    throw new Error('Observer failed')
  })
  await f.runtime.invokeIntegrationAction({ ...action, confirmed: true })
  expect(changed).toHaveBeenCalledExactlyOnceWith('tasks')
  f.write.mockRejectedValueOnce(new Error('Provider failed'))
  await expect(f.runtime.invokeIntegrationAction({ ...action, confirmed: true })).rejects.toThrow('Provider failed')
  expect(changed).toHaveBeenCalledTimes(2)
  stop()
  brokenObserver()
  await f.runtime.invokeIntegrationAction({ ...action, confirmed: true })
  expect(changed).toHaveBeenCalledTimes(2)
})
