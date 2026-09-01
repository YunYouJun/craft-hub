// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopNavigationDialog from './DesktopNavigationDialog.vue'
import { useWorkbenchStore } from './store'

const reference = { repository: 'https://github.com/YunYouJun/craft-hub', subdir: 'apps/web' }
const projects: ProjectRecord[] = [
  { id: 'one', name: 'One', path: '/one/apps/web', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'two', name: 'Two', path: '/two/apps/web', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
]

describe('desktop navigation dialog', () => {
  afterEach(() => Reflect.deleteProperty(window, 'craftHubDesktop'))

  it('makes the user choose when multiple registered Projects match', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const selectProject = vi.spyOn(store, 'selectProject').mockResolvedValue()
    const selectCapability = vi.spyOn(store, 'selectCapability')
    const wrapper = mount(DesktopNavigationDialog, { props: { matches: projects, reference, capabilityId: 'command:dev' }, global: { plugins: [pinia] } })

    expect(selectProject).not.toHaveBeenCalled()
    await wrapper.get('.desktop-project-matches button').trigger('click')
    expect(selectProject).toHaveBeenCalledWith('one')
    expect(selectCapability).toHaveBeenCalledWith('command:dev')
    expect(wrapper.emitted('resolved')).toHaveLength(1)
  })

  it('verifies a selected checkout before offering explicit registration', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const addProject = vi.spyOn(store, 'addProject').mockResolvedValue()
    const verifyProjectReference = vi.fn(async () => true)
    window.craftHubDesktop = {
      selectProjectDirectory: vi.fn(async () => '/checkout/apps/web'),
      verifyProjectReference,
    }
    const wrapper = mount(DesktopNavigationDialog, { props: { matches: [], reference }, global: { plugins: [pinia] } })

    expect(wrapper.find('.desktop-selected-checkout').exists()).toBe(false)
    await wrapper.get('footer button:nth-child(2)').trigger('click')
    await flushPromises()
    expect(verifyProjectReference).toHaveBeenCalledWith(reference, '/checkout/apps/web')
    expect(wrapper.get('.desktop-selected-checkout').text()).toContain('/checkout/apps/web')
    expect(addProject).not.toHaveBeenCalled()

    await wrapper.get('footer button:last-child').trigger('click')
    await flushPromises()
    expect(addProject).toHaveBeenCalledWith('/checkout/apps/web')
    expect(wrapper.emitted('resolved')).toHaveLength(1)
  })
})
