// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { OperationSupport, PersonalWorkbenchHome, SettingsSnapshot, SoftwareCatalogSnapshot, SoftwareInstallationPlan, SoftwareInstallationRun } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import SoftwareCenter from './SoftwareCenter.vue'
import { useWorkbenchStore } from './store'

const initialHome: PersonalWorkbenchHome = {
  tools: [{ id: 'docs', title: 'Docs', group: 'References', url: 'https://docs.example.com/' }],
  pinnedProjectIds: ['project-one'],
}

function settings(home = initialHome, revision = 'initial'): SettingsSnapshot {
  return {
    explicitKeys: ['workbench.home', 'workbench.locale'],
    path: '/settings.json',
    revision,
    settings: {
      'workbench.codex': {},
      'workbench.editor': { default: 'vscode' },
      'workbench.home': structuredClone(home),
      'workbench.locale': 'en',
      'workbench.repositoriesRoot': '',
      'workbench.shortcuts': {},
      'workbench.theme': 'system',
    },
  }
}

const catalog: SoftwareCatalogSnapshot = {
  version: 1,
  sources: [{
    id: 'local-source',
    title: 'Local catalog',
    url: 'https://catalog.example.com/',
    items: [
      {
        id: 'editor',
        title: { en: 'Visual Studio Code' },
        group: { id: 'editors', title: { en: 'Editors', zh: '编辑器' } },
        url: 'https://code.visualstudio.com/',
        downloadUrl: 'https://code.visualstudio.com/download',
        repositoryUrl: 'https://github.com/microsoft/vscode',
        installation: { kind: 'brew-cask', packageId: 'visual-studio-code' },
        status: 'detected',
      },
      {
        id: 'assistant',
        title: { en: 'Assistant', zh: '智能助手' },
        group: { id: 'ai', title: { en: 'AI tools', zh: 'AI 工具' } },
        url: 'https://assistant.example.com/',
        iconUrl: 'https://assistant.example.com/icon.png',
        macosIconUrl: 'https://assistant.example.com/mac.png',
        iconScale: 1.25,
        iconStyle: 'rounded',
        downloadUrl: 'https://downloads.example.com/special-build',
        repositoryUrl: 'https://github.com/example/special-source',
        description: 'A local coding assistant',
        installation: { kind: 'download' },
        status: 'not-detected',
      },
      {
        id: 'cli',
        title: { en: 'Command tool' },
        group: { id: 'editors', title: { en: 'Editors', zh: '编辑器' } },
        url: 'https://cli.example.com/',
        installation: { kind: 'brew-formula', packageId: 'command-tool' },
        status: 'unknown',
      },
    ],
  }],
}

function managedCatalog(): SoftwareCatalogSnapshot {
  const result = structuredClone(catalog)
  const source = result.sources[0]!
  source.canManage = true
  source.items[0]!.canOpen = true
  source.items.push(...['missing-editor', 'missing-cli'].map(id => ({
    id,
    title: { en: id === 'missing-editor' ? 'Missing editor' : 'Missing CLI' },
    group: { id: 'editors', title: { en: 'Editors' } },
    url: `https://${id}.example.com/`,
    installation: { kind: 'brew-formula' as const, packageId: id },
    status: 'not-detected' as const,
    canInstall: true,
  })))
  return result
}

function operationSupport(overrides: Partial<OperationSupport> = {}): OperationSupport {
  return { state: 'available', platform: 'linux', cliVersion: '1.0.0', operations: Object.fromEntries(['catalog', 'preview', 'install', 'runs', 'cancel', 'open'].map(operation => [operation, { supported: true }])), ...overrides }
}

function plan(ids = ['missing-editor', 'missing-cli']): SoftwareInstallationPlan {
  return {
    version: 1,
    id: 'plan-one',
    sourceId: 'local-source',
    createdAt: '2026-10-10T04:00:00.000Z',
    prerequisites: [],
    items: ids.map(softwareId => ({ softwareId, title: { en: softwareId === 'missing-editor' ? 'Missing editor' : 'Missing CLI' }, action: 'install', installation: { kind: 'brew-formula', packageId: softwareId } })),
  }
}

function run(state: SoftwareInstallationRun['state'] = 'running'): SoftwareInstallationRun {
  return {
    version: 1,
    id: 'run-one',
    sourceId: 'local-source',
    planId: 'plan-one',
    createdAt: '2026-10-10T04:00:00.000Z',
    updatedAt: '2026-10-10T04:00:01.000Z',
    state,
    items: [
      { softwareId: 'missing-editor', title: { en: 'Missing editor' }, state: 'installed', log: 'Installed package' },
      { softwareId: 'missing-cli', title: { en: 'Missing CLI' }, state: state === 'completed' ? 'installed' : state === 'failed' ? 'failed' : 'running', log: 'Downloading package…' },
    ],
  }
}

