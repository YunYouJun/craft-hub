// @vitest-environment happy-dom
/// <reference lib="dom" />
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationWorkItemDetail from './IntegrationWorkItemDetail.vue'
import { useWorkbenchStore } from './store'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('work item detail and task handoff', () => {
  it('reads full global details, strips executable markup and never starts a task merely by opening', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ id: '22', title: 'Fix login', description: '<p>Full requirement</p><script>steal()</script>', url: 'https://example.com/22' })
    const start = vi.spyOn(api, 'startAgentTask')
    const wrapper = mount(IntegrationWorkItemDetail, { props: { integrationId: 'issues', detailActionId: 'get', entity: { id: '22', title: 'Fix login', metadata: { workspaceId: 'space', type: 'bug' } } }, global: { plugins: [pinia] }, attachTo: document.body })
    expect(wrapper.get('button').text()).toBe('View details')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('issues', 'get', { workspaceId: 'space', type: 'bug', itemId: '22' }, undefined)
    expect(document.body.textContent).toContain('Full requirement')
    expect(document.body.textContent).not.toContain('steal()')
    expect(document.querySelector('textarea')?.value).toBe('Fix login\n\nhttps://example.com/22\n\nFull requirement')
    expect(start).not.toHaveBeenCalled()
    expect(document.querySelector('[role="combobox"]')?.textContent).toContain('Choose a project')
    expect(document.querySelector('.work-item-meta a')?.getAttribute('href')).toBe('https://example.com/22')
    const trigger = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Hand off to agent')!
    expect(trigger.disabled).toBe(true)
    document.querySelector<HTMLElement>('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(wrapper.get('button').element)
    wrapper.unmount()
  })

  it('hands off only after choosing a project and explicitly submitting the edited instructions', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    const store = useWorkbenchStore()
    store.projects = [{ id: 'project', name: 'Example project', path: '/example', trust: 'trusted', addedAt: '2026-01-01T00:00:00.000Z' }]
    const start = vi.spyOn(store, 'startAgentTask').mockResolvedValue({ id: 'task', provider: 'codex', projectIds: ['project'], primaryProjectId: 'project', prompt: 'Review the login flow', status: 'running', startedAt: '2026-01-01T00:00:00.000Z' })
    const wrapper = mount(IntegrationWorkItemDetail, { props: { integrationId: 'issues', entity: { id: '22', title: 'Fix login' } }, global: { plugins: [pinia] }, attachTo: document.body })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const select = document.querySelector<HTMLElement>('[role="combobox"]')!
    expect(document.querySelector(`label[for="${select.id}"]`)?.textContent).toBe('Task project')
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes('Example project'))!
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(select.textContent).toContain('Example project')
    const textarea = document.querySelector('textarea')!
    expect(document.querySelector(`label[for="${textarea.id}"]`)?.textContent).toBe('Task instructions')
    textarea.value = 'Review the login flow'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(start).not.toHaveBeenCalled()
    const submit = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Hand off to agent')!
    expect(submit.disabled).toBe(false)
    submit.click()
    await flushPromises()
    expect(start).toHaveBeenCalledExactlyOnceWith('Review the login flow', ['project'], 'project')
    expect(document.body.textContent).toContain('Task created: task')
    expect(textarea.disabled).toBe(true)
    wrapper.unmount()
  })
})
