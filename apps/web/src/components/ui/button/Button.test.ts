// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Button from './Button.vue'

describe('ui button', () => {
  it('uses semantic variants and native button defaults', () => {
    const wrapper = mount(Button, { props: { variant: 'warning' }, slots: { default: 'Authorize' } })

    expect(wrapper.classes()).toContain('ui-button--warning')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.text()).toBe('Authorize')
  })

  it('forwards disabled and submit behavior', () => {
    const wrapper = mount(Button, { props: { disabled: true, type: 'submit', variant: 'primary' } })

    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('type')).toBe('submit')
  })
})
