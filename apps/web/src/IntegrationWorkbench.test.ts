// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { IntegrationContribution, IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationActionForm from './IntegrationActionForm.vue'
import IntegrationEntityList from './IntegrationEntityList.vue'
import IntegrationStatusTransitionControl from './IntegrationStatusTransitionControl.vue'
import IntegrationWorkbench from './IntegrationWorkbench.vue'
import { useWorkbenchStore } from './store'

describe('integration workbench', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
  })

  afterEach(() => vi.restoreAllMocks())

  function workSource(type: 'entity-list' | 'entity-search' = 'entity-list') {
    const store = useWorkbenchStore()
    store.integrationContributions = [{
      id: 'tasks',
      pluginId: 'tasks',
      source: 'host:tasks',
      provider: { id: 'tasks', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'list', title: 'List tasks', operation: type === 'entity-list' ? 'work-items.list' : 'work-items.search', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{ id: 'work', title: 'Work', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'tasks', type, actionId: 'list', input: { limit: 20, mode: 'personal' } }] }],
    }]
    return store
  }

  function task(containerId: string, title: string, accountId = 'me'): IntegrationEntity {
    return { id: '1', title, sourceRef: { providerId: 'tasks', instanceId: 'tasks', accountId, containerId, kind: 'task', itemId: '1' }, personalMembership: { accountId, relation: 'owned' } }
  }

  it('waits for account connection before loading work, then clears work on disconnect', async () => {
    const store = workSource()
    const source = store.integrationContributions[0]!
    source.actions.push({ id: 'status', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' })
    source.views[0]!.blocks.unshift({ id: 'connection', type: 'connection-status', actionId: 'status' })
    let connected = false
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_id, action) => action === 'status' ? { connected } : { currentUser: { id: 'me' }, items: [task('one', 'Private task')] })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(invoke).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Connect your account first')
    connected = true
    await wrapper.get('[data-testid="integration-block-connection"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Private task')
    connected = false
    invoke.mockClear()
    await wrapper.get('[data-testid="integration-block-connection"] button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('Private task')
    wrapper.unmount()
  })

  it('keeps a standalone title outside the scrollable content and omits it when embedded', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [{
      id: 'tools',
      pluginId: 'tools',
      source: 'host:tools',
      provider: { id: 'tools', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [],
      views: [{ id: 'overview', title: 'Tools', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global', blocks: [] }],
    }]
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tools', viewId: 'overview' }, global: { plugins: [pinia] } })
    expect(wrapper.get('.workbench-frame-header h1').text()).toBe('Tools')
    expect(wrapper.get('.workbench-frame-scroll').find('h1').exists()).toBe(false)
    expect(wrapper.find('.workbench-frame-scroll .integration-content').exists()).toBe(true)

    await wrapper.setProps({ embedded: true })
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.find('.integration-content').exists()).toBe(true)
    wrapper.unmount()
  })

  it('translates Workstation connection errors and preserves unknown diagnostics', async () => {
    const message = 'Workstation is unavailable. Configure the versioned local CLI on this host.'
    const integration = {
      id: 'workstation',
      provider: { id: 'workstation', requires: '^1.0.0' },
      translations: {
        'zh-CN': { [message]: '无法连接 Workstation。请在本机配置支持当前版本接口的本地 CLI。' },
      },
      actions: [{ id: 'inspect', title: 'Inspect configuration', operation: 'configuration.read', effect: 'local-read', confirmation: 'never' }],
      views: [{ id: 'environment', title: 'Environment configuration', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'configuration', type: 'configuration-manager', actionId: 'inspect' }] }],
    } satisfies IntegrationContribution
    const store = useWorkbenchStore()
    store.integrationContributions = [{
      ...integration,
      pluginId: 'workstation',
      source: 'host:workstation',
      providerVersion: '1.0.0',
      actions: integration.actions.map(action => ({ ...action, effectiveConfirmation: action.confirmation })),
    }]
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error(message))
    useI18n().setLocale('zh-CN')
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'workstation', viewId: 'environment' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('无法连接 Workstation。请在本机配置支持当前版本接口的本地 CLI。')

    useI18n().setLocale('en')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe(message)

    invoke.mockRejectedValue(new Error('Unknown backend diagnostic'))
    useI18n().setLocale('zh-CN')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Unknown backend diagnostic')
    wrapper.unmount()
    invoke.mockRestore()
  })

  it('keeps folded project actions read-only until a project is selected and a write is confirmed', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [{
      id: 'reviews',
      pluginId: 'reviews',
      source: 'host:reviews',
      provider: { id: 'reviews', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'create', title: 'Create review', operation: 'merge-requests.create', effect: 'remote-write', confirmation: 'always', effectiveConfirmation: 'always' }],
      views: [{ id: 'overview', title: 'Reviews', icon: 'builtin:code', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{
        id: 'create',
        type: 'action-form',
        actionId: 'create',
        collapsible: true,
        requiresProject: true,
        fields: [{ id: 'title', label: 'Title', type: 'text', required: true }],
      }] }],
    }]
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ id: '1', title: 'Created' })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'reviews', viewId: 'overview' }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    await wrapper.get('summary').trigger('click')
    expect(wrapper.findComponent(IntegrationActionForm).exists()).toBe(false)
    expect(wrapper.text()).toContain(useI18n().t('integrationProjectRequired'))
    expect(invoke).not.toHaveBeenCalled()

    store.selectedProjectId = 'project-1'
    await flushPromises()
    expect(wrapper.getComponent(IntegrationActionForm).props('projectId')).toBe('project-1')
    await wrapper.get('input').setValue('Review this change')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Review this change')
    expect(invoke).not.toHaveBeenCalled()

    // Clearing the scope tears down the pending form instead of retaining a write for the previous project.
    store.selectedProjectId = ''
    await flushPromises()
    expect(wrapper.findComponent(IntegrationActionForm).exists()).toBe(false)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    wrapper.unmount()
    invoke.mockRestore()
  })

  it('shows a read-only preview while installation metadata is pending', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [{
      id: 'config',
      pluginId: 'config',
      source: 'host:config',
      provider: { id: 'config', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'read', title: 'Read', operation: 'configuration.list', effect: 'local-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{ id: 'config', title: 'Config', icon: 'builtin:terminal', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'config', type: 'entity-list', actionId: 'read', previewInput: { preview: true } }] }],
    }]
    let finish!: (value: { items: Array<{ id: string, title: string }> }) => void
    const complete = new Promise<{ items: Array<{ id: string, title: string }> }>((resolve) => {
      finish = resolve
    })
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_id, _action, input) => input?.preview ? { items: [{ id: 'plugin', title: 'Checking installation' }] } : complete)
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'config', viewId: 'config' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Checking installation')
    expect(wrapper.get('.integration-block header button').attributes('disabled')).toBeDefined()
    finish({ items: [{ id: 'plugin', title: 'Installed plugin' }] })
    await flushPromises()
    expect(wrapper.text()).toContain('Installed plugin')
    expect(wrapper.text()).not.toContain('Checking installation')
    expect(invoke).toHaveBeenCalledTimes(2)
    // A catalog refresh must not tear down stateful connection forms in the same view.
    store.integrationContributions = store.integrationContributions.map(contribution => ({ ...contribution }))
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Installed plugin')
    wrapper.unmount()
    invoke.mockRestore()
  })

  it('opens an explicit global source without rebinding it to the selected project and reacts to scope navigation', async () => {
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project-1'
    store.integrationContributions = [{
      id: 'issues',
      pluginId: 'issues',
      source: 'host:issues',
      provider: { id: 'issues', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'list', title: 'List work', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{ id: 'work', title: 'Work', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'items', type: 'entity-list', actionId: 'list' }] }],
    }]
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, _action, _input, projectId) => ({ items: [{ id: 'item', title: projectId ? 'Project work' : 'Global work' }] }))
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'issues', viewId: 'work', initialScope: 'global' }, global: { plugins: [pinia] } })
    await flushPromises()

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke).toHaveBeenLastCalledWith('issues', 'list', {}, undefined)
    expect(wrapper.text()).toContain('Global work')
    expect(store.selectedProjectId).toBe('project-1')

    await wrapper.setProps({ initialScope: undefined })
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('issues', 'list', {}, 'project-1')
    expect(wrapper.text()).toContain('Project work')

    await wrapper.setProps({ initialScope: 'global' })
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('issues', 'list', {}, undefined)
    expect(wrapper.text()).toContain('Global work')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(store.selectedProjectId).toBe('project-1')
    wrapper.unmount()
    invoke.mockRestore()
  })

  it('renders host-neutral blocks and forwards their declarative input', async () => {
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project-1'
    store.integrationContributions = [{
      id: 'acme-issues',
      pluginId: '@acme/craft-hub-plugin-issues',
      source: 'plugin:@acme/craft-hub-plugin-issues@1.0.0',
      provider: { id: 'acme', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [
        { id: 'status', title: 'Connection', operation: 'connection.status', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
        { id: 'list', title: 'Assigned to me', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
        { id: 'transitions', title: 'List transitions', operation: 'work-items.transitions', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
        { id: 'update-status', title: 'Update status', operation: 'work-items.update-status', effect: 'remote-write', confirmation: 'always', effectiveConfirmation: 'always' },
      ],
      views: [{
        id: 'overview',
        title: 'Acme Issues',
        icon: 'builtin:chart',
        placement: 'primary-sidebar',
        scope: 'global-and-project',
        blocks: [
          { id: 'connection', type: 'connection-status', actionId: 'status' },
          { id: 'assigned', type: 'entity-list', actionId: 'list', input: { mode: 'assigned', limit: 60 } },
        ],
      }],
    }]
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integrationId, actionId) => actionId === 'status'
      ? { connected: true, accountLabel: 'developer@example.com' }
      : { items: [{ id: 'issue-1', title: 'Review proposal', status: 'Open', url: 'https://example.com/issues/1' }] })

    const wrapper = mount(IntegrationWorkbench, {
      props: { integrationId: 'acme-issues', viewId: 'overview' },
      global: { plugins: [pinia] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Acme Issues')
    expect(invoke).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Connected'))
    expect(wrapper.text()).toContain('Review proposal')
    expect(wrapper.get('.integration-status-trigger').text()).toBe('Change status')
    expect(invoke).toHaveBeenCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, 'project-1')

    wrapper.getComponent(IntegrationStatusTransitionControl).vm.$emit('updated', {
      id: 'issue-1',
      title: 'Review proposal',
      status: 'Done',
      url: 'https://example.com/issues/1',
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="listitem"]').text()).toContain('Done')

    wrapper.findComponent({ name: 'FormSelect' }).vm.$emit('update:modelValue', 'global')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, undefined)

    store.integrationContributions[0]!.views[0]!.scope = 'global'
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, undefined)
    expect(wrapper.getComponent(IntegrationStatusTransitionControl).props('projectId')).toBeUndefined()
    wrapper.unmount()
  })

  it('appends two pages without losing declarative filters or conflating equal IDs in different containers', async () => {
    const store = workSource()
    store.selectedProjectId = 'untrusted-project'
    const execute = vi.spyOn(api, 'run')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [task('one', 'First task')], nextCursor: 'next', coverage: 'partial', fetchedAt: '2026-10-12T01:00:00Z' })
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [task('one', 'Updated task'), task('two', 'Second task')], coverage: 'complete', fetchedAt: '2026-10-12T01:01:00Z' })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[data-testid="integration-pagination-tasks"]').text()).toContain('Partially loaded')
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('tasks', 'list', { limit: 20, mode: 'personal', cursor: 'next' }, 'untrusted-project')
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Updated task')
    expect(wrapper.text()).not.toContain('First task')
    expect(wrapper.get('[data-testid="integration-pagination-tasks"]').text()).toContain('Fully loaded')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-12T01:01:00Z')
    expect(execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps a successful snapshot visible when pagination fails and retries the same cursor', async () => {
    workSource()
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ items: [task('one', 'First task')], nextCursor: 'next', coverage: 'partial', fetchedAt: '2026-10-12T01:00:00Z' })
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ items: [task('two', 'Second task')], coverage: 'complete' })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('First task')
    expect(wrapper.get('[role="alert"]').text()).toBe('Network unavailable')
    expect(wrapper.get('[data-testid="integration-pagination-tasks"]').text()).toContain('Content is stale')
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-12T01:00:00Z')
    expect(wrapper.get('[data-testid="integration-pagination-tasks"] button').text()).toBe('Retry')
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('tasks', 'list', { limit: 20, mode: 'personal', cursor: 'next' }, undefined)
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('Content is stale')
    wrapper.unmount()
  })

  it('preserves the latest snapshot on refresh failure and clears it when declarative filters change', async () => {
    const store = workSource()
    let finish!: (page: IntegrationEntityPage) => void
    vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ items: [task('one', 'First task')], coverage: 'complete' })
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('.integration-block-heading button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('First task')
    expect(wrapper.text()).toContain('Content is stale')
    store.integrationContributions[0]!.views[0]!.blocks[0]!.input = { mode: 'all' }
    await flushPromises()
    expect(wrapper.text()).not.toContain('First task')
    expect(wrapper.text()).not.toContain('Refresh failed')
    finish({ items: [task('two', 'New filter task')] })
    await flushPromises()
    expect(wrapper.text()).toContain('New filter task')
    wrapper.unmount()
  })

  it('continues empty pages and stops a repeated cursor without implying complete coverage', async () => {
    workSource()
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ items: [], nextCursor: 'one' })
      .mockResolvedValueOnce({ items: [], nextCursor: 'two' })
      .mockResolvedValueOnce({ items: [task('one', 'Visible task')], nextCursor: 'one' })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('Visible task')
    expect(wrapper.get('[role="alert"]').text()).toContain('repeated a pagination cursor')
    expect(wrapper.get('[data-testid="integration-pagination-tasks"]').text()).toContain('Partially loaded')
    expect(wrapper.get('[data-testid="integration-pagination-tasks"] button').text()).toBe('Retry')
    wrapper.unmount()
  })

  it('replaces the page when the provider changes accounts between pages', async () => {
    workSource()
    vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ currentUser: { id: 'me' }, items: [task('one', 'Previous account task')], nextCursor: 'next' })
      .mockResolvedValueOnce({ currentUser: { id: 'other' }, items: [task('one', 'New account task', 'other')], coverage: 'complete' })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Previous account task')
    expect(wrapper.text()).toContain('New account task')
    expect(wrapper.getComponent(IntegrationEntityList).props('currentUser')).toEqual({ id: 'other' })
    wrapper.unmount()
  })

  it('ignores a late response from the previous project scope', async () => {
    const store = workSource()
    let finish!: (page: IntegrationEntityPage) => void
    vi.spyOn(api, 'invokeIntegrationAction')
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce({ items: [task('two', 'Project task')] })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    store.selectedProjectId = 'project-1'
    await flushPromises()
    expect(wrapper.text()).toContain('Project task')
    finish({ items: [task('one', 'Late global task')] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Late global task')
    expect(wrapper.text()).toContain('Project task')
    wrapper.unmount()
  })

  it('forwards the submitted search and preserves it when loading another page', async () => {
    workSource('entity-search')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ items: [task('one', 'Matching task')], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [task('two', 'Another matching task')] })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    expect(invoke).not.toHaveBeenCalled()
    await wrapper.get('.integration-search input').setValue('  match  ')
    await wrapper.get('.integration-search').trigger('submit')
    await flushPromises()
    await wrapper.get('[data-testid="integration-pagination-tasks"] button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('tasks', 'list', { limit: 20, mode: 'personal', keyword: 'match', cursor: 'next' }, undefined)
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(2)
    wrapper.unmount()
  })

  it('ignores a late response when a new search replaces the current query', async () => {
    workSource('entity-search')
    let finish!: (page: IntegrationEntityPage) => void
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockImplementationOnce(() => new Promise(resolve => finish = resolve))
      .mockResolvedValueOnce({ items: [task('two', 'New query task')] })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await wrapper.get('.integration-search input').setValue('old')
    await wrapper.get('.integration-search').trigger('submit')
    await flushPromises()
    await wrapper.get('.integration-search input').setValue('new')
    await wrapper.get('.integration-search').trigger('submit')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('tasks', 'list', { limit: 20, mode: 'personal', keyword: 'new' }, undefined)
    finish({ items: [task('one', 'Old query task')], nextCursor: 'old-next' })
    await flushPromises()
    expect(wrapper.text()).toContain('New query task')
    expect(wrapper.text()).not.toContain('Old query task')
    expect(wrapper.find('[data-testid="integration-pagination-tasks"] button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses explicit personal ownership without inventing assignees and respects the exact current account', async () => {
    const store = workSource()
    store.integrationContributions[0]!.views[0]!.blocks[0]!.assigneeFilter = 'current-user'
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({
      currentUser: { id: 'me' },
      items: [task('one', 'My personal task'), task('two', 'Other account task', 'other'), { ...task('three', 'Unknown relation task'), personalMembership: { accountId: 'me', relation: 'unknown' } }],
    })
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.findAll('[role="listitem"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('My personal task')
    expect(wrapper.text()).not.toContain('Other account task')
    expect(wrapper.getComponent(IntegrationEntityList).props('items').every((item: IntegrationEntity) => item.assignees === undefined)).toBe(true)
    wrapper.unmount()
  })

  it('does not auto-invoke writes declared as list blocks', async () => {
    const store = workSource()
    store.integrationContributions[0]!.actions[0]!.effect = 'remote-write'
    store.integrationContributions[0]!.actions[0]!.effectiveConfirmation = 'always'
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
    const wrapper = mount(IntegrationWorkbench, { props: { integrationId: 'tasks', viewId: 'work' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(invoke).not.toHaveBeenCalled()
    await wrapper.get('.integration-block-heading button').trigger('click')
    expect(invoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
