// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { ApplicationUninstallGuidance as Guidance } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import ApplicationUninstallGuidance from './ApplicationUninstallGuidance.vue'
import { useI18n } from './i18n'

afterEach(() => vi.restoreAllMocks())
const app = { id: 'a'.repeat(64), bundleId: 'com.example.editor', name: 'Editor', path: '/Applications/Editor.app' }
const other = { ...app, id: 'b'.repeat(64), path: '/Applications/Other/Editor.app' }
function guidance(id = app.id): Guidance {
  return { version: 1, application: { ...app, id }, candidates: [{ id: 'c'.repeat(64), name: 'Uninstall.tool', path: '/Applications/Editor.app/Contents/Uninstall.tool', verification: 'unverified', evidence: 'inside-application' }], documentation: [], searchUrl: 'https://www.google.com/search?q=Editor', incomplete: false }
}

it('shows evidence, distinguishes copies, and only reveals a candidate after a click', async () => {
  useI18n().locale.value = 'en'
  vi.spyOn(api, 'maintainedApplications').mockResolvedValue({ version: 1, supported: true, applications: [app, other], incomplete: false })
  const inspect = vi.spyOn(api, 'applicationUninstallGuidance').mockImplementation(async id => guidance(id))
  const reveal = vi.spyOn(api, 'revealMaintainedApplication').mockResolvedValue({ version: 1, destination: 'finder' })
  const wrapper = mount(ApplicationUninstallGuidance, { props: { bundleId: app.bundleId } })
  try {
    await flushPromises()
    expect(wrapper.findAll('option')).toHaveLength(2)
    expect(wrapper.text()).toContain('Unverified candidate')
    expect(wrapper.text()).toContain('has not supplied uninstall documentation')
    expect(reveal).not.toHaveBeenCalled()
    await wrapper.get('select').setValue(other.id)
    await flushPromises()
    expect(inspect).toHaveBeenLastCalledWith(other.id)
    const button = wrapper.findAll('button').find(button => button.text() === 'Show candidate in Finder')!
    await button.trigger('click')
    await flushPromises()
    expect(reveal).toHaveBeenCalledExactlyOnceWith(other.id, 'c'.repeat(64))
    expect(wrapper.text()).toContain('Requested reveal in Finder')
    expect(wrapper.findAll('a').every(link => link.attributes('href')?.startsWith('https://'))).toBe(true)
  }
  finally { wrapper.unmount() }
})

it('ignores stale guidance when the selected application changes', async () => {
  useI18n().locale.value = 'en'
  vi.spyOn(api, 'maintainedApplications').mockResolvedValue({ version: 1, supported: true, applications: [app, other], incomplete: false })
  let resolveFirst!: (value: Guidance) => void
  vi.spyOn(api, 'applicationUninstallGuidance').mockImplementation(id => id === app.id
    ? new Promise((resolve) => {
        resolveFirst = resolve
      })
    : Promise.resolve(guidance(other.id)))
  const wrapper = mount(ApplicationUninstallGuidance)
  try {
    await flushPromises()
    await wrapper.get('select').setValue(other.id)
    await flushPromises()
    const stale = guidance(app.id)
    stale.candidates[0]!.name = 'Wrong application candidate'
    resolveFirst(stale)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Wrong application candidate')
    expect(wrapper.text()).toContain('Uninstall.tool')
  }
  finally { wrapper.unmount() }
})

it('reports unsupported inspection without probing or revealing applications', async () => {
  useI18n().locale.value = 'en'
  vi.spyOn(api, 'maintainedApplications').mockResolvedValue({ version: 1, supported: false, applications: [], incomplete: false })
  const inspect = vi.spyOn(api, 'applicationUninstallGuidance')
  const wrapper = mount(ApplicationUninstallGuidance)
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('requires macOS')
    expect(inspect).not.toHaveBeenCalled()
    expect(wrapper.find('select').exists()).toBe(false)
  }
  finally { wrapper.unmount() }
})
