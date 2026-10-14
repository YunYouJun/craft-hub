// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { SettingsRow, SettingsSection, SettingsStatus } from './index'

describe('settings primitives', () => {
  it('keeps repeated sections separately named for assistive navigation', () => {
    const wrapper = mount(defineComponent({
      components: { SettingsSection },
      template: '<div><SettingsSection title="Editor" description="Choose a tool"><p>Settings</p></SettingsSection><SettingsSection title="Editor"><p>Defaults</p></SettingsSection></div>',
    }))

    const sections = wrapper.findAll('section')
    const titleIds = sections.map(section => section.attributes('aria-labelledby'))
    expect(new Set(titleIds).size).toBe(2)
    for (const section of sections)
      expect(section.find(`[id="${section.attributes('aria-labelledby')}"]`).text()).toBe('Editor')
    expect(sections[0]!.find(`[id="${sections[0]!.attributes('aria-describedby')}"]`).text()).toBe('Choose a tool')
    expect(sections[1]!.attributes('aria-describedby')).toBeUndefined()
  })

  it('associates a setting label with its control and exposes description IDs to the slot', () => {
    const wrapper = mount(defineComponent({
      components: { SettingsRow },
      template: '<SettingsRow label="Model" description="Used for new tasks" control-id="model"><template #control="{ labelId, descriptionId }"><input id="model" :aria-labelledby="labelId" :aria-describedby="descriptionId"></template></SettingsRow>',
    }))

    const input = wrapper.get('input')
    const label = wrapper.get('label')
    expect(label.attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('aria-labelledby')).toBe(label.attributes('id'))
    expect(wrapper.get(`[id="${input.attributes('aria-describedby')}"]`).text()).toBe('Used for new tasks')
  })

  it('keeps status actions operable without forcing announcements for ordinary metadata', async () => {
    let clicked = false
    const wrapper = mount(defineComponent({
      components: { SettingsStatus },
      setup: () => ({ activate: () => { clicked = true } }),
      template: '<SettingsStatus title="Update ready" tone="success" data-testid="update-status"><template #metadata><small>Version 2</small></template><template #actions><button type="button" @click="activate">Install</button></template></SettingsStatus>',
    }))

    expect(wrapper.attributes('aria-live')).toBeUndefined()
    expect(wrapper.attributes('data-testid')).toBe('update-status')
    expect(wrapper.text()).toContain('Version 2')
    await wrapper.get('button').trigger('click')
    expect(clicked).toBe(true)
  })
})
