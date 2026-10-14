// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import QuickCaptureDialog from './QuickCaptureDialog.vue'

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(api, 'workAssistantStatus').mockResolvedValue({ available: false })
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})
const stubs = { DialogShell: { props: ['open'], template: '<div v-if="open"><slot name="title"/><slot/><slot name="footer"/></div>' } }
it('previews a natural-language draft and never writes until the reviewed form is submitted', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return { items: [], collections: [{ id: 'one', title: '任务' }] }
    return { id: 'new', title: '跟进发布' }
  })
  const wrapper = mount(QuickCaptureDialog, { attachTo: document.body, props: { open: true }, global: { stubs } })
  await flushPromises()
  await wrapper.find('textarea').setValue('明天下午三点跟进发布 #任务 !重要')
  expect(wrapper.find<HTMLInputElement>('input[maxlength="500"]').element.value).toBe('跟进发布')
  expect(invoke.mock.calls.filter(call => call[1] === 'create')).toHaveLength(0)
  const save = wrapper.find<HTMLButtonElement>('button[type="submit"]')
  expect(save.element.form).toBe(wrapper.find('form').element)
  save.element.click()
  await flushPromises()
  expect(invoke.mock.calls.find(call => call[1] === 'create')?.[2]).toMatchObject({ accountId: 'owner@example.com', listId: 'one', title: '跟进发布', important: true })
  expect(wrapper.emitted('saved')).toHaveLength(1)
  expect(wrapper.text()).toContain('跟进发布')
  wrapper.unmount()
})
it('retains an uncertain intent across closing and reopening, so retries reuse its id', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return { items: [], collections: [{ id: 'one', title: 'Tasks' }] }
    throw new Error('Timeout')
  })
  const first = mount(QuickCaptureDialog, { props: { open: true }, global: { stubs } })
  await flushPromises()
  await first.find('textarea').setValue('Ship release')
  await first.find('form').trigger('submit')
  await flushPromises()
  first.unmount()
  const second = mount(QuickCaptureDialog, { props: { open: true }, global: { stubs } })
  await flushPromises()
  await second.find('form').trigger('submit')
  await flushPromises()
  const calls = invoke.mock.calls.filter(call => call[1] === 'create')
  expect(calls).toHaveLength(2)
  expect(calls[0]![2]!.requestId).toBe(calls[1]![2]!.requestId)
  expect(second.emitted('saved')).toBeUndefined()
  second.unmount()
})
