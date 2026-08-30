// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudRequest } from './api'
import App from './App.vue'
import { restoreSession } from './auth'

vi.mock('./api', () => ({ cloudRequest: vi.fn() }))
vi.mock('./auth', () => ({ login: vi.fn(), restoreSession: vi.fn() }))

const mockCloudRequest = vi.mocked(cloudRequest)
const mockRestoreSession = vi.mocked(restoreSession)

describe('cloud desktop entry', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/')
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('shows a primary Desktop Link on an ordinary page without an available device', async () => {
    mockRestoreSession.mockResolvedValue(undefined)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('.desktop-action').classes()).toContain('is-primary')
    expect(wrapper.get('.desktop-open-link').attributes('href')).toBe('craft-hub://open?v=1')
  })

  it('hides the Desktop Link on the personal-cloud callback page', async () => {
    window.history.replaceState({}, '', '/connect')
    mockRestoreSession.mockResolvedValue(undefined)
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('.desktop-action').exists()).toBe(false)
  })

  it('uses secondary emphasis when an available personal-cloud device exists', async () => {
    mockRestoreSession.mockResolvedValue({ csrf: 'csrf', user: { userId: 'user' } } as Awaited<ReturnType<typeof restoreSession>>)
    mockCloudRequest.mockImplementation(async (path: string) => path === '/v1/devices'
      ? { devices: [{ deviceId: 'mac', name: 'Mac', platform: 'darwin', lastSeenAt: Date.now() }] }
      : { requests: [] })
    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.get('.desktop-action').classes()).not.toContain('is-primary')
  })
})
