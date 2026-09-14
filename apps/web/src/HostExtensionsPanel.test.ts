// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { HostExtensionStatus } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import HostExtensionsPanel from './HostExtensionsPanel.vue'
import { useI18n } from './i18n'

afterEach(() => {
  delete window.craftHubDesktop
})

it('installs, disables and removes extensions with a persistent restart prompt', async () => {
  useI18n().setLocale('zh-CN')
  const installed: HostExtensionStatus = { extensions: [{ id: 'acme', name: 'Acme', enabled: true, manifestPath: '/example/distribution.json', modules: ['/example/host.mjs'] }], diagnostics: [], restartRequired: true }
  const installHostExtension = vi.fn(async () => installed)
  const setHostExtensionEnabled = vi.fn(async () => ({ ...installed, extensions: installed.extensions.map(item => ({ ...item, enabled: false })) }))
  const removeHostExtension = vi.fn(async () => ({ ...installed, extensions: [] }))
  const restartForHostExtensions = vi.fn(async () => {})
  window.craftHubDesktop = {
    hostExtensions: vi.fn(async () => ({ extensions: [], diagnostics: [], restartRequired: false })),
    installHostExtension,
    setHostExtensionEnabled,
    removeHostExtension,
    restartForHostExtensions,
  }
  const wrapper = mount(HostExtensionsPanel)
  const click = async (label: string) => {
    await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click')
    await flushPromises()
  }
  await flushPromises()
  await click('添加宿主扩展…')
  expect(wrapper.text()).toContain('Acme')
  expect(wrapper.text()).toContain('重启 Craft Hub 后生效')
  await click('停用')
  expect(setHostExtensionEnabled).toHaveBeenCalledWith('acme', false)
  expect(wrapper.text()).toContain('已禁用')
  await click('移除')
  expect(removeHostExtension).toHaveBeenCalledWith('acme')
  expect(wrapper.text()).toContain('重启 Craft Hub 后生效')
  await click('重启 Craft Hub')
  expect(restartForHostExtensions).toHaveBeenCalledOnce()
  wrapper.unmount()
})
