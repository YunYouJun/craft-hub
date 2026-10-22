// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import MicrosoftTodoOpenButton from './MicrosoftTodoOpenButton.vue'
import { useWorkbenchStore } from './store'

beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
})
afterEach(() => vi.restoreAllMocks())

it('opens only on demand, prevents duplicate launches and keeps its label while pending', async () => {
  let finish!: (result: { destination: 'application' }) => void
  const open = vi.spyOn(api, 'openLocalApplication').mockImplementation(() => new Promise(resolve => finish = resolve))
  const wrapper = mount(MicrosoftTodoOpenButton)
  expect(open).not.toHaveBeenCalled()
  const button = wrapper.get('button')
  await button.trigger('click')
  await button.trigger('click')
  expect(open).toHaveBeenCalledExactlyOnceWith('microsoft-todo')
  expect(button.attributes('disabled')).toBeDefined()
  expect(button.attributes('aria-busy')).toBe('true')
  expect(button.text()).toBe('Open locally')
  finish({ destination: 'application' })
  await flushPromises()
  expect(button.attributes('disabled')).toBeUndefined()
  expect(button.text()).toBe('Open locally')
  expect(wrapper.get('[role="status"]').text()).toContain('Requested Microsoft To Do')
  wrapper.unmount()
})

it('announces the host website fallback without opening another popup', async () => {
  vi.spyOn(api, 'openLocalApplication').mockResolvedValue({ destination: 'website' })
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  const wrapper = mount(MicrosoftTodoOpenButton, { props: { iconOnly: true } })
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(popup).not.toHaveBeenCalled()
  expect(wrapper.get('[role="status"]').text()).toBe('Opened Microsoft To Do on the web.')
  expect(wrapper.get('button').attributes('aria-label')).toBe('Open Microsoft To Do locally')
  expect(wrapper.get('button').text()).toBe('')
  wrapper.unmount()
})

it('allows retry after a launch failure without exposing process diagnostics', async () => {
  const open = vi.spyOn(api, 'openLocalApplication').mockRejectedValueOnce(new Error('private launcher diagnostics')).mockResolvedValue({ destination: 'application' })
  const wrapper = mount(MicrosoftTodoOpenButton)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('Could not open Microsoft To Do. Click to retry.')
  expect(wrapper.text()).not.toContain('private launcher diagnostics')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(open).toHaveBeenCalledTimes(2)
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  wrapper.unmount()
})

it('uses a browser link on hosted workbenches without launching anything on the server', async () => {
  useWorkbenchStore().hostEnvironment = { kind: 'hosted', capabilities: { localProjectDirectories: false, localGitSync: false } }
  const open = vi.spyOn(api, 'openLocalApplication')
  const popup = vi.spyOn(window, 'open').mockReturnValue(null)
  const wrapper = mount(MicrosoftTodoOpenButton)
  await wrapper.get('button').trigger('click')
  expect(open).not.toHaveBeenCalled()
  expect(popup).toHaveBeenCalledExactlyOnceWith('https://to-do.office.com/tasks/', '_blank', 'noopener,noreferrer')
  expect(wrapper.get('button').text()).toBe('Open website')
  wrapper.unmount()
})
