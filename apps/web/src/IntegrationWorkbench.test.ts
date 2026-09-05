// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
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

    store.integrationContributions[0]!.views[0]!.scope = 'global'
    await flushPromises()
    expect(invoke).toHaveBeenLastCalledWith('acme-issues', 'list', { mode: 'assigned', limit: 60 }, undefined)
    expect(wrapper.getComponent(IntegrationStatusTransitionControl).props('projectId')).toBeUndefined()
    wrapper.unmount()
  })
})
