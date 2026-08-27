// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CommandCapability, ProjectRecord } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './components/ui/select'
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
    document.body.innerHTML = ''
    vi.restoreAllMocks()
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

  it('renders parameterized command inputs and submits the selected values', async () => {
    useI18n().setLocale('en')
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useWorkbenchStore()
    const parameterized: CommandCapability = {
      ...command,
      name: 'deploy',
      inputs: [
        { id: 'environment', type: 'select', label: 'Environment', options: [{ value: 'dev' }, { value: 'rdm' }], default: 'dev', flag: '--env' },
        { id: 'uin', type: 'text', label: 'UIN', flag: '--uin', visibleWhen: { input: 'environment', equals: 'dev' }, requiredWhen: { input: 'environment', equals: 'dev' } },
      ],
    }
    store.projects = [{ ...project, trust: 'trusted' }]
    store.selectedProjectId = project.id
    store.capabilities = [parameterized]
    store.selectedCapabilityId = parameterized.id
    const preview = vi.spyOn(store, 'previewSelectedCommand').mockImplementation(async (inputs = {}) => ({
      ...parameterized.invocation,
      args: ['run', 'deploy', '--', `--env=${inputs.environment}`, ...(inputs.environment === 'dev' && inputs.uin ? [`--uin=${inputs.uin}`] : [])],
    }))
    const run = vi.spyOn(store, 'runSelected').mockResolvedValue()

    const wrapper = mount(DetailPanel, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.get('[role="combobox"]').text()).toContain('dev')
    expect(wrapper.get('input').attributes('required')).toBeDefined()

    await wrapper.get('input').setValue('12345')
    await flushPromises()
    expect(preview).toHaveBeenLastCalledWith({ environment: 'dev', uin: '12345' })
    expect(wrapper.text()).toContain('--uin=12345')

    wrapper.getComponent(Select).vm.$emit('update:modelValue', 'rdm')
    await flushPromises()
    expect(wrapper.get('input').element.closest<HTMLElement>('.command-input-field')?.style.display).toBe('none')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(run).toHaveBeenCalledWith({ environment: 'rdm', uin: '12345' })
  })
})
