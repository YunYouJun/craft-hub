// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import ShellCommandPreview from './ShellCommandPreview.vue'

const originalClipboard = navigator.clipboard

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
  vi.restoreAllMocks()
})

describe('shell command preview', () => {
  it('renders escaped Bash syntax highlighting and preserves the command text', async () => {
    const command = 'MODE=preview pnpm run build -- --entry="<unsafe>"'
    const wrapper = mount(ShellCommandPreview, { props: { command } })

    await vi.waitFor(() => expect(wrapper.find('.shiki').exists()).toBe(true))
    expect(wrapper.get('.shiki').attributes('style')).not.toMatch(/(?:^|;)color:/)
    expect(wrapper.html()).toContain('--shiki-light')
    expect(wrapper.find('unsafe').exists()).toBe(false)
    expect(wrapper.text()).toContain(command)
  })

  it('copies the original command and exposes success feedback', async () => {
    useI18n().setLocale('en')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const command = 'pnpm run build -- --entry="pages/home/index"'
    const wrapper = mount(ShellCommandPreview, { props: { command } })
    const copy = wrapper.get('[data-testid="copy-shell-command"]')

    expect(copy.attributes('aria-label')).toBe('Copy command')
    await copy.trigger('click')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(command))
    expect(copy.attributes('aria-label')).toBe('Command copied')
    expect(copy.classes()).toContain('copied')
  })

  it('can hide the copy action for read-only embedding contexts', () => {
    const wrapper = mount(ShellCommandPreview, { props: { command: 'pnpm test', copyable: false } })
    expect(wrapper.find('[data-testid="copy-shell-command"]').exists()).toBe(false)
  })
})
