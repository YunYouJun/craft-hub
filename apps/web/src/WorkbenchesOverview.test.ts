// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ResolvedIntegrationContribution } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api } from './api'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkbenchesOverview from './WorkbenchesOverview.vue'

function integration(id: string, views: ResolvedIntegrationContribution['views']): ResolvedIntegrationContribution {
  return {
    id,
    pluginId: `@example/craft-hub-plugin-${id}`,
    source: `plugin:@example/craft-hub-plugin-${id}@1.0.0`,
    provider: { id: 'example', requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [],
    views,
  }
}

function view(id: string, scope: ResolvedIntegrationContribution['views'][number]['scope'] = 'global'): ResolvedIntegrationContribution['views'][number] {
  return { id, title: id, icon: 'builtin:list', placement: 'primary-sidebar', scope, blocks: [] }
}

describe('workbenches overview', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.restoreAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    useWorkbenchStore().integrationsLoadState = 'ready'
  })

  async function render() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/workbenches', component: { template: '<div />' } },
        { path: '/workbenches/:pluginId/:workbenchId', name: 'plugin-workbench', component: { template: '<div />' } },
        { path: '/integrations/:integrationId/:viewId', name: 'integration', component: { template: '<div />' } },
        { path: '/marketplace', component: { template: '<div />' } },
      ],
    })
    await router.push('/workbenches')
    await router.isReady()
    const wrapper = mount(WorkbenchesOverview, { global: { plugins: [pinia, router] } })
    return { wrapper, router }
  }

  it('uses the store composition contract and keeps explicit standalone entries', async () => {
    const store = useWorkbenchStore()
    store.pluginWorkbenches = [{
      id: 'daily',
      pluginId: '@example/craft-hub-plugin-suite',
      pluginName: 'Daily suite',
      pluginVersion: '1.0.0',
      title: 'Daily work',
      description: 'Your connected work.',
      icon: 'builtin:briefcase',
      views: [
        { type: 'integration', plugin: '@example/craft-hub-plugin-items', integration: 'items', view: 'composed' },
        { type: 'integration', plugin: '@example/craft-hub-plugin-items', integration: 'items', view: 'visible' },
      ],
    }]
    store.integrationContributions = [integration('items', [view('composed'), { ...view('visible'), showInSidebar: true }, view('standalone')])]
    const { wrapper, router } = await render()

    expect(wrapper.get('h1').text()).toBe('Workbenches')
    expect(wrapper.findAll('h2').map(heading => heading.text())).toEqual(['Installed workbenches', 'Standalone integrations'])
    expect(wrapper.get('[data-testid="workbench-entry-daily"]').text()).toContain('Your connected work.')
    expect(wrapper.find('[data-testid="integration-entry-items-composed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="integration-entry-items-visible"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="integration-entry-items-standalone"]').exists()).toBe(true)
    const entry = wrapper.get('[data-testid="workbench-entry-daily"]')
    expect(entry.attributes('href')).toBe('/workbenches/@example%2Fcraft-hub-plugin-suite/daily')
    await entry.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params).toEqual({ pluginId: '@example/craft-hub-plugin-suite', workbenchId: 'daily' })
    wrapper.unmount()
  })

  it('places environment configuration in its own entry and preserves project scope routing', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [integration('tools', [
      { ...view('environment'), blocks: [{ id: 'config', type: 'configuration-manager', actionId: 'read' }] },
      view('global'),
      view('shared', 'global-and-project'),
      view('project', 'project'),
    ])]
    const { wrapper, router } = await render()

    expect(wrapper.find('[data-testid="integration-entry-tools-environment"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="integration-entry-tools-global"]').attributes('href')).toBe('/integrations/tools/global?scope=global')
    expect(wrapper.get('[data-testid="integration-entry-tools-shared"]').attributes('href')).toBe('/integrations/tools/shared?scope=global')
    const project = wrapper.get('[data-testid="integration-entry-tools-project"]')
    expect(project.attributes('href')).toBe('/integrations/tools/project')
    expect(project.text()).toContain('Requires a project')
    await project.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('integration')
    expect(router.currentRoute.value.query).toEqual({})
    expect(store.selectedProjectId).toBe('')
    wrapper.unmount()
  })

  it('shows a localized empty state that opens plugin management', async () => {
    useI18n().setLocale('zh-CN')
    const { wrapper, router } = await render()

    expect(wrapper.get('h1').text()).toBe('工作台')
    expect(wrapper.text()).toContain('接入你的工作台')
    await wrapper.get('.workbenches-state button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/marketplace')
    wrapper.unmount()
  })

  it('distinguishes integration loading from a recoverable load error', async () => {
    const store = useWorkbenchStore()
    store.integrationsLoadState = 'loading'
    const load = vi.spyOn(store, 'loadIntegrations').mockResolvedValue(undefined)
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
    const { wrapper } = await render()

    expect(wrapper.get('[role="status"]').text()).toContain('Loading workbenches')
    expect(wrapper.text()).not.toContain('Connect your workbenches')
    store.integrationsLoadState = 'error'
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Integrations could not be loaded')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(load).toHaveBeenCalledOnce()
    expect(invoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
