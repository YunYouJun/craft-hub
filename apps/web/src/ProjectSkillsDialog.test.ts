// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectSkillsState } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import ProjectSkillsDialog from './ProjectSkillsDialog.vue'
import { useWorkbenchStore } from './store'

const project = { id: 'project', name: 'Project', path: '/project', trust: 'untrusted' as const, addedAt: '2026-01-01T00:00:00.000Z' }
const initial: ProjectSkillsState = {
  projectId: project.id,
  mode: 'manual',
  modeSource: 'default',
  project: {},
  local: {},
  missingPluginIds: [],
  skills: [{ id: 'plugin:example:skill:review', pluginId: 'example', name: 'Review', source: 'marketplace-plugin', status: 'manual-only', scopes: [] }],
}

describe('project Skills dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows every installed plugin Skill and saves machine-local activation choices', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.commandPackagesByProject = { [project.id]: [{ relativePath: '.', root: true }, { relativePath: 'apps/web', root: false, name: 'web' }] }
    vi.spyOn(store, 'refreshProjects').mockResolvedValue(false)
    vi.spyOn(api, 'projectSkills').mockResolvedValue(initial)
    const update = vi.spyOn(api, 'updateProjectSkills').mockImplementation(async (_projectId, settings) => ({ ...initial, mode: settings.mode ?? 'manual', local: settings }))

    mount(ProjectSkillsDialog, { props: { open: true }, attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()

    expect(document.body.textContent).toContain('Review')
    expect(document.body.textContent).toContain('Manual only')
    const mode = document.body.querySelector<HTMLSelectElement>('[data-testid="skill-mode"]')!
    mode.value = 'auto'
    mode.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(update).toHaveBeenCalledWith(project.id, expect.objectContaining({ mode: 'auto' }))

    document.body.querySelector<HTMLInputElement>('[data-testid="skill-scope-plugin:example:skill:review-apps/web"]')!.click()
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(project.id, expect.objectContaining({
      enabled: [{ id: 'plugin:example:skill:review', scopes: ['apps/web'] }],
    }))
  })
})