function bodyButton(testId: string): HTMLButtonElement {
  const element = document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (!element)
    throw new Error(`Missing button: ${testId}`)
  return element
}

describe('software center', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    useWorkbenchStore().settings = settings()
    vi.spyOn(api, 'softwareCatalog').mockResolvedValue(structuredClone(catalog))
    vi.spyOn(api, 'softwareSources').mockResolvedValue({ version: 1, revision: 'empty', localAvailable: true, sources: [] })
    vi.spyOn(api, 'softwareInstallationRuns').mockResolvedValue({ version: 1, runs: [] })
    vi.spyOn(api, 'softwareInstallationPlan').mockImplementation(async (_sourceId, ids) => plan(ids))
    vi.spyOn(api, 'installSoftware').mockResolvedValue(run())
    vi.spyOn(api, 'cancelSoftwareInstallation').mockResolvedValue({ ...run(), state: 'cancelled', items: run().items.map(item => item.state === 'running' ? { ...item, state: 'cancelled' } : item) })
    vi.spyOn(api, 'openSoftwareApplication').mockResolvedValue({ version: 1, softwareId: 'editor', destination: 'application' })
    vi.spyOn(api, 'updateSettings').mockImplementation(async (patch, revision) => settings(patch['workbench.home'] as PersonalWorkbenchHome, `${revision}-saved`))
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  async function open(): Promise<VueWrapper> {
    wrapper = mount(SoftwareCenter, { attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  it.each(['linux', 'win32'])('intersects %s capabilities with local item flags and retains manual links', async (platform) => {
    const result = managedCatalog()
    result.sources[0]!.operationSupport = operationSupport({ platform, operations: { catalog: { supported: true }, runs: { supported: true }, preview: { supported: false, reason: 'unsupported-platform' }, install: { supported: false, reason: 'unsupported-platform' }, open: { supported: false, reason: 'unsupported-platform' } } })
    vi.mocked(api.softwareCatalog).mockResolvedValue(result)
    await open()
    expect(wrapper!.get('[data-testid="software-operation-support"]').text()).toContain(platform)
    expect(wrapper!.get('[data-testid="software-operation-support"]').text()).toContain('unavailable on this platform')
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="open-software"]').exists()).toBe(false)
    expect(wrapper!.get('[aria-label="Download Assistant"]').attributes('href')).toBe('https://downloads.example.com/special-build')
    expect(api.softwareInstallationPlan).not.toHaveBeenCalled()
    expect(api.openSoftwareApplication).not.toHaveBeenCalled()
  })

  it('retains a prepared plan but rejects confirmation after capabilities become unavailable', async () => {
    const result = managedCatalog()
    result.sources[0]!.operationSupport = operationSupport()
    vi.mocked(api.softwareCatalog).mockResolvedValue(result)
    await open()
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    const changed = structuredClone(result)
    changed.sources[0]!.operationSupport = operationSupport({ state: 'unavailable', operations: {} })
    vi.mocked(api.softwareCatalog).mockResolvedValue(changed)
    await wrapper!.get('[data-testid="refresh-software"]').trigger('click')
    await flushPromises()
    expect(bodyButton('confirm-software-installation').disabled).toBe(true)
    expect(document.body.querySelector('[data-testid="software-plan-operation-support"]')?.textContent).toContain('Check its connection and refresh')
    const confirm = wrapper!.findAllComponents(UiButton).find(button => button.attributes('data-testid') === 'confirm-software-installation')!
    confirm.vm.$emit('click')
    await flushPromises()
    expect(api.installSoftware).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="software-install-plan"]')?.textContent).toContain('Missing editor')
  })

  it('retains loaded runs while blocking cancellation and history reads after an old CLI is detected', async () => {
    const result = managedCatalog()
    result.sources[0]!.operationSupport = operationSupport()
    vi.mocked(api.softwareCatalog).mockResolvedValue(result)
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    await open()
    expect(api.softwareInstallationRuns).toHaveBeenCalledOnce()
    const changed = structuredClone(result)
    changed.sources[0]!.operationSupport = operationSupport({ state: 'unsupported', operations: {} })
    vi.mocked(api.softwareCatalog).mockResolvedValue(changed)
    await wrapper!.get('[data-testid="refresh-software"]').trigger('click')
    await flushPromises()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Installed package')
    expect(wrapper!.get('[data-testid="stop-software-installation"]').attributes('disabled')).toBeDefined()
    expect(wrapper!.get('[data-testid="refresh-software-installations"]').attributes('disabled')).toBeDefined()
    wrapper!.findAllComponents(UiButton).find(button => button.attributes('data-testid') === 'stop-software-installation')!.vm.$emit('click')
    wrapper!.findAllComponents(UiButton).find(button => button.attributes('data-testid') === 'refresh-software-installations')!.vm.$emit('click')
    await flushPromises()
    expect(api.cancelSoftwareInstallation).not.toHaveBeenCalled()
    expect(api.softwareInstallationRuns).toHaveBeenCalledOnce()
    expect(wrapper!.get('[data-testid="software-operation-support"]').text()).toContain('Update the local CLI')
  })

  it('reads metadata without writes and distinguishes partial detection with offline brand icons', async () => {
    await open()
    expect(api.softwareCatalog).toHaveBeenCalledOnce()
    expect(api.updateSettings).not.toHaveBeenCalled()
    expect(wrapper!.findAll('.software-card')).toHaveLength(3)
    expect(wrapper!.get('[data-software-id="editor"] header').text()).toContain('Detected')
    expect(wrapper!.get('[data-software-id="assistant"] header').text()).toContain('Not detected')
    expect(wrapper!.get('[data-software-id="cli"] header').text()).toContain('Not checked')
    expect(wrapper!.get('[data-software-id="editor"] h2 .app-icon').classes()).toContain('vscode-icon')
    expect(wrapper!.get('[data-software-id="assistant"] h2 .app-icon').classes()).toContain('i-ri-global-line')
    expect(wrapper!.text()).toContain('an undetected app may be installed elsewhere')
    expect(wrapper!.find('[data-software-id="cli"] img').exists()).toBe(false)
    expect(wrapper!.get('[data-software-id="assistant"] .software-icon img').attributes('src')).toBe('https://assistant.example.com/mac.png')
    expect(wrapper!.find('a a').exists()).toBe(false)
    expect(wrapper!.get('[aria-label="Download Assistant"]').attributes()).toMatchObject({ href: 'https://downloads.example.com/special-build', target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper!.get('[aria-label="GitHub / source Assistant"]').attributes('href')).toBe('https://github.com/example/special-source')
  })

  it('searches destination links and combines search with category filtering', async () => {
    await open()
    await wrapper!.get('input[type="search"]').setValue('special-build')
    expect(wrapper!.findAll('.software-card')).toHaveLength(1)
    await wrapper!.get('input[type="search"]').setValue('special-source')
    expect(wrapper!.get('.software-card h2').text()).toBe('Assistant')
    await wrapper!.get('select').setValue(JSON.stringify(['local-source', 'editors']))
    expect(wrapper!.findAll('.software-card')).toHaveLength(0)
    expect(wrapper!.get('[data-testid="software-no-results"]').text()).toContain('another search or category')
    await wrapper!.get('input[type="search"]').setValue('')
    expect(wrapper!.findAll('.software-card')).toHaveLength(2)
  })

  it('browses, filters and favorites bundled software, then refreshes into local management', async () => {
    const bundled = structuredClone(catalog)
    bundled.sources[0]!.bundled = true
    bundled.sources[0]!.items.forEach((item) => {
      item.status = 'unknown'
      item.canInstall = false
      item.canOpen = false
    })
    vi.mocked(api.softwareCatalog).mockResolvedValueOnce(bundled)
    await open()
    expect(wrapper!.get('[data-testid="software-bundled-note"]').text()).toContain('without local installation checks')
    expect(api.softwareInstallationRuns).not.toHaveBeenCalled()
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="open-software"]').exists()).toBe(false)
    await wrapper!.get('select').setValue(JSON.stringify(['local-source', 'ai']))
    await wrapper!.get('input[type="search"]').setValue('special-build')
    expect(wrapper!.findAll('.software-card')).toHaveLength(1)
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(api.updateSettings).toHaveBeenCalledOnce()
    expect(api.softwareInstallationPlan).not.toHaveBeenCalled()
    expect(api.installSoftware).not.toHaveBeenCalled()
    await wrapper!.get('select').setValue('')
    await wrapper!.get('input[type="search"]').setValue('')
    vi.mocked(api.softwareCatalog).mockResolvedValueOnce(managedCatalog())
    await wrapper!.get('[data-testid="refresh-software"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-testid="software-bundled-note"]').exists()).toBe(false)
    expect(wrapper!.find('.software-source-error').exists()).toBe(false)
    expect(wrapper!.findAll('[data-software-id="assistant"]')).toHaveLength(1)
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(true)
    expect(api.softwareInstallationRuns).toHaveBeenCalledOnce()
  })

  it('reacts to locale changes without reading the catalog again', async () => {
    await open()
    useI18n().setLocale('zh-CN')
    await flushPromises()
    expect(wrapper!.get('[data-software-id="assistant"] h2').text()).toBe('智能助手')
    expect(wrapper!.get('[data-software-id="assistant"] header').text()).toContain('未检测到')
    expect(wrapper!.get('[data-software-id="cli"] header').text()).toContain('未检测')
    expect(wrapper!.get('[data-software-id="editor"] h2').text()).toBe('Visual Studio Code')
    expect(wrapper!.get('select').text()).toContain('编辑器')
    expect(api.softwareCatalog).toHaveBeenCalledOnce()
  })

  it('explains that a repository cache does not include local installation checks', async () => {
    const cached = structuredClone(catalog)
    cached.sources[0]!.repositorySourceId = 'a'.repeat(24)
    cached.sources[0]!.repositoryReadFrom = 'local'
    cached.sources[0]!.items.forEach(item => item.status = 'unknown')
    vi.mocked(api.softwareCatalog).mockResolvedValueOnce(cached)
    await open()
    expect(wrapper!.get('[data-testid="software-repository-note"]').text()).toContain('without local installation checks')
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(false)
    expect(wrapper!.text()).not.toContain('Review the source installation plan first')
  })

  it('adds independent links with the existing revision and retains pins and tools', async () => {
    await open()
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()

    const [patch, revision] = vi.mocked(api.updateSettings).mock.calls[0]!
    expect(revision).toBe('initial')
    expect(patch['workbench.home']).toMatchObject({
      pinnedProjectIds: ['project-one'],
      tools: [initialHome.tools[0], {
        title: 'Assistant',
        group: 'AI tools',
        url: 'https://assistant.example.com/',
        downloadUrl: 'https://downloads.example.com/special-build',
        repositoryUrl: 'https://github.com/example/special-source',
      }],
    })
    expect(useWorkbenchStore().settings?.revision).toBe('initial-saved')
    expect(wrapper!.get('[data-software-id="assistant"] footer button').attributes('disabled')).toBeDefined()
    expect(wrapper!.text()).toContain('Added Assistant to your personal workbench')
    expect(api.softwareCatalog).toHaveBeenCalledOnce()
  })

  it('opens detected Ghostty and saves its native launcher with the favorite', async () => {
    const result = managedCatalog()
    result.sources[0]!.items = [{
      id: 'ghostty',
      title: { en: 'Ghostty' },
      group: { id: 'terminals', title: { en: 'Terminals' } },
      url: 'https://ghostty.org/',
      downloadUrl: 'https://ghostty.org/download',
      repositoryUrl: 'https://github.com/ghostty-org/ghostty',
      installation: { kind: 'brew-cask', packageId: 'ghostty' },
      status: 'detected',
      canOpen: true,
    }]
    vi.mocked(api.softwareCatalog).mockResolvedValue(result)
    await open()
    await wrapper!.get('[data-software-id="ghostty"] [data-testid="open-software"]').trigger('click')
    await flushPromises()
    expect(api.openSoftwareApplication).toHaveBeenCalledWith('local-source', 'ghostty')
    expect(wrapper!.text()).toContain('Requested opening Ghostty')

    await wrapper!.get('[data-software-id="ghostty"] footer button').trigger('click')
    await flushPromises()
    expect(useWorkbenchStore().settings!.settings['workbench.home'].tools.at(-1)).toMatchObject({
      title: 'Ghostty',
      url: 'https://ghostty.org/',
      downloadUrl: 'https://ghostty.org/download',
      repositoryUrl: 'https://github.com/ghostty-org/ghostty',
      launch: { application: 'ghostty' },
    })
    expect(wrapper!.get('[data-software-id="ghostty"] footer button').text()).toContain('In favorites')
  })

  it('does not assign a native launcher from a catalog title or unofficial Ghostty URL', async () => {
    const result = structuredClone(catalog)
    result.sources[0]!.items = [{ ...result.sources[0]!.items[1]!, title: { en: 'Ghostty' }, url: 'https://ghostty.example.com/' }]
    vi.mocked(api.softwareCatalog).mockResolvedValue(result)
    await open()
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(useWorkbenchStore().settings!.settings['workbench.home'].tools.at(-1)?.launch).toBeUndefined()
  })

  it('deduplicates favorites by website even when IDs, titles, www and trailing slashes differ', async () => {
    useWorkbenchStore().settings = settings({ ...initialHome, tools: [...initialHome.tools, { id: 'different-id', title: 'My coding app', url: 'https://www.assistant.example.com///#saved', group: 'My tools' }] })
    await open()
    expect(wrapper!.get('[data-software-id="assistant"] footer button').text()).toContain('In favorites')
    expect(wrapper!.get('[data-software-id="assistant"] footer button').attributes('disabled')).toBeDefined()
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('keeps catalog variants with separate download destinations independently favoriteable', async () => {
    const variant = structuredClone(catalog)
    variant.sources[0]!.items.push({ ...variant.sources[0]!.items[1]!, id: 'assistant-extension', title: { en: 'Assistant extension' }, downloadUrl: 'https://downloads.example.com/editor-setup' })
    vi.mocked(api.softwareCatalog).mockResolvedValue(variant)
    await open()
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(wrapper!.get('[data-software-id="assistant"] footer button').attributes('disabled')).toBeDefined()
    expect(wrapper!.get('[data-software-id="assistant-extension"] footer button').attributes('disabled')).toBeUndefined()
    await wrapper!.get('[data-software-id="assistant-extension"] footer button').trigger('click')
    await flushPromises()
    const tools = useWorkbenchStore().settings!.settings['workbench.home'].tools
    expect(tools.filter(tool => tool.url === 'https://assistant.example.com/')).toHaveLength(2)
    expect(tools.filter(tool => tool.id.startsWith('software:'))).toHaveLength(2)
    expect(wrapper!.get('[data-software-id="assistant-extension"] footer button').attributes('disabled')).toBeDefined()
  })

  it('can load an older settings snapshot without a personal home and adds its first tool safely', async () => {
    const previous = settings()
    delete (previous.settings as Partial<SettingsSnapshot['settings']>)['workbench.home']
    useWorkbenchStore().settings = previous
    await open()
    expect(wrapper!.get('[data-software-id="assistant"] footer button').attributes('disabled')).toBeUndefined()
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(useWorkbenchStore().settings!.settings['workbench.home'].tools).toHaveLength(1)
    expect(useWorkbenchStore().settings!.settings['workbench.home'].tools[0]!.title).toBe('Assistant')
    expect(useWorkbenchStore().settings!.settings['workbench.home'].tools[0]!).toMatchObject({ iconUrl: 'https://assistant.example.com/icon.png', macosIconUrl: 'https://assistant.example.com/mac.png', iconScale: 1.25, iconStyle: 'rounded' })
  })

  it('retains the catalog and offers settings reload after a revision conflict before retrying', async () => {
    vi.mocked(api.updateSettings).mockRejectedValueOnce(new Error('Revision conflict'))
    const changedHome = { ...initialHome, pinnedProjectIds: ['project-two'] }
    vi.spyOn(api, 'settings').mockResolvedValue(settings(changedHome, 'external'))
    await open()
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('The favorite was not saved')
    expect(useWorkbenchStore().settings?.settings['workbench.home']).toEqual(initialHome)
    expect(wrapper!.findAll('.software-card')).toHaveLength(3)
    expect(wrapper!.get('[data-software-id="assistant"] footer button').attributes('disabled')).toBeUndefined()

    await wrapper!.get('[data-testid="reload-software-settings"]').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Settings reloaded')
    await wrapper!.get('[data-software-id="assistant"] footer button').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.updateSettings).mock.calls[1]![1]).toBe('external')
    expect(useWorkbenchStore().settings?.settings['workbench.home'].pinnedProjectIds).toEqual(['project-two'])
  })

  it('keeps an unavailable source visible and retries metadata without claiming it has no applications', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValueOnce({ version: 1, sources: [{ id: 'local-source', title: 'Local catalog', url: 'https://catalog.example.com/', items: [], error: 'unavailable' }] })
    await open()
    expect(wrapper!.get('.software-source').text()).toContain('Catalog unavailable')
    expect(wrapper!.text()).not.toContain('0 applications')
    expect(wrapper!.findAll('.software-card')).toHaveLength(0)
    await wrapper!.get('.software-source button').trigger('click')
    await flushPromises()
    expect(api.softwareCatalog).toHaveBeenCalledTimes(2)
    expect(wrapper!.findAll('.software-card')).toHaveLength(3)
  })

  it('retains stale catalog data after refresh fails and permits an explicit retry', async () => {
    await open()
    vi.mocked(api.softwareCatalog).mockRejectedValueOnce(new Error('Failed metadata read'))
    await wrapper!.get('[data-testid="refresh-software"]').trigger('click')
    await flushPromises()
    expect(wrapper!.get('[data-testid="software-load-error"]').text()).toContain('may be out of date')
    expect(wrapper!.findAll('.software-card')).toHaveLength(3)
    await wrapper!.get('[data-testid="software-load-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-testid="software-load-error"]').exists()).toBe(false)
    expect(api.softwareCatalog).toHaveBeenCalledTimes(3)
  })

  it('shows a useful empty state when no catalog provider is connected', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValueOnce({ version: 1, sources: [] })
    await open()
    expect(wrapper!.get('[data-testid="software-no-sources"]').text()).toContain('No software catalog connected')
    expect(wrapper!.find('.software-filters').exists()).toBe(false)
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('loads persistent history only from capable sources and keeps manual links usable', async () => {
    await open()
    expect(api.softwareInstallationRuns).not.toHaveBeenCalled()
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(false)
    expect(wrapper!.get('[data-software-id="assistant"] .software-package').text()).toBe('Manual install')
    expect(wrapper!.get('[data-software-id="assistant"] .software-package').attributes('title')).toBe('Install manually from the official download page')
    expect(wrapper!.get('[aria-label="Download Assistant"]').attributes('href')).toBe('https://downloads.example.com/special-build')
  })

  it('reviews selected missing software and waits for explicit plan confirmation before starting', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    await open()
    expect(api.softwareInstallationRuns).toHaveBeenCalledWith('local-source')
    await wrapper!.get('[aria-label="Select for installation Missing editor"]').setValue(true)
    await wrapper!.get('[aria-label="Select for installation Missing CLI"]').setValue(true)
    await wrapper!.get('[data-testid="review-selected-software"]').trigger('click')
    await flushPromises()
    expect(api.softwareInstallationPlan).toHaveBeenCalledWith('local-source', ['missing-editor', 'missing-cli'])
    expect(api.installSoftware).not.toHaveBeenCalled()
    const dialog = document.body.querySelector('[data-testid="software-install-plan"]')!
    expect(dialog.textContent).toContain('Review installation plan')
    expect(dialog.textContent).toContain('Missing editor')
    expect(dialog.textContent).toContain('Homebrew formula · missing-cli')
    bodyButton('confirm-software-installation').click()
    await flushPromises()
    expect(api.installSoftware).toHaveBeenCalledWith('local-source', 'plan-one', true)
    expect(document.body.querySelector('[data-testid="software-install-plan"]')).toBeNull()
    expect(wrapper!.find('[data-testid="software-install-selection"]').exists()).toBe(false)
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('1 / 2 items processed')
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Installing')
    expect(wrapper!.get('[data-install-item-id="missing-cli"] pre').text()).toContain('Downloading package')
  })

  it('shows skipped/manual entries and prerequisites without starting a blocked plan', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationPlan).mockResolvedValue({ ...plan(), prerequisites: ['Install the package manager first'], items: [
      { ...plan().items[0]!, action: 'skip', reason: 'Already installed' },
      { ...plan().items[1]!, action: 'manual', reason: 'Use the official download link' },
    ] })
    await open()
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    const dialog = document.body.querySelector('[data-testid="software-install-plan"]')!
    expect(dialog.textContent).toContain('Already installed')
    expect(dialog.textContent).toContain('Use the official download link')
    expect(dialog.textContent).toContain('Install the package manager first')
    expect(bodyButton('confirm-software-installation').disabled).toBe(true)
    expect(api.installSoftware).not.toHaveBeenCalled()
  })

  it('restores real download percentages in cards and history and replaces them with installation state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    const downloading = run()
    downloading.items[1]!.progress = { phase: 'downloading', percent: 42, resource: 'Bottle command-tool' }
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [downloading] })
    await open()
    const card = () => wrapper!.get('[data-software-id="missing-cli"]')
    const history = () => wrapper!.get('[data-install-item-id="missing-cli"]')
    for (const area of [card(), history()]) {
      expect(area.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42')
      expect(area.text()).toContain('Downloading')
    }
    expect(history().text()).toContain('Bottle command-tool')
    expect(card().find('[data-testid="install-software"]').exists()).toBe(false)
    expect(card().get('[data-testid="stop-software-card-installation"]').attributes('aria-label')).toBe('Stop installing Missing CLI')
    expect(card().find('button button').exists()).toBe(false)
    wrapper!.unmount()
    await open()
    expect(card().get('[role="progressbar"]').attributes('aria-valuenow')).toBe('42')
    expect(api.installSoftware).not.toHaveBeenCalled()

    const unknown = structuredClone(downloading)
    unknown.items[1]!.progress = { phase: 'downloading', resource: 'Next dependency' }
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [unknown] })
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(card().find('[role="progressbar"]').exists()).toBe(false)
    expect(card().text()).toContain('Downloading')
    expect(card().text()).not.toContain('%')

    const installing = structuredClone(downloading)
    installing.items[1]!.progress = { phase: 'installing' }
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [installing] })
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper!.find('[role="progressbar"]').exists()).toBe(false)
    expect(card().text()).toContain('Installing')
    expect(history().text()).toContain('Installing')

    vi.mocked(api.cancelSoftwareInstallation).mockResolvedValue({ ...downloading, state: 'cancelling' })
    await wrapper!.get('[data-testid="stop-software-installation"]').trigger('click')
    await flushPromises()
    expect(card().text()).toContain('Stopping')
    expect(wrapper!.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('stops the whole installation task from the card ring and prevents repeat requests while stopping', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    const downloading = run()
    downloading.items[0]!.state = 'queued'
    downloading.items[1]!.progress = { phase: 'downloading', percent: 42 }
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [downloading] })
    let acknowledge!: (result: SoftwareInstallationRun) => void
    vi.mocked(api.cancelSoftwareInstallation).mockImplementation(() => new Promise(resolve => acknowledge = resolve))
    await open()
    const card = wrapper!.get('[data-software-id="missing-cli"]')
    const stop = card.get('[data-testid="stop-software-card-installation"]')
    expect(stop.attributes('aria-label')).toBe('Stop the entire installation task, including remaining items')
    expect(card.get('.software-progress-percent').text()).toBe('42%')
    expect(card.get('.download-ring').text()).toBe('')
    await stop.trigger('click')
    expect(api.cancelSoftwareInstallation).toHaveBeenCalledExactlyOnceWith('local-source', 'run-one')
    expect(stop.attributes('disabled')).toBeDefined()
    expect(card.text()).toContain('Stopping')
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Stopping')
    expect(wrapper!.get('[data-software-id="missing-editor"] [data-testid="stop-software-card-installation"]').attributes('disabled')).toBeDefined()
    await stop.trigger('click')
    expect(api.cancelSoftwareInstallation).toHaveBeenCalledOnce()
    acknowledge({ ...downloading, state: 'cancelled', items: downloading.items.map(item => ({ ...item, state: 'cancelled', progress: undefined })) })
    await flushPromises()
    expect(card.find('[data-testid="stop-software-card-installation"]').exists()).toBe(false)
    expect(card.get('[data-testid="install-software"]').attributes('disabled')).toBeUndefined()
  })

  it('polls only active jobs, refreshes detection after completion and stops polling on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationRuns).mockResolvedValueOnce({ version: 1, runs: [run()] }).mockResolvedValue({ version: 1, runs: [run('completed')] })
    await open()
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Installing')
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Completed')
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('2 / 2 items processed')
    expect(api.softwareCatalog).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(api.softwareInstallationRuns).mock.calls.length
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.softwareInstallationRuns).toHaveBeenCalledTimes(calls)
    wrapper!.unmount()
    wrapper = undefined
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.softwareInstallationRuns).toHaveBeenCalledTimes(calls)
  })

  it('retains the last running state and retries reading history after connection failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationRuns).mockResolvedValueOnce({ version: 1, runs: [run()] }).mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue({ version: 1, runs: [run('failed')] })
    await open()
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper!.get('[data-testid="software-history-error"]').text()).toContain('installation may still be running')
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Installing')
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).not.toContain('Installed')
    await wrapper!.get('[data-testid="refresh-software-installations"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-testid="software-history-error"]').exists()).toBe(false)
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Failed')
  })

  it('retries only unfinished items by preparing a fresh plan before any further installation', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run('failed')] })
    vi.mocked(api.softwareInstallationPlan).mockResolvedValue({ ...plan(['missing-cli']), id: 'plan-retry' })
    await open()
    await wrapper!.get('[data-testid="retry-software-installation"]').trigger('click')
    await flushPromises()
    expect(api.softwareInstallationPlan).toHaveBeenCalledWith('local-source', ['missing-cli'])
    expect(api.installSoftware).not.toHaveBeenCalled()
    bodyButton('confirm-software-installation').click()
    await flushPromises()
    expect(api.installSoftware).toHaveBeenCalledWith('local-source', 'plan-retry', true)
  })

  it('stops a running job without claiming that already installed items were removed', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    await open()
    await wrapper!.get('[data-testid="stop-software-installation"]').trigger('click')
    await flushPromises()
    expect(api.cancelSoftwareInstallation).toHaveBeenCalledWith('local-source', 'run-one')
    expect(wrapper!.get('[data-install-item-id="missing-editor"]').text()).toContain('Installed')
    expect(wrapper!.get('[data-install-item-id="missing-cli"]').text()).toContain('Stopped')
    expect(wrapper!.find('[data-testid="stop-software-installation"]').exists()).toBe(false)
  })

  it('opens only a detected application through the host adapter and reports launch failures', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.openSoftwareApplication).mockRejectedValueOnce(new Error('No longer installed'))
    await open()
    expect(wrapper!.findAll('[data-testid="open-software"]')).toHaveLength(1)
    await wrapper!.get('[data-software-id="editor"] [data-testid="open-software"]').trigger('click')
    await flushPromises()
    expect(api.openSoftwareApplication).toHaveBeenCalledWith('local-source', 'editor')
    expect(wrapper!.get('[data-testid="software-operation-error"]').text()).toContain('Could not open the application')
    await wrapper!.get('[data-software-id="editor"] [data-testid="open-software"]').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Requested opening Visual Studio Code')
    expect(wrapper!.find('[data-testid="software-operation-error"]').exists()).toBe(false)
  })

  it('reconciles an uncertain installation response with history before permitting a duplicate request', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.installSoftware).mockRejectedValueOnce(new Error('Response lost after start'))
    await open()
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    bodyButton('confirm-software-installation').click()
    await flushPromises()
    expect(bodyButton('confirm-software-installation').disabled).toBe(true)
    const dialog = document.body.querySelector('[data-testid="software-install-plan"]')!
    expect(dialog.textContent).toContain('Refresh installation history before retrying')
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    const refresh = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Refresh installation history'))!
    refresh.click()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="software-install-plan"]')).toBeNull()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Installing')
    expect(api.installSoftware).toHaveBeenCalledOnce()
  })

  it('restores completed and interrupted history on remount without restarting jobs', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    const interrupted = { ...run('failed'), id: 'run-interrupted', state: 'interrupted' as const, items: [{ ...run().items[1]!, state: 'interrupted' as const }] }
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run('completed'), interrupted] })
    await open()
    expect(wrapper!.get('[data-run-id="run-interrupted"]').text()).toContain('Interrupted')
    wrapper!.unmount()
    wrapper = undefined
    await open()
    expect(wrapper!.findAll('.software-installation-run')).toHaveLength(2)
    expect(api.installSoftware).not.toHaveBeenCalled()
    expect(api.cancelSoftwareInstallation).not.toHaveBeenCalled()
  })

  it('prevents confirming a plan with installable items until prerequisites are resolved', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationPlan).mockResolvedValue({ ...plan(['missing-editor']), prerequisites: ['The package manager is unavailable'] })
    await open()
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    expect(bodyButton('confirm-software-installation').textContent).toContain('1 item')
    expect(bodyButton('confirm-software-installation').disabled).toBe(true)
    expect(api.installSoftware).not.toHaveBeenCalled()
  })

  it('clears active polling on unmount without starting further history reads', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    await open()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Installing')
    wrapper!.unmount()
    wrapper = undefined
    await vi.advanceTimersByTimeAsync(6000)
    expect(api.softwareInstallationRuns).toHaveBeenCalledOnce()
    expect(document.body.querySelector('[data-run-id="run-one"]')).toBeNull()
  })

  it('does not show capability buttons for a source that supports only discovery', async () => {
    const readonly = managedCatalog()
    delete readonly.sources[0]!.canManage
    vi.mocked(api.softwareCatalog).mockResolvedValue(readonly)
    await open()
    expect(wrapper!.find('[data-testid="install-software"]').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="open-software"]').exists()).toBe(false)
    expect(api.softwareInstallationRuns).not.toHaveBeenCalled()
  })

  it('keeps a newly acknowledged installation when an older history request returns without it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    let resolveHistory!: (value: { version: 1, runs: SoftwareInstallationRun[] }) => void
    vi.mocked(api.softwareInstallationRuns).mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve
    }))
    wrapper = mount(SoftwareCenter, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    bodyButton('confirm-software-installation').click()
    await flushPromises()
    expect(wrapper.get('[data-run-id="run-one"]').text()).toContain('Installing')
    resolveHistory({ version: 1, runs: [] })
    await flushPromises()
    expect(wrapper.get('[data-run-id="run-one"]').text()).toContain('Installing')
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    await vi.advanceTimersByTimeAsync(1500)
    expect(api.softwareInstallationRuns).toHaveBeenCalledTimes(2)
  })

  it('keeps a cancellation acknowledgement when an earlier polling read returns the running state', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    let resolveHistory!: (value: { version: 1, runs: SoftwareInstallationRun[] }) => void
    vi.mocked(api.softwareInstallationRuns).mockResolvedValueOnce({ version: 1, runs: [run()] }).mockImplementationOnce(() => new Promise((resolve) => {
      resolveHistory = resolve
    }))
    const cancelling = { ...run(), state: 'cancelling' as const }
    vi.mocked(api.cancelSoftwareInstallation).mockResolvedValue(cancelling)
    await open()
    await vi.advanceTimersByTimeAsync(1500)
    await wrapper!.get('[data-testid="stop-software-installation"]').trigger('click')
    await flushPromises()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Stopping')
    resolveHistory({ version: 1, runs: [run()] })
    await flushPromises()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Stopping')
    expect(wrapper!.get('[data-testid="stop-software-installation"]').attributes('disabled')).toBeDefined()
  })

  it('reconciles an uncertain start even when the plan is closed before another install attempt', async () => {
    vi.mocked(api.softwareCatalog).mockResolvedValue(managedCatalog())
    vi.mocked(api.installSoftware).mockRejectedValueOnce(new Error('Lost response'))
    await open()
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    bodyButton('confirm-software-installation').click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[aria-label="Close installation plan"]')!.click()
    await flushPromises()
    vi.mocked(api.softwareInstallationRuns).mockResolvedValue({ version: 1, runs: [run()] })
    await wrapper!.get('[data-software-id="missing-editor"] [data-testid="install-software"]').trigger('click')
    await flushPromises()
    expect(api.softwareInstallationPlan).toHaveBeenCalledOnce()
    expect(api.installSoftware).toHaveBeenCalledOnce()
    expect(wrapper!.get('[data-run-id="run-one"]').text()).toContain('Installing')
    expect(document.body.querySelector('[data-testid="software-install-plan"]')).toBeNull()
  })
})
