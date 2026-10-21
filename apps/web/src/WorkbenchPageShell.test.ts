// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import WorkbenchPageShell from './WorkbenchPageShell.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

function scroll(element: Element, top: number): Promise<void> {
  element.scrollTop = top
  element.dispatchEvent(new Event('scroll'))
  return Promise.resolve()
}

function pageRouter() {
  return createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
}

describe('page paths', () => {
  it.each([
    [{ label: 'Home' }],
    [{ label: 'Craft Hub', to: '/overview' }, { label: 'Home' }],
    [{ label: 'Craft Hub', to: '/overview' }, { label: 'Plugins', to: '/marketplace' }, { label: 'Plugins', to: '/marketplace' }],
  ])('omits the path bar when primary navigation and the page title already identify the page (%j)', (...breadcrumbs) => {
    const wrapper = mount(WorkbenchPageShell, { props: { breadcrumbs } })
    expect(wrapper.find('.workbench-page-path').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retains a useful section parent without repeating the application destination', async () => {
    const router = pageRouter()
    await router.push('/software')
    const wrapper = mount(WorkbenchPageShell, {
      props: { breadcrumbs: [{ label: 'Craft Hub', to: '/overview' }, { label: 'Tools', to: '/tools' }, { label: 'Software center' }] },
      global: { plugins: [router] },
    })
    expect(wrapper.find('a[href="/overview"]').exists()).toBe(false)
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Software center')
    await wrapper.get('a[href="/tools"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tools')
    wrapper.unmount()
  })

  it('preserves deep subscription parents and their query when returning from settings', async () => {
    const router = pageRouter()
    await router.push('/subscriptions/team?view=settings')
    const wrapper = mount(WorkbenchPageShell, {
      props: { breadcrumbs: [
        { label: 'Projects', to: '/' },
        { label: 'Workspace sources', to: '/subscriptions' },
        { label: 'My sources', to: '/subscriptions?q=Team' },
        { label: 'Team', to: '/subscriptions/team' },
        { label: 'Subscription settings' },
      ] },
      global: { plugins: [router] },
    })
    expect(wrapper.get('a[href="/"]').text()).toBe('Projects')
    expect(wrapper.get('[aria-current="page"]').text()).toBe('Subscription settings')
    await wrapper.get('a[href="/subscriptions?q=Team"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/subscriptions?q=Team')
    wrapper.unmount()
  })
})

describe('scroll edge separators', () => {
  it('shows the path bar separator only while the page scroller is scrolled', async () => {
    const wrapper = mount(WorkbenchPageShell, {
      props: { breadcrumbs: [{ label: 'Tools', to: '/tools' }, { label: 'Software center' }] },
      slots: { default: () => h('main', { class: 'page-scroller' }, [h('section', { class: 'nested-panel' })]) },
      global: { plugins: [pageRouter()] },
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
    wrapper.unmount()
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

describe('page heading presentation', () => {
  it('keeps the home heading accessible and the scroll API available when its visual heading is omitted', () => {
    const wrapper = mount(WorkbenchViewFrame, {
      props: { title: 'Home', hideHeading: true },
      slots: { default: () => h('p', 'Daily overview') },
    })
    const heading = wrapper.get('h1')
    expect(heading.text()).toBe('Home')
    expect(heading.element.closest('[aria-hidden="true"], [hidden]')).toBeNull()
    const frame = wrapper.vm as unknown as { scrollTo: (top: number) => void, getScrollTop: () => number }
    frame.scrollTo(96)
    expect(frame.getScrollTop()).toBe(96)
    expect(wrapper.get('.workbench-frame-scroll').element.scrollTop).toBe(96)
    wrapper.unmount()
  })

  it('shows the title, actions, and navigation for ordinary pages', () => {
    const wrapper = mount(WorkbenchViewFrame, {
      props: { title: 'Tools' },
      slots: {
        actions: () => h('button', 'Refresh tools'),
        navigation: () => h('nav', { 'aria-label': 'Tool views' }, 'Installed'),
      },
    })
    expect(wrapper.get('h1').text()).toBe('Tools')
    expect(wrapper.get('h1').isVisible()).toBe(true)
    expect(wrapper.get('button').text()).toBe('Refresh tools')
    expect(wrapper.get('button').isVisible()).toBe(true)
    expect(wrapper.get('nav[aria-label="Tool views"]').isVisible()).toBe(true)
    wrapper.unmount()
  })

  it('keeps header actions and navigation visible and focusable when the heading is omitted', async () => {
    let refreshes = 0
    const wrapper = mount(WorkbenchViewFrame, {
      attachTo: document.body,
      props: { title: 'Tools', hideHeading: true },
      slots: {
        actions: () => h('button', { onClick: () => refreshes++ }, 'Refresh tools'),
        navigation: () => h('nav', { 'aria-label': 'Tool views' }, [h('button', 'Installed')]),
      },
    })
    expect(wrapper.get('h1').text()).toBe('Tools')
    expect(wrapper.get('h1').element.closest('[hidden], [aria-hidden="true"]')).toBeNull()
    const action = wrapper.get<HTMLButtonElement>('.workbench-view-actions button')
    const navigation = wrapper.get<HTMLButtonElement>('nav[aria-label="Tool views"] button')
    for (const control of [action, navigation]) {
      expect(control.element.closest('.sr-only, [hidden], [aria-hidden="true"]')).toBeNull()
      expect(control.isVisible()).toBe(true)
      control.element.focus()
      expect(document.activeElement).toBe(control.element)
    }
    await action.trigger('click')
    expect(refreshes).toBe(1)
    wrapper.unmount()
  })
})
