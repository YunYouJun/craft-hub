// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationConfigurationToggle from './IntegrationConfigurationToggle.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('zh-CN')
})
afterEach(() => vi.restoreAllMocks())
const props = { integrationId: 'codex-configuration', actionId: 'update', projectId: 'project', entity: { id: 'test@local', title: 'Test', configurationToggle: { enabled: true, inherited: false, revision: 'revision', scope: 'project' as const } } }
it('sends an explicit scoped toggle and updates only after the response', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [] })
  const wrapper = mount(IntegrationConfigurationToggle, { props })
  expect(wrapper.text()).not.toContain('项目开关')
  expect(wrapper.text()).not.toContain('已开启')
  expect(wrapper.get('[role="switch"]').attributes('aria-label')).toContain('项目开关')
  await wrapper.get('[role="switch"]').trigger('click')
  expect(invoke).toHaveBeenCalledWith('codex-configuration', 'update', { id: 'test@local', enabled: false, revision: 'revision', locale: 'zh-CN' }, 'project', true)
  await flushPromises()
  expect(wrapper.emitted('updated')?.[0]).toEqual([{ items: [] }])
  await wrapper.get('.configuration-reset').trigger('click')
  expect(invoke.mock.calls[1]?.[2]?.enabled).toBeNull()
})
it('retains the checked state on failure and offers a refresh instruction', async () => {
  vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('conflict'))
  const wrapper = mount(IntegrationConfigurationToggle, { props })
  await wrapper.get('[role="switch"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
  expect(wrapper.get('[role="alert"]').text()).toContain('刷新')
  expect(wrapper.emitted('updated')).toBeUndefined()
})
it('prevents duplicate clicks during a save and disables controls during refresh', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockReturnValue(new Promise(() => {}))
  const wrapper = mount(IntegrationConfigurationToggle, { props })
  await wrapper.get('[role="switch"]').trigger('click')
  await wrapper.get('[role="switch"]').trigger('click')
  expect(invoke).toHaveBeenCalledOnce()
  expect(wrapper.text()).toContain('保存中')
  const refreshing = mount(IntegrationConfigurationToggle, { props: { ...props, disabled: true } })
  expect(refreshing.get('[role="switch"]').attributes('disabled')).toBeDefined()
})

it('does not apply a late response after leaving the current scope', async () => {
  let finish!: (value: { items: [] }) => void
  vi.spyOn(api, 'invokeIntegrationAction').mockReturnValue(new Promise((resolve) => {
    finish = resolve
  }))
  const wrapper = mount(IntegrationConfigurationToggle, { props })
  await wrapper.get('[role="switch"]').trigger('click')
  wrapper.unmount()
  finish({ items: [] })
  await flushPromises()
  expect(wrapper.emitted('updated')).toBeUndefined()
})

it('explains inheritance on keyboard focus and dismisses help with Escape', async () => {
  const wrapper = mount(IntegrationConfigurationToggle, { props, attachTo: document.body })
  const help = wrapper.get('button[aria-label="跟随上层设置是什么意思？"]')
  await help.trigger('focus')
  await flushPromises()
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('只删除当前项目')
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('不会卸载插件')
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await flushPromises()
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  wrapper.unmount()
})
