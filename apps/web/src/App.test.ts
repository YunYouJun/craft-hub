// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord, ResolvedIntegrationContribution, WorkspaceRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { api } from './api'
import App from './App.vue'
import EnvironmentWorkbench from './EnvironmentWorkbench.vue'
import IntegrationWorkbench from './IntegrationWorkbench.vue'
import { loadLazyComponents } from './lazy-components'
import PersonalWorkbench from './PersonalWorkbench.vue'
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

function stubStartupData(): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input.toString()
    const body = path === '/api/settings'
      ? { explicitKeys: [], path: '/settings.json', revision: 'initial', settings: { 'workbench.locale': 'en', 'workbench.shortcuts': {}, 'workbench.theme': 'system' } }
      : path === '/api/projects'
        ? projects
        : path === '/api/software-sources'
          ? { version: 1, revision: 'initial', sources: [], localAvailable: true }
          : path === '/api/workspaces'
            ? [workspace]
            : path === '/api/workspaces/state'
              ? { expandedWorkspaceIds: [] }
              : path.endsWith('/pins')
                ? { projectId: path.split('/')[3], capabilityIds: [] }
                : []
    return new Response(JSON.stringify(body), { status: 200 })
  }))
  vi.stubGlobal('EventSource', FakeEventSource)
}

