// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationActionForm from './IntegrationActionForm.vue'
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

    await wrapper.get('select[aria-label="Configuration scope"]').setValue('')
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, undefined)

    store.integrationContributions[0]!.views[0]!.scope = 'global'
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, undefined)
    expect(wrapper.getComponent(IntegrationStatusTransitionControl).props('projectId')).toBeUndefined()
    wrapper.unmount()
  })
})
