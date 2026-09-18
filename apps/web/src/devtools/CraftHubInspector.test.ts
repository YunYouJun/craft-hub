// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CapabilityDiscoveryResult } from 'craft-hub'
import type { InspectorSnapshot } from '../../devtools/types'
import { FRAME_NAV_CHANNEL, FRAME_NAV_VERSION } from '@vitejs/devtools-kit/client'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspector } from './client'
import CraftHubInspector from './CraftHubInspector.vue'
import { inspectorLocaleKey } from './i18n'

vi.mock('./client', () => ({ inspector: { snapshot: vi.fn(), discover: vi.fn() } }))

function snapshot(): InspectorSnapshot {
  return {
    checkedAt: '2026-09-18T10:00:00.000Z',
    health: { status: 'ok', distribution: { id: 'community', name: 'Craft Hub' }, projectConfigSchemaRevision: '1' },
    catalog: {
      projects: [
        { id: 'first', name: 'First project', path: '/projects/first', trust: 'untrusted', addedAt: '' },
        { id: 'second', name: 'Second project', path: '/projects/second', trust: 'trusted', addedAt: '' },
      ],
      diagnostics: [],
    },
    runs: [],
    diagnostics: { checkedAt: '', summary: { errors: 0, warnings: 0 }, diagnostics: [] },
    errors: [],
  }
}

function discovery(name: string): CapabilityDiscoveryResult {
  return { capabilities: [{
    id: name,
    name,
    kind: 'command',
    source: 'package.json',
    invocation: { command: 'pnpm', args: ['run', name], cwd: '/projects/sample', requiredEnv: [] },
  }], diagnostics: [] }
}

describe('craft Hub Inspector', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    vi.mocked(inspector.snapshot).mockResolvedValue(snapshot())
    vi.mocked(inspector.discover).mockResolvedValue(discovery('build'))
  })

  afterEach(() => vi.restoreAllMocks())

  it('inspects untrusted projects, filters capabilities, and refreshes their discovery', async () => {
    const wrapper = mount(CraftHubInspector)
    await flushPromises()
    expect(wrapper.text()).toContain('未信任')
    expect(inspector.discover).toHaveBeenCalledWith('first')
    expect(wrapper.get('summary').text()).toContain('build')
    expect(wrapper.text()).toContain('pnpm run build')
    await wrapper.get('input[type="search"]').setValue('missing')
    expect(wrapper.text()).toContain('没有符合筛选条件的能力。')
    await wrapper.get('input[type="search"]').setValue('')
    vi.mocked(inspector.discover).mockResolvedValue(discovery('test'))
    await wrapper.get('.refresh').trigger('click')
    await flushPromises()
    expect(wrapper.get('summary').text()).toContain('test')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['刷新', '项目', '诊断', '运行记录'])
    wrapper.unmount()
  })

  it('ignores a slow discovery response from a previously selected project', async () => {
    let resolveFirst!: (result: CapabilityDiscoveryResult) => void
    vi.mocked(inspector.discover).mockImplementation(id => id === 'first'
      ? new Promise((resolve) => { resolveFirst = resolve })
      : Promise.resolve(discovery('second-result')))
    const wrapper = mount(CraftHubInspector)
    await flushPromises()
    await wrapper.get('.project-picker select').setValue('second')
    await flushPromises()
    resolveFirst(discovery('stale-first-result'))
    await flushPromises()
    expect(wrapper.get('summary').text()).toContain('second-result')
    expect(wrapper.text()).not.toContain('stale-first-result')
    wrapper.unmount()
  })

  it('syncs official dock navigation and translated titles without losing project filters', async () => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const host = iframe.contentWindow!
    vi.spyOn(window, 'parent', 'get').mockReturnValue(host)
    const post = vi.spyOn(host, 'postMessage').mockImplementation(() => {})
    const wrapper = mount(CraftHubInspector)
    await flushPromises()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      channel: FRAME_NAV_CHANNEL,
      v: FRAME_NAV_VERSION,
      frameId: 'craft-hub',
      type: 'ready',
      current: 'projects',
    }), window.location.origin)
    await wrapper.get('.project-picker select').setValue('second')
    await flushPromises()
    await wrapper.get('input[type="search"]').setValue('build')

    const navigate = (tabId: string, origin = window.location.origin, source: Window = host): void => {
      window.dispatchEvent(new MessageEvent('message', {
        source,
        origin,
        data: { channel: FRAME_NAV_CHANNEL, v: FRAME_NAV_VERSION, frameId: 'craft-hub', from: 'host', type: 'navigate', tabId, navTarget: { path: `/${tabId}` } },
      }))
    }
    navigate('runs', 'https://unrelated.example')
    navigate('runs', window.location.origin, window)
    navigate('unknown')
    await flushPromises()
    expect(wrapper.find('.project-picker').exists()).toBe(true)
    navigate('runs')
    await flushPromises()
    expect(wrapper.text()).toContain('最近运行')
    expect(window.location.hash).toBe('#/runs')
    await wrapper.get('.language-picker').setValue('en')
    expect(wrapper.text()).toContain('Recent runs')
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'manifest',
      current: 'runs',
      tabs: expect.arrayContaining([expect.objectContaining({ id: 'projects', title: 'Projects' })]),
    }), window.location.origin)
    expect(wrapper.find('.tabs').exists()).toBe(false)
    window.history.replaceState(null, '', '/#/projects')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await flushPromises()
    expect(wrapper.get<HTMLSelectElement>('.project-picker select').element.value).toBe('second')
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('build')
    expect(inspector.snapshot).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'navigated', tabId: 'projects' }), window.location.origin)
    wrapper.unmount()
    post.mockClear()
    navigate('diagnostics')
    expect(post).not.toHaveBeenCalled()
    iframe.remove()
  })

  it('remembers the language and opens a direct tab URL', async () => {
    const wrapper = mount(CraftHubInspector)
    await flushPromises()
    await wrapper.get('.language-picker').setValue('en')
    expect(localStorage.getItem(inspectorLocaleKey)).toBe('en')
    wrapper.unmount()
    window.history.replaceState(null, '', '/#/diagnostics')
    const reopened = mount(CraftHubInspector)
    await flushPromises()
    expect(document.documentElement.lang).toBe('en')
    expect(reopened.text()).toContain('Workbench diagnostics')
    expect(reopened.get('[aria-current="page"]').text()).toBe('Diagnostics')
    localStorage.setItem(inspectorLocaleKey, 'zh-CN')
    window.dispatchEvent(new StorageEvent('storage', { key: inspectorLocaleKey }))
    await flushPromises()
    expect(reopened.text()).toContain('工作台诊断')
    reopened.unmount()
  })

  it('shows a connection failure and recovers with Refresh', async () => {
    vi.mocked(inspector.snapshot).mockRejectedValueOnce(new Error('Connection closed'))
    const wrapper = mount(CraftHubInspector)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Connection closed')
    await wrapper.get('.refresh').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已连接')
    wrapper.unmount()
  })
})
