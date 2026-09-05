// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { IntegrationEntity } from 'craft-hub'
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
    const dialog = document.body.querySelector<HTMLElement>('[data-testid="integration-status-dialog"]')!
    expect(dialog.textContent).toContain('Accept · in_progress')
    const confirm = dialog.querySelector<HTMLButtonElement>('[data-testid="confirm-status-transition"]')!
    expect(confirm.disabled).toBe(true)

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
})
