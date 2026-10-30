// @vitest-environment happy-dom
/// <reference lib="dom" />
import type { ResourcePage } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import ResourceCollection from './ResourceCollection.vue'

const clipboard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./clipboard', () => ({ copyText: clipboard }))
const page: ResourcePage = {
  kind: 'resource-page',
  title: 'Accounts',
  input: {},
  collection: {
    columns: [{ id: 'label', label: 'Name' }, { id: 'value', label: 'Value' }],
    rows: [{ id: 'one', cells: { label: 'First', value: '1000000001' }, copyValue: '1000000001', input: { recordId: 'one' } }],
    selectedIds: ['hidden'],
    selectionInput: 'selectedIds',
    filterFormId: 'filter',
    hiddenFormIds: ['filter'],
    hiddenDocumentIds: [],
  },
  forms: [{ id: 'filter', effect: 'read', title: 'Filter', input: {}, fields: [{ id: 'query', label: 'Search', type: 'text', value: '' }] }],
}
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('resource collection', () => {
  it('shows copyable rows and preserves hidden selections until explicitly cleared', async () => {
    useI18n().setLocale('en')
    const wrapper = mount(ResourceCollection, { props: { page } })
    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('1 outside this filter')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('input')?.[0]?.[0]).toEqual({ selection: 'custom', selectedIds: 'hidden,one' })
    await wrapper.get('button[aria-label="Copy Value"]').trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenCalledWith('1000000001')
    await wrapper.findAll('button').find(button => button.text() === 'Clear Selection')!.trigger('click')
    expect(wrapper.emitted('input')?.at(-1)?.[0]).toEqual({ selection: 'custom', selectedIds: '' })
    wrapper.unmount()
  })

  it('debounces filtering without treating it as a write', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ResourceCollection, { props: { page } })
    await wrapper.get('input[type="search"]').setValue('First')
    expect(wrapper.emitted('input')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.emitted('input')?.[0]?.[0]).toEqual({ query: 'First' })
    expect(wrapper.emitted('edit')).toBeUndefined()
    wrapper.unmount()
  })
})
