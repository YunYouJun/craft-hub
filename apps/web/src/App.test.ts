// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { useWorkbenchStore } from './store'

const projects: ProjectRecord[] = [
  { id: 'first', name: 'First', path: '/first', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'target', name: 'Target', path: '/target', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
]

class FakeEventSource {
  static instances: FakeEventSource[] = []
  readonly listeners = new Map<string, EventListener>()
  closed = false

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  close(): void {
    this.closed = true
  }
}

describe('app startup', () => {
  afterEach(() => {
    FakeEventSource.instances = []
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = ''
  })

  it('selects the project requested by the launch URL', async () => {
    window.history.replaceState({}, '', '/?project=target')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.theme': 'system' } }
        : path === '/api/workspaces/state'
          ? { expandedWorkspaceIds: [] }
          : path === '/api/projects'
            ? projects
            : path.endsWith('/pins')
              ? { projectId: path.split('/')[3], capabilityIds: [] }
              : []
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(App, { global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()

    expect(useWorkbenchStore().selectedProjectId).toBe('target')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events')
    expect(wrapper.findAll('.workbench-splitter [data-panel]')).toHaveLength(3)
    expect(wrapper.findAll('.workbench-resize-handle')).toHaveLength(2)
    expect(wrapper.findAll('.workbench-resize-handle').map(handle => handle.attributes('aria-label'))).toEqual([
      'Resize projects panel',
      'Resize capabilities panel',
    ])

    await wrapper.get('[data-testid="open-marketplace"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.marketplace-page').attributes('aria-label')).toBe('Plugin Marketplace')
    expect(wrapper.find('.dialog-overlay').exists()).toBe(false)
    expect(wrapper.get('[data-testid="open-marketplace"]').classes()).toContain('active')

    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    expect(wrapper.find('.marketplace-page').exists()).toBe(false)
    expect(wrapper.get('[data-testid="open-workbench"]').classes()).toContain('active')

    const projectRequests = (): number => fetchMock.mock.calls
      .filter(([input]) => (typeof input === 'string' ? input : input.toString()) === '/api/projects')
      .length
    const workspaceRequests = (): number => fetchMock.mock.calls
      .filter(([input]) => (typeof input === 'string' ? input : input.toString()) === '/api/workspaces')
      .length
    expect(projectRequests()).toBe(1)
    expect(workspaceRequests()).toBe(1)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(projectRequests()).toBe(2)
    expect(workspaceRequests()).toBe(2)

    wrapper.unmount()
    expect(FakeEventSource.instances[0]?.closed).toBe(true)
  })
})
