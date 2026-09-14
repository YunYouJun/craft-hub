// @vitest-environment happy-dom
/// <reference lib="dom" />
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import FilePreview from './FilePreview.vue'
import { useI18n } from './i18n'
import { applyWorkbenchTheme } from './theme'

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  applyWorkbenchTheme('light')
})

it('renders serialized configuration as JSON with line numbers and escaped markup', async () => {
  const content = '{\n  "enabled": true,\n  "label": "<img src=x onerror=alert(1)>"\n}'
  const wrapper = mount(FilePreview, { props: { content, path: 'config.toml' } })
  await vi.waitFor(() => expect(wrapper.get('.file-preview-scroll').attributes('aria-busy')).toBe('false'))
  const shadow = wrapper.get('diffs-container').element.shadowRoot!
  expect(shadow.querySelectorAll('[data-line]').length).toBeGreaterThanOrEqual(4)
  expect(shadow.querySelector('[data-line-number-content]')).not.toBeNull()
  expect(shadow.textContent).toContain('<img src=x onerror=alert(1)>')
  expect(shadow.querySelector('img')).toBeNull()
  expect(shadow.querySelector('[data-line] span[style]')).not.toBeNull()
})

it('updates diff layout, wrapping, theme and the selected content', async () => {
  const wrapper = mount(FilePreview, { props: { content: 'enabled = true\n', path: 'config.toml', comparison: { content: 'enabled = false\n' } } })
  const ready = () => vi.waitFor(() => expect(wrapper.get('.file-preview-scroll').attributes('aria-busy')).toBe('false'))
  await ready()
  const button = (label: string) => wrapper.findAll('button').find(button => button.text() === label)!
  await button('Unified view').trigger('click')
  await ready()
  let shadow = wrapper.get('diffs-container').element.shadowRoot!
  expect(shadow.querySelector('[data-diff-type="single"]')).not.toBeNull()
  await button('Wrap lines').trigger('click')
  applyWorkbenchTheme('dark')
  await ready()
  shadow = wrapper.get('diffs-container').element.shadowRoot!
  expect(shadow.querySelector('[data-overflow="wrap"]')).not.toBeNull()
  expect(shadow.textContent).toContain('color-scheme: dark')
  await wrapper.setProps({ content: 'fresh preview', comparison: undefined, path: 'notes.txt' })
  await ready()
  shadow = wrapper.get('diffs-container').element.shadowRoot!
  expect(shadow.textContent).toContain('fresh preview')
  expect(shadow.textContent).not.toContain('enabled =')
  expect(wrapper.findAll('diffs-container')).toHaveLength(1)
})
