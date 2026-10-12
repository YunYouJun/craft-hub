// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu.vue'
import { useI18n } from './i18n'
import WorkbenchToolbar from './WorkbenchToolbar.vue'

const baseProps = {
  title: 'Development environment',
  projectName: 'Example project',
  sidebarCollapsed: false,
  canGoBack: true,
  canGoForward: false,
  refreshing: false,
  paletteShortcutLabel: '⌘ K',
  paletteOpen: false,
  paletteMode: 'all' as const,
  desktopMac: true,
}

function stubViewport(desktop: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    matches: desktop,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

beforeEach(() => {
  useI18n().setLocale('en')
  stubViewport(true)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('exposes desktop navigation, palette and refresh actions with keyboard hints', async () => {
  const wrapper = mount(WorkbenchToolbar, { props: baseProps })
  await flushPromises()
  expect(wrapper.get('header').attributes('role')).toBeUndefined()
  expect(wrapper.get('.toolbar-section-title').text()).toBe(baseProps.title)
  expect(wrapper.get('.sidebar-toggle').attributes('title')).toContain('⌘ ⌃ S')
  expect(wrapper.get('.toolbar-back').attributes('title')).toContain('⌘ [')
  expect(wrapper.get('.toolbar-forward').attributes('title')).toContain('⌘ ]')
  expect(wrapper.get('.titlebar-project').attributes('title')).toContain('⌘ P')
  expect(wrapper.get('.toolbar-refresh').attributes('title')).toContain('⌘ ⇧ R')
  expect(wrapper.findComponent(AccountMenu).props('placement')).toBe('toolbar')

  await wrapper.get('.sidebar-toggle').trigger('click')
  await wrapper.get('.toolbar-back').trigger('click')
  await wrapper.get('.toolbar-refresh').trigger('click')
  await wrapper.get('.titlebar-project').trigger('click')
  await wrapper.get('.titlebar-search').trigger('click')
  expect(wrapper.emitted('toggleSidebar')).toHaveLength(1)
  expect(wrapper.emitted('back')).toHaveLength(1)
  expect(wrapper.emitted('refresh')).toHaveLength(1)
  expect(wrapper.emitted('openPalette')).toEqual([['projects'], ['all']])
  wrapper.unmount()
})

it('reflects history boundaries, an in-flight refresh, and collapsed sidebar state', async () => {
  const wrapper = mount(WorkbenchToolbar, { props: { ...baseProps, canGoBack: false, canGoForward: true, refreshing: true, sidebarCollapsed: true } })
  await flushPromises()
  expect(wrapper.get('.toolbar-back').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.toolbar-forward').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('.toolbar-refresh').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.toolbar-refresh').attributes('aria-busy')).toBe('true')
  expect(wrapper.get('.sidebar-toggle').attributes('aria-expanded')).toBe('false')
  expect(wrapper.get('.sidebar-toggle').attributes('aria-label')).toBe('Expand sidebar')
  await wrapper.get('.toolbar-back').trigger('click')
  await wrapper.get('.toolbar-refresh').trigger('click')
  await wrapper.get('.toolbar-forward').trigger('click')
  expect(wrapper.emitted('back')).toBeUndefined()
  expect(wrapper.emitted('refresh')).toBeUndefined()
  expect(wrapper.emitted('forward')).toHaveLength(1)
  wrapper.unmount()
})

it('retains mobile navigation and palette actions without adding an account trigger to the mobile header', async () => {
  stubViewport(false)
  const wrapper = mount(WorkbenchToolbar, { props: { ...baseProps, mobileNavigationOpen: true, paletteOpen: true, paletteMode: 'projects' } })
  await flushPromises()
  expect(wrapper.findComponent(AccountMenu).exists()).toBe(false)
  expect(wrapper.find('.toolbar-trailing').exists()).toBe(false)
  expect(wrapper.get('.mobile-navigation-toggle').attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('.titlebar-project').attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('.titlebar-search').attributes('aria-expanded')).toBe('false')
  await wrapper.get('.mobile-navigation-toggle').trigger('click')
  expect(wrapper.emitted('toggleMobileNavigation')).toHaveLength(1)
  wrapper.unmount()
})
