// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { SoftwareSource, SoftwareSourcePreview, SoftwareSourceSnapshot } from 'craft-hub'
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
const workstationSource: SoftwareSource = { ...source, id: 'b'.repeat(24), title: 'Workstation', repository: 'https://github.com/yunyoujun/workstation', localPath: undefined, mode: 'remote', cache: { ...source.cache, readFrom: 'remote' } }
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
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
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

  it('loads the public Workstation catalog and saves its association with one click', async () => {
    vi.mocked(api.previewSoftwareSource).mockResolvedValue({ ...preview, source: workstationSource, replaces: undefined })
    vi.mocked(api.applySoftwareSource).mockResolvedValue({ ...state, revision: 'saved', sources: [source, workstationSource] })
    await open()
    await click('load-workstation-source')
    expect(api.previewSoftwareSource).toHaveBeenCalledExactlyOnceWith({ repository: 'https://github.com/YunYouJun/workstation', mode: 'remote', branch: 'HEAD', catalogPath: 'software.config.ts' })
    expect(api.applySoftwareSource).toHaveBeenCalledExactlyOnceWith('preview-one')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.findAll('[data-repository-source]')).toHaveLength(2)
    expect(element('load-workstation-source').textContent).toContain('Refresh Workstation catalog')
    expect(document.querySelector('[data-testid="software-source-url"]')).toBeNull()
  })

  it('does not duplicate requests while the one-click catalog is being read or saved', async () => {
    let resolvePreview!: (value: SoftwareSourcePreview) => void
    let resolveSave!: (value: SoftwareSourceSnapshot) => void
    vi.mocked(api.previewSoftwareSource).mockReturnValue(new Promise((resolve) => {
      resolvePreview = resolve
    }))
    vi.mocked(api.applySoftwareSource).mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve
    }))
    await open()
    await click('load-workstation-source')
    await click('load-workstation-source')
    expect(element('load-workstation-source').disabled).toBe(true)
    expect(element('add-software-source').disabled).toBe(true)
    expect(api.previewSoftwareSource).toHaveBeenCalledTimes(1)
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
    resolvePreview({ ...preview, replaces: undefined })
    await flushPromises()
    await click('load-workstation-source')
    expect(api.applySoftwareSource).toHaveBeenCalledExactlyOnceWith('preview-one')
    expect(wrapper.emitted('changed')).toBeUndefined()
    resolveSave(state)
    await flushPromises()
    expect(element('load-workstation-source').disabled).toBe(false)
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('refreshes an existing Workstation binding without changing its local mode or branch', async () => {
    const linked: SoftwareSource = { ...workstationSource, localPath: '/workstation', mode: 'local', branch: 'next', cache: { ...source.cache } }
    vi.mocked(api.softwareSources).mockResolvedValue({ ...state, sources: [linked] })
    vi.mocked(api.refreshSoftwareSource).mockResolvedValue({ ...state, sources: [{ ...linked, error: 'unavailable' }] })
    await open()
    expect(element('load-workstation-source').textContent).toContain('Refresh Workstation catalog')
    await click('load-workstation-source')
    expect(api.refreshSoftwareSource).toHaveBeenCalledExactlyOnceWith(linked.id)
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('/workstation')
    expect(wrapper.text()).toContain('next')
    expect(wrapper.text()).toContain('Local working tree')
    expect(wrapper.text()).toContain('Last refresh failed')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('keeps hosted local bindings visible and disables the Workstation refresh shortcut', async () => {
    vi.mocked(api.softwareSources).mockResolvedValue({ ...state, localAvailable: false, sources: [{ ...workstationSource, mode: 'local' }] })
    await open()
    expect(element('load-workstation-source').disabled).toBe(true)
    await click('load-workstation-source')
    expect(api.refreshSoftwareSource).not.toHaveBeenCalled()
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
    expect(element('edit-software-source').disabled).toBe(false)
  })

  it('loads the default catalog separately from a custom Workstation catalog path', async () => {
    vi.mocked(api.softwareSources).mockResolvedValue({ ...state, sources: [{ ...workstationSource, catalogPath: 'custom.config.ts' }] })
    vi.mocked(api.previewSoftwareSource).mockResolvedValue({ ...preview, replaces: undefined })
    await open()
    expect(element('load-workstation-source').textContent).toContain('Load Workstation catalog')
    await click('load-workstation-source')
    expect(api.previewSoftwareSource).toHaveBeenCalledWith(expect.objectContaining({ catalogPath: 'software.config.ts' }))
    expect(api.refreshSoftwareSource).not.toHaveBeenCalled()
  })

  it.each(['preview', 'save'])('retains existing sources after a failed one-click %s and allows retry', async (stage) => {
    vi.mocked(api.previewSoftwareSource).mockResolvedValue({ ...preview, replaces: undefined })
    if (stage === 'preview')
      vi.mocked(api.previewSoftwareSource).mockRejectedValueOnce(new Error('Unavailable'))
    else
      vi.mocked(api.applySoftwareSource).mockRejectedValueOnce(new Error('Stale preview'))
    await open()
    await click('load-workstation-source')
    expect(wrapper.text()).toContain('Workstation catalog was not loaded')
    expect(wrapper.findAll('[data-repository-source]')).toHaveLength(1)
    expect(wrapper.text()).toContain('/repo')
    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(element('load-workstation-source').disabled).toBe(false)
    if (stage === 'preview')
      expect(api.applySoftwareSource).not.toHaveBeenCalled()
    await click('load-workstation-source')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('waits for saved bindings before offering a new Workstation association', async () => {
    let resolveSources!: (value: SoftwareSourceSnapshot) => void
    vi.mocked(api.softwareSources).mockReturnValue(new Promise((resolve) => {
      resolveSources = resolve
    }))
    await open()
    expect(element('load-workstation-source').disabled).toBe(true)
    await click('load-workstation-source')
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
    resolveSources({ ...state, sources: [workstationSource] })
    await flushPromises()
    await click('load-workstation-source')
    expect(api.refreshSoftwareSource).toHaveBeenCalledExactlyOnceWith(workstationSource.id)
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
  })

  it('requires a successful source reload after the initial read fails', async () => {
    vi.mocked(api.softwareSources).mockRejectedValueOnce(new Error('Unavailable'))
    vi.mocked(api.previewSoftwareSource).mockResolvedValue({ ...preview, replaces: undefined })
    await open()
    expect(wrapper.text()).toContain('Could not load repository sources')
    expect(element('load-workstation-source').disabled).toBe(true)
    await click('load-workstation-source')
    expect(api.previewSoftwareSource).not.toHaveBeenCalled()
    await click('reload-software-sources')
    expect(element('load-workstation-source').disabled).toBe(false)
    expect(wrapper.text()).not.toContain('Could not load repository sources')
    await click('load-workstation-source')
    expect(api.applySoftwareSource).toHaveBeenCalledExactlyOnceWith('preview-one')
  })

  it('does not replace a binding saved in another window after the initial source read', async () => {
    const linked: SoftwareSource = { ...workstationSource, localPath: '/workstation', mode: 'local', branch: 'next' }
    vi.mocked(api.previewSoftwareSource).mockResolvedValue({ ...preview, source: workstationSource, replaces: linked.id })
    await open()
    await click('load-workstation-source')
    expect(wrapper.text()).toContain('The source list changed')
    expect(wrapper.findAll('[data-repository-source]')).toHaveLength(1)
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeUndefined()
    vi.mocked(api.softwareSources).mockResolvedValue({ ...state, sources: [source, linked] })
    vi.mocked(api.refreshSoftwareSource).mockResolvedValue({ ...state, sources: [source, linked] })
    await click('reload-software-sources')
    await click('load-workstation-source')
    expect(api.refreshSoftwareSource).toHaveBeenCalledExactlyOnceWith(linked.id)
    expect(wrapper.text()).toContain('/workstation')
    expect(wrapper.text()).toContain('next')
    expect(api.applySoftwareSource).not.toHaveBeenCalled()
  })
})
