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
    expect(document.body.querySelectorAll('[role="option"]')[1]!.classList).toContain('active')
  })

  it('finds and switches owner scopes explicitly', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.ownerScopes = [
      { id: 'personal', kind: 'personal', name: 'Personal' },
      { id: 'tencent', kind: 'team', name: 'Tencent' },
    ]
    store.loadOwnerScopeWorkspaceIndex = vi.fn(async () => {})
    store.switchOwnerScope = vi.fn(async () => {})
    mount(CommandPalette, { props: { open: true }, global: { plugins: [pinia] }, attachTo: document.body })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-search input')!
    input.value = 'Tencent'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent?.includes('Tencent'))!
    option.click()
    await flushPromises()

    expect(store.switchOwnerScope).toHaveBeenCalledWith('tencent')
  })
})
