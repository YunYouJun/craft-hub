// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { IntegrationEntity, IntegrationEntityPage, ResolvedIntegrationContribution } from 'craft-hub'
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

    expect(wrapper!.get('h2').text()).toBe('My work')
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
