// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SoftwareIcon from './SoftwareIcon.vue'

describe('official software artwork', () => {
  it('compensates for canvas padding without changing the image or its silhouette', async () => {
    const wrapper = mount(SoftwareIcon, { props: { url: 'https://example.com/', iconUrl: 'https://example.com/logo.png', iconScale: 1.25 } })
    expect(wrapper.get('img').element.style.getPropertyValue('--artwork-scale')).toBe('1.25')
    expect(wrapper.attributes('data-shape')).toBe('original')
    await wrapper.setProps({ iconScale: undefined })
    expect(wrapper.get('img').element.style.getPropertyValue('--artwork-scale')).toBe('1')
    for (const iconScale of [0, 2, Number.NaN, Infinity]) {
      await wrapper.setProps({ iconScale })
      expect(wrapper.get('img').element.style.getPropertyValue('--artwork-scale')).toBe('1')
    }
    wrapper.unmount()
  })

  it('prefers complete native artwork without masking its existing shape or shadow', async () => {
    const wrapper = mount(SoftwareIcon, { props: { url: 'https://example.com/', macosIconUrl: 'https://example.com/mac.png', iconUrl: 'https://example.com/site.png', iconStyle: 'rounded' } })
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/mac.png')
    expect(wrapper.attributes('data-shape')).toBe('original')
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.app-icon').exists()).toBe(true)
    await wrapper.setProps({ macosIconUrl: undefined })
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/site.png')
    expect(wrapper.attributes('data-shape')).toBe('rounded')
    await wrapper.setProps({ iconStyle: 'original' })
    expect(wrapper.attributes('data-shape')).toBe('original')
    wrapper.unmount()
  })

  it('preserves transparent logos by default and rejects unsafe native artwork', () => {
    const wrapper = mount(SoftwareIcon, { props: { url: 'https://example.com/', macosIconUrl: 'file:///Applications/icon.png', iconUrl: 'https://example.com/logo.svg' } })
    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/logo.svg')
    expect(wrapper.attributes('data-shape')).toBe('original')
    wrapper.unmount()
  })

  it('keeps a fallback until the image loads, handles failure, and retries a changed source', async () => {
    const wrapper = mount(SoftwareIcon, { props: { url: 'https://code.visualstudio.com/', iconUrl: 'https://example.com/editor.png' } })
    expect(wrapper.find('.vscode-icon').exists()).toBe(true)
    expect(wrapper.get('img').attributes()).toMatchObject({ src: 'https://example.com/editor.png', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
    await wrapper.get('img').trigger('load')
    expect(wrapper.find('.app-icon').exists()).toBe(false)
    expect(wrapper.classes()).toContain('software-icon-loaded')
    await wrapper.setProps({ iconUrl: 'https://example.com/new.svg' })
    expect(wrapper.find('.vscode-icon').exists()).toBe(true)
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.vscode-icon').exists()).toBe(true)
    await wrapper.setProps({ iconUrl: 'https://example.com/next.webp' })
    await wrapper.get('img').trigger('load')
    expect(wrapper.classes()).toContain('software-icon-loaded')
    wrapper.unmount()
  })

  it.each(['http://example.com/icon.png', 'https://user:secret@example.com/icon.png', 'data:image/svg+xml,<svg/>', 'file:///private/icon.png', 'javascript:alert(1)'])('rejects unsafe image sources: %s', (iconUrl) => {
    const wrapper = mount(SoftwareIcon, { props: { url: 'https://example.com/', iconUrl } })
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.i-ri-global-line').exists()).toBe(true)
    wrapper.unmount()
  })
})
