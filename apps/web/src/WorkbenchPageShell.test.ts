// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import WorkbenchPageShell from './WorkbenchPageShell.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

function scroll(element: Element, top: number): Promise<void> {
  element.scrollTop = top
  element.dispatchEvent(new Event('scroll'))
  return Promise.resolve()
}

describe('scroll edge separators', () => {
  it('shows the path bar separator only while the page scroller is scrolled', async () => {
    const wrapper = mount(WorkbenchPageShell, {
      props: { breadcrumbs: [{ label: 'Home' }] },
      slots: { default: () => h('main', { class: 'page-scroller' }, [h('section', { class: 'nested-panel' })]) },
    })
    const path = wrapper.get('.workbench-page-path')
    expect(path.attributes('data-scrolled')).toBeUndefined()

    await scroll(wrapper.get('.page-scroller').element, 24)
    expect(path.attributes('data-scrolled')).toBe('true')

    // A panel lower on the page does not run under the path bar.
    const nested = wrapper.get('.nested-panel').element
    nested.getBoundingClientRect = () => ({ top: 160 }) as DOMRect
    await scroll(nested, 0)
    expect(path.attributes('data-scrolled')).toBe('true')

    await scroll(wrapper.get('.page-scroller').element, 0)
    expect(path.attributes('data-scrolled')).toBeUndefined()
  })

  it('shows the frame separator once content scrolls under the title header', async () => {
    const wrapper = mount(WorkbenchViewFrame, { props: { title: 'Tools' }, slots: { default: () => h('p', 'Content') } })
    expect(wrapper.attributes('data-scrolled')).toBeUndefined()
    await scroll(wrapper.get('.workbench-frame-scroll').element, 12)
    expect(wrapper.attributes('data-scrolled')).toBe('true')
    await scroll(wrapper.get('.workbench-frame-scroll').element, 0)
    expect(wrapper.attributes('data-scrolled')).toBeUndefined()
  })
})
