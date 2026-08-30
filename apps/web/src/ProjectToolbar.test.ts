// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import ProjectToolbar from './ProjectToolbar.vue'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project-id',
  name: 'Example',
  path: '/workspace/example',
  trust: 'trusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

describe('project toolbar', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useI18n().setLocale('en')
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'craftHubDesktop')
    vi.unstubAllGlobals()
  })

  it('opens project targets and remembers the selected installed terminal', async () => {
    const openProjectDirectory = vi.fn(async () => {})
    const openProjectInEditor = vi.fn(async () => {})
    const openProjectGitRemote = vi.fn(async () => {})
    const openProjectInCodex = vi.fn(async () => {})
    const openProjectInTerminal = vi.fn(async () => {})
    window.craftHubDesktop = {
      platform: 'darwin',
      listTerminalApplications: vi.fn(async () => ['Ghostty', 'Terminal']),
      openProjectDirectory,
      openProjectInEditor,
      openProjectGitRemote,
      openProjectInCodex,
      openProjectInTerminal,
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'untrusted' }]
    store.selectedProjectId = project.id

    const wrapper = mount(ProjectToolbar, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.text()).toContain(project.path)
    expect(wrapper.get('[role="toolbar"]').attributes('aria-label')).toBe(`Project: ${project.name}`)
    expect(wrapper.findAll('.toolbar-separator')).toHaveLength(2)
    expect([...wrapper.get('[role="toolbar"]').element.querySelectorAll<HTMLElement>('[data-testid^="open-project-"]')]
      .map(element => element.dataset.testid)).toEqual([
      'open-project-directory',
      'open-project-git-remote',
      'open-project-editor',
      'open-project-codex',
      'open-project-terminal',
    ])
    expect((wrapper.get('[data-testid="terminal-application"]').element as HTMLSelectElement).value).toBe('Ghostty')
    expect(wrapper.get('[data-testid="open-project-directory"]').attributes('title')).toBe('Open project in Finder')
    expect(wrapper.get('[data-testid="project-git-integration"]').attributes('title')).toBe('Integrate Git branch')
    expect(wrapper.element.querySelector('[data-testid="open-project-editor"] .vscode-icon')).not.toBeNull()
    expect(wrapper.element.querySelector('[data-testid="select-editor-cursor"] .cursor-icon')).not.toBeNull()
    expect(wrapper.get('[data-testid="open-project-terminal"]').attributes('title')).toBe('Open project in Ghostty')

    await wrapper.get('[data-testid="terminal-application"]').setValue('Terminal')
    await wrapper.get('[data-testid="open-project-directory"]').trigger('click')
    await wrapper.get('[data-testid="open-project-git-remote"]').trigger('click')
    await wrapper.get('[data-testid="open-project-editor"]').trigger('click')
    await wrapper.get('[data-testid="open-project-terminal"]').trigger('click')
    await wrapper.get('[data-testid="open-project-codex"]').trigger('click')
    await flushPromises()

    expect(window.localStorage.getItem('craft-hub-terminal-application')).toBe('Terminal')
    expect(openProjectDirectory).toHaveBeenCalledWith(project.id)
    expect(openProjectInEditor).toHaveBeenCalledWith(project.id)
    expect(openProjectGitRemote).toHaveBeenCalledWith(project.id)
    expect(openProjectInTerminal).toHaveBeenCalledWith(project.id, 'Terminal')
    expect(openProjectInCodex).toHaveBeenCalledWith(project.id)
  })

  it('distinguishes trusted and untrusted projects by icon shape', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'untrusted' }]
    store.selectedProjectId = project.id

    const wrapper = mount(ProjectToolbar, { global: { plugins: [pinia] } })

    expect(wrapper.get('.trust-state .app-icon').classes()).toContain('i-ri-shield-keyhole-line')
    expect(wrapper.get('.trust-state').text()).toBe('')
    expect(wrapper.get('.trust-state').attributes('data-tooltip')).toBe('Allow Craft Hub execution')

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(project), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })))
    await wrapper.get('.trust-state').trigger('click')
    expect(document.querySelector<HTMLElement>('[data-testid="project-trust-dialog"]')?.textContent).toContain('Allow Craft Hub to execute this project?')
    document.querySelector<HTMLButtonElement>('[data-testid="trust-project-confirm"]')?.click()
    await flushPromises()

    expect(store.selectedProject?.trust).toBe('trusted')
    expect(document.querySelector('[data-testid="project-trust-dialog"]')).toBeNull()

    store.projects = [project]
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.trust-state .app-icon').classes()).toContain('i-ri-shield-check-line')
    expect(wrapper.get('.trust-state').attributes('data-tooltip')).toBe('Craft Hub execution allowed')
  })

  it('keeps open-in-Codex as the primary action and exposes project configuration from its menu', async () => {
    window.craftHubDesktop = {
      listTerminalApplications: vi.fn(async () => []),
      openProjectInCodex: vi.fn(async () => {}),
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    const wrapper = mount(ProjectToolbar, { global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.get('[data-testid="open-project-codex"]').attributes('title')).toBe('Open project in Codex')
    expect(wrapper.get('.codex-action-menu summary .app-icon').classes()).toContain('i-ri-arrow-down-s-line')
    await wrapper.get('.codex-action-menu summary').trigger('click')
    await wrapper.get('.codex-action-menu button').trigger('click')

    expect(store.agentActionDialogOpen).toBe(true)
  })
})
