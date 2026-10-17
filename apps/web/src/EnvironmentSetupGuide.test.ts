// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { EnvironmentSetupSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import EnvironmentSetupGuide from './EnvironmentSetupGuide.vue'
import { useI18n } from './i18n'

const revision = 'a'.repeat(64)
const initial: EnvironmentSetupSnapshot = {
  version: 1,
  checkedAt: '2026-10-16T00:00:00.000Z',
  platform: 'darwin',
  profileRevision: revision,
  prerequisitesReady: false,
  steps: [
    { id: 'homebrew', title: { en: 'Homebrew' }, description: { en: 'Install using the official instructions, then check again.' }, state: 'action-required', dependsOn: [], actions: [{ kind: 'copy', title: { en: 'Installer command' }, text: 'fixture-installer' }] },
    { id: 'workstation.cli', title: { en: 'Workstation' }, description: { en: 'Finish prerequisites first.' }, state: 'blocked', dependsOn: ['homebrew'], actions: [{ kind: 'copy', title: { en: 'Build command' }, text: 'fixture-build' }] },
  ],
}
const wrappers: ReturnType<typeof mount>[] = []
const writeText = vi.fn(async () => {})
function render() {
  const wrapper = mount(EnvironmentSetupGuide, { props: { profileRevision: revision }, global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  useI18n().setLocale('en')
  vi.spyOn(api, 'environmentSetup').mockResolvedValue(structuredClone(initial))
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  writeText.mockClear()
})

describe('target Mac setup guide', () => {
  it('copies instructions without completing a stage and enables continuation only after rechecking', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('Action needed')
    const buttons = wrapper.findAll('details button')
    expect(buttons[1].attributes('disabled')).toBeDefined()
    await buttons[0].trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('fixture-installer')
    expect(api.environmentSetup).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('Prerequisites verified.')
    expect(wrapper.text()).toContain('Command copied.')
    vi.mocked(api.environmentSetup).mockResolvedValue({ ...initial, prerequisitesReady: true, steps: initial.steps.map(step => ({ ...step, state: 'ready' })) })
    await wrapper.get('[data-testid="refresh-setup-guide"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Prerequisites verified.')
  })

  it('retains failed observations as unconfirmed and disables stale command copying', async () => {
    const wrapper = render()
    await flushPromises()
    vi.mocked(api.environmentSetup).mockRejectedValueOnce(new Error('Service offline'))
    await wrapper.get('[data-testid="refresh-setup-guide"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('current state is unconfirmed')
    expect(wrapper.findAll('details button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.text()).not.toContain('Prerequisites verified.')
  })

  it('ignores a late response from a previous profile', async () => {
    let release: (value: EnvironmentSetupSnapshot) => void = () => {}
    vi.mocked(api.environmentSetup).mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve
    }))
    const wrapper = render()
    const next = 'b'.repeat(64)
    vi.mocked(api.environmentSetup).mockResolvedValue({ ...initial, profileRevision: next, steps: [{ ...initial.steps[0], title: { en: 'New profile tools' } }] })
    await wrapper.setProps({ profileRevision: next })
    await flushPromises()
    release({ ...initial, steps: [{ ...initial.steps[0], title: { en: 'Old profile tools' } }] })
    await flushPromises()
    expect(wrapper.text()).toContain('New profile tools')
    expect(wrapper.text()).not.toContain('Old profile tools')
  })
})
