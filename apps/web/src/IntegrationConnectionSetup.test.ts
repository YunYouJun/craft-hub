// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationConnectionSetup from './IntegrationConnectionSetup.vue'

const status = { connected: false, forms: [{ id: 'token', title: 'Personal token', submitLabel: 'Save and connect', fields: [{ id: 'token', label: 'Token', type: 'password' as const, required: true }] }] }
const props = { status, integrationId: 'example', actionId: 'connect', projectId: 'project-1', translate: (value: string) => value }
beforeEach(() => {
  vi.restoreAllMocks()
  useI18n().setLocale('en')
})

describe('connection setup forms', () => {
  it('only submits on user action, confirms the selected method, clears secrets and refreshes', async () => {
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ connected: true })
    const wrapper = mount(IntegrationConnectionSetup, { props })
    expect(invoke).not.toHaveBeenCalled()
    await wrapper.get('input').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith('example', 'connect', { token: 'secret', method: 'token', locale: 'en' }, 'project-1', true)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.emitted('updated')).toHaveLength(1)
    wrapper.unmount()
  })

  it('opens desktop OAuth automatically and refreshes until connected', async () => {
    vi.useFakeTimers()
    const openExternalUrl = vi.fn().mockResolvedValue(undefined)
    window.craftHubDesktop = { openExternalUrl }
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ connected: false, authorizationUrl: 'https://example.com/oauth' })
    const wrapper = mount(IntegrationConnectionSetup, { props: { ...props, status: { connected: false, forms: [{ id: 'oauth', title: 'Connect', submitLabel: 'Connect', fields: [] }] } } })
    try {
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/oauth')
      await vi.advanceTimersByTimeAsync(2000)
      expect(wrapper.emitted('updated')).toHaveLength(1)
      await wrapper.setProps({ status: { connected: true, forms: [] } })
      await vi.advanceTimersByTimeAsync(4000)
      expect(wrapper.emitted('updated')).toHaveLength(1)
      expect(wrapper.find('[role="status"]').exists()).toBe(false)
    }
    finally {
      wrapper.unmount()
      delete window.craftHubDesktop
      vi.useRealTimers()
    }
  })

  it('shows an explicit authorization link and does not navigate to unsafe URLs', async () => {
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ connected: false, authorizationUrl: 'https://example.com/oauth?state=abc' })
    const wrapper = mount(IntegrationConnectionSetup, { props: { ...props, status: { ...status, links: [{ title: 'Unsafe', url: 'javascript:alert(1)' }] } } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('a').attributes('href')).toBe('https://example.com/oauth?state=abc')
    expect(wrapper.text()).toContain('The connection status updates automatically')
    expect(wrapper.text()).not.toContain('Unsafe')
    wrapper.unmount()
  })
})
