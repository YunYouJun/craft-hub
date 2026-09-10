// @vitest-environment happy-dom
/// <reference lib="dom" />
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import IntegrationActionForm from './IntegrationActionForm.vue'

const props = {
  integrationId: 'review',
  projectId: 'project',
  block: { id: 'create', type: 'action-form' as const, actionId: 'create', fields: [{ id: 'title', label: 'Title', type: 'text' as const, required: true }, { id: 'reviewers', label: 'Reviewers', type: 'string-list' as const }] },
  action: { id: 'create', title: 'Create review', operation: 'merge-requests.create' as const, effect: 'remote-write' as const, confirmation: 'always' as const, effectiveConfirmation: 'always' as const },
  translate: (value: string) => value,
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('integration action form', () => {
  it('does not execute writes on mount or cancel and sends the reviewed snapshot after confirmation', async () => {
    useI18n().setLocale('en')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ id: '1', title: 'Created' })
    const wrapper = mount(IntegrationActionForm, { props, attachTo: document.body })
    expect(invoke).not.toHaveBeenCalled()
    await wrapper.get('input').setValue('New review')
    await wrapper.findAll('input')[1]!.setValue('alice, bob')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('New review')
    const cancel = [...document.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!
    cancel.click()
    await flushPromises()
    expect(invoke).not.toHaveBeenCalled()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm action')!
    confirm.click()
    await flushPromises()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('review', 'create', { title: 'New review', reviewers: ['alice', 'bob'] }, 'project', true)
    expect(wrapper.emitted('completed')?.[0]).toEqual([{ id: '1', title: 'Created' }])
    wrapper.unmount()
  })

  it('reviews checkbox and select values from the shared controls before writing', async () => {
    useI18n().setLocale('en')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [] })
    const wrapper = mount(IntegrationActionForm, { attachTo: document.body, props: { ...props, block: { ...props.block, fields: [
      { id: 'enabled', label: 'Enabled', type: 'checkbox', value: false },
      { id: 'mode', label: 'Mode', type: 'select', value: 'preview', options: [{ value: 'preview', label: 'Preview' }, { value: 'publish', label: 'Publish' }] },
    ] } } })
    await wrapper.get('[role="checkbox"]').trigger('click')
    expect(wrapper.get('[role="checkbox"]').attributes('aria-checked')).toBe('true')
    await wrapper.get('[role="combobox"]').trigger('pointerdown', { button: 0, ctrlKey: false })
    await flushPromises()
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes('Publish'))!
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke).not.toHaveBeenCalled()
    const confirm = [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm action')!
    confirm.click()
    await flushPromises()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('review', 'create', { enabled: true, mode: 'publish' }, 'project', true)
    wrapper.unmount()
  })

  it('keeps provider failures visible and allows retry without remounting', async () => {
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValueOnce(new Error('Connection expired')).mockResolvedValue({ items: [] })
    const wrapper = mount(IntegrationActionForm, { props: { ...props, action: { ...props.action, effectiveConfirmation: 'never', effect: 'remote-read', operation: 'ci.status' } } })
    await wrapper.get('input').setValue('commit')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Connection expired')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
