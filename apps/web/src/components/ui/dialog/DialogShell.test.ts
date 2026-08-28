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
    mount(DialogShell, {
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
  })
})
