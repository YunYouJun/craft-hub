// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { IntegrationConnectionStatus, IntegrationEntity, IntegrationEntityPage, ResolvedIntegrationContribution } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkItemsOverview from './WorkItemsOverview.vue'

function workSource(id: string): ResolvedIntegrationContribution {
  return {
    id,
    pluginId: `plugin-${id}`,
    source: `host:${id}`,
    provider: { id: 'tasks', requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [{ id: 'list', title: 'List work', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
    views: [{ id: 'work', title: id, icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'items', type: 'entity-list', actionId: 'list', input: { mode: 'personal', limit: 20 } }] }],
  }
}

function ownedItem(instanceId: string, title: string, containerId = 'list-1', accountId = 'me'): IntegrationEntity {
  return {
    id: 'same-display-id',
    title,
    sourceRef: { providerId: 'tasks', instanceId, accountId, containerId, kind: 'task', itemId: 'same-native-id' },
    personalMembership: { accountId, relation: 'owned' },
    statusCategory: 'unknown',
  }
}

function connectedWorkSource(id: string): ResolvedIntegrationContribution {
  const source = workSource(id)
  source.actions.push({ id: 'status', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' })
  source.views[0]!.blocks.unshift({ id: 'connection', type: 'connection-status', actionId: 'status' })
  return source
}

function groupedWorkSource(): ResolvedIntegrationContribution {
  const source = connectedWorkSource('source-a')
  source.views[0]!.title = 'Issue tracker'
  source.views[0]!.blocks[1]!.title = 'Project todos'
  source.actions.push({ ...source.actions[0]!, id: 'work-items', title: 'Work items' })
  source.views[0]!.blocks.push({ id: 'work-items', type: 'entity-list', actionId: 'work-items' })
  source.views.push({ ...source.views[0]!, id: 'personal', title: 'Personal todos', blocks: [source.views[0]!.blocks[0]!, { id: 'personal', type: 'entity-list', actionId: 'list', title: 'Personal todos', input: { mode: 'personal' } }] })
  return source
}

describe('shared work items overview', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    const store = useWorkbenchStore()
    store.integrationsLoadState = 'ready'
    store.projects = [{ id: 'project-1', name: 'Untrusted project', path: '/repos/project', trust: 'untrusted', addedAt: '2026-10-12T00:00:00Z' }]
    store.selectedProjectId = 'project-1'
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [] })
    vi.spyOn(api, 'trust').mockRejectedValue(new Error('Unexpected trust operation'))
    vi.spyOn(api, 'run').mockRejectedValue(new Error('Unexpected command execution'))
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    expect(api.trust).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    expect(useWorkbenchStore().projects[0]?.trust).toBe('untrusted')
    vi.restoreAllMocks()
  })

  async function open(props: InstanceType<typeof WorkItemsOverview>['$props'] = {}): Promise<VueWrapper> {
    wrapper = mount(WorkItemsOverview, { props })
    await flushPromises()
    return wrapper
  }

  function source(index = 0) {
    return wrapper!.findAll('.home-work-source')[index]!
  }

  function button(label: string, index = 0) {
    const candidate = source(index).findAll('button').find(button => button.text() === label)
    if (!candidate)
      throw new Error(`Missing source button: ${label}`)
    return candidate
  }

  it('switches provider tabs with the keyboard, retains filters and keeps focus aggregated across providers', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a'), connectedWorkSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (id, action) => action === 'status'
      ? { connected: true }
      : { currentUser: { id: 'me' }, collections: [{ id: 'list-1', title: 'Personal' }, { id: 'list-2', title: 'Work' }], items: [ownedItem(id, `${id} personal`), ownedItem(id, `${id} work`, 'list-2')], coverage: 'complete' })
    wrapper = mount(WorkItemsOverview, { props: { compact: true, tabbed: true }, attachTo: document.body })
    await flushPromises()

    const tabs = wrapper.get('[aria-label="Work sources"]').findAll('[role="tab"]')
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(source().isVisible()).toBe(true)
    expect(source(1).isVisible()).toBe(false)
    await source().get('.collection-choice[title="Work"]').trigger('click')
    expect(source().text()).not.toContain('source-a personal')
    vi.mocked(api.invokeIntegrationAction).mockClear()
    ;(tabs[0]!.element as HTMLElement).focus()
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    await vi.waitFor(() => expect(tabs[1]!.attributes('aria-selected')).toBe('true'))
    expect(source().isVisible()).toBe(false)
    expect(source(1).isVisible()).toBe(true)
    expect(tabs[1]!.attributes('aria-controls')).toBe(source(1).attributes('id'))
    expect(source(1).attributes('aria-labelledby')).toBe(tabs[1]!.attributes('id'))
    expect(wrapper.findComponent({ name: 'TodayFocus' }).props('entries')).toHaveLength(4)
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()

    await tabs[0]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(source().get('.collection-choice[title="Work"]').attributes('aria-pressed')).toBe('true')
    expect(source().text()).toContain('source-a work')
    expect(source().text()).not.toContain('source-a personal')
    await source().get('[aria-label="Refresh source-a"]').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.map(call => call[0])).toEqual(['source-a', 'source-a'])
    expect(source().get('.collection-choice[title="Work"]').attributes('aria-pressed')).toBe('true')
  })

  it('shows only one grouped list at a time and retains list selection when changing providers', async () => {
    useWorkbenchStore().integrationContributions = [groupedWorkSource(), workSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (id, action, input) => action === 'status'
      ? { connected: true }
      : { currentUser: { id: 'me' }, items: [ownedItem(id, `${action} ${input?.mode ?? 'items'}`)] })
    await open({ compact: true, tabbed: true })
    const listTabs = source().get('[aria-label="Issue tracker lists"]').findAll('[role="tab"]')
    const lists = source().findAll('.home-work-list')
    expect(lists.map(list => list.isVisible())).toEqual([true, false, false])
    await listTabs[2]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(lists.map(list => list.isVisible())).toEqual([false, false, true])
    await lists[2]!.findAll('button').find(button => button.text() === 'View all')!.trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'personal', 'global']])

    const tabs = wrapper!.get('[aria-label="Work sources"]').findAll('[role="tab"]')
    await tabs[1]!.trigger('keydown', { key: 'Enter' })
    await tabs[0]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(listTabs[2]!.attributes('aria-selected')).toBe('true')
    expect(lists.map(list => list.isVisible())).toEqual([false, false, true])
  })

  it('exposes disconnected tabs, connects from the selected panel and falls back when a provider is removed', async () => {
    const store = useWorkbenchStore()
    const first = connectedWorkSource('source-a')
    store.integrationContributions = [first, connectedWorkSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (id, action) => action === 'status'
      ? { connected: id !== 'source-b', message: 'Sign in to continue.' }
      : { currentUser: { id: 'me' }, items: [] })
    await open({ compact: true, tabbed: true })
    const tabs = wrapper!.get('[aria-label="Work sources"]').findAll('[role="tab"]')
    expect(tabs[1]!.find('.home-tab-attention').exists()).toBe(true)
    await tabs[1]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(source(1).get('.home-connection').isVisible()).toBe(true)
    expect(source(1).text()).toContain('Sign in to continue.')
    await button('Connect account', 1).trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-b', 'work', 'global']])
    store.integrationContributions = [first]
    await flushPromises()
    expect(source().isVisible()).toBe(true)
    expect(wrapper!.get('[aria-label="Work sources"] [role="tab"]').attributes('aria-selected')).toBe('true')
  })

  it('groups lists from one integration across views while retaining distinct integrations and navigation', async () => {
    const other = workSource('source-b')
    other.views[0]!.title = 'Issue tracker'
    useWorkbenchStore().integrationContributions = [groupedWorkSource(), other]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (id, action, input) => action === 'status'
      ? { connected: true }
      : { currentUser: { id: 'me' }, items: [ownedItem(id, `${id} ${action} ${input?.mode ?? 'items'}`)] })
    await open({ compact: true })

    expect(wrapper!.findAll('.home-work-source')).toHaveLength(2)
    expect(source().get('.home-group-heading strong').text()).toBe('Issue tracker')
    const lists = source().findAll('.home-work-list')
    expect(lists).toHaveLength(3)
    expect(lists.map(list => list.get('.home-list-heading strong').text())).toEqual(['Project todos', 'Work items', 'Personal todos'])
    expect(lists.map(list => list.get('.home-work-item').text())).toEqual(['source-a list personal', 'source-a work-items items', 'source-a list personal'])
    expect(source(1).findAll('.home-work-row')).toHaveLength(1)
    await lists[2]!.findAll('button').find(button => button.text() === 'View all')!.trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'personal', 'global']])
    await lists[1]!.get('[aria-label="Prepare handoff source-a work-items items"]').trigger('click')
    expect(wrapper!.emitted('prepareHandoff')![0]![0]).toMatchObject({ source: { integrationId: 'source-a', actionId: 'work-items', sectionTitle: 'Work items' } })
  })

  it('shares the account check and connection notice then refreshes all lists from the group header', async () => {
    useWorkbenchStore().integrationContributions = [groupedWorkSource()]
    let connected = false
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action) => action === 'status'
      ? { connected, message: 'Connect your issue tracker account.' }
      : { currentUser: { id: 'me' }, items: [] })
    await open()

    expect(wrapper!.findAll('.home-work-source')).toHaveLength(1)
    expect(source().findAll('.home-connection')).toHaveLength(1)
    expect(source().findAll('.home-work-list')).toHaveLength(3)
    expect(api.invokeIntegrationAction).toHaveBeenCalledExactlyOnceWith('source-a', 'status', { locale: 'en' })
    await button('Connect account').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'work', 'global']])

    connected = true
    vi.mocked(api.invokeIntegrationAction).mockClear()
    await source().get('[aria-label="Refresh Issue tracker"]').trigger('click')
    await flushPromises()
    expect(source().find('.home-connection').exists()).toBe(false)
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(4)
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'list', { mode: 'personal', limit: 20 })
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'work-items', {})
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'list', { mode: 'personal' })
  })

  it('keeps grouped list failures, retries and pagination independent', async () => {
    const grouped = groupedWorkSource()
    grouped.views.pop()
    useWorkbenchStore().integrationContributions = [grouped]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, action, input) => {
      if (action === 'status')
        return { connected: true }
      if (action === 'work-items')
        throw new Error('Unavailable')
      return { currentUser: { id: 'me' }, items: [ownedItem('source-a', input?.cursor ? 'Next todo' : 'First todo', input?.cursor ? 'list-2' : 'list-1')], ...(input?.cursor ? {} : { nextCursor: 'next' }) }
    })
    await open()

    expect(wrapper!.findAll('.home-work-source')).toHaveLength(1)
    const lists = source().findAll('.home-work-list')
    expect(lists[0]!.text()).toContain('First todo')
    expect(lists[0]!.find('[role="alert"]').exists()).toBe(false)
    expect(lists[1]!.get('[role="alert"]').text()).toContain('Could not load work items')
    await lists[0]!.findAll('button').find(button => button.text() === 'Load more')!.trigger('click')
    await flushPromises()
    expect(lists[0]!.findAll('.home-work-row')).toHaveLength(2)
    vi.mocked(api.invokeIntegrationAction).mockClear().mockResolvedValue({ currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Recovered work item')] })
    await lists[1]!.findAll('button').find(button => button.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'work-items', {})
    expect(api.invokeIntegrationAction).not.toHaveBeenCalledWith('source-a', 'list', expect.anything())
    expect(lists[1]!.text()).toContain('Recovered work item')
    expect(lists[0]!.findAll('.home-work-row')).toHaveLength(2)
  })

  it('keeps separate account checks and connection entries distinct within one integration', async () => {
    const grouped = groupedWorkSource()
    grouped.views[0]!.blocks[0]!.input = { account: 'personal' }
    grouped.views[1]!.blocks[0] = { ...grouped.views[1]!.blocks[0]!, input: { account: 'team' } }
    useWorkbenchStore().integrationContributions = [grouped]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_id, _action, input) => ({ connected: false, message: `Connect ${input?.account}` }))
    await open()

    expect(wrapper!.findAll('.home-work-source')).toHaveLength(1)
    expect(source().findAll('.home-connection').map(notice => notice.text())).toEqual([
      expect.stringContaining('Connect personal'),
      expect.stringContaining('Connect team'),
    ])
    expect(api.invokeIntegrationAction).toHaveBeenCalledTimes(2)
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'status', { account: 'personal', locale: 'en' })
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'status', { account: 'team', locale: 'en' })
    const notices = source().findAll('.home-connection')
    await notices[1]!.get('button').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'personal', 'global']])
  })

  it('shows the authorization reason and a connection entry before attempting an unauthenticated work read', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a')]
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({ connected: false, message: 'Authorize your personal account to read tasks.' })
    await open()

    expect(api.invokeIntegrationAction).toHaveBeenCalledExactlyOnceWith('source-a', 'status', { locale: 'en' })
    expect(source().get('[role="status"]').text()).toContain('Account connection required')
    expect(source().text()).toContain('Authorize your personal account')
    expect(source().find('[role="alert"]').exists()).toBe(false)
    await button('Connect account').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'work', 'global']])
    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
  })

  it('loads work after authorization and clears previous results if the account is disconnected', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a')]
    let connected = false
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_integrationId, actionId) => actionId === 'status'
      ? { connected }
      : { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Authorized task')], fetchedAt: '2026-10-12T01:00:00Z' })
    await open({ compact: true })
    expect(source().text()).toContain('Account connection required')

    connected = true
    await wrapper!.get('[aria-label="Refresh my work"]').trigger('click')
    await flushPromises()
    expect(source().text()).toContain('Authorized task')
    expect(source().text()).not.toContain('Account connection required')

    connected = false
    await wrapper!.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(source().text()).not.toContain('Authorized task')
    expect(source().find('time').exists()).toBe(false)
    expect(source().text()).toContain('Account connection required')
  })

  it('keeps work readable if an optional connection check fails and offers connection settings on a read failure', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (_integrationId, actionId) => {
      if (actionId === 'status')
        throw new Error('Status unavailable')
      return { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Available task')] }
    })
    await open()
    expect(source().text()).toContain('Available task')

    vi.mocked(api.invokeIntegrationAction).mockRejectedValue(new Error('Offline'))
    await wrapper!.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(source().get('[role="alert"]').text()).toContain('Check connection')
    await button('Check connection').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'work', 'global']])
  })

  it('does not start a work read from a late connection response for a removed source', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a')]
    let finish!: (status: IntegrationConnectionStatus) => void
    vi.mocked(api.invokeIntegrationAction).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    await open()
    await wrapper!.setProps({ integrations: [] })
    finish({ connected: true })
    await flushPromises()

    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    expect(wrapper!.find('.home-work-source').exists()).toBe(false)
  })

  it('filters complete results by list, retains empty lists and refreshes only the selected source', async () => {
    useWorkbenchStore().integrationContributions = [connectedWorkSource('source-a'), workSource('source-b')]
    let refreshed = false
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (id, actionId) => actionId === 'status'
      ? { connected: true, accountLabel: 'Reader' }
      : { currentUser: { id: 'me' }, collections: [{ id: 'list-1', title: 'Personal' }, { id: 'list-2', title: 'Work' }, { id: 'empty', title: 'Empty' }], items: [ownedItem(id, 'Personal task'), { ...ownedItem(id, refreshed ? 'Refreshed work task' : 'Work task', 'list-2'), priority: { label: 'Important' } }], coverage: 'complete' })
    await open({ compact: true })
    const choice = (title: string) => source().findAll('.collection-choice').find(button => button.attributes('title') === title)!
    expect(choice('Empty').text()).toContain('0')
    expect(source().text()).toContain('Connected')
    await choice('Work').trigger('click')
    await flushPromises()
    expect(source().text()).toContain('Work task')
    expect(source().text()).toContain('Important')
    expect(source().text()).not.toContain('Personal task')
    vi.mocked(api.invokeIntegrationAction).mockClear()
    refreshed = true
    await source().get('[aria-label="Refresh source-a"]').trigger('click')
    await flushPromises()
    expect(source().text()).toContain('Refreshed work task')
    expect(choice('Work').attributes('aria-pressed')).toBe('true')
    expect(vi.mocked(api.invokeIntegrationAction).mock.calls.map(call => call[0])).toEqual(['source-a', 'source-a'])
    await choice('Empty').trigger('click')
    await flushPromises()
    expect(source().findAll('.home-work-row')).toHaveLength(0)
    expect(source().text()).toContain('No pending work')
  })

  it('shows owned personal work without assignees and keeps the same native IDs separate across integrations', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [workSource('source-a'), workSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async integrationId => ({
      currentUser: { id: 'me' },
      items: [ownedItem(integrationId, `${integrationId} owned task`), ownedItem(integrationId, 'Other account task', 'list-2', 'other')],
      fetchedAt: '2026-10-12T01:00:00Z',
    }))
    await open()

    expect(wrapper!.findAll('.home-work-row')).toHaveLength(2)
    expect(wrapper!.text()).toContain('source-a owned task')
    expect(wrapper!.text()).toContain('source-b owned task')
    expect(wrapper!.text()).not.toContain('Other account task')
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('source-a', 'list', { mode: 'personal', limit: 20 })
    await source().get('[aria-label="Prepare handoff source-a owned task"]').trigger('click')
    const handoff = wrapper!.emitted('prepareHandoff')![0]![0] as { item: IntegrationEntity, source: { integrationId: string } }
    expect(handoff.source.integrationId).toBe('source-a')
    expect(handoff.item.sourceRef?.instanceId).toBe('source-a')
    expect(handoff.item.assignees).toBeUndefined()
    expect(store.selectedProjectId).toBe('project-1')
  })

  it('appends pages, updates repeated identities and retains equal IDs in other containers and sources', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a'), workSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (integrationId, _actionId, input) => {
      if (integrationId === 'source-b')
        return { currentUser: { id: 'me' }, items: [ownedItem('source-b', 'Other source task')] }
      return input?.cursor
        ? { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Updated first task'), ownedItem('source-a', 'Other container task', 'list-2')], coverage: 'complete', fetchedAt: '2026-10-12T01:01:00Z' }
        : { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Initial first task')], nextCursor: 'opaque-page-2', coverage: 'partial' }
    })
    await open()
    await button('Load more').trigger('click')
    await flushPromises()

    expect(api.invokeIntegrationAction).toHaveBeenLastCalledWith('source-a', 'list', { mode: 'personal', limit: 20, cursor: 'opaque-page-2' })
    expect(wrapper!.findAll('.home-work-row')).toHaveLength(3)
    expect(wrapper!.text()).not.toContain('Initial first task')
    expect(wrapper!.text()).toContain('Updated first task')
    expect(wrapper!.text()).toContain('Other container task')
    expect(wrapper!.text()).toContain('Other source task')
    expect(source().get('time[datetime="2026-10-12T01:01:00Z"]').text()).not.toContain('2026-10-12T01:01:00Z')
    expect(source().findAll('button').some(button => button.text() === 'Load more')).toBe(false)
  })

  it('keeps a healthy source usable when another fails and retries a failed next page with the same cursor', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a'), workSource('source-b')]
    let moreCalls = 0
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (integrationId, _actionId, input) => {
      if (integrationId === 'source-b')
        throw new Error('Source unavailable')
      if (!input?.cursor)
        return { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Loaded task')], nextCursor: 'next', fetchedAt: '2026-10-12T01:00:00Z' }
      if (++moreCalls === 1)
        throw new Error('Next page unavailable')
      return { currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Retried task', 'list-2')] }
    })
    await open()
    expect(source(1).get('[role="alert"]').text()).toContain('Could not load work items')
    expect(source().text()).toContain('Loaded task')
    await button('Load more').trigger('click')
    await flushPromises()
    expect(source().text()).toContain('Loaded task')
    expect(source().text()).toContain('Previous results may be stale')
    expect(source().get('time[datetime="2026-10-12T01:00:00Z"]').text()).not.toContain('2026-10-12T01:00:00Z')
    await button('Retry').trigger('click')
    await flushPromises()

    expect(api.invokeIntegrationAction).toHaveBeenLastCalledWith('source-a', 'list', { mode: 'personal', limit: 20, cursor: 'next' })
    expect(source().findAll('.home-work-row')).toHaveLength(2)
    expect(source().text()).not.toContain('Previous results may be stale')
    expect(source(1).get('[role="alert"]').text()).toContain('Could not load work items')
  })

  it('clears previous-account results when identity changes during pagination', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a')]
    vi.mocked(api.invokeIntegrationAction)
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Old account task')], nextCursor: 'next' })
      .mockResolvedValueOnce({ currentUser: { id: 'other' }, items: [ownedItem('source-a', 'New account task', 'list-1', 'other')] })
    await open()
    await button('Load more').trigger('click')
    await flushPromises()

    expect(wrapper!.text()).not.toContain('Old account task')
    expect(wrapper!.text()).toContain('New account task')
    expect(wrapper!.findAll('.home-work-row')).toHaveLength(1)
    expect(source().get('[role="alert"]').text()).toContain('Source account changed')
  })

  it('retains the last successful snapshot when a global or same-source catalog refresh fails', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [workSource('source-a')]
    vi.mocked(api.invokeIntegrationAction).mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Last successful task')], fetchedAt: '2026-10-12T01:00:00Z' })
    await open()
    vi.mocked(api.invokeIntegrationAction).mockRejectedValue(new Error('Offline'))
    await wrapper!.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(wrapper!.text()).toContain('Last successful task')
    expect(source().get('time[datetime="2026-10-12T01:00:00Z"]').text()).not.toContain('2026-10-12T01:00:00Z')
    expect(wrapper!.text()).toContain('Previous results may be stale')
    store.integrationContributions = [workSource('source-a')]
    await flushPromises()
    expect(wrapper!.text()).toContain('Last successful task')
    await wrapper!.setProps({ integrations: [] })
    await flushPromises()
    expect(wrapper!.text()).not.toContain('Last successful task')
  })

  it('ignores late responses after refresh and after the source is removed', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a'), workSource('source-b')]
    let finishOld!: (page: IntegrationEntityPage) => void
    vi.mocked(api.invokeIntegrationAction)
      .mockImplementationOnce(() => new Promise(resolve => finishOld = resolve))
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Fresh task')] })
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [ownedItem('source-b', 'Selected source task')] })
    await open({ integrations: ['source-a'] })
    await wrapper!.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(wrapper!.text()).toContain('Fresh task')
    await wrapper!.setProps({ integrations: ['source-b'] })
    await flushPromises()
    finishOld({ currentUser: { id: 'me' }, items: [ownedItem('source-a', 'Late old task')] })
    await flushPromises()

    expect(wrapper!.text()).toContain('Selected source task')
    expect(wrapper!.text()).not.toContain('Fresh task')
    expect(wrapper!.text()).not.toContain('Late old task')
    expect(wrapper!.findAll('.home-work-source')).toHaveLength(1)
  })

  it('does not label unidentified accounts as personal work or auto-load confirmed and project-only sources', async () => {
    const confirmed = workSource('confirmed')
    confirmed.actions[0]!.effectiveConfirmation = 'always'
    const projectOnly = workSource('project-only')
    projectOnly.views[0]!.scope = 'project'
    useWorkbenchStore().integrationContributions = [workSource('source-a'), confirmed, projectOnly]
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({ items: [ownedItem('source-a', 'Unidentified task')] })
    await open()

    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    expect(wrapper!.text()).not.toContain('Unidentified task')
    expect(wrapper!.text()).toContain('has not provided your account identity')
    await button('View all').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['source-a', 'work', 'global']])
  })

  it('keeps source identities available without crowding the list and presents provider-local deadlines', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a')]
    const item = ownedItem('source-a', 'Review the project', 'list-1', 'opaque-account-id')
    item.status = 'active'
    item.statusLabel = 'In progress'
    item.dueDate = { dateTime: '2026-10-12T09:30:00', timeZone: 'Asia/Shanghai' }
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({
      currentUser: { id: 'opaque-account-id', label: 'Personal account' },
      items: [item],
      fetchedAt: '2026-10-12T01:00:00Z',
      coverage: 'complete',
    })
    await open()

    expect(source().text()).toContain('Personal account')
    expect(source().text()).not.toContain('opaque-account-id')
    expect(source().text()).not.toContain(item.id)
    expect(source().get('.home-work-item').attributes('title')).toContain(item.id)
    expect(source().get('.daily-row-meta').text()).toContain('In progress')
    const due = source().get('time[datetime="2026-10-12T09:30:00"]')
    expect(due.text()).toContain('9:30')
    expect(due.text()).not.toContain('2026-10-12T09:30:00')
    expect(due.attributes('title')).toContain('Asia/Shanghai')
    expect(source().text()).toContain('Complete')
    expect(wrapper!.find('h2').exists()).toBe(false)
  })

  it('distinguishes a compact preview from full loaded coverage and reveals every loaded item', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a')]
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({
      currentUser: { id: 'me' },
      items: Array.from({ length: 6 }, (_, index) => ownedItem('source-a', `Task ${index + 1}`, `container-${index}`)),
      coverage: 'complete',
    })
    await open({ compact: true })

    expect(wrapper!.get('.home-work h2').text()).toBe('My work')
    expect(source().findAll('.home-work-row')).toHaveLength(5)
    expect(source().text()).toContain('Partial preview')
    await button('Show loaded items').trigger('click')
    expect(source().findAll('.home-work-row')).toHaveLength(6)
    expect(source().text()).toContain('Complete')
    expect(source().text()).not.toContain('Partial preview')
  })

  it('refreshes one source from its group header and retains its snapshot if that refresh fails', async () => {
    useWorkbenchStore().integrationContributions = [workSource('source-a'), workSource('source-b')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async integrationId => ({
      currentUser: { id: 'me' },
      items: [ownedItem(integrationId, `${integrationId} task`)],
      nextCursor: 'next',
      fetchedAt: '2026-10-12T01:00:00Z',
    }))
    await open()
    expect(wrapper!.find('.home-section-heading').exists()).toBe(false)
    vi.mocked(api.invokeIntegrationAction).mockClear().mockRejectedValueOnce(new Error('Offline'))
    await source().get('[aria-label="Refresh source-a"]').trigger('click')
    await flushPromises()

    expect(api.invokeIntegrationAction).toHaveBeenCalledExactlyOnceWith('source-a', 'list', { mode: 'personal', limit: 20 })
    expect(source().text()).toContain('source-a task')
    expect(source().get('[role="alert"]').text()).toContain('Previous results may be stale')
    expect(source(1).text()).toContain('source-b task')
    expect(source(1).find('[role="alert"]').exists()).toBe(false)
  })
})
