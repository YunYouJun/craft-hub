// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SidebarIcon from './SidebarIcon.vue'

const packageSvg = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='
const packagePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k1ioAAAAASUVORK5CYII='

describe('sidebar icon', () => {
  it.each([
    ['packaged SVG', packageSvg],
    ['packaged PNG', packagePng],
    ['HTTPS', 'https://example.com/plugin-icon.svg'],
  ])('preserves %s plugin images in both navigation states', async (_label, icon) => {
    const wrapper = mount(SidebarIcon, { props: { icon } })

    expect(wrapper.find('img').exists()).toBe(true)
    expect(wrapper.get('img').attributes('src')).toBe(icon)
    await wrapper.setProps({ active: true })
    expect(wrapper.get('img').attributes('src')).toBe(icon)

    wrapper.unmount()
  })

  it('preserves emoji plugin icons', async () => {
    const wrapper = mount(SidebarIcon, { props: { icon: 'emoji:🧩' } })

    expect(wrapper.text()).toBe('🧩')
    await wrapper.setProps({ active: true })
    expect(wrapper.text()).toBe('🧩')

    wrapper.unmount()
  })

  it('falls back after an image error and retries when the icon changes', async () => {
    const wrapper = mount(SidebarIcon, { props: { icon: packageSvg, fallback: 'folder' } })

    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.app-icon').exists()).toBe(true)

    await wrapper.setProps({ icon: packagePng })
    expect(wrapper.get('img').attributes('src')).toBe(packagePng)

    wrapper.unmount()
  })

  it('retains the outlined and filled variants for built-in navigation', async () => {
    const wrapper = mount(SidebarIcon, { props: { icon: 'builtin:folder' } })

    expect(wrapper.classes()).toContain('i-ri-folder-3-line')
    await wrapper.setProps({ active: true })
    expect(wrapper.classes()).toContain('i-ri-folder-3-fill')

    wrapper.unmount()
  })
})
