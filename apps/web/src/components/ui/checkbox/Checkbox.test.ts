// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './index'

describe('checkbox', () => {
  it('animates the check mark only after a user change', async () => {
    const wrapper = mount(Checkbox, { props: { defaultValue: true } })
    const checkbox = wrapper.get('[data-slot="checkbox"]')
    expect(checkbox.attributes('data-state')).toBe('checked')
    expect(checkbox.attributes('data-changed')).toBeUndefined()
    await checkbox.trigger('click')
    expect(checkbox.attributes('data-state')).toBe('unchecked')
    expect(checkbox.attributes()).toHaveProperty('data-changed', '')
  })
})
