// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu.vue'
import { useI18n } from './i18n'

afterEach(() => {
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
