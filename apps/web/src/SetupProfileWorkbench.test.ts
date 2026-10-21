// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { SetupProfile, SetupProfileInventory, SetupProfileReview, SetupProfileSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiRequestError } from './api'
import { useI18n } from './i18n'
import { machineReadiness } from './machine-readiness'
import SetupProfileWorkbench from './SetupProfileWorkbench.vue'
import { useMachineReadinessStore } from './store'

const software = { sourceId: 'fixture', softwareId: 'editor', title: { en: 'Editor' }, url: 'https://example.com/editor', installation: { kind: 'brew-cask' as const, packageId: 'example-editor' } }
const configuration = { integrationId: 'configuration', itemId: 'file:.zshrc', title: 'Shell configuration', kind: 'terminal' as const, origin: 'public' as const, sourceDigest: 'a'.repeat(64) }
const profile: SetupProfile = { version: 1, platform: 'darwin', name: 'Development Mac', software: [software], configurations: [configuration] }
const snapshot: SetupProfileSnapshot = { version: 1, revision: 'b'.repeat(64), profile }
const inventory: SetupProfileInventory = { software: [{ reference: software, status: 'detected', canInstall: true }], configurations: [{ reference: configuration, status: 'synced', href: '/integrations/configuration/environment' }], unavailableIntegrations: [] }
const review: SetupProfileReview = { snapshot, software: [{ reference: software, state: 'missing', canInstall: true }], configurations: [{ reference: configuration, state: 'review', href: '/integrations/configuration/environment' }] }
const wrappers: ReturnType<typeof mount>[] = []
let pinia = createPinia()
function render() {
  const wrapper = mount(SetupProfileWorkbench, { global: { plugins: [pinia], stubs: { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('en')
  vi.spyOn(api, 'runtimeHealth').mockResolvedValue({ status: 'ok', projectConfigSchemaRevision: 'current', distribution: { id: 'community', name: 'Craft Hub' }, hostEnvironment: { kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } } })
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
  it.each(['save', 'import'] as const)('expires the home readiness observation after a successful profile %s', async (operation) => {
    const readyReview: SetupProfileReview = {
      ...structuredClone(review),
      software: review.software.map(item => ({ ...item, state: 'ready' })),
      configurations: review.configurations.map(item => ({ ...item, state: 'ready' })),
    }
    vi.mocked(api.reviewSetupProfile).mockResolvedValueOnce(readyReview)
    const readiness = useMachineReadinessStore()
    await readiness.refresh()
    expect(machineReadiness(readiness).environmentReady).toBe(true)
    const wrapper = render()
    await flushPromises()
    const updated = { ...structuredClone(snapshot), revision: 'c'.repeat(64) }
    vi.mocked(api.saveSetupProfile).mockResolvedValueOnce(updated)
    vi.mocked(api.reviewSetupProfile).mockResolvedValue({ ...structuredClone(review), snapshot: updated })
    if (operation === 'import')
      await wrapper.get('textarea[aria-label="Environment profile to import"]').setValue(JSON.stringify(profile))
    await wrapper.get(`[data-testid="${operation}-setup-profile"]`).trigger('click')
    await flushPromises()

    expect(readiness.review?.snapshot.revision).toBe(snapshot.revision)
    expect(machineReadiness(readiness).environmentReady).toBe(false)
    expect(machineReadiness(readiness).previouslyReady).toBe(2)
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(1)
    await readiness.refresh()
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(2)
    expect(readiness.review?.snapshot.revision).toBe(updated.revision)
    expect(machineReadiness(readiness).environmentReady).toBe(false)
    expect(api.installSoftware).not.toHaveBeenCalled()
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
  })

  it.each(['save', 'import'] as const)('retains the cached home observation when profile %s fails', async (operation) => {
    const readiness = useMachineReadinessStore()
    await readiness.refresh()
    const wrapper = render()
    await flushPromises()
    vi.mocked(api.saveSetupProfile).mockRejectedValueOnce(new Error('Save failed'))
    if (operation === 'import')
      await wrapper.get('textarea[aria-label="Environment profile to import"]').setValue(JSON.stringify(profile))
    await wrapper.get(`[data-testid="${operation}-setup-profile"]`).trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Save failed')
    expect(readiness.setupFailed).toBe(false)
    expect(readiness.reviewFailed).toBe(false)
    await readiness.refresh()
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(1)
  })

  it('invalidates the home observation when a save succeeds after leaving the profile page', async () => {
    const readiness = useMachineReadinessStore()
    await readiness.refresh()
    const wrapper = render()
    await flushPromises()
    let resolveSave!: (value: SetupProfileSnapshot) => void
    vi.mocked(api.saveSetupProfile).mockReturnValueOnce(new Promise((resolve) => {
      resolveSave = resolve
    }))
    await wrapper.get('[data-testid="save-setup-profile"]').trigger('click')
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    wrapper.unmount()
    resolveSave(structuredClone(snapshot))
    await flushPromises()
    expect(readiness.setupFailed).toBe(true)
    expect(readiness.reviewFailed).toBe(true)
    await readiness.refresh()
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(2)
  })

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
