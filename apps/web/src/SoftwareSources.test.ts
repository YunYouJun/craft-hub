// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { SoftwareSourcePreview, SoftwareSourceSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import SoftwareSources from './SoftwareSources.vue'
import { useWorkbenchStore } from './store'

const source = {
  id: 'a'.repeat(24),
  repository: 'https://github.com/example/catalog',
  localPath: '/repo',
  mode: 'local' as const,
  title: 'Example catalog',
  branch: 'HEAD',
  catalogPath: 'software.config.ts',
  checkedAt: '2026-10-13T00:00:00.000Z',
  cache: { revision: 'a'.repeat(64), itemCount: 1, readFrom: 'local' as const, savedAt: '2026-10-13T00:00:00.000Z' },
}
const state: SoftwareSourceSnapshot = { version: 1, revision: 'initial', sources: [source], localAvailable: true }
const preview: SoftwareSourcePreview = {
  previewId: 'preview-one',
  source,
  replaces: source.id,
  catalog: { version: 1, revision: source.cache.revision, source: { id: 'example', title: source.title, url: source.repository }, items: [{ id: 'editor', title: { en: 'Editor' }, group: { id: 'coding', title: { en: 'Coding' } }, url: 'https://example.com/editor', installation: { kind: 'download' } }] },
}
let wrapper: VueWrapper
function element(id: string): HTMLInputElement {
  const result = document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)
  if (!result)
    throw new Error(`Missing ${id}`)
  return result
}
async function change(id: string, value: string): Promise<void> {
  const field = element(id)
  field.value = value
  field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  await flushPromises()
}
async function click(id: string): Promise<void> {
  element(id).click()
  await flushPromises()
}
beforeEach(() => {
  document.body.innerHTML = ''
  setActivePinia(createPinia())
  useI18n().setLocale('en')
  vi.spyOn(api, 'softwareSources').mockResolvedValue(structuredClone(state))
  vi.spyOn(api, 'previewSoftwareSource').mockResolvedValue(structuredClone(preview))
  vi.spyOn(api, 'applySoftwareSource').mockResolvedValue({ ...state, revision: 'saved' })
  vi.spyOn(api, 'refreshSoftwareSource').mockResolvedValue({ ...state, sources: [{ ...source, error: 'unavailable' }] })
  vi.spyOn(api, 'removeSoftwareSource').mockResolvedValue({ ...state, revision: 'removed', sources: [] })
})
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
async function open(): Promise<void> {
  wrapper = mount(SoftwareSources, { attachTo: document.body })
  await flushPromises()
}

describe('software repository source controls', () => {
  it('shows linked locations and cached provenance without automatically refreshing', async () => {
    await open()
    expect(wrapper.text()).toContain('Local and online linked')
    expect(wrapper.text()).toContain('Local working tree')
    expect(wrapper.text()).toContain('/repo')
    expect(api.refreshSoftwareSource).not.toHaveBeenCalled()
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
  })

  it('reuses an existing local project and saves only the reviewed preview token', async () => {
    useWorkbenchStore().projects = [{ id: 'project', name: 'Catalog', path: '/repo', trust: 'untrusted', addedAt: '2026-10-13T00:00:00.000Z' }]
    await open()
    await click('add-software-source')
    expect(element('apply-software-source').disabled).toBe(true)
    await change('software-source-project', '/repo')
    expect(element('software-source-mode').value).toBe('local')
    await click('preview-software-source')
    expect(api.previewSoftwareSource).toHaveBeenCalledWith(expect.objectContaining({ mode: 'local', localPath: '/repo', repository: undefined }))
    expect(document.body.textContent).toContain('Saving updates the existing source')
    await click('apply-software-source')
    expect(api.applySoftwareSource).toHaveBeenCalledExactlyOnceWith('preview-one')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.findAll('[data-repository-source]')).toHaveLength(1)
  })

  it('can switch a linked source to online reading and invalidates the preview after edits', async () => {
    await open()
    await click('edit-software-source')
    await change('software-source-mode', 'remote')
    await click('preview-software-source')
    expect(api.previewSoftwareSource).toHaveBeenCalledWith(expect.objectContaining({ id: source.id, repository: source.repository, localPath: '/repo', mode: 'remote' }))
    expect(element('apply-software-source').disabled).toBe(false)
    await change('software-source-branch', 'next')
    expect(element('apply-software-source').disabled).toBe(true)
    expect(document.querySelector('[data-testid="software-source-preview"]')).toBeNull()
  })

  it('keeps the saved catalog visible after a failed refresh and requires an explicit removal action', async () => {
    await open()
    await click('refresh-software-source')
    expect(wrapper.text()).toContain('Last refresh failed')
    expect(wrapper.text()).toContain('1 applications')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    await click('remove-software-source')
    expect(api.removeSoftwareSource).not.toHaveBeenCalled()
    await click('confirm-remove-software-source')
    expect(api.removeSoftwareSource).toHaveBeenCalledExactlyOnceWith(source.id, 'initial')
    expect(wrapper.findAll('[data-repository-source]')).toHaveLength(0)
  })

  it('hides local fields on hosted workbenches and keeps failed previews unsaved', async () => {
    vi.mocked(api.softwareSources).mockResolvedValue({ ...state, sources: [], localAvailable: false })
    vi.mocked(api.previewSoftwareSource).mockRejectedValue(new Error('Unavailable'))
    await open()
    await click('add-software-source')
    expect(document.querySelector('[data-testid="software-source-path"]')).toBeNull()
    await click('workstation-source-preset')
    await click('preview-software-source')
    expect(api.previewSoftwareSource).toHaveBeenCalledWith(expect.objectContaining({ mode: 'remote', localPath: undefined }))
    expect(document.body.textContent).toContain('exported softwareGroups literal array')
    expect(element('apply-software-source').disabled).toBe(true)
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
  })
})
