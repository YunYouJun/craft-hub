// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectRecord, SkillCapability } from 'craft-hub'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import CapabilityList from './CapabilityList.vue'
import { useWorkbenchStore } from './store'

describe('capability list', () => {
  beforeEach(() => window.localStorage.clear())

  it('shows a configured command description below its name', () => {
    const project: ProjectRecord = {
      id: 'project',
      name: 'Project',
      path: '/project',
      trust: 'untrusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    const command: CommandCapability = {
      id: 'command',
      kind: 'command',
      name: 'docs:dev',
      description: 'Start the documentation site in development mode.',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'docs:dev'], cwd: project.path, requiredEnv: [] },
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })

    expect(wrapper.get('.capability-row strong').text()).toBe('docs:dev')
    expect(wrapper.get('.capability-description').text()).toBe(command.description)
  })

  it('shows mixed pins first and supports direct and keyboard reordering controls', async () => {
    const project: ProjectRecord = {
      id: 'project',
      name: 'Project',
      path: '/project',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    const command: CommandCapability = {
      id: 'command',
      kind: 'command',
      name: 'dev',
      source: 'package.json',
      invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: project.path, requiredEnv: [] },
    }
    const skill: SkillCapability = {
      id: 'skill',
      kind: 'skill',
      name: 'release',
      source: 'agent-skill',
      path: '/project/.agents/skills/release/SKILL.md',
      contentHash: 'hash',
      content: '# Release',
    }
    const pinOrders: string[][] = []
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command, skill]
    store.capabilityPinsByProject = { [project.id]: [skill.id, command.id] }
    store.setCapabilityPinOrder = async (ids: string[]) => {
      pinOrders.push(ids)
      return true
    }

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })
    const rows = wrapper.findAll('.capability-row')

    expect(wrapper.get('.capability-section h3').text()).toContain('Pinned')
    expect(rows.map(row => row.get('strong').text())).toEqual(['release', 'dev'])
    expect(rows[0]?.attributes('draggable')).toBe('true')
    await rows[0]!.trigger('dragstart')
    await rows[1]!.trigger('drop')
    await rows[0]!.trigger('keydown', { altKey: true, key: 'ArrowDown' })
    expect(pinOrders).toEqual([
      [command.id, skill.id],
      [command.id, skill.id],
    ])
  })

  it('shows a dismissible Codex suggestion again when the missing command set changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project'
    store.agentActions = [{
      id: 'improve-project-config',
      targetPath: '.craft-hub/project.yaml',
      missingCommandCount: 2,
      commandFingerprint: 'first-set',
    }]
    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })

    expect(wrapper.get('.agent-action-hint').text()).toContain('2 command(s)')
    await wrapper.get('.agent-action-hint-main').trigger('click')
    expect(store.agentActionDialogOpen).toBe(true)
    await wrapper.get('.agent-action-hint-dismiss').trigger('click')
    expect(wrapper.find('.agent-action-hint').exists()).toBe(false)

    store.agentActions = [{ ...store.agentActions[0]!, commandFingerprint: 'second-set', missingCommandCount: 1 }]
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.agent-action-hint').text()).toContain('1 command(s)')
  })
})
