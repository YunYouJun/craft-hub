// @vitest-environment happy-dom
/// <reference lib="dom" />
import type { ResolvedIntegrationContribution, ResourcePage } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import { withIntegrationMutation } from './integration-mutations'
import IntegrationActionForm from './IntegrationActionForm.vue'
import IntegrationResourceBrowser from './IntegrationResourceBrowser.vue'

const contribution: ResolvedIntegrationContribution = {
  id: 'example',
  pluginId: 'example',
  source: 'host:example',
  provider: { id: 'example', requires: '^1.0.0' },
  providerVersion: '1.0.0',
  views: [],
  actions: [
    { id: 'read', title: 'Read', operation: 'resources.read', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' },
    { id: 'write', title: 'Write', operation: 'resources.update', effect: 'local-write', confirmation: 'always', effectiveConfirmation: 'always' },
  ],
}
const page: ResourcePage = {
  kind: 'resource-page',
  title: 'Project documents',
  input: { resource: 'documents' },
  documents: [{ id: 'one', title: 'Existing content', content: '# Existing text', filename: 'prompt.md', compareWith: '# Previous text' }],
  forms: [{ id: 'edit', title: 'Edit template', effect: 'update', input: { resource: 'documents', revision: 'old' }, fields: [{ id: 'content', label: 'Content', type: 'textarea', value: '# Existing text' }] }],
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.craftHubDesktop
  document.body.innerHTML = ''
})

describe('native resource browser', () => {
  it('loads documents without writing and resets an editor only after an explicit successful update', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
    const wrapper = mount(IntegrationResourceBrowser, { props: { contribution, integrationId: 'example', projectId: 'project', input: { resource: 'documents' } }, global: { plugins: [pinia] } })
    await flushPromises()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('example', 'read', { resource: 'documents' }, 'project')
    expect(wrapper.text()).toContain('Previous text')
    await wrapper.get('textarea').setValue('My unsaved draft')
    expect(wrapper.get('textarea').element.value).toBe('My unsaved draft')
    wrapper.getComponent(IntegrationActionForm).vm.$emit('completed', { ...page, forms: [{ ...page.forms![0], input: { revision: 'new' }, fields: [{ id: 'content', label: 'Content', type: 'textarea', value: 'Saved and normalized' }] }] })
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('Saved and normalized')
    wrapper.unmount()
  })

  it('keeps the current document available when a refresh fails', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Offline'))
    const wrapper = mount(IntegrationResourceBrowser, { props: { contribution, integrationId: 'example' }, global: { plugins: [pinia] } })
    await flushPromises()
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Offline')
    expect(wrapper.text()).toContain('Existing text')
    expect(invoke).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})

it.each([false, true])('uses shared transient copy feedback, including clipboard failure=%s', async (fail) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('en')
  vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const copyText = fail ? vi.fn().mockRejectedValue(new Error('clipboard unavailable')) : vi.fn().mockResolvedValue(undefined)
  window.craftHubDesktop = { copyText }
  const wrapper = mount(IntegrationResourceBrowser, { props: { contribution, integrationId: 'example' }, global: { plugins: [pinia] }, attachTo: document.body })
  try {
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Copy')!.trigger('click')
    await flushPromises()
    expect(copyText).toHaveBeenCalledWith('# Existing text')
    const toast = wrapper.get('.ui-action-toast')
    expect(toast.text()).toBe(fail ? 'Could not copy. Try again.' : 'Copied')
    expect(toast.text()).not.toContain('# Existing text')
  }
  finally { wrapper.unmount() }
})

it.each([true, false])('uses the native save panel and reports only completed exports (saved=%s)', async (saved) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('en')
  vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue(page)
  const saveTextFile = vi.fn().mockResolvedValue({ saved })
  window.craftHubDesktop = { saveTextFile }
  const wrapper = mount(IntegrationResourceBrowser, { props: { contribution, integrationId: 'example' }, global: { plugins: [pinia] }, attachTo: document.body })
  try {
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Download')!.trigger('click')
    await flushPromises()
    expect(saveTextFile).toHaveBeenCalledExactlyOnceWith({ filename: 'prompt.md', content: '# Existing text' })
    expect(wrapper.find('.ui-action-toast').exists()).toBe(saved)
    if (saved)
      expect(wrapper.get('.ui-action-toast').text()).toBe('Document saved')
  }
  finally { wrapper.unmount() }
})

it('keeps background progress polling alive while another confirmed operation protects navigation', async () => {
  vi.useFakeTimers()
  const pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('en')
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ ...page, refreshAfterMs: 1500 })
  const wrapper = mount(IntegrationResourceBrowser, { props: { contribution, integrationId: 'example' }, global: { plugins: [pinia] } })
  let release!: () => void
  let mutation: Promise<void> | undefined
  try {
    await flushPromises()
    mutation = withIntegrationMutation(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await flushPromises()
    expect(wrapper.findAll('button').find(button => button.text() === 'Refresh')!.attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(1600)
    await flushPromises()
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenLastCalledWith('example', 'read', page.input, undefined)
  }
  finally {
    release?.()
    await mutation
    wrapper.unmount()
    vi.useRealTimers()
  }
})
