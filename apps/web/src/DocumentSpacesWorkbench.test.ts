// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { DocumentNode, DocumentRecord, DocumentSpace } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { emitDocumentSpaceChange } from './document-space-events'
import DocumentSpacesWorkbench from './DocumentSpacesWorkbench.vue'
import { useI18n } from './i18n'

vi.mock('./FileDiffPreview.vue', () => ({
  default: {
    props: ['before', 'after', 'beforeLabel', 'afterLabel'],
    template: '<div data-testid="mock-file-diff">{{ beforeLabel }} | {{ afterLabel }}</div>',
  },
}))

const sampleSpace: DocumentSpace = {
  id: 'notes-1234',
  title: 'Notes',
  rootPath: '/Users/demo/Notes',
  providerId: 'local',
  kind: 'local',
  capabilities: {
    create: true,
    write: true,
    delete: true,
    move: true,
    snapshot: false,
    resolveAsset: true,
  },
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const markdown = overrides.markdown ?? '# Idea Board\n\nInitial draft body.'
  const frontmatter = overrides.frontmatter ?? { title: 'Idea Board', status: 'draft', tags: ['video'] }
  const rawContent = overrides.rawContent ?? `---\ntitle: Idea Board\nstatus: draft\ntags:\n  - video\n---\n\n${markdown}`
  return {
    spaceId: sampleSpace.id,
    path: 'idea.md',
    title: 'Idea Board',
    frontmatter,
    markdown,
    rawContent,
    revision: 'rev-1',
    updatedAt: '2026-11-27T00:00:00.000Z',
    cards: [],
    breadcrumbs: [{ path: 'idea.md', title: 'Idea Board' }],
    ...overrides,
  }
}

const sampleNodes: DocumentNode[] = [
  {
    path: 'idea.md',
    name: 'idea.md',
    title: 'Idea Board',
    kind: 'document',
    summary: 'Initial draft body.',
    status: 'draft',
    tags: ['video'],
    updatedAt: '2026-11-27T00:00:00.000Z',
  },
  {
    path: 'launch',
    name: 'launch',
    title: 'Launch Bundle',
    kind: 'bundle',
    primaryDocumentPath: 'launch/index.md',
    childCount: 1,
    summary: 'Release campaign folder',
    updatedAt: '2026-11-27T00:00:00.000Z',
  },
]

