// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { SplitterPanel } from 'reka-ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import WorkbenchResizeHandle from './WorkbenchResizeHandle.vue'
import WorkbenchSplitter from './WorkbenchSplitter.vue'

const preferenceKey = 'craft-hub-primary-sidebar-width'
const Fixture = defineComponent({
  components: { SplitterPanel, WorkbenchResizeHandle, WorkbenchSplitter },
  props: { compact: Boolean, home: Boolean, middle: Boolean },
  template: `
    <WorkbenchSplitter :compact="compact" :includes-activity-rail="home" :auto-save-id="home ? 'test-home-layout' : undefined" sidebar-label="Resize sidebar">
      <template #sidebar><nav>Navigation</nav></template>
      <SplitterPanel v-if="middle && !compact" id="middle" :order="2" size-unit="px" :default-size="320" :min-size="230" :max-size="540">Commands</SplitterPanel>
      <WorkbenchResizeHandle v-if="middle && !compact" label="Resize commands" />
      <component :is="compact ? 'div' : 'SplitterPanel'" id="content" :order="3" size-unit="px" :min-size="350">Content</component>
    </WorkbenchSplitter>`,
})

function sidebarSize(wrapper: ReturnType<typeof mount>): number {
  // Reka rounds its rendered percentage to three significant digits.
  return Math.round(Number.parseFloat(wrapper.get<HTMLElement>('#primary-sidebar-panel').element.style.flexGrow) * 12)
}

describe('shared workbench splitter', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const [name, value] of Object.entries({ 'width': 236, 'min-width': 208, 'max-width': 346 }))
      document.documentElement.style.setProperty(`--workbench-sidebar-${name}`, `${value}px`)
    document.documentElement.style.setProperty('--workbench-activity-width', '44px')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-panel-group'))
        return DOMRect.fromRect({ width: 1200, height: 800 })
      if (this.hasAttribute('data-resize-handle'))
        return DOMRect.fromRect({ x: 236, y: 0, width: 1, height: 800 })
      return DOMRect.fromRect()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('remembers dragging on either page, excluding the fixed activity rail', async () => {
    const plugin = mount(Fixture, { attachTo: document.body })
    await flushPromises()
    const before = sidebarSize(plugin)
    const handle = plugin.get('[role="separator"]').element
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 236, clientY: 20 }))
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 280, clientY: 20 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 280, clientY: 20 }))
    await flushPromises()
    const resized = sidebarSize(plugin)
    expect(resized).toBeGreaterThan(before)
    expect(Number(localStorage.getItem(preferenceKey))).toBeCloseTo(resized, 1)
    plugin.unmount()

    const home = mount(Fixture, { props: { home: true }, attachTo: document.body })
    await flushPromises()
    expect(sidebarSize(home)).toBeCloseTo(resized + 44, 1)
    await home.get('[role="separator"]').trigger('keydown', { key: 'ArrowLeft' })
    await home.get('[role="separator"]').trigger('keyup', { key: 'ArrowLeft' })
    await flushPromises()
    const narrowed = sidebarSize(home) - 44
    expect(narrowed).toBeLessThan(resized)
    expect(Number(localStorage.getItem(preferenceKey))).toBeCloseTo(narrowed, 1)
    home.unmount()

    const reopened = mount(Fixture, { attachTo: document.body })
    await flushPromises()
    expect(sidebarSize(reopened)).toBeCloseTo(narrowed, 1)
    reopened.unmount()
  })

  it('prefers the shared width over old home layouts even when content panels load later', async () => {
    localStorage.setItem(preferenceKey, '300')
    localStorage.setItem('reka:test-home-layout', JSON.stringify({
      'content,primary-sidebar-panel': { expandToSizes: {}, layout: [24, 76] },
      'content,middle,primary-sidebar-panel': { expandToSizes: {}, layout: [24, 30, 46] },
    }))
    const wrapper = mount(Fixture, { props: { home: true }, attachTo: document.body })
    await flushPromises()
    expect(sidebarSize(wrapper)).toBeCloseTo(344, 1)
    await wrapper.setProps({ middle: true })
    await flushPromises()
    expect(sidebarSize(wrapper)).toBeCloseTo(344, 1)
    expect(wrapper.findAll('[data-panel]')).toHaveLength(3)
    expect(localStorage.getItem(preferenceKey)).toBe('300')
    wrapper.unmount()
  })

  it('migrates an existing home width when no shared preference exists', async () => {
    localStorage.setItem('reka:test-home-layout', JSON.stringify({
      'content,primary-sidebar-panel': { expandToSizes: {}, layout: [25, 75] },
    }))
    const home = mount(Fixture, { props: { home: true }, attachTo: document.body })
    await flushPromises()
    expect(sidebarSize(home)).toBe(300)
    expect(localStorage.getItem(preferenceKey)).toBe('256')
    home.unmount()
    const plugin = mount(Fixture, { attachTo: document.body })
    await flushPromises()
    expect(sidebarSize(plugin)).toBe(256)
    plugin.unmount()
  })

  it('enforces resize limits and preserves the desktop width through compact layout', async () => {
    const wrapper = mount(Fixture, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('[role="separator"]').trigger('keydown', { key: 'End' })
    await wrapper.get('[role="separator"]').trigger('keyup', { key: 'End' })
    await flushPromises()
    expect(sidebarSize(wrapper)).toBeCloseTo(346, 1)
    await wrapper.get('[role="separator"]').trigger('keydown', { key: 'Home' })
    await wrapper.get('[role="separator"]').trigger('keyup', { key: 'Home' })
    await flushPromises()
    expect(sidebarSize(wrapper)).toBeCloseTo(208, 1)
    await wrapper.setProps({ compact: true })
    await nextTick()
    expect(wrapper.find('[role="separator"]').exists()).toBe(false)
    expect(wrapper.get('nav').text()).toBe('Navigation')
    expect(localStorage.getItem(preferenceKey)).toBe('208')
    await wrapper.setProps({ compact: false })
    await flushPromises()
    expect(sidebarSize(wrapper)).toBeCloseTo(208, 1)
    wrapper.unmount()
  })
})
