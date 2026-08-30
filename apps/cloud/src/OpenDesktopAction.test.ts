// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OpenDesktopAction from './OpenDesktopAction.vue'

describe('open desktop action', () => {
  afterEach(() => vi.useRealTimers())

  it('uses a real Desktop Link and offers a neutral fallback after a short wait', async () => {
    vi.useFakeTimers()
    const wrapper = mount(OpenDesktopAction)
    const link = wrapper.get('a.desktop-open-link')

    expect(link.attributes('href')).toBe('craft-hub://open?v=1')
    await link.trigger('click')
    expect(wrapper.text()).toContain('正在尝试打开')
    expect(wrapper.text()).not.toContain('安装或更新')

    await vi.advanceTimersByTimeAsync(1_500)
    expect(wrapper.text()).toContain('如果没有看到桌面窗口')
    expect(wrapper.find('a[href*="releases/latest"]').exists()).toBe(true)
  })
})
