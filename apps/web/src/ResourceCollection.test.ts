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
  delete window.craftHubDesktop
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('resource collection', () => {
  it('opens native credentials from a declared context and refreshes after native account import', async () => {
    useI18n().setLocale('en')
    const open = vi.fn().mockResolvedValue({ sessionId: 'grant', availableRowIds: ['one'] })
    const close = vi.fn().mockResolvedValue(undefined)
    const credential = vi.fn()
    const importAccounts = vi.fn().mockResolvedValue({ imported: true })
    window.craftHubDesktop = { openResourceSession: open, closeResourceSession: close, resourceCredential: credential, importResourceAccounts: importAccounts }
    const context = { integrationId: 'example', viewId: 'overview', blockId: 'records', input: {} }
    const nativePage: ResourcePage = {
      ...page,
      browserImport: { id: 'accounts', title: 'Import Accounts', url: 'https://accounts.example.com/list', allowedOrigins: ['https://accounts.example.com'], formId: 'import', request: { path: '/accounts', operatorGlobal: 'user', operatorParameter: 'user' }, response: { recordsPath: ['accounts'], successField: 'code', successValue: 0 }, credentials: { keyField: 'username', secretField: 'password', availableField: 'status', publicFields: ['username', 'status'] } },
      collection: { ...page.collection!, rows: [{ ...page.collection!.rows[0]!, credentialKey: 'account-one' }] },
    }
    const wrapper = mount(ResourceCollection, { props: { page: nativePage, nativeContext: context }, attachTo: document.body })
    await flushPromises()
    expect(open).toHaveBeenCalledWith(context)
    expect(wrapper.text()).toContain('••••••••')
    expect(credential).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === 'Import Accounts')!.trigger('click')
    await flushPromises()
    expect(importAccounts).toHaveBeenCalledWith('grant')
    expect(wrapper.emitted('input')?.at(-1)?.[0]).toEqual({})
    wrapper.unmount()
    expect(close).toHaveBeenCalledWith('grant')
  })

  it('copies provider-formatted batches above the table and blocks empty or pending selections', async () => {
    useI18n().setLocale('en')
    const batchPage: ResourcePage = {
      ...page,
      collection: { ...page.collection!, copyDocumentIds: ['shown', 'selected'] },
      documents: [
        { id: 'shown', title: 'Copy Shown (2)', content: '1000000001,1000000002' },
        { id: 'selected', title: 'Copy Selected (0)', content: '' },
      ],
    }
    const wrapper = mount(ResourceCollection, { props: { page: batchPage }, attachTo: document.body })
    const shown = () => wrapper.findAll('button').find(button => button.text() === 'Copy Shown (2)')!
    const selected = () => wrapper.findAll('button').find(button => button.text().startsWith('Copy Selected'))!
    expect(selected().attributes('disabled')).toBeDefined()
    await shown().trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenLastCalledWith('1000000001,1000000002')
    expect(document.body.textContent).toContain('Copied')
    await wrapper.get('[role="checkbox"]').trigger('click')
    expect(shown().attributes('disabled')).toBeDefined()
    await wrapper.setProps({ page: { ...batchPage, documents: [batchPage.documents![0]!, { id: 'selected', title: 'Copy Selected (1)', content: '1000000001' }] } })
    await selected().trigger('click')
    await flushPromises()
    expect(clipboard).toHaveBeenLastCalledWith('1000000001')
    clipboard.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await shown().trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Copy failed')
    wrapper.unmount()
  })

  it('shows copyable rows and preserves hidden selections until explicitly cleared', async () => {
    useI18n().setLocale('en')
    const wrapper = mount(ResourceCollection, { props: { page }, attachTo: document.body })
    expect(wrapper.text()).toContain('First')
    expect(wrapper.text()).toContain('1 outside this filter')
    await wrapper.get('[role="checkbox"]').trigger('click')
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
    const batchPage: ResourcePage = { ...page, collection: { ...page.collection!, copyDocumentIds: ['shown'] }, documents: [{ id: 'shown', title: 'Copy Shown', content: '1000000001' }] }
    const wrapper = mount(ResourceCollection, { props: { page: batchPage }, attachTo: document.body })
    await wrapper.get('input[type="search"]').setValue('First')
    expect(wrapper.emitted('input')).toBeUndefined()
    await wrapper.setProps({ page: { ...batchPage } })
    expect(wrapper.findAll('button').find(button => button.text() === 'Copy Shown')!.attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.emitted('input')?.[0]?.[0]).toEqual({ query: 'First' })
    expect(wrapper.emitted('edit')).toBeUndefined()
    wrapper.unmount()
  })
})
