// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { IntegrationActionResult, IntegrationEntity } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationStatusTransitionControl from './IntegrationStatusTransitionControl.vue'

describe('integration status transition control', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    document.body.innerHTML = ''
    pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('uses the native item ID and complete account and container scope for transitions and the confirmed write', async () => {
    const sourceRef = { providerId: 'tasks', instanceId: 'personal-tasks', accountId: 'me', containerId: 'inbox', kind: 'task', itemId: 'native-task-1' }
    const entity: IntegrationEntity = { id: 'display-task-1', title: 'Review proposal', status: 'open', sourceRef, metadata: { type: 'task', itemId: 'metadata-id' } }
    const updated = { ...entity, status: 'done' }
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ currentStatus: 'open', transitions: [{ id: 'complete', title: 'Complete', fromStatus: 'open', toStatus: 'done', requiredFields: [] }] })
      .mockResolvedValueOnce(updated)
    const wrapper = mount(IntegrationStatusTransitionControl, { props: { entity, integrationId: 'personal-tasks', transitionsActionId: 'transitions', updateActionId: 'update', projectId: 'project-1' }, global: { plugins: [pinia] }, attachTo: document.body })
    await wrapper.get('.integration-status-trigger').trigger('click')
    await flushPromises()
    const input = { type: 'task', itemId: 'native-task-1', sourceRef, title: entity.title, currentStatus: 'open' }
    expect(invoke).toHaveBeenNthCalledWith(1, 'personal-tasks', 'transitions', input, 'project-1')
    expect(invoke).toHaveBeenCalledOnce()
    document.body.querySelector<HTMLButtonElement>('[data-transition-id="complete"]')!.click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-status-transition"]')!.click()
    await flushPromises()
    expect(invoke).toHaveBeenNthCalledWith(2, 'personal-tasks', 'update', { ...input, transitionId: 'complete', status: 'done', fields: {} }, 'project-1', true)
    expect(wrapper.emitted('updated')).toEqual([[updated]])
    expect(entity.id).toBe('display-task-1')
    expect(entity.metadata?.itemId).toBe('metadata-id')
    wrapper.unmount()
  })

  it('loads native transitions, validates required fields, and confirms the remote write', async () => {
    const updated: IntegrationEntity = {
      id: '22',
      title: 'Login bug',
      status: 'in_progress',
      metadata: { type: 'bug', workspaceId: '123' },
    }
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({
        currentStatus: 'new',
        transitions: [{ id: 'new-in-progress', title: 'Accept', fromStatus: 'new', toStatus: 'in_progress', requiredFields: ['owner'] }],
      })
      .mockResolvedValueOnce(updated)
    const wrapper = mount(IntegrationStatusTransitionControl, {
      attachTo: document.body,
      global: { plugins: [pinia] },
      props: {
        entity: { id: '22', title: 'Login bug', status: 'new', metadata: { type: 'bug', workspaceId: '123' } },
        integrationId: 'acme-work-items',
        projectId: 'project-1',
        transitionsActionId: 'transitions',
        updateActionId: 'update-status',
      },
    })

    await wrapper.get('.integration-status-trigger').trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenNthCalledWith(1, 'acme-work-items', 'transitions', {
      type: 'bug',
      workspaceId: '123',
      itemId: '22',
      title: 'Login bug',
      currentStatus: 'new',
    }, 'project-1')
    const dialog = document.body.querySelector<HTMLElement>('[data-testid="integration-status-popover"]')!
    expect(dialog.textContent).toContain('Accept')
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-testid="confirm-status-transition"]')!
    expect(confirm.disabled).toBe(true)

    dialog.querySelector<HTMLButtonElement>('[data-transition-id="new-in-progress"]')!.click()
    await flushPromises()
    const field = dialog.querySelector<HTMLInputElement>('input[name="owner"]')!
    field.value = 'Ada'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(confirm.disabled).toBe(false)
    confirm.click()
    await flushPromises()

    expect(invoke).toHaveBeenNthCalledWith(2, 'acme-work-items', 'update-status', {
      type: 'bug',
      workspaceId: '123',
      itemId: '22',
      title: 'Login bug',
      currentStatus: 'new',
      transitionId: 'new-in-progress',
      status: 'in_progress',
      fields: { owner: 'Ada' },
    }, 'project-1', true)
    expect(wrapper.emitted('updated')).toEqual([[updated]])
  })
  it('opens available states beside the badge without a modal, nested select, or automatic target choice', async () => {
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ currentStatus: 'active', transitions: [
      { id: 'test', title: 'Testing', fromStatus: 'active', toStatus: 'testing', requiredFields: [] },
      { id: 'review', title: 'Review', fromStatus: 'active', toStatus: 'review', requiredFields: [] },
    ] })
    const wrapper = mount(IntegrationStatusTransitionControl, { props: { entity: { id: 'one', title: 'Work item', status: 'active' }, integrationId: 'tasks', transitionsActionId: 'transitions', updateActionId: 'update', trigger: 'status' }, global: { plugins: [pinia] }, attachTo: document.body })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const panel = document.body.querySelector<HTMLElement>('.integration-status-popover')
    expect(panel).not.toBeNull()
    expect(document.body.querySelector('.dialog-overlay')).toBeNull()
    expect(panel!.querySelector('select')).toBeNull()
    expect(panel!.querySelectorAll('[data-transition-id]')).toHaveLength(2)
    const confirm = panel!.querySelector<HTMLButtonElement>('[data-testid="confirm-status-transition"]')!
    expect(confirm.disabled).toBe(true)
    panel!.querySelector<HTMLButtonElement>('[data-transition-id="test"]')!.click()
    await flushPromises()
    expect(confirm.disabled).toBe(false)
    expect(invoke).toHaveBeenCalledOnce()
    expect(document.body.style.overflow).not.toBe('hidden')
    wrapper.unmount()
  })

  it('ignores transitions returned after closing and reopening the dropdown', async () => {
    let finishFirst!: (value: IntegrationActionResult) => void
    vi.spyOn(api, 'invokeIntegrationAction')
      .mockImplementationOnce(() => new Promise(resolve => finishFirst = resolve))
      .mockResolvedValueOnce({ currentStatus: 'active', transitions: [{ id: 'fresh', title: 'Fresh target', fromStatus: 'active', toStatus: 'fresh', requiredFields: [] }] })
    const wrapper = mount(IntegrationStatusTransitionControl, { props: { entity: { id: 'one', title: 'Work item', status: 'active' }, integrationId: 'tasks', transitionsActionId: 'transitions', updateActionId: 'update', trigger: 'status' }, global: { plugins: [pinia] }, attachTo: document.body })
    const trigger = wrapper.get('.integration-status-trigger')
    await trigger.trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('.integration-status-actions button')!.click()
    await flushPromises()
    await trigger.trigger('click')
    await flushPromises()
    finishFirst({ currentStatus: 'active', transitions: [{ id: 'old', title: 'Old target', fromStatus: 'active', toStatus: 'old', requiredFields: [] }] })
    await flushPromises()
    expect(document.body.querySelector('[data-transition-id="fresh"]')).not.toBeNull()
    expect(document.body.querySelector('[data-transition-id="old"]')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the chosen target on write failure and retries only after explicit confirmation', async () => {
    const invoke = vi.spyOn(api, 'invokeIntegrationAction')
      .mockResolvedValueOnce({ currentStatus: 'active', transitions: [{ id: 'test', title: 'Testing', fromStatus: 'active', toStatus: 'testing', requiredFields: [] }] })
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce({ id: 'one', title: 'Work item', status: 'testing' })
    const wrapper = mount(IntegrationStatusTransitionControl, { props: { entity: { id: 'one', title: 'Work item', status: 'active' }, integrationId: 'tasks', transitionsActionId: 'transitions', updateActionId: 'update', trigger: 'status' }, global: { plugins: [pinia] }, attachTo: document.body })
    await wrapper.get('.integration-status-trigger').trigger('click')
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-transition-id="test"]')!.click()
    await flushPromises()
    const confirm = document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-status-transition"]')!
    confirm.click()
    confirm.click()
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Permission denied')
    expect(document.body.querySelector('[data-transition-id="test"]')?.getAttribute('aria-checked')).toBe('true')
    confirm.click()
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenLastCalledWith('tasks', 'update', expect.objectContaining({ status: 'testing', transitionId: 'test' }), undefined, true)
    expect(wrapper.emitted('updated')).toHaveLength(1)
    wrapper.unmount()
  })
})
