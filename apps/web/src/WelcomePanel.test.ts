// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WelcomePanel from './WelcomePanel.vue'

describe('guided first run welcome', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'craftHubDesktop')
    vi.restoreAllMocks()
  })

  it('uses the desktop folder picker and adds the selected local project', async () => {
    useI18n().setLocale('en')
    window.craftHubDesktop = {
      selectProjectDirectory: vi.fn(async () => '/workspace/example'),
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const addProject = vi.spyOn(store, 'addProject').mockResolvedValue()

    const wrapper = mount(WelcomePanel, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain('Choose a local project')
    await wrapper.get('.welcome-action').trigger('click')
    await flushPromises()

    expect(window.craftHubDesktop.selectProjectDirectory).toHaveBeenCalledOnce()
    expect(addProject).toHaveBeenCalledWith('/workspace/example')
  })

  it('can be dismissed when replayed from the desktop menu', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(WelcomePanel, { props: { replaying: true }, global: { plugins: [pinia] } })

    expect(wrapper.text()).toContain('Choose another project')
    await wrapper.get('.welcome-close').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
