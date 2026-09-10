// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import Switch from './Switch.vue'

it('keeps the controlled thumb state until the parent confirms and ignores busy clicks', async () => {
  const wrapper = mount(Switch, { props: { modelValue: false }, attrs: { 'aria-label': 'Enable plugin' } })
  await wrapper.get('[role="switch"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  expect(wrapper.get('[data-slot="switch-thumb"]').attributes('data-state')).toBe('unchecked')
  await wrapper.setProps({ loading: true })
  await wrapper.get('[role="switch"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  expect(wrapper.get('[role="switch"]').attributes('aria-busy')).toBe('true')
  expect(wrapper.get('.ui-switch-spinner').attributes('aria-hidden')).toBe('true')
  await wrapper.setProps({ modelValue: true, loading: false })
  expect(wrapper.get('[data-slot="switch-thumb"]').attributes('data-state')).toBe('checked')
  expect(wrapper.find('.ui-switch-spinner').exists()).toBe(false)
})
