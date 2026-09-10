// @vitest-environment happy-dom
/// <reference lib="dom" />
import type { ConfigurationManagementPage, ResolvedIntegrationContribution } from 'craft-hub'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { FormSelect } from './components/ui/select'
import ConfigurationManager from './ConfigurationManager.vue'
import { useI18n } from './i18n'

enableAutoUnmount(afterEach)

const contribution: ResolvedIntegrationContribution = { id: 'test', pluginId: 'test', source: 'host:test', provider: { id: 'test', requires: '^1.0.0' }, providerVersion: '1.0.0', views: [], actions: [
  { id: 'read', title: 'Read', operation: 'configuration.read', effect: 'local-read', confirmation: 'never', effectiveConfirmation: 'never' },
  { id: 'update', title: 'Update', operation: 'configuration.update', effect: 'local-write', confirmation: 'always', effectiveConfirmation: 'always' },
] }
const page: ConfigurationManagementPage = { configuration: true, items: [{ id: 'a', title: 'Sample', kind: 'mcp', owner: 'user', origin: 'private', localPath: '/fixture/home/config', sourcePath: '/fixture/repo/config', status: 'first-adoption', revision: 'revision', local: 'local display', source: 'source display', fields: ['enabled'] }] }
beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  vi.restoreAllMocks()
})

it('requires explicit choices and sends an immutable revision to preview', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ ...page, preview: { planId: 'plan', changes: [] } })
  const wrapper = mount(ConfigurationManager, { props: { page, contribution } })
  expect(wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.attributes('disabled')).toBeDefined()
  wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!.vm.$emit('update:modelValue', 'source')
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'update', { operation: 'preview', decisions: [{ id: 'a', revision: 'revision', choice: 'source', fields: {} }] }, undefined, true)
  expect(wrapper.emitted('updated')).toHaveLength(1)
})

it('shows failures with recovery refresh and does not erase a reviewed preview', async () => {
  vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('Configuration changed'))
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'plan', changes: [{ path: '/fixture/home/config', direction: 'to-local', before: 'old', after: 'new', deletion: false }] } }, contribution } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.findAll('button').find(button => button.text() === 'Apply reviewed plan')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('.ui-alert--danger').text()).toContain('Configuration changed')
  expect(body.get('[aria-label="Change preview"]').text()).toContain('/fixture/home/config')
  expect(wrapper.get('.ui-alert--danger').text()).toContain('Refresh and inspect recovery')
})

it('preserves decisions across filters and requires every merge field', async () => {
  const wrapper = mount(ConfigurationManager, { props: { page, contribution } })
  const decision = () => wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Decision Sample')!
  decision().vm.$emit('update:modelValue', 'merge')
  await flushPromises()
  const preview = () => wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!
  expect(preview().attributes('disabled')).toBeDefined()
  wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Merge field enabled')!.vm.$emit('update:modelValue', 'local')
  await flushPromises()
  expect(preview().attributes('disabled')).toBeUndefined()
  await wrapper.get('input[type="search"]').setValue('nothing')
  expect(wrapper.text()).toContain('No matching configuration')
  expect(preview().text()).toContain('(1)')
  await wrapper.get('input[type="search"]').setValue('')
  expect(decision().props('modelValue')).toBe('merge')
})

it('keeps a prepared plan when closing the preview dialog', async () => {
  const invoke = vi.spyOn(api, 'invokeIntegrationAction')
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'plan', changes: [] } }, contribution } })
  await flushPromises()
  const body = new DOMWrapper(document.body)
  await body.get('[aria-label="Close preview"]').trigger('click')
  await flushPromises()
  expect(invoke).not.toHaveBeenCalled()
  await wrapper.findAll('button').find(button => button.text() === 'Review prepared plan')!.trigger('click')
  await flushPromises()
  expect(body.get('[aria-label="Change preview"]').text()).toContain('No file changes')
})

it('does not offer resolution controls for installer-owned items', () => {
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, items: [{ ...page.items[0], status: 'read-only', owner: 'installer', management: 'Use the installer' }] }, contribution } })
  expect(wrapper.text()).toContain('Use the installer')
  expect(wrapper.findAllComponents(FormSelect).some(select => select.props('ariaLabel')?.startsWith('Decision'))).toBe(false)
})
