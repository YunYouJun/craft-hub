// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { LocalEnvironmentSnapshot, RuntimeHealth } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import EnvironmentWorkbench from './EnvironmentWorkbench.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const health: RuntimeHealth = {
  status: 'ok',
  projectConfigSchemaRevision: 'current',
  distribution: { id: 'community', name: 'Craft Hub' },
  hostEnvironment: { kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } },
}

const snapshot: LocalEnvironmentSnapshot = {
  schemaVersion: 1,
  checkedAt: '2026-10-09T10:00:00.000Z',
  host: { platform: 'darwin', arch: 'arm64', osRelease: '25.6.0' },
  runtime: { version: 'v24.18.0', executablePath: '/desktop/runtime/node', arch: 'arm64' },
  searchDirectories: ['/usr/bin', '/opt/homebrew/bin'],
  tools: [
    { id: 'git', name: 'Git', status: 'available', version: 'git version 2.51.0', executablePath: '/usr/bin/git', source: 'path' },
    { id: 'node', name: 'Node.js', status: 'available', version: 'v22.18.0', executablePath: '/opt/homebrew/bin/node', resolvedPath: '/opt/homebrew/Cellar/node/22.18/bin/node', source: 'common-location' },
    { id: 'pnpm', name: 'pnpm', status: 'missing' },
    { id: 'fnm', name: 'fnm', status: 'error', executablePath: '/usr/bin/fnm', message: 'Version check timed out' },
    { id: 'homebrew', name: 'Homebrew', status: 'unsupported', message: 'Platform is unsupported' },
    { id: 'workstation', name: 'Workstation', status: 'missing' },
  ],
}

