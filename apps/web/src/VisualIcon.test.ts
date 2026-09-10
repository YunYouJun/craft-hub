// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import VisualIcon from './VisualIcon.vue'

it('renders packaged SVG as an image and restores the fallback after load failure', async () => {
  const icon = 'data:image/svg+xml;base64,PHN2Zy8+'
  const wrapper = mount(VisualIcon, { props: { icon, fallback: 'plugins' } })
  expect(wrapper.get('img').attributes('src')).toBe(icon)
  expect(wrapper.find('svg').exists()).toBe(false)
  await wrapper.get('img').trigger('error')
  expect(wrapper.find('img').exists()).toBe(false)
  expect(wrapper.find('.app-icon').exists()).toBe(true)
  await wrapper.setProps({ icon: 'https://example.com/icon.svg' })
  expect(wrapper.get('img').attributes('src')).toBe('https://example.com/icon.svg')
  await wrapper.setProps({ icon: 'javascript:alert(1)' })
  expect(wrapper.find('img').exists()).toBe(false)
})
