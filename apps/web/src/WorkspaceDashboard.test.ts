// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { AgentTaskRecord, ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
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
  const wrappers: Array<ReturnType<typeof mount>> = []

  beforeEach(() => {
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, 'craftHubDesktop')
  })

  function mountDashboard() {
    const wrapper = mount(WorkspaceDashboard, { attachTo: document.body, global: { plugins: [getActivePinia()!] } })
    wrappers.push(wrapper)
    return wrapper
  }

  function setup() {
    const store = useWorkbenchStore()
    store.projects = [project]
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    return { store, wrapper: mountDashboard() }
  }

  it('starts the whole Workspace as a persisted Codex task by default', async () => {
    const startWorkspaceInCodex = vi.fn(async () => ({ taskId: 'task-id', threadId: 'thread-id' }))
    window.craftHubDesktop = { startWorkspaceInCodex }
    const { wrapper } = setup()
    await flushPromises()

    await wrapper.get('textarea').setValue('Implement the feature')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(startWorkspaceInCodex).toHaveBeenCalledWith(workspace.id, [project.id], project.id, 'Use Craft Hub workspace workspace-id.\n\nImplement the feature')
    expect(wrapper.text()).toContain('running in Craft Hub with 1 Workspace root(s) attached')
    expect(wrapper.text()).toContain('opens automatically after the thread is released')
    expect(wrapper.get('[data-testid="codex-root-list"]').text()).toContain('/workspace/example')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('passes structured-cloneable project ids to the Electron bridge', async () => {
    let clonedProjectIds: string[] | undefined
    const startWorkspaceInCodex = vi.fn(async (_workspaceId: string, projectIds: string[]) => {
      clonedProjectIds = structuredClone(projectIds)
      return { taskId: 'task-id', threadId: 'thread-id' }
    })
    window.craftHubDesktop = { startWorkspaceInCodex }
    const { wrapper } = setup()
    await flushPromises()

    await wrapper.get('textarea').setValue('Implement the feature')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(clonedProjectIds).toEqual([project.id])
    expect(wrapper.text()).not.toContain('could not be cloned')
  })

  it('requires explicit project authorization before a multi-root Codex task can start', async () => {
    const startWorkspaceInCodex = vi.fn(async () => ({ taskId: 'task-id', threadId: 'thread-id' }))
    window.craftHubDesktop = { startWorkspaceInCodex }
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'untrusted' }]
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    const wrapper = mountDashboard()
    await flushPromises()

    await wrapper.get('textarea').setValue('Inspect the project')

    expect(wrapper.get('[data-testid="start-in-codex"]').attributes('disabled')).toBeDefined()
    await wrapper.get('.agent-task-action-menu [data-slot="dropdown-menu-trigger"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector<HTMLElement>('[data-testid="start-in-background"]')?.getAttribute('data-disabled')).not.toBeNull()
    expect(wrapper.text()).toContain('1 project(s) are excluded')

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(startWorkspaceInCodex).not.toHaveBeenCalled()
  })

  it('lets the user review workspace authorization and selects the project after approval', async () => {
    window.craftHubDesktop = { startWorkspaceInCodex: vi.fn(async () => ({ taskId: 'task-id', threadId: 'thread-id' })) }
    const store = useWorkbenchStore()
    store.projects = [{ ...project, trust: 'untrusted' }]
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    const trustProjectById = vi.spyOn(store, 'trustProjectById').mockResolvedValue(true)
    const wrapper = mountDashboard()
    await flushPromises()

    await wrapper.get('.project-trust.trust-action').trigger('click')
    expect(document.querySelector('[data-testid="workspace-trust-dialog"]')).not.toBeNull()
    const confirm = document.querySelector('[data-testid="trust-workspace-project-confirm"]') as HTMLButtonElement
    confirm.click()
    await flushPromises()

    expect(trustProjectById).toHaveBeenCalledWith(project.id)
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps unattended SDK execution in the secondary menu', async () => {
    window.craftHubDesktop = { startProjectInCodex: vi.fn(async () => {}) }
    const { store, wrapper } = setup()
    const startAgentTask = vi.spyOn(store, 'startAgentTask').mockResolvedValue({
      id: 'task-id',
      provider: 'codex',
      projectIds: [project.id],
      primaryProjectId: project.id,
      prompt: 'Run in background',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
    } satisfies AgentTaskRecord)
    await flushPromises()

    await wrapper.get('textarea').setValue('Run in background')
    await wrapper.get('.agent-task-action-menu [data-slot="dropdown-menu-trigger"]').trigger('click')
    document.body.querySelector<HTMLElement>('[data-testid="start-in-background"]')?.click()
    await flushPromises()

    expect(startAgentTask).toHaveBeenCalledWith('Run in background', [project.id], project.id, workspace.id)
    expect(wrapper.text()).toContain('running in Craft Hub')
  })

  it('keeps an SDK-owned running thread in Craft Hub until it is released', async () => {
    const openCodexThread = vi.fn(async () => {
      throw new Error('Already open in another application')
    })
    window.craftHubDesktop = { openCodexThread }
    const { store, wrapper } = setup()
    store.agentTasks = [{
      id: 'task-id',
      provider: 'codex',
      projectIds: [project.id],
      primaryProjectId: project.id,
      workspaceId: workspace.id,
      prompt: 'Run in Craft Hub',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
      externalThreadId: '0196c0f6-6c08-78c0-b0f2-2b5d58e2b2bc',
      output: '$ pnpm test\nTests running\n',
    } satisfies AgentTaskRecord]
    await flushPromises()

    const openThreadButton = wrapper.findAll('button').find(button => button.text().includes('Open in Codex'))
    expect(openThreadButton).toBeUndefined()
    expect(openCodexThread).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('This task is still running in Craft Hub')
    expect(wrapper.get('[data-testid="agent-task-output"]').text()).toContain('Tests running')
  })

  it('keeps direct Primary-project launch separate from the multi-root task form', async () => {
    const openWorkspaceInEditor = vi.fn(async () => {})
    const openWorkspaceInCodex = vi.fn(async () => {})
    const startWorkspaceInCodex = vi.fn(async () => ({ taskId: 'task-id', threadId: 'thread-id' }))
    window.craftHubDesktop = { openWorkspaceInCodex, openWorkspaceInEditor, startWorkspaceInCodex }
    const { wrapper } = setup()
    await flushPromises()

    await wrapper.get('[data-testid="open-workspace-editor"]').trigger('click')
    await wrapper.get('[data-testid="open-workspace-codex"]').trigger('click')
    await wrapper.get('[data-testid="prepare-workspace-codex"]').trigger('click')
    await flushPromises()

    expect(openWorkspaceInEditor).toHaveBeenCalledWith(workspace.id)
    expect(openWorkspaceInCodex).toHaveBeenCalledWith(workspace.id)
    expect(startWorkspaceInCodex).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(wrapper.get('textarea').element)
    expect(wrapper.text()).toContain('1 workspace root(s) are ready')
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

    const wrapper = mountDashboard()
    await flushPromises()

    expect(wrapper.text()).not.toContain('available')
    expect(wrapper.text()).not.toContain('missing')
    expect(wrapper.get('.member-source-status.available').attributes('title')).toBe('Available to add')
    expect(wrapper.findAll('.member-source-status')[1]!.attributes('title')).toBe('Not found on this device')
    expect(wrapper.get('.workspace-member-card .project-trust').attributes('title')).toBe('Craft Hub execution allowed')
  })
})
