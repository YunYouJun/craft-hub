// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { SetupProfile, SetupProfileInventory, SetupProfileReview, SetupProfileSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './api'
import { useI18n } from './i18n'
import SetupProfileWorkbench from './SetupProfileWorkbench.vue'

const software = { sourceId: 'fixture', softwareId: 'editor', title: { en: 'Editor' }, url: 'https://example.com/editor', installation: { kind: 'brew-cask' as const, packageId: 'example-editor' } }
const configuration = { integrationId: 'configuration', itemId: 'file:.zshrc', title: 'Shell configuration', kind: 'terminal' as const, origin: 'public' as const, sourceDigest: 'a'.repeat(64) }
const profile: SetupProfile = { version: 1, platform: 'darwin', name: 'Development Mac', software: [software], configurations: [configuration] }
const snapshot: SetupProfileSnapshot = { version: 1, revision: 'b'.repeat(64), profile }
const inventory: SetupProfileInventory = { software: [{ reference: software, status: 'detected', canInstall: true }], configurations: [{ reference: configuration, status: 'synced', href: '/integrations/configuration/environment' }], unavailableIntegrations: [] }
const review: SetupProfileReview = { snapshot, software: [{ reference: software, state: 'missing', canInstall: true }], configurations: [{ reference: configuration, state: 'review', href: '/integrations/configuration/environment' }] }
const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const wrapper = mount(SetupProfileWorkbench, { global: { stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'setupProfile').mockResolvedValue(structuredClone(snapshot))
  vi.spyOn(api, 'setupProfileInventory').mockResolvedValue(structuredClone(inventory))
  vi.spyOn(api, 'environmentSetup').mockResolvedValue({ version: 1, checkedAt: '2026-10-16T00:00:00.000Z', profileRevision: snapshot.revision, platform: 'darwin', steps: [], prerequisitesReady: false })
  vi.spyOn(api, 'saveSetupProfile').mockResolvedValue(structuredClone(snapshot))
  vi.spyOn(api, 'reviewSetupProfile').mockResolvedValue(structuredClone(review))
  vi.spyOn(api, 'installSoftware')
  vi.spyOn(api, 'invokeIntegrationAction')
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
})

describe('environment profile workbench', () => {
  it('saves explicit selections and displays a portable export without starting provider writes', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('textarea[readonly]').element.value).toContain('Development Mac')
    await wrapper.get('[data-testid="save-setup-profile"]').trigger('click')
    await flushPromises()
    expect(api.saveSetupProfile).toHaveBeenCalledExactlyOnceWith({ operation: 'save', revision: snapshot.revision, name: profile.name, software: [{ sourceId: 'fixture', softwareId: 'editor' }], configurations: [{ integrationId: 'configuration', itemId: 'file:.zshrc' }] })
    expect(api.installSoftware).not.toHaveBeenCalled()
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
  })

  it('imports only on save and checks target readiness before offering existing review workflows', async () => {
    const wrapper = render()
    await flushPromises()
    await wrapper.get('textarea[aria-label="Environment profile to import"]').setValue(JSON.stringify(profile))
    expect(api.saveSetupProfile).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="import-setup-profile"]').trigger('click')
    await flushPromises()
    expect(api.saveSetupProfile).toHaveBeenCalledWith({ operation: 'import', revision: snapshot.revision, profile })
    expect(api.reviewSetupProfile).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="check-setup-profile"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('0 / 2 ready')
    expect(wrapper.text()).toContain('Not detected')
    expect(wrapper.text()).toContain('Review configuration')
    expect(wrapper.findAll('a').some(link => link.attributes('data-to')?.includes('setupItem'))).toBe(true)
    expect(wrapper.findAll('a').some(link => link.attributes('data-to')?.includes('"scope":"global"'))).toBe(true)
    expect(api.installSoftware).not.toHaveBeenCalled()
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
  })

  it('keeps the last saved profile on invalid imports and does not claim readiness after failed checks', async () => {
    const wrapper = render()
    await flushPromises()
    await wrapper.get('textarea[aria-label="Environment profile to import"]').setValue('{invalid')
    await wrapper.get('[data-testid="import-setup-profile"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.get<HTMLTextAreaElement>('textarea[readonly]').element.value).toContain('Development Mac')
    expect(api.saveSetupProfile).not.toHaveBeenCalled()
    vi.mocked(api.reviewSetupProfile).mockRejectedValueOnce(new Error('Source offline'))
    await wrapper.get('[data-testid="check-setup-profile"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Source offline')
    expect(wrapper.text()).not.toContain('2 / 2 ready')
  })

  it('withholds local profile operations on hosted workbenches', async () => {
    vi.mocked(api.setupProfile).mockRejectedValueOnce(new ApiRequestError('Local only', 403))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('Open Craft Hub locally')
    expect(wrapper.find('[data-testid="save-setup-profile"]').exists()).toBe(false)
  })
})
