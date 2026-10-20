// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { EnvironmentSetupSnapshot, EnvironmentSetupStep, SetupProfile, SetupProfileReview } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import MachineReadiness from './MachineReadiness.vue'
import { machineReadinessReuseMs, useWorkbenchStore } from './store'

const revision = 'a'.repeat(64)
const step = (id: string, state: EnvironmentSetupStep['state'], dependsOn: string[] = [], title = id): EnvironmentSetupStep => ({ id, title: { en: title, zh: title }, description: { en: `${title} description` }, state, dependsOn, actions: [] })
const setup = (steps: EnvironmentSetupStep[]): EnvironmentSetupSnapshot => ({ version: 1, checkedAt: '2026-10-20T08:30:00.000Z', profileRevision: revision, platform: 'darwin', prerequisitesReady: steps.every(item => ['ready', 'not-required'].includes(item.state)), steps })
const software = (softwareId: string, title: string): SetupProfile['software'][number] => ({ sourceId: 'workstation', softwareId, title: { en: title }, url: `https://example.com/${softwareId}`, installation: { kind: 'brew-cask', name: softwareId } as SetupProfile['software'][number]['installation'] })
const configuration = (itemId: string, title: string): SetupProfile['configurations'][number] => ({ integrationId: 'workstation', itemId, title, kind: 'terminal', origin: 'public', sourceDigest: 'b'.repeat(64) })
const profile: SetupProfile = { version: 1, platform: 'darwin', name: 'Mine', software: [software('iterm2', 'iTerm2'), software('raycast', 'Raycast')], configurations: [configuration('zshrc', 'zshrc')] }
function review(states: { software: SetupProfileReview['software'][number]['state'][], configurations: SetupProfileReview['configurations'][number]['state'][] }, canInstall = false): SetupProfileReview {
  return {
    snapshot: { version: 1, revision, profile },
    software: profile.software.map((reference, index) => ({ reference, state: states.software[index], canInstall: canInstall && states.software[index] === 'missing' })),
    configurations: profile.configurations.map((reference, index) => ({ reference, state: states.configurations[index], href: '/integrations/workstation/configuration' })),
  }
}
const allReadySteps = [step('developer-tools', 'ready', [], 'Git'), step('homebrew', 'ready', ['developer-tools'], 'Homebrew'), step('workstation.node', 'not-required'), step('workstation.cli', 'ready', ['developer-tools'], 'Workstation'), step('workstation.sources', 'ready', ['workstation.cli'], 'Sources')]

