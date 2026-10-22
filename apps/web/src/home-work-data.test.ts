// @vitest-environment happy-dom

import type { IntegrationEntity, IntegrationEntityPage, ResolvedIntegrationContribution } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, disposePinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { api, ApiRequestError } from './api'
import { completionActionId, connectionKey, useHomeWorkDataStore } from './home-work-data'
import { useI18n } from './i18n'
import { emitIntegrationChange } from './integration-action-events'
import { homeWorkSources } from './personal-workbench'
import { useWorkbenchStore } from './store'

function contribution(id = 'tasks'): ResolvedIntegrationContribution {
  return {
    id,
    pluginId: `plugin-${id}`,
    source: `host:${id}`,
    provider: { id: 'tasks', requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [
      { id: 'status', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
      { id: 'list', title: 'List work', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
    ],
    views: [{ id: 'work', title: id, icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [
      { id: 'connection', type: 'connection-status', actionId: 'status' },
      { id: 'items', type: 'entity-list', actionId: 'list', input: { list: 'one' } },
      { id: 'other-items', type: 'entity-list', actionId: 'list', input: { list: 'two' } },
    ] }],
  }
}

function page(title = 'Previous task', accountId = 'me', nextCursor?: string): IntegrationEntityPage {
  return {
    currentUser: { id: accountId },
    items: [{ id: title, title, sourceRef: { providerId: 'tasks', instanceId: 'tasks', accountId, containerId: 'one', kind: 'task', itemId: title } }],
    ...(nextCursor ? { nextCursor, coverage: 'partial' as const } : { coverage: 'complete' as const }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function sources() {
  return homeWorkSources(useWorkbenchStore().integrationContributions, 'en')
}

describe('shared home work data', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    useWorkbenchStore().integrationContributions = [contribution()]
    useWorkbenchStore().integrationsLoadState = 'ready'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'))
    vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page())
  })

  afterEach(() => {
    disposePinia(getActivePinia()!)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the successful snapshot synchronously after the previous component unmounts without repeating reads', async () => {
    const source = sources()[0]!
    const component = { setup() {
      const data = useHomeWorkDataStore()
      void data.load(source)
      return () => h('div', data.stateFor(source).page?.items[0]?.title)
    } }
    const first = mount(component)
    await flushPromises()
    expect(first.text()).toBe('Previous task')
    first.unmount()
    const second = mount(component)
    expect(second.text()).toBe('Previous task')
    await flushPromises()
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
    second.unmount()
  })

  it('retains a stale snapshot while one background request refreshes it after the TTL', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    await data.load(source)
    vi.advanceTimersByTime(60_001)
    const pending = deferred<IntegrationEntityPage>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : pending.promise)
    const refresh = data.load(source)
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Previous task')
    expect(data.stateFor(source).loading).toBe(true)
    await flushPromises()
    pending.resolve(page('Updated task'))
    await refresh
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Updated task')
    expect(data.stateFor(source).loading).toBe(false)
  })

  it('coalesces source reads and shares a connection check between sibling lists', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    const status = deferred<{ connected: boolean }>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? status.promise : page())
    const load = data.load(first!)
    const duplicate = data.load(first!)
    const other = data.load(second!)
    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    status.resolve({ connected: true })
    await Promise.all([load, duplicate, other])
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'status')).toHaveLength(1)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(2)
  })

  it('uses the connection TTL when loading another list and lets manual refresh bypass both TTLs', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    await data.load(first!)
    await data.load(second!)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'status')).toHaveLength(1)
    await data.load(first!, { force: true })
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'status')).toHaveLength(2)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(3)
    const pending = deferred<IntegrationEntityPage>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : pending.promise)
    const refresh = data.load(first!, { force: true })
    const duplicate = data.load(first!, { force: true })
    pending.resolve(page())
    await Promise.all([refresh, duplicate])
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(4)
  })

  it('rechecks disconnected sources on re-entry after authorization finishes outside the app', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockResolvedValueOnce({ connected: false })
    await data.load(source)
    expect(data.stateFor(source).connection?.connected).toBe(false)
    expect(data.stateFor(source).page).toBeUndefined()

    vi.mocked(api.invokeIntegrationAction).mockClear().mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page('Authorized task'))
    await data.load(source)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
    expect(data.stateFor(source).connection?.connected).toBe(true)
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Authorized task')
  })

  it('keeps account-specific connection inputs distinct and normalizes input key order', () => {
    const source = sources()[0]!
    expect(connectionKey({ ...source, connection: { actionId: 'status', input: { locale: 'en', account: 'one' } } }))
      .toBe(connectionKey({ ...source, connection: { actionId: 'status', input: { account: 'one', locale: 'en' } } }))
    expect(connectionKey({ ...source, connection: { actionId: 'status', input: { account: 'one' } } }))
      .not
      .toBe(connectionKey({ ...source, connection: { actionId: 'status', input: { account: 'two' } } }))
  })

  it('shows authorization status before attempting a list and clears every disconnected sibling snapshot', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    await Promise.all([data.load(first!), data.load(second!)])
    vi.mocked(api.invokeIntegrationAction).mockClear().mockResolvedValue({ connected: false, message: 'Connect your account' })
    await data.load(first!, { force: true })
    expect(api.invokeIntegrationAction).toHaveBeenCalledExactlyOnceWith('tasks', 'status', { locale: 'en' })
    for (const source of [first!, second!]) {
      expect(data.stateFor(source).page).toBeUndefined()
      expect(data.stateFor(source).fetchedAt).toBeUndefined()
      expect(data.stateFor(source).connection).toMatchObject({ connected: false })
    }
  })

  it('clears all old snapshots as soon as a changed session identity answers, before the new list', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheKey: 'old-account' } } : page())
    await Promise.all([data.load(first!), data.load(second!)])
    const next = deferred<IntegrationEntityPage>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheKey: 'new-account' } } : next.promise)
    const refresh = data.load(first!, { force: true })
    await flushPromises()
    expect(data.stateFor(first!).page).toBeUndefined()
    expect(data.stateFor(second!).page).toBeUndefined()
    next.resolve(page('New account task', 'other'))
    await refresh
    expect(data.stateFor(first!).page?.currentUser?.id).toBe('other')
  })

  it('clears sibling pages when the current user changes even without a session identity', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    await Promise.all([data.load(first!), data.load(second!)])
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page('New account task', 'other'))
    await data.load(first!, { force: true })
    expect(data.stateFor(first!).page?.items[0]?.title).toBe('New account task')
    expect(data.stateFor(second!).page).toBeUndefined()
  })

  it.each([401, 403])('clears account snapshots on authentication failure %i', async (status) => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    await Promise.all([data.load(first!), data.load(second!)])
    vi.mocked(api.invokeIntegrationAction).mockRejectedValue(new ApiRequestError('Authorization required', status))
    await data.load(first!, { force: true })
    expect(data.stateFor(first!).page).toBeUndefined()
    expect(data.stateFor(second!).page).toBeUndefined()
    expect(data.stateFor(first!).error).toContain('Could not load work items')
    expect(data.stateFor(first!).loading).toBe(false)
  })

  it('allows reads after an optional status failure and preserves the snapshot on ordinary read failures', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => {
      if (action === 'status')
        throw new Error('Status temporarily unavailable')
      return page()
    })
    await data.load(source)
    expect(data.stateFor(source).page?.items).toHaveLength(1)
    vi.mocked(api.invokeIntegrationAction).mockRejectedValue(new Error('Offline'))
    await data.load(source, { force: true })
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Previous task')
    expect(data.stateFor(source).error).toContain('Could not load work items')
  })

  it('ignores late responses after invalidation and allows an immediate replacement read', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    const old = deferred<IntegrationEntityPage>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : old.promise)
    const pending = data.load(source)
    await flushPromises()
    data.invalidate('tasks')
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page('Fresh task'))
    await data.load(source)
    old.resolve(page('Late old task'))
    await pending
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Fresh task')
    expect(data.stateFor(source).loading).toBe(false)
  })

  it('does not start a list after an invalidated connection check resolves', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    const status = deferred<{ connected: boolean }>()
    vi.mocked(api.invokeIntegrationAction).mockReturnValueOnce(status.promise)
    const pending = data.load(source)
    data.invalidate('tasks')
    status.resolve({ connected: true })
    await pending
    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    expect(data.stateFor(source).page).toBeUndefined()
  })

  it('retains equivalent catalog snapshots, invalidates changed providers, and removes unregistered sources', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    await data.load(source)
    useWorkbenchStore().integrationContributions = [contribution()]
    await nextTick()
    await data.load(sources()[0]!)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
    const updated = contribution()
    updated.providerVersion = '1.1.0'
    useWorkbenchStore().integrationContributions = [updated]
    await nextTick()
    expect(data.stateFor(sources()[0]!).page).toBeUndefined()
    useWorkbenchStore().integrationContributions = []
    await nextTick()
    expect(data.states[source.key]).toBeUndefined()
  })

  it('appends pages, retries a failed cursor and stops repeated cursors', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page('First', 'me', 'next'))
    await data.load(source)
    vi.mocked(api.invokeIntegrationAction).mockRejectedValueOnce(new Error('Offline'))
    await data.load(source, { more: true })
    expect(data.stateFor(source).retryMore).toBe(true)
    expect(data.stateFor(source).page?.nextCursor).toBe('next')
    vi.mocked(api.invokeIntegrationAction).mockResolvedValueOnce(page('Second', 'me', 'next'))
    await data.load(source, { more: true })
    expect(api.invokeIntegrationAction).toHaveBeenLastCalledWith('tasks', 'list', { list: 'one', cursor: 'next' })
    expect(data.stateFor(source).page?.items.map(item => item.title)).toEqual(['First', 'Second'])
    expect(data.stateFor(source).page?.nextCursor).toBeUndefined()
    expect(data.stateFor(source).error).toContain('repeated cursor')
  })

  it('replaces previous-account pagination results and retains the identity-change explanation', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : page('Old account task', 'me', 'next'))
    await data.load(source)
    vi.mocked(api.invokeIntegrationAction).mockResolvedValueOnce(page('New account task', 'other'))
    await data.load(source, { more: true })
    expect(data.stateFor(source).page?.items.map(item => item.title)).toEqual(['New account task'])
    expect(data.stateFor(source).cursors).toEqual([])
    expect(data.stateFor(source).error).toContain('Source account changed')
  })

  it('does not cache explicitly non-cacheable successful reads as fresh', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheReads: false } } : { items: [] })
    await data.load(source)
    await data.load(source)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(2)
  })

  it('reuses an empty unidentified result for 60 seconds after a successful connection check', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : { items: [] })
    await data.load(source)
    vi.mocked(api.invokeIntegrationAction).mockClear()
    await data.load(source)
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()

    await data.load(source, { force: true })
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
    vi.mocked(api.invokeIntegrationAction).mockClear()
    vi.advanceTimersByTime(60_001)
    await data.load(source)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
  })

  it('revalidates unidentified nonempty results even when their connection is fresh', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status'
      ? { connected: true }
      : { items: [{ id: 'unidentified', title: 'Unidentified task' }] })
    await data.load(source)
    await data.load(source)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(2)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'status')).toHaveLength(1)
  })

  it('revalidates unidentified empty results without a connection action', async () => {
    const declaration = contribution()
    declaration.views[0]!.blocks.shift()
    useWorkbenchStore().integrationContributions = [declaration]
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    expect(source.connection).toBeUndefined()
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({ items: [] })
    await data.load(source)
    await data.load(source)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
  })

  it('revalidates unidentified empty results when an optional connection check never succeeded', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => {
      if (action === 'status')
        throw new Error('Status unavailable')
      return { items: [] }
    })
    await data.load(source)
    await data.load(source)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(4)
  })

  it('keeps known-account sibling snapshots when another list omits its current-user identity', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action, input) => action === 'status'
      ? { connected: true, session: { cacheKey: 'account' } }
      : input?.list === 'one' ? page() : { items: [{ id: 'unidentified', title: 'Unidentified task' }] })
    await data.load(first!)
    await data.load(second!, { force: true })
    expect(data.stateFor(first!).page?.items[0]?.title).toBe('Previous task')
    expect(data.stateFor(second!).page?.currentUser).toBeUndefined()
    vi.mocked(api.invokeIntegrationAction).mockClear()
    await data.load(second!)
    expect(api.invokeIntegrationAction).toHaveBeenCalledExactlyOnceWith('tasks', 'list', { list: 'two' })
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheKey: 'account' } } : page('Changed account task', 'other'))
    await data.load(second!, { force: true })
    expect(data.stateFor(first!).page).toBeUndefined()
    expect(data.stateFor(second!).page?.currentUser?.id).toBe('other')
  })

  it('keeps shared authorization checks valid when only one of their lists is removed', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    const status = deferred<{ connected: boolean }>()
    vi.mocked(api.invokeIntegrationAction).mockReturnValueOnce(status.promise)
    const pending = Promise.all([data.load(first!), data.load(second!)])
    const remaining = contribution()
    remaining.views[0]!.blocks.pop()
    useWorkbenchStore().integrationContributions = [remaining]
    status.resolve({ connected: false })
    await pending
    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    expect(data.stateFor(first!).connection?.connected).toBe(false)
    expect(data.states[second!.key]).toBeUndefined()
  })

  it('retains snapshots through a transient catalog refresh and removes sources only after it is ready', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    await data.load(source)
    useWorkbenchStore().integrationsLoadState = 'loading'
    useWorkbenchStore().integrationContributions = []
    expect(data.stateFor(source).page?.items[0]?.title).toBe('Previous task')
    useWorkbenchStore().integrationContributions = [contribution()]
    useWorkbenchStore().integrationsLoadState = 'ready'
    await data.load(sources()[0]!)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
  })

  it('rejects an old sibling list response after a new account connection is known', async () => {
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheKey: 'old' } } : page())
    await data.load(first!)
    const old = deferred<IntegrationEntityPage>()
    vi.mocked(api.invokeIntegrationAction).mockReturnValueOnce(old.promise)
    const oldRead = data.load(second!)
    await flushPromises()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true, session: { cacheKey: 'new' } } : page('New account task', 'other'))
    await data.load(first!, { force: true })
    old.resolve(page('Late old account task'))
    await oldRead
    expect(data.stateFor(second!).page).toBeUndefined()
    expect(data.stateFor(second!).loading).toBe(false)
    expect(data.stateFor(first!).page?.currentUser?.id).toBe('other')
  })

  it('restarts from the first page when authorization changes before a pagination request', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status'
      ? { connected: true, session: { cacheKey: 'old' } }
      : page('Old account task', 'me', 'old-account-cursor'))
    await data.load(source)
    vi.advanceTimersByTime(60_001)
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status'
      ? { connected: true, session: { cacheKey: 'new' } }
      : page('New account task', 'other'))
    await data.load(source, { more: true })
    expect(api.invokeIntegrationAction).toHaveBeenLastCalledWith('tasks', 'list', { list: 'one' })
    expect(data.stateFor(source).page?.items[0]?.title).toBe('New account task')
    expect(data.stateFor(source).cursors).toEqual([])
  })

  it('revalidates a source whose session expires before the ordinary TTL', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status'
      ? { connected: true, session: { cacheKey: 'account', expiresAt: '2026-10-21T00:00:10Z' } }
      : page())
    await data.load(source)
    vi.advanceTimersByTime(10_001)
    await data.load(source)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'status')).toHaveLength(2)
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(call => call[1] === 'list')).toHaveLength(2)
  })

  it('invalidates on connection mutations, blocks intermediate reads and signals settled refreshes', async () => {
    const data = useHomeWorkDataStore()
    const source = sources()[0]!
    await data.load(source)
    const revision = data.revision
    emitIntegrationChange({ integrationId: 'tasks', phase: 'start' })
    expect(data.stateFor(source).page).toBeUndefined()
    expect(data.revision).toBeGreaterThan(revision)
    vi.mocked(api.invokeIntegrationAction).mockClear()
    await data.load(source)
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
    emitIntegrationChange({ integrationId: 'tasks', phase: 'start' })
    emitIntegrationChange({ integrationId: 'tasks', phase: 'settled' })
    await data.load(source)
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
    emitIntegrationChange({ integrationId: 'tasks', phase: 'settled' })
    await data.load(source)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
  })

  it('patches every sibling list after a completion and discards a read that started before the write', async () => {
    const tasks = contribution()
    tasks.actions.push({ id: 'complete', title: 'Complete', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always', effectiveConfirmation: 'always' })
    useWorkbenchStore().integrationContributions = [tasks]
    const data = useHomeWorkDataStore()
    const [first, second] = sources()
    await Promise.all([data.load(first!), data.load(second!)])
    vi.mocked(api.invokeIntegrationAction).mockClear()
    const stale = deferred<IntegrationEntityPage>()
    const write = deferred<IntegrationEntity>()
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status' ? { connected: true } : action === 'complete' ? write.promise : stale.promise)
    const refreshing = data.load(first!, { force: true })
    await flushPromises()
    const item = data.stateFor(first!).page!.items[0]!
    const completing = data.setCompletion(first!, item, true)
    expect(data.stateFor(first!).loading).toBe(false)
    expect(await data.load(second!, { force: true })).toBeUndefined()
    write.resolve({ ...item, status: 'completed', statusCategory: 'done' })
    await completing
    stale.resolve(page())
    await refreshing
    expect(data.stateFor(first!).page!.items[0]).toMatchObject({ title: 'Previous task', statusCategory: 'done' })
    expect(data.stateFor(second!).page!.items[0]).toMatchObject({ statusCategory: 'done' })
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('tasks', 'complete', expect.objectContaining({ itemId: 'Previous task', statusCategory: 'done' }), undefined, true, { broadcast: false })
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.filter(([, action]) => action === 'list')).toHaveLength(1)
  })

  it('exposes completion only for direct status actions without workflow transitions', () => {
    const tasks = contribution()
    expect(completionActionId(tasks)).toBeUndefined()
    tasks.actions.push({ id: 'complete', title: 'Complete', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always', effectiveConfirmation: 'always' })
    expect(completionActionId(tasks)).toBe('complete')
    tasks.actions.push({ id: 'transitions', title: 'Transitions', operation: 'work-items.transitions', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' })
    expect(completionActionId(tasks)).toBeUndefined()
  })
})
