// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DialogShell from './DialogShell.vue'

describe('dialog shell', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('provides the accessible dialog structure and forwards content attributes', async () => {
    const wrapper = mount(DialogShell, {
      attachTo: document.body,
      attrs: { 'data-testid': 'dialog' },
      props: { open: true, contentClass: 'example-dialog' },
      slots: { default: 'Body', description: 'Description', title: 'Title' },
    })
    await flushPromises()

    const dialog = document.body.querySelector<HTMLElement>('[data-testid="dialog"]')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('Title')
    expect(dialog.textContent).toContain('Description')
    expect(dialog.textContent).toContain('Body')
    expect(dialog.querySelector('.dialog-panel-body')).toBeNull()
    wrapper.unmount()
  })

  it('keeps a panel body and action footer inside the accessible focus-managed dialog', async () => {
    const wrapper = mount(DialogShell, {
      attachTo: document.body,
      props: { open: true, layout: 'panel' },
      slots: {
        title: 'Refresh settings',
        description: 'Workstation',
        default: '<label>Refresh time<input type="time" value="09:30"></label>',
        footer: '<button type="button">Cancel</button><button type="button">Save</button>',
      },
    })
    await flushPromises()
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.classList.contains('dialog-panel')).toBe(true)
    expect(dialog.querySelector('.dialog-panel-header')?.textContent).toContain('Refresh settings')
    expect(dialog.querySelector('.dialog-panel-body input')?.getAttribute('type')).toBe('time')
    expect(dialog.querySelector('.dialog-panel-footer')?.textContent).toBe('CancelSave')
    const field = dialog.querySelector<HTMLInputElement>('input')!
    field.focus()
    expect(document.activeElement).toBe(field)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
})
