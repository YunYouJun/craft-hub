// @vitest-environment happy-dom
import type { ConfigurationManagementPage } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { FormSelect } from './components/ui/select'
import ConfigurationRepositories from './ConfigurationRepositories.vue'
import { useI18n } from './i18n'

const registry: NonNullable<ConfigurationManagementPage['registry']> = {
  version: 1,
  revision: 'registry-revision',
  ownership: {},
  sources: [{ id: 'office', name: 'Office configuration', root: '/fixture/office', kind: 'overlay', audience: 'work', enabled: true }, { id: 'personal', name: 'Personal configuration', root: '/fixture/personal', kind: 'overlay', audience: 'personal', enabled: true }],
  targets: [{ id: 'future', name: 'Future backup', driver: 'workstation', audience: 'work', sourceIds: ['office'], directory: 'workstation', keyEnvironment: 'TEST_BACKUP_KEY' }],
}
beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
})
function render(value = registry, canManage = true) {
  return mount(ConfigurationRepositories, { props: { registry: value, busy: false, canManage, canBackup: true }, global: { plugins: [getActivePinia()!] } })
}

it('keeps reserved targets non-executable and changes one source using the registry revision', async () => {
  const wrapper = render()
  expect(wrapper.get('[data-target-id="future"]').text()).toContain('Reserved')
  expect(wrapper.findAll('button').some(button => button.text() === 'Preview encrypted backup')).toBe(false)
  await wrapper.get('[data-source-id="office"]').findAll('button').find(button => button.text() === 'Disable')!.trigger('click')
  expect(wrapper.emitted('request')![0]).toEqual(['repositories-update', { registry: { revision: 'registry-revision', action: 'save-source', source: { ...registry.sources[0], enabled: false } } }])
})

it('filters target sources by scope and submits only the passphrase variable name', async () => {
  const wrapper = render()
  await wrapper.findAll('button').find(button => button.text() === 'Add backup target')!.trigger('click')
  expect(wrapper.get('fieldset').text()).toContain('Personal configuration')
  expect(wrapper.get('fieldset').text()).not.toContain('Office configuration')
  wrapper.findAllComponents(FormSelect).find(select => select.props('ariaLabel') === 'Backup scope')!.vm.$emit('update:modelValue', 'work')
  await flushPromises()
  expect(wrapper.get('fieldset').text()).toContain('Office configuration')
  expect(wrapper.get('fieldset').text()).not.toContain('Personal configuration')
  expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  await wrapper.get('fieldset input').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('request')![0]).toEqual(['repositories-update', { registry: expect.objectContaining({ revision: 'registry-revision', action: 'save-target', target: expect.objectContaining({ audience: 'work', root: undefined, sourceIds: ['office'], keyEnvironment: 'WORKSTATION_BACKUP_PASSPHRASE' }) }) }])
})

it('requires an explicit replacement choice and sends backup work through preview', async () => {
  const wrapper = render({ ...registry, targets: [{ ...registry.targets[0], root: '/fixture/backups' }] })
  await wrapper.findAll('button').find(button => button.text() === 'Preview encrypted backup')!.trigger('click')
  expect(wrapper.emitted('request')![0]).toEqual(['backup-preview', { targetId: 'future', action: 'save', revision: 'registry-revision' }])
  await wrapper.get('.replace-choice input').setValue(true)
  await wrapper.findAll('button').find(button => button.text() === 'Preview encrypted backup')!.trigger('click')
  expect(wrapper.emitted('request')![1]).toEqual(['backup-preview', { targetId: 'future', action: 'save', revision: 'registry-revision', resolution: 'replace' }])
})

it('disables registration for unsupported backends and leaves external application backups with their owner', () => {
  const wrapper = render({ ...registry, targets: [{ ...registry.targets[0], root: '/fixture/backups', driver: 'external' }] }, false)
  expect(wrapper.findAll('button').find(button => button.text() === 'Add source')!.attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-target-id="future"]').text()).toContain('Managed by the original application')
  expect(wrapper.findAll('button').some(button => button.text().includes('Preview'))).toBe(false)
})
