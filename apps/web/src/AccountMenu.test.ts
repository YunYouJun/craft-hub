// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu.vue'
import { useI18n } from './i18n'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete window.craftHubDesktop
})
it('shows local mode without offering unconfigured sign-in', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
  const wrapper = mount(AccountMenu)
  await flushPromises()
  expect(wrapper.find('[popovertarget]').exists()).toBe(true)
  expect(wrapper.find('.account-panel button').exists()).toBe(false)
  wrapper.unmount()
})
it('opens the system browser, completes login, and signs out', async () => {
  useI18n().setLocale('en')
  let connected = false
  const openExternalUrl = vi.fn(async () => {})
  window.craftHubDesktop = { openExternalUrl }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/sign-in'))
      return Response.json({ authorizationUrl: 'https://login.example.com/login' })
    if (url.endsWith('/complete'))
      connected = true
    if (url.endsWith('/sign-out'))
      connected = false
    return Response.json({ enabled: true, provider: 'Example', mode: 'local', canSignIn: true, canSignOut: true, identity: connected ? { id: '1', name: 'Example User' } : undefined })
  }))
  const wrapper = mount(AccountMenu)
  await flushPromises()
  await wrapper.get('.account-panel button').trigger('click')
  await flushPromises()
  expect(openExternalUrl).toHaveBeenCalledWith('https://login.example.com/login')
  expect(wrapper.text()).toContain('Example User')
  expect(wrapper.text()).toContain('Sign out')
  await wrapper.get('.account-panel button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('Sign in')
  expect(wrapper.text()).not.toContain('Example User')
  wrapper.unmount()
})
it('renders the provider photo and falls back to initials when loading fails', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: true, identity: { id: '1', name: 'Example', avatarUrl: 'https://images.example.com/avatar.png' } })))
  const wrapper = mount(AccountMenu)
  await flushPromises()
  expect(wrapper.get('img').attributes('src')).toBe('https://images.example.com/avatar.png')
  await wrapper.get('img').trigger('error')
  expect(wrapper.find('img').exists()).toBe(false)
  expect(wrapper.get('.account-avatar').text()).toBe('E')
  wrapper.unmount()
})

it('opens below the mobile account trigger and constrains the panel to the visible viewport', async () => {
  vi.stubGlobal('innerWidth', 390)
  vi.stubGlobal('innerHeight', 844)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
  const wrapper = mount(AccountMenu)
  await flushPromises()
  const bounds = new DOMRect(340, 48, 36, 36)
  vi.spyOn(wrapper.get<HTMLButtonElement>('[popovertarget]').element, 'getBoundingClientRect').mockReturnValue(bounds)

  const panel = wrapper.get<HTMLDivElement>('.account-panel')
  await panel.trigger('beforetoggle')

  const top = Number.parseFloat(panel.element.style.top)
  const left = Number.parseFloat(panel.element.style.left)
  const height = Number.parseFloat(panel.element.style.maxHeight)
  expect(top).toBe(bounds.bottom + 8)
  expect(top).toBeGreaterThan(bounds.bottom)
  expect(left).toBeGreaterThanOrEqual(8)
  expect(left + 280).toBeLessThanOrEqual(window.innerWidth - 8)
  expect(top + height).toBeLessThanOrEqual(window.innerHeight - 8)
  expect(height).toBeGreaterThan(0)
  expect(panel.element.style.bottom).toBe('')
  wrapper.unmount()
})

it('removes mobile top positioning when resizing back to the desktop rail', async () => {
  vi.stubGlobal('innerWidth', 760)
  vi.stubGlobal('innerHeight', 844)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
  const wrapper = mount(AccountMenu)
  await flushPromises()
  const measure = vi.spyOn(wrapper.get<HTMLButtonElement>('[popovertarget]').element, 'getBoundingClientRect')
  measure.mockReturnValue(new DOMRect(700, 48, 36, 36))
  const panel = wrapper.get<HTMLDivElement>('.account-panel')
  await panel.trigger('beforetoggle')
  expect(panel.element.style.top).not.toBe('')
  expect(panel.element.style.bottom).toBe('')

  vi.stubGlobal('innerWidth', 1280)
  vi.stubGlobal('innerHeight', 900)
  const desktopBounds = new DOMRect(8, 752, 36, 36)
  measure.mockReturnValue(desktopBounds)
  window.dispatchEvent(new Event('resize'))
  await wrapper.vm.$nextTick()

  expect(panel.element.style.left).toBe(`${desktopBounds.right + 8}px`)
  expect(panel.element.style.bottom).toBe(`${window.innerHeight - desktopBounds.bottom}px`)
  expect(panel.element.style.top).toBe('')
  expect(panel.element.style.maxHeight).toBe('')
  wrapper.unmount()
})

it('opens a desktop toolbar account panel below the trigger with its right edge aligned', async () => {
  vi.stubGlobal('innerWidth', 1440)
  vi.stubGlobal('innerHeight', 900)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
  const wrapper = mount(AccountMenu, { props: { placement: 'toolbar' } })
  await flushPromises()
  const bounds = new DOMRect(1396, 6, 32, 32)
  vi.spyOn(wrapper.get<HTMLButtonElement>('[popovertarget]').element, 'getBoundingClientRect').mockReturnValue(bounds)

  const panel = wrapper.get<HTMLDivElement>('.account-panel')
  await panel.trigger('beforetoggle')

  expect(Number.parseFloat(panel.element.style.left) + 280).toBe(bounds.right)
  expect(panel.element.style.top).toBe(`${bounds.bottom + 8}px`)
  expect(panel.element.style.bottom).toBe('')
  expect(Number.parseFloat(panel.element.style.top) + Number.parseFloat(panel.element.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 8)
  wrapper.unmount()
})

it('keeps a toolbar account panel inside the viewport when the trigger is near its left edge', async () => {
  vi.stubGlobal('innerWidth', 900)
  vi.stubGlobal('innerHeight', 640)
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })))
  const wrapper = mount(AccountMenu, { props: { placement: 'toolbar' } })
  await flushPromises()
  vi.spyOn(wrapper.get<HTMLButtonElement>('[popovertarget]').element, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 6, 32, 32))
  const panel = wrapper.get<HTMLDivElement>('.account-panel')
  await panel.trigger('beforetoggle')

  expect(panel.element.style.left).toBe('8px')
  expect(Number.parseFloat(panel.element.style.left) + 280).toBeLessThanOrEqual(window.innerWidth - 8)
  wrapper.unmount()
})
