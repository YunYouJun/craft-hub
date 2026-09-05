// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from './store'
import WorkspaceProjectList from './WorkspaceProjectList.vue'

const projects: ProjectRecord[] = [
  { id: 'docs', name: 'docs', path: '/docs', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'wetools', name: 'wetools', path: '/wetools', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'assistant', name: 'weassistan', path: '/assistant', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' },
]

const workspace: WorkspaceRecord = {
  schemaVersion: 1,
  id: 'minitool',
  name: 'minitool',
  primaryProject: 'wetools',
  members: [
    { project: 'docs', projectId: 'docs', resolved: true },
    { project: 'wetools', projectId: 'wetools', resolved: true },
    { project: 'assistant', label: 'Assistant API', projectId: 'assistant', resolved: true },
  ],
  revision: 'revision',
}

function command(id: string, projectId: string): CommandCapability {
  return {
    id,
    kind: 'command',
    name: id,
    source: 'package.json',
    invocation: { command: 'pnpm', args: ['run', id], cwd: `/${projectId}`, requiredEnv: [] },
  }
}

describe('workspace project list', () => {
  it('shows the primary project first with prioritized status and at most two pinned capabilities', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const pinned = [command('dev', 'wetools'), command('test', 'wetools'), command('build', 'wetools')]
    store.projects = projects
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    store.paletteItems = pinned.map(capability => ({ project: projects[1]!, capability }))
    store.capabilityPinsByProject = { wetools: pinned.map(capability => capability.id) }
    store.capabilityDiagnosticsByProject = { wetools: [{ source: 'project', path: '/wetools', message: 'Broken metadata' }] }

    const wrapper = mount(WorkspaceProjectList, { global: { plugins: [pinia] } })
    const rows = wrapper.findAll('.workspace-project-summary')

    expect(rows.map(row => row.get('.workspace-project-open strong').text())).toEqual(['wetools', 'docs', 'Assistant API'])
    expect(rows[0]!.get('.workspace-project-primary').text()).toBe('Primary')
    expect(rows[0]!.get('.workspace-project-status').text()).toContain('1 configuration issue')
    expect(rows[0]!.findAll('.workspace-capability-shortcut')).toHaveLength(2)
    expect(rows[0]!.get('.workspace-capability-more').text()).toContain('1 more')

    await rows[0]!.findAll('.workspace-capability-shortcut')[0]!.trigger('click')
    expect(store.selectedWorkspaceId).toBe(workspace.id)
    expect(store.selectedProjectId).toBe('')
    expect(store.workspaceCapabilityProject?.id).toBe('wetools')
    expect(store.workspaceCapability?.id).toBe('dev')
  })

  it('opens a project from its independent project button', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = projects
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id
    const selectProject = vi.spyOn(store, 'selectProject').mockResolvedValue()

    const wrapper = mount(WorkspaceProjectList, { global: { plugins: [pinia] } })
    await wrapper.findAll('.workspace-project-open')[1]!.trigger('click')

    expect(selectProject).toHaveBeenCalledWith('docs')
  })

  it('does not treat project trust as a static list status', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = projects
    store.workspaces = [workspace]
    store.selectedWorkspaceId = workspace.id

    const wrapper = mount(WorkspaceProjectList, { global: { plugins: [pinia] } })
    const untrustedRow = wrapper.findAll('.workspace-project-summary')[0]!

    expect(untrustedRow.get('.workspace-project-open strong').text()).toBe('wetools')
    expect(untrustedRow.find('.workspace-project-status').exists()).toBe(false)
  })

  it('renders an actionable empty state for a workspace with no members', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.workspaces = [{ ...workspace, id: 'empty', name: 'Empty', primaryProject: undefined, members: [] }]
    store.selectedWorkspaceId = 'empty'

    const wrapper = mount(WorkspaceProjectList, { global: { plugins: [pinia] } })

    expect(wrapper.get('.workspace-project-empty').text()).toContain('Add project')
  })

  it('distinguishes an available unregistered project from a missing project', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.workspaces = [{
      ...workspace,
      id: 'imported',
      members: [
        { project: 'available', label: 'Available project', resolved: false, path: '/available' },
        { project: 'missing', label: 'Missing project', resolved: false },
      ],
    }]
    store.selectedWorkspaceId = 'imported'

    const wrapper = mount(WorkspaceProjectList, { global: { plugins: [pinia] } })
    const rows = wrapper.findAll('.workspace-project-summary.unresolved')

    expect(rows[0]!.get('.workspace-project-status').text()).toBe('Available to add')
    expect(rows[1]!.get('.workspace-project-status').text()).toBe('Not found on this device')
  })
})
