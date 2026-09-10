// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { Capability, ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from './CommandPalette.vue'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = { id: 'project', name: 'Project', path: '/project', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }
const capabilities: Capability[] = [
  { id: 'build', kind: 'command', name: 'build', source: 'package.json', sourcePath: '/project/package.json', invocation: { command: 'pnpm', args: ['build'], cwd: '/project', requiredEnv: [] } },
  { id: 'test', kind: 'command', name: 'test', source: 'package.json', sourcePath: '/project/package.json', invocation: { command: 'pnpm', args: ['test'], cwd: '/project', requiredEnv: [] } },
]

describe('command palette', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    const store = useWorkbenchStore()
    store.selectedProjectId = project.id
    store.paletteItems = capabilities.map(capability => ({ project, capability }))
  })

  it('navigates results with arrows and selects with Enter', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = project.id
    store.paletteItems = capabilities.map(capability => ({ project, capability }))
    const wrapper = mount(CommandPalette, { props: { open: true }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!

    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
    await flushPromises()
    expect(document.body.querySelectorAll('[role="option"]')[1]!.getAttribute('aria-selected')).toBe('true')
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await flushPromises()

    expect(useWorkbenchStore().selectedCapabilityId).toBe('test')
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('wraps ArrowUp from the first result to the last result', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.selectedProjectId = project.id
    store.paletteItems = capabilities.map(capability => ({ project, capability }))
    mount(CommandPalette, { props: { open: true }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    document.body.querySelector<HTMLInputElement>('.palette-search input')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }))
    await flushPromises()
    expect([...document.body.querySelectorAll('[role="option"]')].at(-1)!.classList).toContain('active')
  })

  it('switches projects from the project palette and requests the project page', async () => {
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectProject = vi.fn(async () => {})
    const wrapper = mount(CommandPalette, { props: { open: true, mode: 'projects' }, attachTo: document.body })
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[role="option"]')!.click()
    await flushPromises()
    expect(store.selectProject).toHaveBeenCalledWith('project')
    expect(wrapper.emitted('openWorkbench')).toHaveLength(1)
    wrapper.unmount()
  })

  it('reveals keyboard selections without scrolling on pointer hover', async () => {
    const wrapper = mount(CommandPalette, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const input = document.querySelector<HTMLInputElement>('.palette-search input')!
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    const first = options[0]!
    const last = options.at(-1)!
    first.scrollIntoView = vi.fn()
    last.scrollIntoView = vi.fn()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await flushPromises()
    expect(last.getAttribute('aria-selected')).toBe('true')
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    first.dispatchEvent(new MouseEvent('mouseenter'))
    await flushPromises()
    expect(first.getAttribute('aria-selected')).toBe('true')
    expect(first.scrollIntoView).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('returns filtered results to the top of the list', async () => {
    const wrapper = mount(CommandPalette, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const list = document.querySelector<HTMLElement>('.palette-results')!
    const input = document.querySelector<HTMLInputElement>('.palette-search input')!
    list.scrollTop = 160
    input.value = 'build'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(list.scrollTop).toBe(0)
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(document.querySelector('[role="option"]')?.getAttribute('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('switches from projects to command navigation with > and returns when cleared', async () => {
    const store = useWorkbenchStore()
    store.projects = [project]
    const wrapper = mount(CommandPalette, { props: { open: true, mode: 'projects' }, attachTo: document.body })
    await flushPromises()
    expect(document.body.querySelector('[aria-current="true"]')?.textContent).toContain('Project')
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!
    input.value = '>'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('[aria-current="true"]')).toBeNull()
    expect(document.body.querySelectorAll('[role="option"]').length).toBeGreaterThan(1)
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(document.body.querySelector('[aria-current="true"]')?.textContent).toContain('/project')
    expect(store.selectedCapabilityId).toBe('')
    wrapper.unmount()
  })

  it('filters categories and cycles them with Tab while retaining the search focus', async () => {
    const wrapper = mount(CommandPalette, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toMatch(/Projects|项目/)
    expect(document.activeElement).toBe(input)
    const commandTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => /^(?:Commands|命令)$/.test(tab.textContent?.trim() ?? ''))!
    commandTab.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    await flushPromises()
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    input.value = 'build'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await flushPromises()
    expect(input.value).toBe('build')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0)
    expect(useWorkbenchStore().selectedCapabilityId).toBe('')
    wrapper.unmount()
  })

  it('uses trust and configuration diagnostics for project status colors', async () => {
    const store = useWorkbenchStore()
    store.projects = [project]
    const wrapper = mount(CommandPalette, { props: { open: true, mode: 'projects' }, attachTo: document.body })
    await flushPromises()
    expect(document.querySelector('.palette-project-status--trusted')).not.toBeNull()
    store.projectCatalogDiagnostics = [{ projectId: project.id, source: 'project-config', targetPath: '/project/config.json', path: '/project/config.json', message: 'Invalid configuration' }]
    await flushPromises()
    expect(document.querySelector('.palette-project-status--warning')).not.toBeNull()
    expect(document.querySelector('.palette-project-status--trusted')).toBeNull()
    store.projectCatalogDiagnostics = []
    store.projects = [{ ...project, trust: 'untrusted' }]
    await flushPromises()
    expect(document.querySelector('.palette-project-status--neutral')).not.toBeNull()
    expect(document.querySelector('.palette-project-status--warning')).toBeNull()
    wrapper.unmount()
  })

  it('opens contributed pages without executing a project command', async () => {
    const store = useWorkbenchStore()
    store.integrationContributions = [{ id: 'issues', pluginId: 'example', source: 'host:example', provider: { id: 'example', requires: '^1.0.0' }, providerVersion: '1.0.0', actions: [], views: [{ id: 'todos', title: 'My queue', icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [] }] }]
    const wrapper = mount(CommandPalette, { props: { open: true, mode: 'commands' }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!
    input.value = '> My queue'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    await flushPromises()
    expect(wrapper.emitted('openIntegration')).toEqual([['issues', 'todos']])
    expect(store.selectedCapabilityId).toBe('')
    wrapper.unmount()
  })

  it('finds and switches owner scopes explicitly', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'acme', kind: 'team', name: 'Acme' },
    ]
    store.loadOwnerScopeWorkspaceIndex = vi.fn(async () => {})
    store.switchOwnerScope = vi.fn(async () => {})
    mount(CommandPalette, { props: { open: true }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!
    input.value = 'Acme'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent?.includes('Acme'))!
    option.click()
    await flushPromises()

    expect(store.switchOwnerScope).toHaveBeenCalledWith('acme')
  })
})
