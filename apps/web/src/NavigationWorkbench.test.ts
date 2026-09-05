// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NavigationWorkbench from './NavigationWorkbench.vue'

const panels = [{
  id: 'development',
  pluginId: '@example/craft-hub-plugin-links',
  pluginName: 'Engineering links',
  pluginVersion: '1.0.0',
  title: 'Developer resources',
  description: 'Shared engineering systems',
  icon: 'builtin:code',
  links: [
    { id: 'handbook', title: 'Engineering handbook', description: 'Standards and workflows', url: 'https://example.com/handbook', icon: 'builtin:docs', keywords: ['standards'] },
    { id: 'metrics', title: 'Metrics', description: 'Service dashboards', url: 'https://example.com/metrics', icon: 'builtin:chart', keywords: ['data'] },
  ],
}]

describe('navigation workbench', () => {
  afterEach(() => vi.restoreAllMocks())

  it('renders plugin panels and filters links across metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(panels), { status: 200 })))
    const wrapper = mount(NavigationWorkbench, { global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Developer resources')
    expect(wrapper.findAll('.navigation-links a')).toHaveLength(2)
    expect(wrapper.get('.navigation-links a').attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })

    await wrapper.get('input[type="search"]').setValue('data')
    expect(wrapper.findAll('.navigation-links a')).toHaveLength(1)
    expect(wrapper.text()).toContain('Metrics')
    wrapper.unmount()
  })

  it('offers plugin management when no panel is installed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })))
    const wrapper = mount(NavigationWorkbench, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.get('.navigation-state button').trigger('click')
    expect(wrapper.emitted('managePlugins')).toHaveLength(1)
    wrapper.unmount()
  })
})
