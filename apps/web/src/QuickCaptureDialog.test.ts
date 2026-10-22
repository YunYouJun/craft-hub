// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { DialogShell } from './components/ui/dialog'
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
  expect(wrapper.findAll('.settings-form-group .settings-form-row')).toHaveLength(3)
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

it('resolves a list hashtag typed before lists finish loading without replacing other reviewed fields', async () => {
  let resolveLists!: (page: { items: [], collections: Array<{ id: string, title: string }> }) => void
  const page = new Promise<{ items: [], collections: Array<{ id: string, title: string }> }>((resolve) => {
    resolveLists = resolve
  })
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return page
    return { id: 'new', title: 'Follow up' }
  })
  const wrapper = mount(QuickCaptureDialog, { props: { open: true }, global: { stubs } })
  await flushPromises()
  await wrapper.find('textarea').setValue('Follow up #Work')
  await wrapper.find('details textarea').setValue('Keep this reviewed context')
  await wrapper.find('input[type="checkbox"]').setValue(true)
  resolveLists({ items: [], collections: [{ id: 'tasks', title: 'Tasks' }, { id: 'work', title: 'Work' }] })
  await flushPromises()
  expect(wrapper.find<HTMLInputElement>('input[maxlength="500"]').element.value).toBe('Follow up')
  expect(wrapper.find<HTMLSelectElement>('select').element.value).toBe('work')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(invoke.mock.calls.find(call => call[1] === 'create')?.[2]).toMatchObject({ listId: 'work', title: 'Follow up', notes: 'Keep this reviewed context', important: true })
  wrapper.unmount()
})

it('keeps a manually reviewed title and list when a later list refresh resolves the capture hashtag', async () => {
  let resolveLists!: (page: { items: [], collections: Array<{ id: string, title: string }> }) => void
  const pendingPage = new Promise<{ items: [], collections: Array<{ id: string, title: string }> }>((resolve) => {
    resolveLists = resolve
  })
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return { items: [], collections: [{ id: 'tasks', title: 'Tasks' }, { id: 'personal', title: 'Personal' }] }
    return { id: 'new', title: 'Reviewed title' }
  })
  const wrapper = mount(QuickCaptureDialog, { props: { open: true }, global: { stubs } })
  await flushPromises()
  await wrapper.find('textarea').setValue('Follow up #Work')
  await wrapper.find('input[maxlength="500"]').setValue('Reviewed title')
  await wrapper.find('select').setValue('personal')
  invoke.mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return pendingPage
    return { id: 'new', title: 'Reviewed title' }
  })
  await wrapper.find('button[aria-label="Refresh connection"], button[aria-label="刷新连接"]').trigger('click')
  await flushPromises()
  resolveLists({ items: [], collections: [{ id: 'tasks', title: 'Tasks' }, { id: 'personal', title: 'Personal' }, { id: 'work', title: 'Work' }] })
  await flushPromises()
  expect(wrapper.find<HTMLInputElement>('input[maxlength="500"]').element.value).toBe('Reviewed title')
  expect(wrapper.find<HTMLSelectElement>('select').element.value).toBe('personal')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
  expect(invoke.mock.calls.find(call => call[1] === 'create')?.[2]).toMatchObject({ listId: 'personal', title: 'Reviewed title' })
  wrapper.unmount()
})

it('preserves keyboard submission, the edited draft and the open dialog while a save is in flight', async () => {
  let finishSave!: (item: { id: string, title: string }) => void
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockImplementation(async (_integration, action) => {
    if (action === 'connection')
      return { connected: true, accountLabel: 'owner@example.com', capabilities: { create: true } }
    if (action === 'tasks')
      return { items: [], collections: [{ id: 'tasks', title: 'Tasks' }] }
    return new Promise<{ id: string, title: string }>((resolve) => {
      finishSave = resolve
    })
  })
  const wrapper = mount(QuickCaptureDialog, { attachTo: document.body, props: { open: true } })
  await flushPromises()
  const composer = document.body.querySelector<HTMLTextAreaElement>('.capture-composer textarea')!
  composer.value = 'Keep this thought'
  composer.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
  await flushPromises()
  expect(invoke.mock.calls.filter(call => call[1] === 'create')).toHaveLength(1)
  expect(document.body.querySelector<HTMLInputElement>('input[maxlength="500"]')?.value).toBe('Keep this thought')
  expect(composer.disabled).toBe(true)
  wrapper.findComponent(DialogShell).vm.$emit('update:open', false)
  expect(wrapper.emitted('update:open')).toBeUndefined()
  finishSave({ id: 'saved', title: 'Keep this thought' })
  await flushPromises()
  expect(wrapper.emitted('saved')).toHaveLength(1)
  expect(composer.value).toBe('')
  wrapper.unmount()
})
