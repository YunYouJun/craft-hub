// @vitest-environment happy-dom
/// <reference lib="dom" />
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentConnectionSettings from './AgentConnectionSettings.vue'
import { api } from './api'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

afterEach(() => vi.restoreAllMocks())
describe('agent connection settings', () => {
  it('requires scope selection, enables only on a click and revokes the displayed configuration', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    const store = useWorkbenchStore()
    store.projects = [{ id: 'project', name: 'Example', path: '/example', trust: 'untrusted', addedAt: '2026-01-01' }]
    vi.spyOn(api, 'agentConnection').mockResolvedValue({ available: true, enabled: false, projectIds: [], integrationRead: false })
    const update = vi.spyOn(api, 'updateAgentConnection').mockResolvedValue({ available: true, enabled: true, projectIds: ['project'], integrationRead: false, mcpConfig: { mcpServers: { 'craft-hub': { command: 'node', args: ['cli.mjs', 'mcp'] } } } })
    const wrapper = mount(AgentConnectionSettings, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')[0]!.attributes('disabled')).toBeDefined()
    await wrapper.get('input[value="project"]').setValue(true)
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith({ enabled: true, projectIds: ['project'], integrationRead: false })
    expect(wrapper.text()).toContain('MCP')
    update.mockResolvedValue({ available: true, enabled: false, projectIds: [], integrationRead: false })
    await wrapper.findAll('button').find(button => button.text() === 'Revoke connection')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Not connected')
    expect(wrapper.find('pre').exists()).toBe(false)
    wrapper.unmount()
  })

  it('explains hosted limitations without offering to grant server-local access', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    vi.spyOn(api, 'agentConnection').mockResolvedValue({ available: false, enabled: false, projectIds: [], integrationRead: false })
    const wrapper = mount(AgentConnectionSettings, { global: { plugins: [pinia] } })
    await flushPromises()
    expect(wrapper.text()).toContain('cannot access your device')
    expect(wrapper.find('input').exists()).toBe(false)
    wrapper.unmount()
  })
})
