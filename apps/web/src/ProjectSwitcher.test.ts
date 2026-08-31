// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import ProjectSwitcher from './ProjectSwitcher.vue'
import { useWorkbenchStore } from './store'

const projects: ProjectRecord[] = [
  { id: 'craft-hub', name: 'Craft Hub', path: '/repos/craft-hub', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'studio', name: 'Studio', path: '/repos/design/studio', trust: 'trusted', addedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'website', name: 'Website', path: '/repos/personal/website', trust: 'untrusted', addedAt: '2026-01-03T00:00:00.000Z' },
]

const workspace: WorkspaceRecord = {
  id: 'workspace',
  name: 'Design Systems',
  schemaVersion: 1,
  revision: '1',
  members: [{ project: 'studio', projectId: 'studio', resolved: true }],
}

describe('project switcher', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useI18n().setLocale('en')
  })

  afterEach(() => {
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, 'craftHubDesktop')
    vi.restoreAllMocks()
  })

  function setup() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = projects
    store.selectedProjectId = 'craft-hub'
    store.recentProjectIds = ['craft-hub', 'website']
    store.workspaces = [workspace]
    const wrapper = mount(ProjectSwitcher, { attachTo: document.body, global: { plugins: [pinia] } })
    return { store, wrapper }
  }

  it('opens from the agreed shortcut and searches names, paths, and workspaces', async () => {
    setup()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true }))
    await flushPromises()

    const switcher = document.body.querySelector<HTMLElement>('[data-testid="project-switcher"]')
    const input = switcher?.querySelector<HTMLInputElement>('input')
    expect(switcher).not.toBeNull()
    expect(document.activeElement).toBe(input)

    input!.value = 'design systems'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await flushPromises()
    expect(switcher?.textContent).toContain('Studio')
    expect(switcher?.textContent).not.toContain('Website')

    input!.value = 'personal/website'
    input!.dispatchEvent(new InputEvent('input', { bubbles: true }))
    await flushPromises()
    expect(switcher?.textContent).toContain('Website')
  })

  it('switches projects and closes the quick picker', async () => {
    const { store, wrapper } = setup()
    const selectProject = vi.spyOn(store, 'selectProject').mockResolvedValue()

    await wrapper.get('[data-testid="project-switcher-trigger"]').trigger('click')
    await flushPromises()
    const website = [...document.body.querySelectorAll<HTMLElement>('.project-switcher-item')]
      .find(item => item.textContent?.includes('Website'))
    expect(website).toBeDefined()

    website!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(selectProject).toHaveBeenCalledWith('website')
    expect(document.body.querySelector('[data-testid="project-switcher"]')).toBeNull()
  })

  it('opens the browser add-project dialog from the picker', async () => {
    const { wrapper } = setup()
    await wrapper.get('[data-testid="project-switcher-trigger"]').trigger('click')
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('[data-testid="project-switcher-add"]')!.click()
    await flushPromises()

    expect(document.body.querySelector('[data-testid="project-switcher-add-form"]')).not.toBeNull()
  })

  it('uses the desktop folder picker when it is available', async () => {
    const selectProjectDirectory = vi.fn(async () => '/repos/new-project')
    window.craftHubDesktop = { selectProjectDirectory }
    const { store, wrapper } = setup()
    const addProject = vi.spyOn(store, 'addProject').mockResolvedValue()

    await wrapper.get('[data-testid="project-switcher-trigger"]').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="project-switcher-add"]')!.click()
    await flushPromises()

    expect(selectProjectDirectory).toHaveBeenCalledWith(undefined)
    expect(addProject).toHaveBeenCalledWith('/repos/new-project')
  })
})
