// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkspaceDashboard from './WorkspaceDashboard.vue'

const project: ProjectRecord = {
  id: 'project-id',
  name: 'Example',
  path: '/workspace/example',
  trust: 'trusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

const workspace: WorkspaceRecord = {
  schemaVersion: 1,
  id: 'workspace-id',
  name: 'Workspace',
  primaryProject: 'example',
  revision: 'revision',
  members: [{ project: 'example', projectId: project.id, resolved: true }],
}

describe('workspace Codex tasks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  afterEach(() => Reflect.deleteProperty(window, 'craftHubDesktop'))

  function setup() {
    const store = useWorkbenchStore()
    store.projects = [project]
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    return { store, wrapper: mount(WorkspaceDashboard) }
  }

  it('opens the primary project in Codex with a copied prompt by default', async () => {
    const startProjectInCodex = vi.fn(async () => {})
    window.craftHubDesktop = { startProjectInCodex }
    const { wrapper } = setup()
    await flushPromises()

    await wrapper.get('textarea').setValue('Implement the feature')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(startProjectInCodex).toHaveBeenCalledWith(project.id, 'Implement the feature')
    expect(wrapper.text()).toContain('prompt was copied')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps unattended SDK execution in the secondary menu', async () => {
    window.craftHubDesktop = { startProjectInCodex: vi.fn(async () => {}) }
    const { store, wrapper } = setup()
    const startAgentTask = vi.spyOn(store, 'startAgentTask').mockResolvedValue()
    await flushPromises()

    await wrapper.get('textarea').setValue('Run in background')
    await wrapper.get('.agent-task-action-menu summary').trigger('click')
    await wrapper.get('[data-testid="start-in-background"]').trigger('click')
    await flushPromises()

    expect(startAgentTask).toHaveBeenCalledWith('Run in background', [project.id], project.id, workspace.id)
    expect(wrapper.text()).toContain('running in Craft Hub')
  })

  it('routes workspace launchers through the desktop bridge', async () => {
    const openWorkspace = vi.fn(async () => {})
    window.craftHubDesktop = { openWorkspace }
    const { wrapper } = setup()
    await flushPromises()

    await wrapper.get('[data-testid="open-workspace-vscode"]').trigger('click')
    await wrapper.get('[data-testid="open-workspace-codebuddy"]').trigger('click')
    await wrapper.get('[data-testid="open-workspace-codex"]').trigger('click')
    await flushPromises()

    expect(openWorkspace.mock.calls).toEqual([
      [workspace.id, 'vscode'],
      [workspace.id, 'codebuddy'],
      [workspace.id, 'codex'],
    ])
  })

  it('uses localized status icons instead of raw workspace member states', async () => {
    const store = useWorkbenchStore()
    store.projects = [project]
    store.workspaces = [{
      ...workspace,
      members: [
        ...workspace.members,
        { project: 'api', label: 'API', resolved: false, path: '/api' },
        { project: 'missing', label: 'Missing', resolved: false },
      ],
    }]
    store.selectedWorkspaceId = workspace.id

    const wrapper = mount(WorkspaceDashboard)
    await flushPromises()

    expect(wrapper.text()).not.toContain('available')
    expect(wrapper.text()).not.toContain('missing')
    expect(wrapper.get('.member-source-status.available').attributes('title')).toBe('Available to add')
    expect(wrapper.findAll('.member-source-status')[1]!.attributes('title')).toBe('Not found on this device')
    expect(wrapper.get('.workspace-member-card .project-trust').attributes('title')).toBe('Trusted')
  })
})
