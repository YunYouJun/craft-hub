// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './index'

const mounted: ReturnType<typeof mount>[] = []

afterEach(() => {
  for (const wrapper of mounted)
    wrapper.unmount()
  mounted.length = 0
})

function renderTabs(orientation: 'horizontal' | 'vertical', activationMode: 'automatic' | 'manual' = 'automatic') {
  const wrapper = mount(defineComponent({
    components: { TabsContent, TabsList, TabsRoot, TabsTrigger },
    setup: () => ({ selected: ref('general'), orientation, activationMode }),
    template: `
      <TabsRoot v-model="selected" :orientation="orientation" :activation-mode="activationMode">
        <TabsList variant="sidebar" aria-label="Settings">
          <TabsTrigger value="general"><template #icon><svg /></template>General</TabsTrigger>
          <TabsTrigger value="unavailable" disabled>Unavailable</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>
        <TabsContent value="general">General settings</TabsContent>
        <TabsContent value="appearance">Appearance settings</TabsContent>
      </TabsRoot>
    `,
  }), { attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}

describe('shared tabs', () => {
  it('retains vertical keyboard navigation, skips disabled tabs and associates the active panel', async () => {
    const wrapper = renderTabs('vertical')
    await nextTick()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(wrapper.get('[role="tablist"]').attributes()).toMatchObject({
      'aria-label': 'Settings',
      'aria-orientation': 'vertical',
      'data-variant': 'sidebar',
    })
    expect(tabs[0]!.attributes('data-variant')).toBe('sidebar')
    expect(tabs[0]!.get('[data-slot="navigation-icon"]').attributes('aria-hidden')).toBe('true')
    ;(tabs[0]!.element as HTMLElement).focus()
    await tabs[0]!.trigger('keydown', { key: 'ArrowDown' })
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[2]!.element))
    expect(tabs[2]!.attributes('aria-selected')).toBe('true')
    const activePanel = wrapper.get('[role="tabpanel"][data-state="active"]')
    await vi.waitFor(() => expect(activePanel.text()).toBe('Appearance settings'))
    expect(tabs[2]!.attributes('aria-controls')).toBe(activePanel.attributes('id'))
    await tabs[2]!.trigger('keydown', { key: 'ArrowDown' })
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[0]!.element))
  })

  it('preserves manual activation with Enter and Space while arrow keys only move focus', async () => {
    const wrapper = renderTabs('horizontal', 'manual')
    await nextTick()
    const tabs = wrapper.findAll('[role="tab"]')
    ;(tabs[0]!.element as HTMLElement).focus()
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[2]!.element))
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    await tabs[2]!.trigger('keydown', { key: 'Enter' })
    expect(tabs[2]!.attributes('aria-selected')).toBe('true')
    await tabs[2]!.trigger('keydown', { key: 'ArrowLeft' })
    await vi.waitFor(() => expect(document.activeElement).toBe(tabs[0]!.element))
    await tabs[0]!.trigger('keydown', { key: ' ' })
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    await tabs[1]!.trigger('keydown', { key: 'Enter' })
    expect(tabs[1]!.attributes('aria-selected')).toBe('false')
  })

  it('supports asChild without adding a second control or losing attributes', async () => {
    const wrapper = mount(defineComponent({
      components: { TabsList, TabsRoot, TabsTrigger },
      template: `
        <TabsRoot default-value="overview">
          <TabsList as-child aria-label="Preview">
            <nav data-test="navigation">
              <TabsTrigger value="overview" as-child>
                <a href="#overview" title="Overview" class="preview-link">Overview</a>
              </TabsTrigger>
            </nav>
          </TabsList>
        </TabsRoot>
      `,
    }))
    mounted.push(wrapper)

    expect(wrapper.findAll('[role="tablist"]')).toHaveLength(1)
    expect(wrapper.get('[role="tablist"]').element.tagName).toBe('NAV')
    expect(wrapper.find('button').exists()).toBe(false)
    const trigger = wrapper.get('a')
    expect(trigger.attributes()).toMatchObject({ 'href': '#overview', 'title': 'Overview', 'role': 'tab', 'aria-selected': 'true' })
    expect(trigger.classes()).toEqual(expect.arrayContaining(['ui-navigation-item', 'preview-link']))
  })
})
