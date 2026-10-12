// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { NavigationItem, NavigationList } from './index'

describe('navigation presentation', () => {
  it('retains route semantics and inherits presentation through groups', () => {
    const wrapper = mount(defineComponent({
      components: { NavigationItem, NavigationList },
      template: `
        <NavigationList as="nav" variant="sidebar" aria-label="Workbench">
          <div class="group">
            <NavigationItem as="a" href="/environment" aria-current="page" title="Environment">
              <template #icon><svg data-test="icon" /></template>
              <span class="ui-navigation-label">Environment</span>
            </NavigationItem>
          </div>
        </NavigationList>
      `,
    }))

    expect(wrapper.element.tagName).toBe('NAV')
    expect(wrapper.attributes('aria-label')).toBe('Workbench')
    expect(wrapper.attributes('role')).toBeUndefined()
    const item = wrapper.get('a')
    expect(item.attributes()).toMatchObject({
      'href': '/environment',
      'aria-current': 'page',
      'title': 'Environment',
      'data-variant': 'sidebar',
    })
    expect(item.attributes('role')).toBeUndefined()
    expect(item.get('[data-slot="navigation-icon"]').attributes('aria-hidden')).toBe('true')
  })

  it('keeps the single child, native attributes and custom focus behavior with asChild', async () => {
    const clicked = vi.fn()
    const wrapper = mount(NavigationItem, {
      props: { asChild: true },
      attrs: { 'onClick': clicked, 'aria-label': 'Projects' },
      slots: { default: '<a href="/projects" tabindex="2" class="route-link">Projects</a>' },
    })

    expect(wrapper.element.tagName).toBe('A')
    expect(wrapper.attributes()).toMatchObject({ 'href': '/projects', 'tabindex': '2', 'aria-label': 'Projects' })
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['ui-navigation-item', 'route-link']))
    await wrapper.trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('uses native button disabled state and preserves child button type', async () => {
    const clicked = vi.fn()
    const wrapper = mount(NavigationItem, {
      props: { asChild: true, disabled: true },
      attrs: { onClick: clicked },
      slots: { default: '<button type="submit">Run</button>' },
    })

    await nextTick()
    expect(wrapper.attributes('type')).toBe('submit')
    expect((wrapper.element as HTMLButtonElement).disabled).toBe(true)
    ;(wrapper.element as HTMLButtonElement).click()
    expect(clicked).not.toHaveBeenCalled()
    await wrapper.setProps({ disabled: false })
    ;(wrapper.element as HTMLButtonElement).click()
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('prevents pointer and keyboard activation of disabled links without removing their target', async () => {
    const clicked = vi.fn()
    const down = vi.fn()
    const pressed = vi.fn()
    const wrapper = mount(NavigationItem, {
      props: { as: 'a', disabled: true },
      attrs: { href: '/settings', onClick: clicked, onMousedown: down, onKeydown: pressed },
      slots: { default: 'Settings' },
    })

    expect(wrapper.attributes()).toMatchObject({ 'href': '/settings', 'tabindex': '-1', 'aria-disabled': 'true' })
    expect(wrapper.attributes('disabled')).toBeUndefined()
    await wrapper.trigger('click')
    await wrapper.trigger('mousedown')
    await wrapper.trigger('keydown', { key: 'Enter' })
    await wrapper.trigger('keydown', { key: ' ' })
    expect(clicked).not.toHaveBeenCalled()
    expect(down).not.toHaveBeenCalled()
    expect(pressed).not.toHaveBeenCalled()
  })

  it('owns disabled focus attributes with asChild and restores the original link attributes on enable', async () => {
    const clicked = vi.fn()
    const captured = vi.fn()
    const wrapper = mount(NavigationItem, {
      props: { asChild: true, disabled: true },
      attrs: { onClickCapture: captured },
      slots: { default: () => h('a', { 'href': '/projects', 'tabindex': 0, 'aria-disabled': false, 'onClick': clicked }, 'Projects') },
    })
    await nextTick()

    expect(wrapper.attributes()).toMatchObject({ 'href': '/projects', 'tabindex': '-1', 'aria-disabled': 'true', 'data-disabled': '' })
    await wrapper.trigger('click')
    expect(clicked).not.toHaveBeenCalled()
    expect(captured).not.toHaveBeenCalled()

    await wrapper.setProps({ disabled: false })
    expect(wrapper.attributes()).toMatchObject({ 'href': '/projects', 'tabindex': '0', 'aria-disabled': 'false' })
    expect(wrapper.attributes('data-disabled')).toBeUndefined()
    await wrapper.trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
    expect(captured).toHaveBeenCalledOnce()
  })

  it('owns native disabled state even when the child explicitly enables its button', async () => {
    const clicked = vi.fn()
    const wrapper = mount(NavigationItem, {
      props: { asChild: true, disabled: true },
      slots: { default: () => h('button', { disabled: false, tabindex: 0, type: 'submit', onClick: clicked }, 'Run') },
    })
    await nextTick()

    const button = wrapper.element as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.tabIndex).toBe(-1)
    expect(button.type).toBe('submit')
    button.click()
    expect(clicked).not.toHaveBeenCalled()

    await wrapper.setProps({ disabled: false })
    expect(wrapper.element).toBe(button)
    expect(button.disabled).toBe(false)
    expect(button.tabIndex).toBe(0)
    await wrapper.trigger('click')
    expect(clicked).toHaveBeenCalledOnce()
  })

  it('owns disabled attributes on a direct link and restores consumer focus attributes on enable', async () => {
    const wrapper = mount(NavigationItem, {
      props: { as: 'a', disabled: true },
      attrs: { 'href': '/settings', 'tabindex': 0, 'aria-disabled': false },
      slots: { default: 'Settings' },
    })

    expect(wrapper.attributes()).toMatchObject({ 'href': '/settings', 'tabindex': '-1', 'aria-disabled': 'true' })
    await wrapper.setProps({ disabled: false })
    expect(wrapper.attributes()).toMatchObject({ 'href': '/settings', 'tabindex': '0', 'aria-disabled': 'false' })
    expect(wrapper.attributes('data-disabled')).toBeUndefined()
  })
})
