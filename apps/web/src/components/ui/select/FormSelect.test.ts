// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import FormSelect from './FormSelect.vue'

describe('form select', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shares semantic option icons between the trigger and menu', async () => {
    const wrapper = mount(FormSelect, {
      attachTo: document.body,
      props: {
        modelValue: 'remote',
        options: [
          { value: 'local', label: 'Local preview' },
          { value: 'remote', label: 'Remote workspace', icon: 'code' },
        ],
        testId: 'editor-select',
      },
    })

    expect(wrapper.find('[data-testid="editor-select"] .i-ri-code-s-slash-line').exists()).toBe(true)
    expect(wrapper.get('[data-testid="editor-select"]').text()).toContain('Remote workspace')

    await wrapper.get('[role="combobox"]').trigger('pointerdown', { button: 0, ctrlKey: false })
    await flushPromises()
    expect(document.body.querySelector('[role="option"] .i-ri-code-s-slash-line')).not.toBeNull()
  })
})
