// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { EnvironmentSourceSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import EnvironmentSourceConnection from './EnvironmentSourceConnection.vue'
import { useI18n } from './i18n'

const initial: EnvironmentSourceSnapshot = { providers: [{ id: 'workstation', name: 'Workstation', kinds: ['private', 'public'] }], connections: [] }
const pending = { id: 'a'.repeat(32), providerId: 'workstation', repository: 'https://example.com/config.git', kind: 'private' as const, state: 'authentication-required' as const, phase: 'cloning' as const, expiresAt: '2026-10-17T00:00:00Z', error: 'authentication-required' as const }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  useI18n().setLocale('zh-CN')
  vi.spyOn(api, 'environmentSources').mockResolvedValue(structuredClone(initial))
  vi.spyOn(api, 'connectEnvironmentSource').mockResolvedValue({ ...initial, connections: [pending] })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

it('connects with a repository URL, asks for authentication, clears the token and rechecks only on success', async () => {
  const wrapper = mount(EnvironmentSourceConnection)
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('input[type="url"]').setValue(pending.repository)
  await wrapper.get('.connection-form').trigger('submit')
  await flushPromises()
  expect(api.connectEnvironmentSource).toHaveBeenCalledWith({ operation: 'connect', providerId: 'workstation', kind: 'private', repository: pending.repository })
  expect(wrapper.emitted('connected')).toBeUndefined()
  await wrapper.get('.authentication-form input:not([type="password"])').setValue('fixture')
  await wrapper.get('input[type="password"]').setValue('fixture-token')
  vi.mocked(api.connectEnvironmentSource).mockResolvedValueOnce({ ...initial, connections: [{ ...pending, error: undefined, state: 'connected', localPath: '/managed/config' }] })
  await wrapper.get('.authentication-form').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('配置源已连接')
  expect(wrapper.text()).not.toContain('fixture-token')
  expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  expect(wrapper.emitted('connected')).toHaveLength(1)
})

it('rejects credentials embedded in URLs and can cancel an authentication request', async () => {
  const wrapper = mount(EnvironmentSourceConnection)
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('input[type="url"]').setValue('https://user:token@example.com/config.git')
  await wrapper.get('.connection-form').trigger('submit')
  await flushPromises()
  expect(api.connectEnvironmentSource).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('不含用户名、令牌')
  await wrapper.get('input[type="url"]').setValue(pending.repository)
  await wrapper.get('.connection-form').trigger('submit')
  await flushPromises()
  vi.mocked(api.connectEnvironmentSource).mockResolvedValueOnce({ ...initial, connections: [{ ...pending, error: undefined, state: 'cancelled' }] })
  await wrapper.findAll('button').find(button => button.text() === '取消连接')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('连接已取消')
  expect(wrapper.emitted('connected')).toBeUndefined()
})

it('offers every declared provider without a saved profile and respects its source kinds', async () => {
  vi.mocked(api.environmentSources).mockResolvedValue({ providers: [...initial.providers, { id: 'fixture', name: 'Fixture', kinds: ['public'] }], connections: [] })
  const wrapper = mount(EnvironmentSourceConnection, { props: { standalone: true } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('[data-testid="source-provider"]').setValue('fixture')
  const types = wrapper.findAll('.connection-form select')[1]!
  expect(types.findAll('option').map(option => option.attributes('value'))).toEqual(['public'])
  await wrapper.get('input[type="url"]').setValue(pending.repository)
  await wrapper.get('.connection-form').trigger('submit')
  await flushPromises()
  expect(api.connectEnvironmentSource).toHaveBeenCalledWith({ operation: 'connect', providerId: 'fixture', kind: 'public', repository: pending.repository })
})

it('requires a fresh read after an uncertain write and explains missing providers', async () => {
  const wrapper = mount(EnvironmentSourceConnection, { props: { standalone: true } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('input[type="url"]').setValue(pending.repository)
  vi.mocked(api.connectEnvironmentSource).mockRejectedValueOnce(new Error('connection lost'))
  await wrapper.get('.connection-form').trigger('submit')
  await flushPromises()
  expect(wrapper.get('.connection-form button').attributes('disabled')).toBeDefined()
  await wrapper.get('.connection-form').trigger('submit')
  expect(api.connectEnvironmentSource).toHaveBeenCalledTimes(1)
  await wrapper.get('.connection-heading button').trigger('click')
  await flushPromises()
  expect(wrapper.get('.connection-form button').attributes('disabled')).toBeUndefined()
  vi.mocked(api.environmentSources).mockResolvedValue({ providers: [], connections: [] })
  await wrapper.get('.connection-heading button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('暂无可用的配置源提供方')
  expect(wrapper.find('.connection-form').exists()).toBe(false)
})
