/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { h } from 'vue'
import { NavigationItem } from './components/ui/navigation'
import SidebarIcon from './SidebarIcon.vue'
import { applyWorkbenchTheme } from './theme'
import VisualIcon from './VisualIcon.vue'
import './styles/tokens.css'

const svg = (content: string): string => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${content}</svg>`)}`
const symbols = [
  ['muted outline', svg('<g fill="none" stroke="#737780" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></g>')],
  ['currentColor outline', svg('<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></g>')],
] as const
let wrapper: ReturnType<typeof mount> | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  applyWorkbenchTheme('system')
})

describe('sidebar artwork theme rendering', () => {
  it.each(symbols)('makes %s follow the foreground through theme, selection, hover and focus changes', async (_name, icon) => {
    wrapper = mount(NavigationItem, {
      attachTo: document.body,
      props: { variant: 'sidebar' },
      attrs: { style: '--navigation-icon-size: 24px' },
      slots: { default: () => h(SidebarIcon, { icon }) },
    })
    const image = wrapper.get('img').element
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
    const artwork = wrapper.get('.visual-icon').element
    await expect.poll(() => getComputedStyle(artwork).maskImage).not.toBe('none')
    const button = page.getByRole('button')
    for (const [theme, color] of [['dark', 'rgb(242, 242, 247)'], ['light', 'rgb(29, 29, 31)']] as const) {
      applyWorkbenchTheme(theme)
      for (const selected of [false, true]) {
        await wrapper.setProps({ 'aria-selected': selected })
        await button.hover()
        ;(wrapper.element as HTMLButtonElement).focus()
        await expect.poll(() => getComputedStyle(artwork).backgroundColor).toBe(color)
        expect(getComputedStyle(image).opacity).toBe('0')
      }
    }
  })

  it.each([
    ['brand color', svg('<circle cx="12" cy="12" r="8" fill="#1259df"/>')],
    ['multiple neutral paints', svg('<rect x="2" y="2" width="20" height="20" fill="black"/><circle cx="12" cy="12" r="6" fill="white"/>')],
  ])('preserves %s instead of flattening the artwork', async (_name, icon) => {
    wrapper = mount(SidebarIcon, { attachTo: document.body, props: { icon } })
    const image = wrapper.get('img').element
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
    expect(wrapper.classes()).not.toContain('visual-icon-mask')
    expect(getComputedStyle(image).opacity).not.toBe('0')
  })

  it('reclassifies replacement artwork and restores its fallback after a failed load', async () => {
    wrapper = mount(VisualIcon, { attachTo: document.body, props: { icon: symbols[0][1] } })
    await expect.poll(() => wrapper!.classes()).toContain('visual-icon-mask')
    await wrapper.setProps({ icon: svg('<circle cx="12" cy="12" r="8" fill="#1259df"/>') })
    const image = wrapper.get('img').element
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
    expect(wrapper.classes()).not.toContain('visual-icon-mask')
    await wrapper.setProps({ icon: 'data:image/svg+xml;base64,broken!' })
    await expect.poll(() => wrapper!.find('img').exists()).toBe(false)
    expect(wrapper.find('.app-icon').exists()).toBe(true)
    await wrapper.setProps({ icon: symbols[1][1] })
    await expect.poll(() => wrapper!.classes()).toContain('visual-icon-mask')
  })

  it('allows callers to retain the original neutral artwork', async () => {
    wrapper = mount(VisualIcon, { attachTo: document.body, props: { icon: symbols[0][1], monochrome: false } })
    const image = wrapper.get('img').element
    await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true)
    expect(wrapper.classes()).not.toContain('visual-icon-mask')
  })
})
