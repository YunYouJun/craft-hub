// @vitest-environment happy-dom
/// <reference lib="dom" />
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ResourceSecretCell from './ResourceSecretCell.vue'

afterEach(() => {
  delete window.craftHubDesktop
  vi.useRealTimers()
})

it('keeps passwords masked until explicitly shown, conceals on blur and copies through native code', async () => {
  vi.useFakeTimers()
  const credential = vi.fn().mockResolvedValue({ value: 'synthetic-password' })
  window.craftHubDesktop = { resourceCredential: credential }
  const wrapper = mount(ResourceSecretCell, { props: { rowId: 'one', session: { sessionId: 'grant', availableRowIds: ['one'] }, chinese: false } })
  expect(credential).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('••••••••')
  await wrapper.get('[aria-label="Show Password"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('synthetic-password')
  window.dispatchEvent(new Event('blur'))
  await flushPromises()
  expect(wrapper.text()).not.toContain('synthetic-password')
  credential.mockResolvedValue({ copied: true })
  await wrapper.get('[aria-label="Copy Password"]').trigger('click')
  await flushPromises()
  expect(credential).toHaveBeenLastCalledWith({ sessionId: 'grant', rowId: 'one', operation: 'copy' })
  expect(wrapper.emitted('feedback')?.at(-1)?.[0]).toBe('Copied')
  credential.mockResolvedValue({ value: 'synthetic-password' })
  await wrapper.get('[aria-label="Show Password"]').trigger('click')
  await flushPromises()
  await vi.advanceTimersByTimeAsync(30000)
  expect(wrapper.text()).not.toContain('synthetic-password')
  wrapper.unmount()
})

it('discards late password responses after a scope change or unmount', async () => {
  let resolve!: (value: { value: string }) => void
  const credential = vi.fn(() => new Promise<{ value: string }>((done) => {
    resolve = done
  }))
  window.craftHubDesktop = { resourceCredential: credential }
  const wrapper = mount(ResourceSecretCell, { props: { rowId: 'one', session: { sessionId: 'old', availableRowIds: ['one'] }, chinese: false } })
  await wrapper.get('[aria-label="Show Password"]').trigger('click')
  await wrapper.setProps({ session: { sessionId: 'new', availableRowIds: ['one'] } })
  resolve({ value: 'late-password' })
  await flushPromises()
  expect(wrapper.text()).not.toContain('late-password')
  await wrapper.get('[aria-label="Show Password"]').trigger('click')
  wrapper.unmount()
  resolve({ value: 'late-after-unmount' })
  await flushPromises()
  expect(wrapper.emitted('feedback')).toBeUndefined()
})