const wrappers: ReturnType<typeof mount>[] = []
function render(props: { refreshKey?: number } = {}) {
  const target = (to: { path: string, query?: Record<string, string> }) => to.path + (to.query ? `?${new URLSearchParams(to.query)}` : '')
  const RouterLink = { props: ['to'], methods: { target }, template: '<a :data-to="target(to)"><slot /></a>' }
  const wrapper = mount(MachineReadiness, { props, global: { stubs: { RouterLink } } })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  vi.spyOn(api, 'environmentSetup').mockResolvedValue(setup(allReadySteps))
  vi.spyOn(api, 'reviewSetupProfile').mockResolvedValue(review({ software: ['ready', 'ready'], configurations: ['ready'] }))
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function leave() {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
}

describe('machine readiness home', () => {
  it('declares the environment ready only when every profile item is freshly verified', async () => {
    const wrapper = render()
    await flushPromises()
    const summary = wrapper.get('[data-testid="readiness-summary"]').text()
    expect(summary).toContain('Environment ready')
    expect(summary).toContain('7 / 7 ready')
    expect(wrapper.find('[data-testid="readiness-next"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="readiness-blockers"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="readiness-stage-runtime"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="difference-missing"]').text()).toContain('None')
  })

  it('shows one next step, its blocked dependents and profile differences without executing anything', async () => {
    vi.mocked(api.environmentSetup).mockResolvedValue(setup([
      step('developer-tools', 'ready', [], 'Git'),
      step('homebrew', 'action-required', ['developer-tools'], 'Homebrew'),
      step('workstation.node', 'blocked', ['homebrew'], 'Node.js'),
      step('workstation.cli', 'blocked', ['developer-tools', 'workstation.node'], 'Workstation'),
    ]))
    vi.mocked(api.reviewSetupProfile).mockResolvedValue(review({ software: ['missing', 'ready'], configurations: ['changed'] }, true))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('2 / 7 ready')
    expect(wrapper.text()).not.toContain('Environment ready')
    const next = wrapper.get('[data-testid="readiness-next"]')
    expect(next.text()).toContain('Homebrew')
    expect(next.get('a').attributes('data-to')).toBe('/environment/setup')
    expect(next.findAll('button')).toHaveLength(0)
    expect(wrapper.get('[data-testid="readiness-item-step:workstation.node"]').text()).toContain('Waiting for: Homebrew')
    const cli = wrapper.get('[data-testid="readiness-item-step:workstation.cli"]').text()
    expect(cli).toContain('Waiting for: Node.js')
    expect(cli).not.toContain('Waiting for: Git')
    expect(wrapper.get('[data-testid="readiness-item-step:homebrew"]').text()).not.toContain('Waiting for')
    expect(wrapper.get('[data-testid="difference-missing"]').text()).toContain('iTerm2')
    expect(wrapper.get('[data-testid="difference-review"]').text()).toContain('zshrc')
    expect(wrapper.text()).toContain('Versions are not compared yet')
  })

  it('points to Software center once prerequisites are ready and software is missing', async () => {
    vi.mocked(api.reviewSetupProfile).mockResolvedValue(review({ software: ['missing', 'missing'], configurations: ['ready'] }, true))
    const wrapper = render()
    await flushPromises()
    const next = wrapper.get('[data-testid="readiness-next"]')
    expect(next.text()).toContain('Review installing 2 missing software')
    expect(next.get('a').attributes('data-to')).toBe('/software?setup=1')
  })

  it('never counts unknown or unavailable observations as ready', async () => {
    vi.mocked(api.environmentSetup).mockResolvedValue(setup([...allReadySteps.slice(0, 4), step('workstation.sources', 'unknown', ['workstation.cli'], 'Sources')]))
    vi.mocked(api.reviewSetupProfile).mockResolvedValue(review({ software: ['unknown', 'unavailable'], configurations: ['ready'] }))
    const wrapper = render()
    await flushPromises()
    const summary = wrapper.get('[data-testid="readiness-summary"]').text()
    expect(summary).toContain('4 / 7 ready')
    expect(summary).not.toContain('Environment ready')
    expect(wrapper.get('[data-testid="readiness-item-step:workstation.sources"]').text()).toContain('Not confirmed')
    expect(wrapper.get('[data-testid="difference-unconfirmed"]').text()).toContain('iTerm2')
    expect(wrapper.get('[data-testid="difference-missing"]').text()).toContain('None')
    expect(wrapper.get('[data-testid="readiness-next"]').text()).toContain('Confirm unknown items')
  })

  it('keeps the previous result as unconfirmed when a recheck fails', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('Environment ready')
    vi.mocked(api.environmentSetup).mockRejectedValueOnce(new Error('Service offline'))
    await wrapper.get('[data-testid="refresh-machine-readiness"]').trigger('click')
    await flushPromises()
    const summary = wrapper.get('[data-testid="readiness-summary"]').text()
    expect(summary).toContain('Current state not confirmed')
    expect(summary).toContain('7 / 7 ready at the last check')
    expect(wrapper.text()).not.toContain('Environment ready')
    expect(wrapper.get('[data-testid="readiness-item-step:homebrew"]').text()).toContain('Unconfirmed')
    expect(wrapper.text()).toContain('Last checked')
    const next = wrapper.get('[data-testid="readiness-next"]')
    expect(next.text()).toContain('Check this machine again')
    await next.get('button').trigger('click')
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('Environment ready')
  })

  it('guides toward a local management plugin when Workstation is not installed', async () => {
    vi.mocked(api.environmentSetup).mockResolvedValue(setup([
      step('developer-tools', 'ready', [], 'Git'),
      step('homebrew', 'ready', ['developer-tools'], 'Homebrew'),
      step('management-plugin', 'action-required', [], 'Connect a local management plugin'),
    ]))
    vi.mocked(api.reviewSetupProfile).mockResolvedValue(review({ software: ['unknown', 'unknown'], configurations: ['unavailable'] }))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('2 / 6 ready')
    const next = wrapper.get('[data-testid="readiness-next"]')
    expect(next.text()).toContain('Connect a local management plugin')
    expect(next.get('a').attributes('data-to')).toBe('/environment/setup')
    expect(wrapper.get('[data-testid="difference-unconfirmed"]').text()).toContain('iTerm2, Raycast, zshrc')
    expect(wrapper.text()).not.toContain('Environment ready')
  })

  it('asks for a profile before comparing and stays read-only in hosted mode', async () => {
    vi.mocked(api.reviewSetupProfile).mockResolvedValue({ snapshot: { version: 1, revision, profile: null }, software: [], configurations: [] })
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('No environment profile yet')
    expect(wrapper.text()).not.toContain('Environment ready')
    expect(wrapper.get('[data-testid="readiness-next"]').text()).toContain('Save my environment profile')

    useWorkbenchStore().localEnvironmentAccess = 'hosted'
    vi.mocked(api.environmentSetup).mockClear()
    const hosted = render()
    await flushPromises()
    expect(api.environmentSetup).not.toHaveBeenCalled()
    expect(hosted.find('[data-testid="readiness-hosted"]').exists()).toBe(true)
  })
})

