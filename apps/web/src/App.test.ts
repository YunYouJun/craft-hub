// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import App from './App.vue'
import { createWorkbenchRouter } from './router'
import { isMacPlatform } from './shortcuts'
import { useWorkbenchStore } from './store'

const projects: ProjectRecord[] = [
  { id: 'first', name: 'First', path: '/first', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'target', name: 'Target', path: '/target', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
]

const workspace: WorkspaceRecord = {
  schemaVersion: 1,
  id: 'personal-development',
  name: 'Personal development',
  primaryProject: 'first',
  revision: 'revision',
  members: [{ project: 'first', projectId: projects[0]!.id, resolved: true }],
}

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

async function mountApp(pinia: ReturnType<typeof createPinia>, path = '/') {
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  return {
    router,
    wrapper: mount(App, { global: { plugins: [pinia, router] }, attachTo: document.body }),
  }
}

describe('app startup', () => {
  afterEach(() => {
    vi.useRealTimers()
    FakeEventSource.instances = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, 'craftHubDesktop')
    delete window.craftHubDesktop
  })

  it('shows a project load error instead of a false empty-project welcome', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects')
        return new Response(JSON.stringify({ error: 'runtime unavailable' }), { status: 500 })
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [] }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(wrapper.get('[data-testid="project-load-error"]').text()).toContain('runtime unavailable')
    expect(wrapper.find('[data-testid="guided-first-run-welcome"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps the detail workspace loading while the initial project selection is pending', async () => {
    let releaseDiscovery!: () => void
    const discoveryReady = new Promise<void>((resolve) => {
      releaseDiscovery = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/projects')
        return new Response(JSON.stringify({ projects: [projects[0]], diagnostics: [] }), { status: 200 })
      if (path.endsWith('/capability-discovery')) {
        await discoveryReady
        return new Response(JSON.stringify({ capabilities: [], diagnostics: [], packages: [] }), { status: 200 })
      }
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [], selectedProjectId: projects[0]!.id }), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: projects[0]!.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await vi.waitFor(() => expect(useWorkbenchStore().projects).toHaveLength(1))

    const loadingState = {
      detailEmpty: wrapper.find('.detail-empty').exists(),
      loadingText: wrapper.find('.project-load-state').text(),
      projectToolbar: wrapper.find('.project-toolbar').exists(),
    }

    releaseDiscovery()
    await flushPromises()
    wrapper.unmount()

    expect(loadingState.loadingText).toContain('Loading')
    expect(loadingState.detailEmpty).toBe(false)
    expect(loadingState.projectToolbar).toBe(false)
  })

  it('restores the persisted project before loading an initial project overview', async () => {
    const overviewProjectIds: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/projects')
        return new Response(JSON.stringify({ projects, diagnostics: [] }), { status: 200 })
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [], selectedProjectId: projects[1]!.id }), { status: 200 })
      if (path.endsWith('/capability-discovery'))
        return new Response(JSON.stringify({ capabilities: [], diagnostics: [], packages: [] }), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: path.split('/')[3], capabilityIds: [] }), { status: 200 })
      if (path.includes('/overview?')) {
        const projectId = path.split('/')[3]!
        overviewProjectIds.push(projectId)
        return new Response(JSON.stringify({
          projectId,
          package: { name: projectId, relativePath: '.', root: true },
          readme: { status: 'missing' },
        }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(useWorkbenchStore().selectedProjectId).toBe(projects[1]!.id)
    expect(overviewProjectIds).toEqual([projects[1]!.id])
    wrapper.unmount()
  })

  it('coalesces focus and visibility refreshes into one request batch', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      requests.push(path)
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/projects')
        return new Response(JSON.stringify({ projects: [], diagnostics: [] }), { status: 200 })
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [] }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const codexActivityStatus = vi.fn(async () => ({ installed: false, runningSessionIds: [], supported: false }))
    window.craftHubDesktop = { codexActivityStatus }
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await flushPromises()
    requests.length = 0
    codexActivityStatus.mockClear()
    vi.useFakeTimers()

    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(requests.filter(path => path === '/api/workspaces')).toHaveLength(1)
    expect(requests.filter(path => path === '/api/agent-tasks')).toHaveLength(1)
    expect(codexActivityStatus).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('opens an invalid project config at its diagnostic location in the configured editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects') {
        return new Response(JSON.stringify({
          projects: [projects[0]],
          diagnostics: [{
            projectId: projects[0]!.id,
            source: 'project-config',
            targetPath: '.craft-hub/project.jsonc',
            path: '/unknown',
            line: 3,
            column: 14,
            message: 'Unrecognized key: "unknown"',
          }],
        }), { status: 200 })
      }
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [] }), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: projects[0]!.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const openProjectEvidenceInEditor = vi.fn(async () => {})
    window.craftHubDesktop = { openProjectEvidenceInEditor }
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(wrapper.get('[data-testid="project-config-diagnostic"]').text()).toContain('Unrecognized key: "unknown"')
    await wrapper.get('[data-testid="open-project-config-diagnostic"]').trigger('click')
    expect(openProjectEvidenceInEditor).toHaveBeenCalledWith(projects[0]!.id, '.craft-hub/project.jsonc', 3, 14)
    wrapper.unmount()
  })

  it('shows explicit Runtime compatibility and refresh warnings without dropping projects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/projects')
        return new Response(JSON.stringify({ projects: [projects[0]], diagnostics: [] }), { status: 200 })
      if (path === '/api/settings') {
        return new Response(JSON.stringify({
          explicitKeys: [],
          path: '/settings.json',
          revision: 'initial',
          settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' },
        }), { status: 200 })
      }
      if (path === '/api/workspaces/state')
        return new Response(JSON.stringify({ expandedWorkspaceIds: [] }), { status: 200 })
      if (path.endsWith('/pins'))
        return new Response(JSON.stringify({ projectId: projects[0]!.id, capabilityIds: [] }), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper } = await mountApp(pinia)
    await flushPromises()
    const store = useWorkbenchStore()

    store.runtimeSchemaMismatch = { actual: 'sha256:old', expected: 'sha256:new' }
    await nextTick()

    expect(wrapper.get('[data-testid="runtime-schema-mismatch"]').text()).toContain('Runtime is out of date')
    expect(store.projects).toEqual([projects[0]])

    store.runtimeSchemaMismatch = undefined
    store.projectsLoadState = 'error'
    store.projectsLoadError = 'runtime unavailable'
    await nextTick()

    expect(wrapper.get('[data-testid="project-refresh-error"]').text()).toContain('runtime unavailable')
    expect(store.projects).toEqual([projects[0]])
    wrapper.unmount()
  })

  it('keeps splitter drag direction correct when the middle panel mounts after project loading', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-panel-group'))
        return DOMRect.fromRect({ width: 1000, height: 800 })
      if (this.id === 'capabilities-resize-handle')
        return DOMRect.fromRect({ x: 600, y: 0, width: 9, height: 800 })
      if (this.hasAttribute('data-resize-handle'))
        return DOMRect.fromRect({ x: 280, y: 0, width: 9, height: 800 })
      return DOMRect.fromRect()
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/projects'
          ? [projects[0]]
          : path === '/api/workspaces/state'
            ? { expandedWorkspaceIds: [] }
            : path.endsWith('/pins')
              ? { projectId: projects[0]!.id, capabilityIds: [] }
              : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { wrapper } = await mountApp(pinia)
    await flushPromises()
    await nextTick()

    const capabilitiesPanel = wrapper.get('#capabilities-panel')
    const sizeBefore = Number(capabilitiesPanel.attributes('data-panel-size'))
    const handle = wrapper.get('#capabilities-resize-handle').element
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 600, clientY: 20 }))
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 550, clientY: 20 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 550, clientY: 20 }))
    await nextTick()

    expect(Number(capabilitiesPanel.attributes('data-panel-size'))).toBeLessThan(sizeBefore)
    wrapper.unmount()
  })

  it('does not restore a project toolbar when an active workspace refreshes on focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/owner-scopes'
          ? [{ id: 'personal', kind: 'personal', name: 'Personal' }]
          : path === '/api/owner-scopes/state'
            ? { activeScopeId: 'personal' }
            : path === '/api/projects'
              ? [projects[0]]
              : path === '/api/workspaces'
                ? [workspace]
                : path === '/api/workspaces/state'
                  ? { expandedWorkspaceIds: [workspace.id], selectedWorkspaceId: workspace.id }
                  : path === '/api/workspace-groups/project-assignments'
                    ? {}
                    : path.endsWith('/pins')
                      ? { projectId: projects[0]!.id, capabilityIds: [] }
                      : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(wrapper.get('.workspace-dashboard h2').text()).toBe(workspace.name)
    expect(wrapper.find('.project-toolbar').exists()).toBe(false)

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    const store = useWorkbenchStore()
    expect(store.selectedWorkspace?.id).toBe(workspace.id)
    expect(store.selectedProjectId).toBe('')
    expect(wrapper.find('.project-toolbar').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens the marketplace directly and keeps rail navigation in the route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/workspaces/state'
          ? { expandedWorkspaceIds: [] }
          : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { router, wrapper } = await mountApp(pinia, '/marketplace')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/marketplace')
    expect(wrapper.get('.marketplace-page').attributes('aria-label')).toBe('Plugin Marketplace')
    expect(wrapper.get('[data-testid="open-marketplace"]').classes()).toContain('active')

    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.marketplace-page').exists()).toBe(false)

    await wrapper.get('[data-testid="open-marketplace"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/marketplace')

    wrapper.unmount()
  })

  it('opens diagnostics directly and returns to the project workbench through the activity rail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/workspaces/state'
          ? { expandedWorkspaceIds: [] }
          : path === '/api/diagnostics'
            ? {
                checkedAt: '2026-09-04T10:00:00.000Z',
                diagnostics: [{ id: 'settings', kind: 'settings', severity: 'error', subject: '/settings.json', message: 'Invalid settings', target: { type: 'settings' } }],
                summary: { errors: 1, warnings: 0 },
              }
            : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { router, wrapper } = await mountApp(pinia, '/diagnostics')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/diagnostics')
    expect(wrapper.get('.diagnostics-workbench h1').text()).toBe('Diagnostics')
    expect(wrapper.get('[data-testid="open-diagnostics"]').classes()).toContain('active')
    expect(wrapper.get('[data-testid="open-diagnostics"] .activity-badge').text()).toBe('1')

    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.diagnostics-workbench').exists()).toBe(false)

    wrapper.unmount()
  })

  it('switches from navigation to marketplace without mounting the project workbench behind it', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/workspaces/state'
          ? { expandedWorkspaceIds: [] }
          : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    const pinia = createPinia()
    setActivePinia(pinia)

    const { router, wrapper } = await mountApp(pinia, '/navigation')
    await flushPromises()

    expect(wrapper.find('.navigation-view-shell').exists()).toBe(true)

    await wrapper.get('[data-testid="open-marketplace"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/marketplace')
    expect(wrapper.find('.marketplace-page').exists()).toBe(true)
    expect(wrapper.find('.workbench-splitter').exists()).toBe(false)

    wrapper.unmount()
  })

  it('handles desktop links for workspace, marketplace, and settings views', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
        : path === '/api/workspaces/state'
          ? { expandedWorkspaceIds: [] }
          : path === '/api/workspaces'
            ? [workspace]
            : []
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    vi.stubGlobal('EventSource', FakeEventSource)
    let navigate: ((navigation: DesktopNavigation) => void) | undefined
    let openHelp: (() => void) | undefined
    window.craftHubDesktop = {
      onDesktopNavigation: vi.fn((callback) => {
        navigate = callback
        return () => {}
      }),
      onOpenHelp: vi.fn((callback) => {
        openHelp = callback
        return () => {}
      }),
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()

    navigate?.({ kind: 'workspace', workspaceId: workspace.id })
    await flushPromises()
    expect(useWorkbenchStore().selectedWorkspace?.id).toBe(workspace.id)

    navigate?.({ kind: 'marketplace' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/marketplace')

    navigate?.({ kind: 'settings' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(document.body.querySelector('.settings-dialog')).not.toBeNull()

    openHelp?.()
    await flushPromises()
    const helpTab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent === 'Help')
    expect(helpTab?.getAttribute('data-state')).toBe('active')
    expect(document.body.textContent).toContain('Confetti is visual only')
    wrapper.unmount()
  })

  it('selects the project requested by the launch URL', async () => {
    let replayOnboarding: (() => void) | undefined
    const stopReplayOnboarding = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      const body = path === '/api/settings'
        ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+Shift+P' }, 'workbench.theme': 'system' } }
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
    const focusCodexApplication = vi.fn(async () => {})
    const codexActivityStatus = vi.fn(async () => ({ installed: true, runningSessionIds: [], supported: true }))
    window.craftHubDesktop = {
      codexActivityStatus,
      focusCodexApplication,
      onReplayOnboarding: vi.fn((callback) => {
        replayOnboarding = callback
        return stopReplayOnboarding
      }),
    }
    const pinia = createPinia()
    setActivePinia(pinia)

    const { router, wrapper } = await mountApp(pinia, '/?project=target')
    await flushPromises()

    const store = useWorkbenchStore()
    expect(store.selectedProjectId).toBe('target')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events')
    expect(wrapper.findAll('.workbench-splitter [data-panel]')).toHaveLength(3)
    expect(wrapper.findAll('.workbench-resize-handle')).toHaveLength(2)
    expect(wrapper.findAll('.workbench-resize-handle').map(handle => handle.attributes('aria-label'))).toEqual([
      'Resize projects panel',
      'Resize capabilities panel',
    ])

    const refreshButton = wrapper.get('.status-actions button')
    store.refreshing = true
    await nextTick()
    expect(refreshButton.attributes('aria-busy')).toBe('true')
    expect(refreshButton.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.i-svg-spinners-180-ring-with-bg')).toHaveLength(2)
    store.refreshing = false
    await nextTick()
    expect(refreshButton.attributes('disabled')).toBeUndefined()
    expect(refreshButton.attributes('data-tooltip')).toBe('Refresh')
    expect(refreshButton.find('.i-ri-refresh-line').exists()).toBe(true)

    store.agentTasks = [
      { id: 'running-codex', provider: 'codex', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Run', startedAt: '2026-01-01T00:00:00.000Z', status: 'running' },
      { id: 'finished-codex', provider: 'codex', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Done', startedAt: '2026-01-01T00:00:00.000Z', status: 'completed' },
      { id: 'other-agent', provider: 'other', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Run', startedAt: '2026-01-01T00:00:00.000Z', status: 'running' },
    ]
    await nextTick()
    expect(wrapper.get('.codex-task-status').attributes('aria-label')).toBe('1 Codex task(s) running · Open Codex')
    expect(wrapper.get('.codex-task-status').attributes('data-tooltip')).toBe('1 Codex task(s) running · Open Codex')
    expect(wrapper.get('.codex-task-status strong').text()).toBe('1')
    await wrapper.get('.codex-task-status').trigger('click')
    expect(focusCodexApplication).toHaveBeenCalledOnce()
    store.agentTasks = []
    await nextTick()
    expect(wrapper.find('.codex-task-status').exists()).toBe(false)

    await wrapper.get('[data-testid="open-marketplace"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/marketplace')
    expect(wrapper.get('.marketplace-page').attributes('aria-label')).toBe('Plugin Marketplace')
    expect(wrapper.find('.dialog-overlay').exists()).toBe(false)
    expect(wrapper.get('[data-testid="open-marketplace"]').classes()).toContain('active')

    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(wrapper.find('.marketplace-page').exists()).toBe(false)
    expect(wrapper.get('[data-testid="open-workbench"]').classes()).toContain('active')

    replayOnboarding?.()
    await nextTick()
    expect(wrapper.get('[data-testid="guided-first-run-welcome"]').text()).toContain('Choose another project')
    await wrapper.get('.welcome-close').trigger('click')
    expect(wrapper.find('[data-testid="guided-first-run-welcome"]').exists()).toBe(false)

    const primaryModifier = isMacPlatform() ? { metaKey: true } : { ctrlKey: true }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', shiftKey: true, ...primaryModifier }))
    await flushPromises()
    expect(document.body.querySelector('.command-palette')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', shiftKey: true, ...primaryModifier }))
    await flushPromises()
    expect(document.body.querySelector('.command-palette')).toBeNull()

    const projectRequests = (): number => fetchMock.mock.calls
      .filter(([input]) => (typeof input === 'string' ? input : input.toString()) === '/api/projects')
      .length
    const workspaceRequests = (): number => fetchMock.mock.calls
      .filter(([input]) => (typeof input === 'string' ? input : input.toString()) === '/api/workspaces')
      .length
    const agentTaskRequests = (): number => fetchMock.mock.calls
      .filter(([input]) => (typeof input === 'string' ? input : input.toString()) === '/api/agent-tasks')
      .length
    expect(projectRequests()).toBe(1)
    expect(workspaceRequests()).toBe(1)
    expect(agentTaskRequests()).toBe(1)
    await refreshButton.trigger('click')
    await flushPromises()
    expect(projectRequests()).toBe(2)
    expect(workspaceRequests()).toBe(2)
    expect(agentTaskRequests()).toBe(2)
    expect(codexActivityStatus).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('focus'))
    await new Promise(resolve => setTimeout(resolve, 110))
    await flushPromises()
    expect(projectRequests()).toBe(3)
    expect(workspaceRequests()).toBe(3)
    expect(agentTaskRequests()).toBe(3)

    wrapper.unmount()
    expect(FakeEventSource.instances[0]?.closed).toBe(true)
    expect(stopReplayOnboarding).toHaveBeenCalledOnce()
  })
})
