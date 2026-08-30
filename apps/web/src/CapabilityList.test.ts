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

  it('shows project-level command and skill counts in the filters', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project'
    store.capabilities = [
      {
        id: 'dev',
        kind: 'command',
        name: 'dev',
        source: 'package.json',
        invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: '/project', requiredEnv: [] },
      },
      {
        id: 'build',
        kind: 'command',
        name: 'build',
        source: 'package.json',
        invocation: { command: 'pnpm', args: ['run', 'build'], cwd: '/project', requiredEnv: [] },
      },
      {
        id: 'release',
        kind: 'skill',
        name: 'release',
        source: 'agent-skill',
        path: '/project/.agents/skills/release/SKILL.md',
        contentHash: 'hash',
        content: '# Release',
      },
    ]

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })
    const filters = wrapper.findAll('.filters button')

    expect(filters.map(button => button.text())).toEqual(['All', 'Commands 2', 'Skills 1'])
  })

  it('shows friendly skill sources only when a project mixes source types', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project'
    store.capabilities = [
      {
        id: 'agent-release',
        kind: 'skill',
        name: 'release',
        source: 'agent-skill',
        path: '/project/.agents/skills/release/SKILL.md',
        contentHash: 'agent-hash',
        content: '# Release',
      },
    ]

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })
    expect(wrapper.find('.capability-source').exists()).toBe(false)

    store.capabilities.push({
      id: 'codex-review',
      kind: 'skill',
      name: 'review',
      source: 'codex-skill',
      path: '/project/.codex/skills/review/SKILL.md',
      contentHash: 'codex-hash',
      content: '# Review',
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('.capability-source').map(source => source.text())).toEqual(['Agent', 'Codex'])
    expect(wrapper.findAll('.capability-source .app-icon')).toHaveLength(2)
    expect(wrapper.findAll('.capability-source').map(source => source.attributes('title'))).toEqual(['agent-skill', 'codex-skill'])
  })

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

  it('labels first-run-friendly and high-impact commands', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = 'project'
    store.capabilities = [
      {
        id: 'build',
        kind: 'command',
        name: 'build',
        source: 'package.json',
        category: 'build',
        invocation: { command: 'pnpm', args: ['run', 'build'], cwd: '/project', requiredEnv: [] },
      },
      {
        id: 'publish',
        kind: 'command',
        name: 'publish',
        source: 'package.json',
        category: 'deploy',
        invocation: { command: 'pnpm', args: ['run', 'publish'], cwd: '/project', requiredEnv: [] },
      },
    ]

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })
    expect(wrapper.findAll('.capability-guidance').map(item => item.text())).toEqual([
      'Good first run',
      'High impact',
    ])
    expect(wrapper.findAll('.capability-heading > .capability-guidance')).toHaveLength(2)
  })

  it('offers safe recovery when no capabilities are discovered', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [{
      id: 'empty',
      name: 'Empty',
      path: '/empty',
      trust: 'untrusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }]
    store.selectedProjectId = 'empty'

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })
    expect(wrapper.get('.no-capabilities-state').text()).toContain('No runnable capabilities found')
    expect(wrapper.get('.no-capabilities-state').text()).toContain('Preview project config')
    expect(wrapper.get('.no-capabilities-state').text()).toContain('Choose another folder')
  })

  it('groups workspace commands, filters categories, remembers collapse state, and shows diagnostics', async () => {
    const project: ProjectRecord = {
      id: 'monorepo',
      name: 'Monorepo',
      path: '/project',
      trust: 'trusted',
      addedAt: '2026-01-01T00:00:00.000Z',
    }
    const commands: CommandCapability[] = [
      {
        id: 'root-dev',
        kind: 'command',
        name: 'dev',
        source: 'package.json',
        category: 'develop',
        package: { name: 'root', relativePath: '.', root: true },
        invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: project.path, requiredEnv: [] },
      },
      {
        id: 'widget-build',
        kind: 'command',
        name: 'build',
        source: 'apps/widget/package.json',
        category: 'build',
        package: { name: '@scope/widget', relativePath: 'apps/widget', root: false },
        invocation: { command: 'pnpm', args: ['run', 'build'], cwd: '/project/apps/widget', requiredEnv: [] },
      },
      {
        id: 'widget-deploy',
        kind: 'command',
        name: 'deploy',
        source: 'apps/widget/package.json',
        category: 'deploy',
        package: { name: '@scope/widget', relativePath: 'apps/widget', root: false },
        invocation: { command: 'pnpm', args: ['run', 'deploy'], cwd: '/project/apps/widget', requiredEnv: [] },
      },
    ]
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = commands
    store.capabilityDiagnosticsByProject = {
      [project.id]: [{ source: 'pnpm-workspace', path: 'packages/broken/package.json', message: 'Invalid JSON' }],
    }

    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })

    expect(wrapper.findAll('.capability-group-heading strong').map(item => item.text())).toEqual(['Project root', 'apps/widget'])
    expect(wrapper.text()).toContain('@scope/widget')
    expect(wrapper.get('.capability-diagnostics').text()).toContain('packages/broken/package.json')

    const deployFilter = wrapper.findAll('.category-filters button').find(button => button.text() === 'Deploy/Release')!
    await deployFilter.trigger('click')
    expect(wrapper.findAll('.capability-row strong').map(item => item.text())).toEqual(['deploy'])

    await wrapper.get('.capability-group-heading').trigger('click')
    expect(wrapper.find('.capability-row').exists()).toBe(false)
    expect(window.localStorage.getItem(`craft-hub-capability-groups:${project.id}`)).toContain('apps/widget')
  })

  it('summarizes monorepo packages and scopes commands when a package is selected', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = 'monorepo'
    store.commandPackagesByProject = {
      monorepo: [
        { name: 'root', relativePath: '.', root: true },
        { name: '@scope/web', description: 'Web application for Craft Hub.', relativePath: 'apps/web', root: false },
        { name: '@scope/config', description: 'Shared lint config.', relativePath: 'packages/config', root: false },
        { description: 'Project documentation.', relativePath: 'docs', root: false },
      ],
    }
    store.capabilities = [
      {
        id: 'root-dev',
        kind: 'command',
        name: 'dev',
        source: 'package.json',
        category: 'develop',
        package: { name: 'root', relativePath: '.', root: true },
        invocation: { command: 'pnpm', args: ['run', 'dev'], cwd: '/project', requiredEnv: [] },
      },
      {
        id: 'app-build',
        kind: 'command',
        name: 'build',
        source: 'apps/web/package.json',
        category: 'build',
        package: { name: '@scope/web', relativePath: 'apps/web', root: false },
        invocation: { command: 'pnpm', args: ['run', 'build'], cwd: '/project/apps/web', requiredEnv: [] },
      },
      {
        id: 'app-test',
        kind: 'command',
        name: 'test',
        source: 'apps/web/package.json',
        category: 'test',
        package: { name: '@scope/web', relativePath: 'apps/web', root: false },
        invocation: { command: 'pnpm', args: ['run', 'test'], cwd: '/project/apps/web', requiredEnv: [] },
      },
    ]
    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })

    const packagesTab = wrapper.findAll('.filters button').find(button => button.text().includes('Packages'))!
    await packagesTab.trigger('click')
    expect(wrapper.get('.package-overview-summary').text()).toContain('4 packages · 3 commands')
    expect(wrapper.findAll('.package-overview-section h3').map(heading => heading.text())).toEqual(['Root', 'Apps', 'Packages', 'Documentation'])
    expect(wrapper.findAll('.package-overview-row').map(row => row.text())).toEqual([
      expect.stringContaining('Project root'),
      expect.stringContaining('apps/web'),
      expect.stringContaining('packages/config'),
      expect.stringContaining('docs'),
    ])
    expect(wrapper.findAll('.package-overview-row')[1]!.get('small').text()).toBe('@scope/web · Web application for Craft Hub.')

    await wrapper.get('.search-box input').setValue('Shared lint config')
    expect(wrapper.findAll('.package-overview-row').map(row => row.text())).toEqual([
      expect.stringContaining('packages/config'),
    ])
    await wrapper.get('.search-box input').setValue('')

    await wrapper.findAll('.package-overview-row')[1]!.trigger('click')
    expect(wrapper.get('.package-scope-filter').text()).toContain('apps/web')
    expect(wrapper.findAll('.capability-row strong').map(row => row.text())).toEqual(['build', 'test'])

    await wrapper.get('.package-scope-filter').trigger('click')
    expect(wrapper.findAll('.capability-row strong').map(row => row.text())).toEqual(['dev', 'build', 'test'])
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
      targetPath: '.craft-hub/project.jsonc',
      missingCommandCount: 2,
      commandFingerprint: 'first-set',
    }]
    const wrapper = mount(CapabilityList, { global: { plugins: [pinia] } })

    expect(wrapper.get('.agent-action-hint').text()).toContain('2 command or package description(s)')
    expect(wrapper.get('.capability-notices').element.children[0]).toBe(wrapper.get('.agent-action-hint').element)
    expect(wrapper.get('.capability-list').element.previousElementSibling).toBe(wrapper.get('.capability-notices').element)
    await wrapper.get('.agent-action-hint-main').trigger('click')
    expect(store.agentActionDialogOpen).toBe(true)
    await wrapper.get('.agent-action-hint-dismiss').trigger('click')
    expect(wrapper.find('.agent-action-hint').exists()).toBe(false)

    store.agentActions = [{ ...store.agentActions[0]!, commandFingerprint: 'second-set', missingCommandCount: 1 }]
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.agent-action-hint').text()).toContain('1 command or package description(s)')
  })
})