describe('machine readiness across home page visits', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T08:30:00.000Z'))
  })

  it('shows the last result at once and does not probe again within the reuse window', async () => {
    render()
    await flushPromises()
    leave()
    vi.setSystemTime(Date.now() + machineReadinessReuseMs - 1000)
    const wrapper = render()
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('Environment ready')
    expect(wrapper.text()).toContain('Checked')
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(1)
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(1)
  })

  it('shows the last result while a later visit rechecks in the background', async () => {
    render()
    await flushPromises()
    leave()
    vi.setSystemTime(Date.now() + machineReadinessReuseMs + 1000)
    let finish!: (value: EnvironmentSetupSnapshot) => void
    vi.mocked(api.environmentSetup).mockReturnValueOnce(new Promise(resolve => finish = resolve))
    vi.mocked(api.reviewSetupProfile).mockResolvedValueOnce(review({ software: ['missing', 'ready'], configurations: ['ready'] }))
    const wrapper = render()
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('Environment ready')
    expect(wrapper.text()).toContain('Last checked')
    expect(wrapper.get('[data-testid="refresh-machine-readiness"]').text()).toContain('Checking')
    finish(setup(allReadySteps))
    await flushPromises()
    expect(wrapper.get('[data-testid="readiness-summary"]').text()).toContain('6 / 7 ready')
    expect(wrapper.get('[data-testid="difference-missing"]').text()).toContain('iTerm2')
  })

  it('always rechecks on a manual request or a new refresh key', async () => {
    const wrapper = render({ refreshKey: 1 })
    await flushPromises()
    await wrapper.get('[data-testid="refresh-machine-readiness"]').trigger('click')
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(2)
    await wrapper.setProps({ refreshKey: 2 })
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(3)
    leave()
    render({ refreshKey: 2 })
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(3)
    leave()
    render({ refreshKey: 3 })
    await flushPromises()
    expect(api.environmentSetup).toHaveBeenCalledTimes(4)
  })

  it('keeps a failed recheck unconfirmed after leaving and returning', async () => {
    const wrapper = render()
    await flushPromises()
    vi.mocked(api.reviewSetupProfile).mockRejectedValueOnce(new Error('Service offline'))
    await wrapper.get('[data-testid="refresh-machine-readiness"]').trigger('click')
    await flushPromises()
    leave()
    const returned = render()
    await flushPromises()
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(2)
    const summary = returned.get('[data-testid="readiness-summary"]').text()
    expect(summary).toContain('Current state not confirmed')
    expect(summary).toContain('7 / 7 ready at the last check')
    expect(returned.text()).not.toContain('Environment ready')
    expect(returned.text()).toContain('Last checked')
    expect(returned.get('[data-testid="readiness-next"]').text()).toContain('Check this machine again')
  })
})
