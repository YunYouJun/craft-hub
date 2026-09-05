// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import PluginWorkbench from './PluginWorkbench.vue'
import { useWorkbenchStore } from './store'

describe('plugin workbench', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
  })

  it('switches between composed integration and navigation views', async () => {
    const store = useWorkbenchStore()
    store.pluginWorkbenches = [{
      id: 'internal',
      pluginId: '@acme/craft-hub-plugin-suite',
      pluginName: 'Acme Suite',
      pluginVersion: '1.0.0',
      title: 'Internal workbench',
      description: 'One place for daily work.',
      icon: 'builtin:briefcase',
      views: [
        { type: 'integration', plugin: '@acme/craft-hub-plugin-issues', integration: 'acme-issues', view: 'overview' },
        { type: 'navigation', plugin: '@acme/craft-hub-plugin-suite', panel: 'resources' },
      ],
    }]
    store.integrationContributions = [{
      id: 'acme-issues',
      pluginId: '@acme/craft-hub-plugin-issues',
      source: 'plugin:@acme/craft-hub-plugin-issues@1.0.0',
      provider: { id: 'acme', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'list', title: 'Assigned to me', operation: 'issues.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{
        id: 'overview',
        title: 'Issues',
        icon: 'builtin:list',
        placement: 'primary-sidebar',
        scope: 'global',
        blocks: [{ id: 'items', type: 'entity-list', actionId: 'list' }],
      }],
    }]
    vi.spyOn(api, 'navigationPanels').mockResolvedValue([{
      id: 'resources',
      pluginId: '@acme/craft-hub-plugin-suite',
      pluginName: 'Acme Suite',
      pluginVersion: '1.0.0',
      title: 'Resources',
      icon: 'builtin:web',
      links: [{ id: 'handbook', title: 'Handbook', url: 'https://example.com/handbook', keywords: [] }],
    }])
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [{ id: '1', title: 'Review change' }] })

    const wrapper = mount(PluginWorkbench, {
      props: { pluginId: '@acme/craft-hub-plugin-suite', workbenchId: 'internal' },
      global: { plugins: [pinia] },
    })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('Internal workbench')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Review change')
    expect(wrapper.find('.integration-header').exists()).toBe(false)

    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.get('.navigation-links a').text()).toContain('Handbook')
    expect(wrapper.get('.navigation-links a').attributes('href')).toBe('https://example.com/handbook')
  })
})