describe('documentSpacesWorkbench', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    document.body.innerHTML = ''
    delete window.craftHubDesktop
    pinia = createPinia()
    setActivePinia(pinia)
    useI18n().setLocale('en')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows empty onboarding and registers a local folder', async () => {
    const spacesMock = vi.spyOn(api, 'documentSpaces')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([sampleSpace])
    const registerMock = vi.spyOn(api, 'registerLocalDocumentSpace').mockResolvedValue(sampleSpace)
    vi.spyOn(api, 'documentSpaceNodes').mockResolvedValue(sampleNodes)

    const wrapper = mount(DocumentSpacesWorkbench, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.get('[data-testid="spaces-empty-state"]').text()).toContain('Local-first Document Spaces')
    await wrapper.get('[data-testid="empty-add-space-button"]').trigger('click')

    const pathInput = document.body.querySelector<HTMLInputElement>('input[name="space-path"]')!
    pathInput.value = '/Users/demo/Notes'
    pathInput.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="add-local-space-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(registerMock).toHaveBeenCalledWith({ path: '/Users/demo/Notes' })
    expect(spacesMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="collection-view"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="collection-node-idea.md"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('switches grid/list layout, opens a document, edits in raw Markdown, and saves', async () => {
    vi.spyOn(api, 'documentSpaces').mockResolvedValue([sampleSpace])
    vi.spyOn(api, 'documentSpaceNodes').mockResolvedValue(sampleNodes)
    const initialDoc = makeDoc()
    vi.spyOn(api, 'readDocument').mockResolvedValue(initialDoc)
    const writeMock = vi.spyOn(api, 'writeDocument').mockResolvedValue({
      status: 'saved',
      document: makeDoc({
        title: 'Updated Idea',
        frontmatter: { title: 'Updated Idea', status: 'draft', tags: ['video'] },
        markdown: '# Updated Idea\n\nEdited markdown body.',
        revision: 'rev-2',
      }),
    })

    const wrapper = mount(DocumentSpacesWorkbench, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()

    expect(wrapper.find('.spaces-card-grid').exists()).toBe(true)
    await wrapper.get('[data-testid="collection-view-list"]').trigger('click')
    expect(wrapper.find('.spaces-card-list').exists()).toBe(true)

    await wrapper.get('[data-testid="collection-node-idea.md"]').trigger('click')
    await flushPromises()

    expect(wrapper.get<HTMLInputElement>('[data-testid="document-title-input"]').element.value).toBe('Idea Board')

    await wrapper.get('[data-testid="mode-markdown"]').trigger('click')
    const textarea = wrapper.get<HTMLTextAreaElement>('[data-testid="raw-markdown-textarea"]')
    await textarea.setValue('---\ntitle: Updated Idea\nstatus: draft\ntags:\n  - video\n---\n\n# Updated Idea\n\nEdited markdown body.')
    await wrapper.get('[data-testid="save-document-button"]').trigger('click')
    await flushPromises()

    expect(writeMock).toHaveBeenCalledWith(sampleSpace.id, {
      path: 'idea.md',
      markdown: '# Updated Idea\n\nEdited markdown body.',
      frontmatter: { title: 'Updated Idea', status: 'draft', tags: ['video'] },
      expectedRevision: 'rev-1',
    })
    expect(wrapper.get('[data-testid="editor-save-status"]').text()).toBe('Saved')
    wrapper.unmount()
  })

  it('opens daily notes, toggles focus mode, and copies AI/Paseo handoff context', async () => {
    vi.spyOn(api, 'documentSpaces').mockResolvedValue([sampleSpace])
    vi.spyOn(api, 'documentSpaceNodes').mockResolvedValue(sampleNodes)
    const dailyDoc = makeDoc({
      path: 'daily/2026-11-27.md',
      title: '2026-11-27',
      folderPath: 'daily',
      markdown: '# 2026-11-27\n\nDaily plan.',
      breadcrumbs: [{ path: 'daily', title: 'daily' }, { path: 'daily/2026-11-27.md', title: '2026-11-27' }],
    })
    const dailySpy = vi.spyOn(api, 'openDailyNote').mockResolvedValue(dailyDoc)
    vi.spyOn(api, 'readDocument').mockResolvedValue(dailyDoc)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const wrapper = mount(DocumentSpacesWorkbench, { attachTo: document.body, global: { plugins: [pinia] } })
    await flushPromises()

    await wrapper.get('[data-testid="daily-note-button"]').trigger('click')
    await flushPromises()
    expect(dailySpy).toHaveBeenCalledWith(sampleSpace.id)
    expect(wrapper.get('[data-testid="document-title-input"]').element).toBeDefined()

    await wrapper.get('[data-testid="toggle-focus-mode"]').trigger('click')
    expect(wrapper.emitted('update:focusMode')).toEqual([[true]])

    await wrapper.get('[data-testid="copy-ai-handoff"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Document: daily/2026-11-27.md'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Revision: rev-1'))
    wrapper.unmount()
  })

  it('hot-reloads clean documents on SSE change and shows conflict banner when dirty', async () => {
    vi.spyOn(api, 'documentSpaces').mockResolvedValue([sampleSpace])
    vi.spyOn(api, 'documentSpaceNodes').mockResolvedValue(sampleNodes)
    const readMock = vi.spyOn(api, 'readDocument')
      .mockResolvedValueOnce(makeDoc({ revision: 'rev-1', markdown: '# Idea Board\n\nVersion 1' }))
      .mockResolvedValueOnce(makeDoc({ revision: 'rev-2', markdown: '# Idea Board\n\nVersion 2 from disk' }))
      .mockResolvedValueOnce(makeDoc({ revision: 'rev-3', markdown: '# Idea Board\n\nVersion 3 from Paseo' }))

    const wrapper = mount(DocumentSpacesWorkbench, {
      attachTo: document.body,
      props: { initialSpaceId: sampleSpace.id, initialDocPath: 'idea.md' },
      global: { plugins: [pinia] },
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="craft-document-editor-canvas"]').text()).toContain('Version 1')

    emitDocumentSpaceChange({ spaceId: sampleSpace.id, paths: ['idea.md'] })
    await flushPromises()
    expect(wrapper.get('[data-testid="craft-document-editor-canvas"]').text()).toContain('Version 2 from disk')

    await wrapper.get('[data-testid="mode-markdown"]').trigger('click')
    await wrapper.get('[data-testid="raw-markdown-textarea"]').setValue('Local dirty draft')

    emitDocumentSpaceChange({ spaceId: sampleSpace.id, paths: ['idea.md'] })
    await flushPromises()
    expect(readMock).toHaveBeenCalledTimes(3)
    expect(wrapper.find('[data-testid="document-conflict-banner"]').exists()).toBe(true)

    const writeMock = vi.spyOn(api, 'writeDocument').mockResolvedValue({
      status: 'saved',
      document: makeDoc({ revision: 'rev-4', markdown: 'Local dirty draft' }),
    })
    await wrapper.get('[data-testid="conflict-keep-local"]').trigger('click')
    await flushPromises()

    expect(writeMock).toHaveBeenCalledWith(sampleSpace.id, expect.objectContaining({
      expectedRevision: 'rev-3',
    }))
    expect(wrapper.find('[data-testid="document-conflict-banner"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows conflict banner on 409 save conflict and reloads disk version when chosen', async () => {
    vi.spyOn(api, 'documentSpaces').mockResolvedValue([sampleSpace])
    vi.spyOn(api, 'documentSpaceNodes').mockResolvedValue(sampleNodes)
    const diskLatest = makeDoc({ revision: 'rev-disk', markdown: '# Idea Board\n\nLatest from disk.' })
    vi.spyOn(api, 'readDocument')
      .mockResolvedValueOnce(makeDoc({ revision: 'rev-1', markdown: '# Idea Board\n\nLocal version.' }))
      .mockResolvedValueOnce(diskLatest)
    vi.spyOn(api, 'writeDocument').mockResolvedValueOnce({
      status: 'conflict',
      current: diskLatest,
      message: 'Document changed on disk since it was opened',
    })

    const wrapper = mount(DocumentSpacesWorkbench, {
      attachTo: document.body,
      props: { initialSpaceId: sampleSpace.id, initialDocPath: 'idea.md' },
      global: { plugins: [pinia] },
    })
    await flushPromises()

    await wrapper.get('[data-testid="save-document-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="document-conflict-banner"]').exists()).toBe(true)

    await wrapper.get('[data-testid="conflict-reload"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="document-conflict-banner"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="craft-document-editor-canvas"]').text()).toContain('Latest from disk.')
    wrapper.unmount()
  })
})
