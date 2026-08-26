// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DetailPanel from './DetailPanel.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const project: ProjectRecord = {
  id: 'project-id',
  name: 'Example',
  path: '/workspace/example',
  trust: 'untrusted',
  addedAt: '2026-01-01T00:00:00.000Z',
}

const command: CommandCapability = {
  id: 'command-id',
  kind: 'command',
  name: 'build',
  source: 'package.json',
  sourcePath: '/workspace/example/package.json',
  sourceLine: 12,
  invocation: { command: 'pnpm', args: ['run', 'build'], cwd: project.path, requiredEnv: [] },
}

describe('detail panel desktop actions', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'craftHubDesktop')
  })

  it('shows the source path and delegates open actions through the desktop bridge', async () => {
    useI18n().setLocale('en')
    const openCapabilitySourceInVSCode = vi.fn(async () => {})
    window.craftHubDesktop = {
      openCapabilitySourceInVSCode,
    }
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    store.projects = [project]
    store.selectedProjectId = project.id
    store.capabilities = [command]
    store.selectedCapabilityId = command.id

    const wrapper = mount(DetailPanel, { global: { plugins: [pinia] } })
    expect(wrapper.text()).toContain(`${command.sourcePath}:${command.sourceLine}`)
    expect(wrapper.get('[data-testid="open-source-vscode"]').text()).toBe('Source')
    expect(wrapper.get('[data-testid="open-source-vscode"] .app-icon').classes()).toContain('i-ri-file-search-line')

    await wrapper.get('[data-testid="open-source-vscode"]').trigger('click')
    await flushPromises()

    expect(openCapabilitySourceInVSCode).toHaveBeenCalledWith(project.id, command.id)
  })
})
