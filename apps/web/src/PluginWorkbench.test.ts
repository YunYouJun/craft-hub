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
    vi.restoreAllMocks()
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
        { type: 'integration', plugin: '@acme/craft-hub-plugin-issues', integration: 'acme-issues', view: 'overview', group: 'Work items' },
        { type: 'navigation', plugin: '@acme/craft-hub-plugin-suite', panel: 'resources', group: 'Resources' },
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
        icon: 'data:image/svg+xml;base64,PHN2Zy8+',
        placement: 'primary-sidebar',
        scope: 'global',
        blocks: [{ id: 'items', type: 'entity-list', actionId: 'list' }],
      }],
    }]
    const navigation = vi.spyOn(api, 'navigationPanels').mockResolvedValue([{
      id: 'resources',
      pluginId: '@acme/craft-hub-plugin-suite',
      pluginName: 'Acme Suite',
      pluginVersion: '1.0.0',
      title: 'Resources',
      icon: 'builtin:web',
      links: [{ id: 'handbook', title: 'Handbook', url: 'https://example.com/handbook', keywords: [] }],
    }])
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [{ id: '1', title: 'Review change' }] })

    const wrapper = mount(PluginWorkbench, {
      props: { pluginId: '@acme/craft-hub-plugin-suite', workbenchId: 'internal' },
      global: { plugins: [pinia] },
    })
    await flushPromises()

    expect(wrapper.get('.workbench-page-sidebar strong').text()).toBe('Internal workbench')
    expect(wrapper.get('[role="separator"]').attributes('aria-label')).toBe('Resize sidebar')
    expect(wrapper.get('h1').text()).toBe('Issues')
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
    const sidebarIcon = wrapper.get('[role="tab"] .visual-icon')
    expect(sidebarIcon.classes()).toContain('visual-icon-mask')
    expect(wrapper.findAll('.plugin-workbench-group h2').map(group => group.text())).toEqual(['Work items', 'Resources'])
    expect(wrapper.text()).toContain('Review change')
    expect(wrapper.find('.integration-header').exists()).toBe(false)

    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.get('.navigation-links a').text()).toContain('Handbook')
    expect(wrapper.get('.navigation-links a').attributes('href')).toBe('https://example.com/handbook')
    expect(wrapper.get('h1').text()).toBe('Resources')
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'Home' })
    await flushPromises()
    expect(wrapper.text()).toContain('Review change')

    invoke.mockResolvedValue({ items: [{ id: '1', title: 'Updated review' }] })
    const refresh: unknown = Reflect.get(wrapper.vm, 'refresh')
    if (typeof refresh !== 'function')
      throw new TypeError('Workbench refresh action is unavailable')
    await refresh()
    await flushPromises()
    expect(wrapper.text()).toContain('Updated review')
    expect(wrapper.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')
    expect(navigation).toHaveBeenCalledOnce()
    const integrationReadCount = invoke.mock.calls.length
    await wrapper.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(navigation).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledTimes(integrationReadCount)
    wrapper.unmount()
  })

  it('renders generic host views selected by a plugin and opens projects through host navigation', async () => {
    const store = useWorkbenchStore()
    store.projectsLoadState = 'ready'
    store.integrationsLoadState = 'ready'
    store.projects = [{ id: 'local', name: 'Local project', path: '/repos/local', trust: 'untrusted', addedAt: '2026-10-12T00:00:00Z' }]
    store.pluginWorkbenches = [{ id: 'daily', pluginId: '@acme/craft-hub-plugin-suite', pluginName: 'Suite', pluginVersion: '1.0.0', title: 'Daily work', views: [
      { type: 'host', view: 'work-items', integrations: [], group: 'Tasks' },
      { type: 'host', view: 'projects', group: 'Development' },
    ] }]
    vi.spyOn(api, 'navigationPanels').mockResolvedValue([])
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
    const wrapper = mount(PluginWorkbench, { props: { pluginId: '@acme/craft-hub-plugin-suite', workbenchId: 'daily' }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('Connect your work items')
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.text()).toContain('Local project')
    const open = wrapper.get('[data-testid="open-project-local"]')
    await open.trigger('click')
    expect(wrapper.emitted('openProject')).toEqual([['local']])
    expect(store.projects[0]?.trust).toBe('untrusted')
    expect(invoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps unavailable members reachable by keyboard and associates tabs with the visible panel', async () => {
    const store = useWorkbenchStore()
    store.pluginWorkbenches = [{ id: 'daily', pluginId: '@acme/craft-hub-plugin-suite', pluginName: 'Suite', pluginVersion: '1.0.0', title: 'Daily work', views: [
      { type: 'host', view: 'work-items', integrations: [], group: 'Tasks' },
      { type: 'integration', plugin: '@acme/craft-hub-plugin-suite', integration: 'missing', view: 'overview', group: 'Resources' },
    ] }]
    vi.spyOn(api, 'navigationPanels').mockResolvedValue([])
    const wrapper = mount(PluginWorkbench, { props: { pluginId: '@acme/craft-hub-plugin-suite', workbenchId: 'daily' }, global: { plugins: [pinia] } })
    await flushPromises()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map(tab => tab.element.tagName)).toEqual(['BUTTON', 'BUTTON'])
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1'])
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'End' })
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['-1', '0'])
    expect(tabs[1]!.attributes('aria-selected')).toBe('true')
    expect(tabs[1]!.attributes('aria-controls')).toBe(wrapper.get('[role="tabpanel"]').attributes('id'))
    expect(wrapper.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(tabs[1]!.attributes('id'))
    expect(wrapper.text()).toContain('This view is unavailable')
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })
})