describe('app startup', () => {
  // Lazy views resolve once here, as idle prefetch does in the app, so routes render in the same tick.
  beforeAll(loadLazyComponents)

  it('opens software discovery only from its route and returns to project navigation', async () => {
    stubStartupData()
    const catalog = vi.spyOn(api, 'softwareCatalog').mockResolvedValue({ version: 1, sources: [] })
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/overview')
    await flushPromises()
    expect(catalog).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="open-tools"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tools')
    expect(catalog).not.toHaveBeenCalled()
    await wrapper.get('.section-navigation a[href="/software"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/software')
    expect(wrapper.get('[data-testid="open-tools"]').classes()).toContain('active')
    expect(wrapper.get('.section-navigation a[href="/software"]').attributes('aria-current')).toBe('page')
    expect(catalog).toHaveBeenCalledOnce()
    expect(wrapper.get<HTMLButtonElement>('[data-testid="load-workstation-source"]').element.disabled).toBe(false)
    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    wrapper.unmount()
  })

  it('opens all tools from the home preview and keeps website deep links in the tools section', async () => {
    stubStartupData()
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/overview')
    await flushPromises()

    await wrapper.get('[data-testid="view-all-tools"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tools')
    expect(wrapper.get('[data-testid="open-tools"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/tools"]').attributes('aria-current')).toBe('page')

    await router.push('/navigation')
    await flushPromises()
    expect(wrapper.get('[data-testid="open-tools"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/navigation"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation-header strong').text()).toBe('Tools')
    expect(wrapper.find('[data-testid="open-navigation"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('keeps workspace source details within project navigation', async () => {
    stubStartupData()
    const startupFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/config-subscriptions') {
        return Response.json({ connected: true, canConnect: false, provider: 'Git', subscriptions: [{
          id: 'shared',
          name: 'Shared development',
          url: 'https://git.example.com/shared/development.git',
          repository: 'shared/development',
          branch: 'main',
          directory: '.craft-hub',
        }] })
      }
      return startupFetch(input)
    }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/subscriptions/shared?panel=settings')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('subscriptions-detail')
    expect(wrapper.get('.subscriptions-workbench h1').text()).toBe('Shared development')
    expect(wrapper.get('[data-testid="open-workbench"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/subscriptions"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.get('.section-navigation-header strong').text()).toBe('Projects')
    expect(wrapper.find('.activity-rail [data-testid="open-workspace-sources"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['/environment', '/integrations/profile/setup'])('groups declared configuration views under development environment from %s', async (initialPath) => {
    stubStartupData()
    const contribution: ResolvedIntegrationContribution = {
      id: 'profile',
      pluginId: 'profile',
      source: 'host:profile',
      provider: { id: 'example', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'read', title: 'Inspect configuration', operation: 'configuration.read', effect: 'local-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{ id: 'setup', title: 'Configuration profiles', icon: 'builtin:settings', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'profiles', type: 'configuration-manager', actionId: 'read' }] }],
    }
    vi.spyOn(api, 'integrations').mockResolvedValue({ integrations: [contribution], diagnostics: [] })
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ configuration: true, items: [] })
    vi.spyOn(api, 'runtimeHealth').mockResolvedValue({
      status: 'ok',
      projectConfigSchemaRevision: 'current',
      distribution: { id: 'community', name: 'Craft Hub' },
      hostEnvironment: { kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } },
    })
    vi.spyOn(api, 'localEnvironment').mockResolvedValue({
      schemaVersion: 1,
      checkedAt: '2026-10-12T00:00:00.000Z',
      host: { platform: 'darwin', arch: 'arm64', osRelease: '25.6.0' },
      runtime: { version: 'v24.18.0', executablePath: '/runtime/node', arch: 'arm64' },
      searchDirectories: [],
      tools: [],
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, initialPath)
    await flushPromises()

    expect(wrapper.get('[data-testid="open-environment"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.get('.section-navigation-header strong').text()).toBe('Development environment')
    const configuration = wrapper.get('.section-navigation a[href="/integrations/profile/setup"]')
    expect(configuration.text()).toBe('Configuration profiles')
    if (initialPath === '/environment') {
      expect(invoke).not.toHaveBeenCalled()
      await configuration.trigger('click')
      await flushPromises()
    }
    expect(router.currentRoute.value.path).toBe('/integrations/profile/setup')
    expect(wrapper.get('.section-navigation a[href="/integrations/profile/setup"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="open-environment"]').attributes('aria-current')).toBe('page')
    expect(invoke).toHaveBeenCalledWith('profile', 'read', {}, undefined)
    expect(wrapper.find('[data-testid="open-integration-profile-setup"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens workbenches from the overview and switches them directly from main navigation and projects', async () => {
    stubStartupData()
    vi.spyOn(api, 'integrations').mockResolvedValue({ integrations: [{
      id: 'workspace',
      pluginId: 'workspace',
      source: 'host:workspace',
      provider: { id: 'example', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [],
      views: [{ id: 'overview', title: 'Connected workspace', icon: 'builtin:workspace', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [] }],
    }], diagnostics: [] })
    vi.spyOn(api, 'pluginWorkbenches').mockResolvedValue([{
      id: 'daily',
      pluginId: '@example/craft-hub-plugin-daily',
      pluginName: 'Daily suite',
      pluginVersion: '1.0.0',
      title: 'Daily work',
      views: [{ type: 'host', view: 'projects' }],
    }, {
      id: 'daily',
      pluginId: '@example/craft-hub-plugin-team',
      pluginName: 'Team suite',
      pluginVersion: '1.0.0',
      title: 'Team work',
      views: [{ type: 'host', view: 'projects' }],
    }])
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/overview')
    await flushPromises()

    await wrapper.get('[data-testid="open-workbenches"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/workbenches')
    expect(wrapper.get('.workbenches-overview h1').text()).toBe('Workbenches')
    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/workbenches"]').attributes('aria-current')).toBe('page')

    await wrapper.get('[data-testid="integration-entry-workspace-overview"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/integrations/workspace/overview?scope=global')
    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/integrations/workspace/overview"]').attributes('aria-current')).toBe('page')

    await router.push('/integrations/workspace/overview')
    await flushPromises()
    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.section-navigation a[href="/integrations/workspace/overview"]').attributes('aria-current')).toBe('page')

    await wrapper.get('[data-testid="open-workbenches"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-testid="workbench-entry-daily"]')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('plugin-workbench')
    expect(router.currentRoute.value.params).toEqual({ pluginId: '@example/craft-hub-plugin-daily', workbenchId: 'daily' })
    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBeUndefined()
    expect(wrapper.get('[data-testid="open-plugin-workbench-@example/craft-hub-plugin-daily-daily"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.plugin-workbench-sidebar-header strong').text()).toBe('Daily work')

    await wrapper.get('[data-testid="open-plugin-workbench-@example/craft-hub-plugin-team-daily"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params).toEqual({ pluginId: '@example/craft-hub-plugin-team', workbenchId: 'daily' })
    expect(wrapper.get('.plugin-workbench-sidebar-header strong').text()).toBe('Team work')
    expect(wrapper.get('[data-testid="open-plugin-workbench-@example/craft-hub-plugin-team-daily"]').attributes('aria-current')).toBe('page')
    expect(wrapper.findAll('.activity-button[aria-current="page"]')).toHaveLength(1)

    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    await wrapper.get('[data-testid="open-plugin-workbench-@example/craft-hub-plugin-daily-daily"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.params).toEqual({ pluginId: '@example/craft-hub-plugin-daily', workbenchId: 'daily' })
    expect(wrapper.get('.plugin-workbench-sidebar-header strong').text()).toBe('Daily work')
    wrapper.unmount()
  })

  afterEach(() => {
    vi.useRealTimers()
    FakeEventSource.instances = []
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', '/')
    document.body.innerHTML = ''
    localStorage.removeItem('craft-hub-desktop-sidebar-collapsed')
    Reflect.deleteProperty(window, 'craftHubDesktop')
    delete window.craftHubDesktop
  })

  it('remembers collapsed navigation while moving between desktop pages', async () => {
    stubStartupData()
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/overview')
    await flushPromises()
    expect(wrapper.get('.sidebar-toggle').attributes('aria-expanded')).toBe('true')
    await wrapper.get('.sidebar-toggle').trigger('click')
    expect(localStorage.getItem('craft-hub-desktop-sidebar-collapsed')).toBe('true')
    // The rail width glides to its collapsed size over a few frames.
    await vi.waitFor(() => expect(wrapper.get('.app-shell').attributes('style')).toContain('52px'))
    await router.push('/tools')
    await flushPromises()
    expect(wrapper.get('.sidebar-toggle').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.project-rail').classes()).toContain('activity-collapsed')
    wrapper.unmount()
    const reopened = await mountApp(pinia, '/overview')
    await flushPromises()
    expect(reopened.wrapper.get('.sidebar-toggle').attributes('aria-expanded')).toBe('false')
    reopened.wrapper.unmount()
  })

  it('routes desktop shortcuts and protects editing and open dialogs from navigation commands', async () => {
    stubStartupData()
    let menuAction: Parameters<NonNullable<NonNullable<Window['craftHubDesktop']>['onMenuAction']>>[0] | undefined
    window.craftHubDesktop = {
      platform: 'darwin',
      onMenuAction: (callback) => {
        menuAction = callback
        return () => {}
      },
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const { wrapper, router } = await mountApp(pinia, '/overview')
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tools')
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/tools')
    input.remove()
    menuAction?.('home')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/overview')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
    await flushPromises()
    expect(document.body.querySelector('.settings-dialog')).not.toBeNull()
    menuAction?.('tools')
    menuAction?.('toggle-sidebar')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true }))
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/overview')
    expect(wrapper.get('.sidebar-toggle').attributes('aria-expanded')).toBe('true')
    expect(document.body.querySelector('.command-palette')).toBeNull()
    wrapper.unmount()
  })

  it('opens the environment route without projects and keeps probes out of startup and project refreshes', async () => {
    stubStartupData()
    const startupFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/projects' || input === '/api/workspaces')
        return new Response(JSON.stringify([]), { status: 200 })
      return startupFetch(input)
    }))
    vi.spyOn(api, 'runtimeHealth').mockResolvedValue({
      status: 'ok',
      projectConfigSchemaRevision: 'current',
      distribution: { id: 'community', name: 'Craft Hub' },
      hostEnvironment: { kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } },
    })
    const inspect = vi.spyOn(api, 'localEnvironment').mockResolvedValue({
      schemaVersion: 1,
      checkedAt: '2026-10-09T10:00:00.000Z',
      host: { platform: 'darwin', arch: 'arm64', osRelease: '25.6.0' },
      runtime: { version: 'v24.18.0', executablePath: '/desktop/runtime/node', arch: 'arm64' },
      searchDirectories: [],
      tools: [],
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('overview')
    expect(inspect).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="open-environment"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/environment')
    expect(wrapper.findComponent(EnvironmentWorkbench).exists()).toBe(true)
    expect(wrapper.get('[data-testid="open-environment"]').classes()).toContain('active')
    expect(useWorkbenchStore().projects).toEqual([])
    expect(inspect).toHaveBeenCalledOnce()

    await useWorkbenchStore().refreshProjects(undefined, false)
    await flushPromises()
    expect(inspect).toHaveBeenCalledOnce()
    await wrapper.get('[data-testid="open-overview"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(EnvironmentWorkbench).exists()).toBe(false)
    expect(inspect).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('lands fresh loads on the personal overview and opens projects and workspaces in the existing workbench', async () => {
    stubStartupData()
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('overview')
    expect(router.currentRoute.value.path).toBe('/overview')
    expect(wrapper.get('[data-testid="open-overview"]').classes()).toContain('active')
    expect(wrapper.find('.workbench-splitter').exists()).toBe(false)

    wrapper.getComponent(PersonalWorkbench).vm.$emit('openProject', projects[1]!.id)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('workbench')
    expect(useWorkbenchStore().selectedProjectId).toBe(projects[1]!.id)

    await wrapper.get('[data-testid="open-overview"]').trigger('click')
    await flushPromises()
    wrapper.getComponent(PersonalWorkbench).vm.$emit('openWorkspace', workspace.id)
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(useWorkbenchStore().selectedWorkspace?.id).toBe(workspace.id)
    expect(wrapper.get('.workspace-dashboard h2').text()).toBe(workspace.name)
    wrapper.unmount()
  })

  it('keeps the overview usable and continues project loading after initial settings fail', async () => {
    stubStartupData()
    const startupFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = typeof input === 'string' ? input : input.toString()
      if (path === '/api/settings')
        return new Response(JSON.stringify({ error: 'settings unavailable' }), { status: 500 })
      return startupFetch(input)
    }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()

    const store = useWorkbenchStore()
    expect(router.currentRoute.value.name).toBe('overview')
    expect(store.settingsLoadState).toBe('error')
    expect(store.projectsLoadState).toBe('ready')
    expect(store.projects).toEqual(projects)
    expect(wrapper.findComponent(PersonalWorkbench).exists()).toBe(true)
    expect(FakeEventSource.instances).toHaveLength(1)

    wrapper.getComponent(PersonalWorkbench).vm.$emit('openProject', projects[1]!.id)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('workbench')
    expect(store.selectedProjectId).toBe(projects[1]!.id)
    wrapper.unmount()
  })

  it('preserves the global overview source scope while ordinary sidebar navigation retains project context', async () => {
    stubStartupData()
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()
    const store = useWorkbenchStore()
    store.selectedProjectId = projects[1]!.id
    store.integrationContributions = [{
      id: 'issues',
      pluginId: 'issues',
      source: 'host:issues',
      provider: { id: 'issues', requires: '^1.0.0' },
      providerVersion: '1.0.0',
      actions: [{ id: 'list', title: 'List work', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
      views: [{ id: 'work', title: 'Work', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'items', type: 'entity-list', actionId: 'list' }] }],
    }]
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [] })
    await flushPromises()

    wrapper.getComponent(PersonalWorkbench).vm.$emit('openIntegration', 'issues', 'work', 'global')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ scope: 'global' })
    expect(wrapper.getComponent(IntegrationWorkbench).props('initialScope')).toBe('global')
    expect(invoke).toHaveBeenLastCalledWith('issues', 'list', {}, undefined)
    expect(store.selectedProjectId).toBe(projects[1]!.id)

    expect(wrapper.get('[data-testid="open-workbenches"]').attributes('aria-current')).toBe('page')
    await wrapper.get('.section-navigation a[href="/integrations/issues/work"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.getComponent(IntegrationWorkbench).props('initialScope')).toBeUndefined()
    expect(invoke).toHaveBeenLastCalledWith('issues', 'list', {}, projects[1]!.id)
    expect(store.selectedProjectId).toBe(projects[1]!.id)
    wrapper.unmount()
  })

  it.each([true, false])('keeps a desktop project link on the existing workbench (queued before loading: %s)', async (queuedInitially) => {
    stubStartupData()
    const navigation = {
      kind: 'project' as const,
      reference: { repository: 'https://github.com/example/target', subdir: '.' },
      matches: [projects[1]!],
    }
    window.craftHubDesktop = {
      consumeDesktopNavigation: vi.fn()
        .mockResolvedValueOnce(queuedInitially ? navigation : undefined)
        .mockResolvedValueOnce(queuedInitially ? undefined : navigation),
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const { router, wrapper } = await mountApp(pinia)
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('workbench')
    expect(useWorkbenchStore().selectedProjectId).toBe(projects[1]!.id)
    expect(wrapper.findComponent(PersonalWorkbench).exists()).toBe(false)
    expect(window.craftHubDesktop.consumeDesktopNavigation).toHaveBeenCalledTimes(2)
    wrapper.unmount()
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

    const { wrapper } = await mountApp(pinia, '/?project=first')
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

    const { wrapper } = await mountApp(pinia, '/?project=first')
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

    const { wrapper } = await mountApp(pinia, '/?project=first')
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

    const { wrapper } = await mountApp(pinia, '/?project=first')
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
    await wrapper.get('[data-testid="open-workbench"]').trigger('click')
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
    await vi.waitFor(() => expect(wrapper.get('.marketplace-page').attributes('aria-label')).toBe('Plugin Marketplace'))
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
    await vi.waitFor(() => expect(wrapper.find('.marketplace-page').exists()).toBe(true))
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
    let openSettings: (() => void) | undefined
    window.craftHubDesktop = {
      onDesktopNavigation: vi.fn((callback) => {
        navigate = callback
        return () => {}
      }),
      onOpenHelp: vi.fn((callback) => {
        openHelp = callback
        return () => {}
      }),
      onOpenSettings: vi.fn((callback) => {
        openSettings = callback
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

    openSettings?.()
    await flushPromises()
    const generalTab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent === 'General')
    expect(generalTab?.getAttribute('data-state')).toBe('active')
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
    expect(router.currentRoute.value.fullPath).toBe('/?project=target')
    expect(store.selectedProjectId).toBe('target')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events')
    FakeEventSource.instances[0]!.listeners.get('software-source-change')!(new MessageEvent('software-source-change', { data: JSON.stringify({ changedAt: '2026-10-21T00:00:00.000Z' }) }))
    expect(store.softwareSourcesRevision).toBe(1)
    const events = FakeEventSource.instances[0]!
    events.listeners.get('open')!(new Event('open'))
    expect(store.softwareSourcesRevision).toBe(2)
    await nextTick()
    expect(wrapper.get('.status-bar').attributes('data-idle')).toBeDefined()
    events.listeners.get('error')!(new Event('error'))
    await nextTick()
    // A dropped stream is worth reporting, so the status bar leaves its idle state until the stream reopens.
    expect(wrapper.get('.status-bar').attributes('data-idle')).toBeUndefined()
    events.listeners.get('open')!(new Event('open'))
    expect(store.softwareSourcesRevision).toBe(3)
    await nextTick()
    expect(wrapper.get('.status-bar').attributes('data-idle')).toBeDefined()
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
    expect(refreshButton.find('.i-lucide-refresh-cw').exists()).toBe(true)

    store.agentTasks = [
      { id: 'running-codex', provider: 'codex', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Run', startedAt: '2026-01-01T00:00:00.000Z', status: 'running' },
      { id: 'finished-codex', provider: 'codex', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Done', startedAt: '2026-01-01T00:00:00.000Z', status: 'completed' },
      { id: 'other-agent', provider: 'other', projectIds: ['target'], primaryProjectId: 'target', prompt: 'Run', startedAt: '2026-01-01T00:00:00.000Z', status: 'running' },
    ]
    await nextTick()
    expect(wrapper.get('.codex-task-status').attributes('aria-label')).toBe('1 Codex task(s) running · Open Codex')
    expect(wrapper.get('.codex-task-status').attributes('data-tooltip')).toBe('1 Codex task(s) running · Open Codex')
    expect(wrapper.get('.codex-task-status strong').text()).toBe('1')
    expect(wrapper.get('.status-bar').attributes('data-idle')).toBeUndefined()
    await wrapper.get('.codex-task-status').trigger('click')
    expect(focusCodexApplication).toHaveBeenCalledOnce()
    store.agentTasks = []
    await nextTick()
    expect(wrapper.find('.codex-task-status').exists()).toBe(false)

    await wrapper.get('[data-testid="open-marketplace"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/marketplace')
    await vi.waitFor(() => expect(wrapper.get('.marketplace-page').attributes('aria-label')).toBe('Plugin Marketplace'))
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