describe('local environment workbench', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    vi.spyOn(api, 'runtimeHealth').mockResolvedValue(health)
    vi.spyOn(api, 'localEnvironment').mockResolvedValue(snapshot)
  })

  afterEach(() => vi.restoreAllMocks())

  it('checks only after opening and separates backend runtime, paths and tool states', async () => {
    const store = useWorkbenchStore()
    expect(api.localEnvironment).not.toHaveBeenCalled()
    expect(store.projects).toEqual([])
    const wrapper = mount(EnvironmentWorkbench)
    expect(store.localEnvironmentLoading).toBe(true)
    await flushPromises()

    expect(api.localEnvironment).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="environment-runtime"]').text()).toContain('v24.18.0')
    expect(wrapper.get('[data-testid="environment-tool-node"]').text()).toContain('v22.18.0')
    expect(wrapper.get('[data-testid="environment-tool-node"]').text()).toContain('/opt/homebrew/Cellar/node/22.18/bin/node')
    expect(wrapper.get('[data-testid="environment-tool-pnpm"]').text()).toContain('may be installed elsewhere')
    expect(wrapper.get('[data-testid="environment-tool-fnm"]').text()).toContain('Check failed')
    expect(wrapper.get('[data-testid="environment-tool-homebrew"]').text()).toContain('Unsupported')
    expect(wrapper.get('[data-testid="environment-summary"]').text()).toContain('2 available')
    expect(wrapper.get('[data-testid="environment-summary"] time').attributes('datetime')).toBe(snapshot.checkedAt)
    expect(wrapper.get('[data-testid="environment-search-directories"]').attributes('open')).toBeUndefined()
    expect(wrapper.get('[data-testid="environment-search-directories"]').text()).toContain('/opt/homebrew/bin')

    await wrapper.get('[data-testid="refresh-environment"]').trigger('click')
    await flushPromises()
    expect(api.localEnvironment).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('renders recognizable offline brands and keeps names beside semantic fallbacks', async () => {
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()

    expect(wrapper.get('[data-testid="environment-runtime"] h2 .app-icon').classes()).toContain('i-logos-nodejs-icon')
    expect(wrapper.get('[data-testid="environment-tool-git"] h2 .app-icon').classes()).toContain('i-logos-git-icon')
    expect(wrapper.get('[data-testid="environment-tool-node"] h2 .app-icon').classes()).toContain('i-logos-nodejs-icon')
    expect(wrapper.get('[data-testid="environment-tool-pnpm"] h2 .app-icon').classes()).toContain('i-logos-pnpm')
    expect(wrapper.get('[data-testid="environment-tool-homebrew"] h2 .app-icon').classes()).toContain('i-logos-homebrew')
    expect(wrapper.get('[data-testid="environment-tool-fnm"] h2').text()).toBe('fnm')
    expect(wrapper.get('[data-testid="environment-tool-fnm"] h2 .app-icon').classes()).toContain('i-ri-terminal-box-line')
    expect(wrapper.get('[data-testid="environment-tool-workstation"] h2').text()).toBe('Workstation')
    expect(wrapper.get('[data-testid="environment-tool-workstation"] h2 .app-icon').classes()).toContain('i-ri-folders-line')
    expect(wrapper.findAll('h2 .app-icon').every(icon => icon.attributes('aria-hidden') === 'true')).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })

  it('blocks hosted inspection before requesting environment data and drops any local snapshot', async () => {
    const store = useWorkbenchStore()
    store.localEnvironment = snapshot
    vi.mocked(api.runtimeHealth).mockResolvedValue({ ...health, hostEnvironment: { kind: 'hosted', capabilities: { localProjectDirectories: false, localGitSync: false } } })
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()

    expect(api.localEnvironment).not.toHaveBeenCalled()
    expect(store.localEnvironment).toBeUndefined()
    expect(wrapper.get('[data-testid="environment-hosted"]').text()).toContain('cannot access your device')
    expect(wrapper.find('[data-testid="environment-runtime"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('localizes reason codes when changing language and preserves legacy messages without a reason', async () => {
    vi.mocked(api.localEnvironment).mockResolvedValue({
      ...snapshot,
      tools: [
        { id: 'git', name: 'Git', status: 'error', reason: 'developer-tools-unavailable', message: 'System developer tools unavailable' },
        { id: 'fnm', name: 'fnm', status: 'error', reason: 'timeout', message: 'Probe timed out' },
        { id: 'homebrew', name: 'Homebrew', status: 'unsupported', reason: 'platform-unsupported', message: 'Unsupported platform' },
        { id: 'pnpm', name: 'pnpm', status: 'missing', reason: 'not-found', message: 'Not found' },
        { id: 'workstation', name: 'Workstation', status: 'error', message: 'Legacy diagnostic' },
      ],
    })
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()
    expect(wrapper.get('[data-testid="environment-tool-fnm"]').text()).toContain('The tool version check timed out.')

    useI18n().setLocale('zh-CN')
    await flushPromises()
    expect(wrapper.get('[data-testid="environment-tool-fnm"]').text()).toContain('工具版本检测超时。')
    expect(wrapper.get('[data-testid="environment-tool-fnm"]').text()).not.toContain('Probe timed out')
    expect(wrapper.get('[data-testid="environment-tool-git"]').text()).toContain('系统开发工具不可用')
    expect(wrapper.get('[data-testid="environment-tool-homebrew"]').text()).toContain('当前系统不支持此工具的检测。')
    expect(wrapper.get('[data-testid="environment-tool-pnpm"]').text()).toContain('检索目录中未发现')
    expect(wrapper.get('[data-testid="environment-tool-pnpm"]').text()).not.toContain('Not found')
    expect(wrapper.get('[data-testid="environment-tool-workstation"]').text()).toContain('Legacy diagnostic')
    expect(api.localEnvironment).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retains the last snapshot with a stale warning after refresh fails, and retries explicitly', async () => {
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()
    vi.mocked(api.localEnvironment).mockRejectedValueOnce(new Error('Probe unavailable'))

    await wrapper.get('[data-testid="refresh-environment"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="environment-error"]').text()).toContain('Probe unavailable')
    expect(wrapper.get('[data-testid="environment-stale"]').text()).toContain('out of date')
    expect(wrapper.get('[data-testid="environment-tool-git"]').text()).toContain('git version 2.51.0')

    await wrapper.get('[data-testid="environment-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="environment-error"]').exists()).toBe(false)
    expect(api.localEnvironment).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })

  it('requires verified host information before probing and permits retry after initial failure', async () => {
    vi.mocked(api.runtimeHealth).mockResolvedValueOnce(undefined)
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()

    expect(api.localEnvironment).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="environment-error"]').text()).toContain('Could not verify')
    expect(wrapper.find('[data-testid="environment-summary"]').exists()).toBe(false)
    await wrapper.get('[data-testid="environment-error"] button').trigger('click')
    await flushPromises()
    expect(api.localEnvironment).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('coalesces concurrent checks and does not show old results as newly checked while loading', async () => {
    const store = useWorkbenchStore()
    store.localEnvironment = snapshot
    let resolveCheck!: (value: LocalEnvironmentSnapshot) => void
    vi.mocked(api.localEnvironment).mockImplementation(() => new Promise((resolve) => {
      resolveCheck = resolve
    }))
    const wrapper = mount(EnvironmentWorkbench)
    await flushPromises()
    await store.loadLocalEnvironment()
    expect(api.localEnvironment).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="refresh-environment"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.environment-updating').text()).toContain('Previous results')
    expect(store.localEnvironment?.checkedAt).toBe(snapshot.checkedAt)
    resolveCheck({ ...snapshot, checkedAt: '2026-10-09T11:00:00.000Z' })
    await flushPromises()
    expect(wrapper.get('[data-testid="environment-summary"] time').attributes('datetime')).toBe('2026-10-09T11:00:00.000Z')
    wrapper.unmount()
  })
})
