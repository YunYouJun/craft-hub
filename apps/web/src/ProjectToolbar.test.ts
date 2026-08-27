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
  })

  it('opens project targets and remembers the selected installed terminal', async () => {
    const openProjectInVSCode = vi.fn(async () => {})
    const openProjectInCodex = vi.fn(async () => {})
    const openProjectInTerminal = vi.fn(async () => {})
    window.craftHubDesktop = {
      listTerminalApplications: vi.fn(async () => ['Ghostty', 'Terminal']),
      openProjectInVSCode,
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
      'open-project-vscode',
      'open-project-codex',
      'open-project-terminal',
    ])
    expect((wrapper.get('[data-testid="terminal-application"]').element as HTMLSelectElement).value).toBe('Ghostty')
    expect(wrapper.get('[data-testid="open-project-terminal"]').attributes('title')).toBe('Open project in Ghostty')

    await wrapper.get('[data-testid="terminal-application"]').setValue('Terminal')
    await wrapper.get('[data-testid="open-project-vscode"]').trigger('click')
    await wrapper.get('[data-testid="open-project-terminal"]').trigger('click')
    await wrapper.get('[data-testid="open-project-codex"]').trigger('click')
    await flushPromises()

    expect(window.localStorage.getItem('craft-hub-terminal-application')).toBe('Terminal')
    expect(openProjectInVSCode).toHaveBeenCalledWith(project.id)
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

    store.projects = [project]
    await wrapper.vm.$nextTick()

    expect(wrapper.get('.trust-state .app-icon').classes()).toContain('i-ri-shield-check-line')
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
