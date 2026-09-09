// @vitest-environment happy-dom
/// <reference lib="dom" />
import type { ConfigurationManagementPage, ResolvedIntegrationContribution } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import ConfigurationManager from './ConfigurationManager.vue'
import { useI18n } from './i18n'

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
  await wrapper.get('[aria-label="Decision Sample"]').setValue('source')
  await wrapper.findAll('button').find(button => button.text().includes('Preview selected'))!.trigger('click')
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('test', 'update', { operation: 'preview', decisions: [{ id: 'a', revision: 'revision', choice: 'source', fields: {} }] }, undefined, true)
  expect(wrapper.emitted('updated')).toHaveLength(1)
})

it('shows failures with recovery refresh and does not erase a reviewed preview', async () => {
  vi.spyOn(api, 'invokeIntegrationAction').mockRejectedValue(new Error('Configuration changed'))
  const wrapper = mount(ConfigurationManager, { props: { page: { ...page, preview: { planId: 'plan', changes: [{ path: '/fixture/home/config', direction: 'to-local', before: 'old', after: 'new', deletion: false }] } }, contribution } })
  await wrapper.findAll('button').find(button => button.text() === 'Apply reviewed plan')!.trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('Configuration changed')
  expect(wrapper.get('[aria-label="Change preview"]').text()).toContain('/fixture/home/config')
  expect(wrapper.get('[role="alert"]').text()).toContain('Refresh and inspect recovery')
})
