// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { PersonalWorkbenchHome, ResolvedIntegrationContribution, SettingsSnapshot } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useI18n } from './i18n'
import PersonalWorkbench from './PersonalWorkbench.vue'
import { useWorkbenchStore } from './store'
import ToolsWorkbench from './ToolsWorkbench.vue'

const initialHome: PersonalWorkbenchHome = {
  tools: [{ id: 'docs', title: 'Docs', url: 'https://docs.example.com/', group: 'Projects' }],
  pinnedProjectIds: [],
}

function snapshot(home: PersonalWorkbenchHome = initialHome, revision = 'initial'): SettingsSnapshot {
  return {
    explicitKeys: ['workbench.home'],
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

function workProvider(id: string, title: string): ResolvedIntegrationContribution {
  return {
    id,
    pluginId: `plugin-${id}`,
    source: `host:${id}`,
    provider: { id, requires: '^1.0.0' },
    providerVersion: '1.0.0',
    actions: [{ id: 'list', title: 'List', operation: 'work-items.list', effect: 'remote-read', confirmation: 'never', effectiveConfirmation: 'never' }],
    views: [{ id: 'work', title, icon: 'builtin:list', placement: 'primary-sidebar', scope: 'global', blocks: [{ id: 'list', type: 'entity-list', actionId: 'list', input: { limit: 20 } }] }],
  }
}

function bodyButton(label: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)
  if (!button)
    throw new Error(`Missing button: ${label}`)
  return button
}

async function editInput(selector: string, value: string): Promise<void> {
  const input = document.body.querySelector<HTMLInputElement>(selector)
  if (!input)
    throw new Error(`Missing input: ${selector}`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function submitTools(): Promise<void> {
  document.body.querySelector<HTMLFormElement>('#home-tools-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
}

describe('personal workbench', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    delete window.craftHubDesktop
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    const store = useWorkbenchStore()
    store.settings = snapshot()
    store.projectsLoadState = 'ready'
    store.integrationsLoadState = 'ready'
    vi.spyOn(api, 'navigationPanels').mockResolvedValue([])
    vi.spyOn(api, 'invokeIntegrationAction').mockResolvedValue({ items: [] })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function openHome(): Promise<VueWrapper> {
    wrapper = mount(PersonalWorkbench, { attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  async function openToolsPage(): Promise<VueWrapper> {
    wrapper = mount(ToolsWorkbench, { attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  async function openTools(): Promise<void> {
    await openToolsPage()
    bodyButton('Customize tools').click()
    await flushPromises()
  }

  it('uses the actual destination for branding and preserves accessible tool names', async () => {
    useWorkbenchStore().settings = snapshot({ tools: [
      { id: 'renamed-chat', title: 'My chat', group: 'Tools', url: 'https://chatgpt.com/' },
      { id: 'claude', title: 'Claude', group: 'Tools', url: 'https://claude.ai/' },
      { id: 'gemini', title: 'Gemini', group: 'Tools', url: 'https://gemini.google.com/app' },
      { id: 'perplexity', title: 'Perplexity', group: 'Tools', url: 'https://www.perplexity.ai/' },
      { id: 'raycast', title: 'Raycast', group: 'Tools', url: 'https://www.raycast.com/' },
      { id: 'orca', title: 'Orca', group: 'Tools', url: 'https://www.onorca.dev/' },
      { id: 'custom', title: 'Claude', group: 'Tools', url: 'https://docs.example.com/' },
    ] })
    await openToolsPage()

    const icons = wrapper!.findAll('.home-tool-mark .app-icon')
    expect(icons[0]!.classes()).toContain('i-simple-icons-openai')
    expect(icons[1]!.classes()).toContain('i-logos-claude-icon')
    expect(icons[2]!.classes()).toContain('i-logos-google-gemini-icon')
    expect(icons[3]!.classes()).toContain('i-simple-icons-perplexity')
    expect(icons[4]!.classes()).toContain('i-simple-icons-raycast')
    expect(icons[5]!.classes()).toContain('i-ri-terminal-window-line')
    expect(icons[6]!.classes()).toContain('i-ri-global-line')
    expect(icons.every(icon => icon.attributes('aria-hidden') === 'true')).toBe(true)
    expect(wrapper!.findAll('.home-tool strong').map(name => name.text())).toEqual(['My chat', 'Claude', 'Gemini', 'Perplexity', 'Raycast', 'Orca', 'Claude'])
    expect(wrapper!.find('.home-tool-mark img').exists()).toBe(false)
  })

  it('validates edited URLs before saving and cancels without changing persistent preferences', async () => {
    const update = vi.spyOn(api, 'updateSettings')
    await openTools()
    await editInput('.home-tool-editor input[type="url"]', 'https://user:password@example.com/')
    await submitTools()

    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('valid HTTPS URL without embedded credentials')
    expect(update).not.toHaveBeenCalled()
    bodyButton('Cancel').click()
    await flushPromises()

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(useWorkbenchStore().settings?.settings['workbench.home']).toEqual(initialHome)
    expect(wrapper!.get('.home-tool').attributes('href')).toBe('https://docs.example.com/')
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps download and source destinations outside the application-launch link', async () => {
    const tool = {
      id: 'launcher',
      title: 'Launcher',
      group: 'Tools',
      url: 'https://example.com/',
      downloadUrl: 'https://downloads.example.com/app',
      repositoryUrl: 'https://github.com/example/tool',
      launch: { application: 'orca' as const },
    }
    useWorkbenchStore().settings = snapshot({ tools: [tool] })
    const open = vi.fn().mockResolvedValue({ destination: 'application', contextTransferred: false })
    window.craftHubDesktop = { openWorkbenchTool: open }
    await openHome()

    const download = wrapper!.get('[aria-label="Download Launcher"]')
    const source = wrapper!.get('[aria-label="GitHub / source Launcher"]')
    expect(download.attributes()).toMatchObject({ href: tool.downloadUrl, target: '_blank', rel: 'noopener noreferrer' })
    expect(source.attributes()).toMatchObject({ href: tool.repositoryUrl, target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper!.find('a a').exists()).toBe(false)
    download.element.addEventListener('click', event => event.preventDefault())
    source.element.addEventListener('click', event => event.preventDefault())
    await download.trigger('click')
    await source.trigger('click')
    expect(open).not.toHaveBeenCalled()
    await wrapper!.get('.home-tool').trigger('click')
    await flushPromises()
    expect(open).toHaveBeenCalledWith(tool.id)
  })

  it('includes download and source URLs when searching personal tools', async () => {
    useWorkbenchStore().settings = snapshot({ tools: [{ ...initialHome.tools[0]!, downloadUrl: 'https://download.example.com/special-build', repositoryUrl: 'https://github.com/example/special-source' }] })
    await openToolsPage()
    await wrapper!.get('input[type="search"]').setValue('special-build')
    expect(wrapper!.findAll('.home-tool')).toHaveLength(1)
    await wrapper!.get('input[type="search"]').setValue('special-source')
    expect(wrapper!.findAll('.home-tool')).toHaveLength(1)
    await wrapper!.get('input[type="search"]').setValue('not-a-tool')
    expect(wrapper!.findAll('.home-tool')).toHaveLength(0)
  })

  it.each(['downloadUrl', 'repositoryUrl'])('validates optional %s before saving', async (field) => {
    const update = vi.spyOn(api, 'updateSettings')
    await openTools()
    await editInput(`.home-tool-editor input[name="${field}"]`, 'https://user:password@example.com/')
    await submitTools()

    expect(update).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('valid HTTPS URL without embedded credentials')
    expect(useWorkbenchStore().settings?.settings['workbench.home']).toEqual(initialHome)
  })

  it('saves separate links and removes a cleared optional destination', async () => {
    const home = { ...initialHome, tools: [{ ...initialHome.tools[0]!, downloadUrl: 'https://old.example.com/download', repositoryUrl: 'https://github.com/example/old' }] }
    const savedHome = { ...initialHome, tools: [{ ...initialHome.tools[0]!, downloadUrl: 'https://new.example.com/download' }] }
    useWorkbenchStore().settings = snapshot(home)
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(snapshot(savedHome, 'saved-links'))
    await openTools()
    await editInput('.home-tool-editor input[name="downloadUrl"]', ' https://new.example.com/download ')
    await editInput('.home-tool-editor input[name="repositoryUrl"]', '  ')
    expect(useWorkbenchStore().settings?.settings['workbench.home']).toEqual(home)
    await submitTools()

    expect(update).toHaveBeenCalledWith({ 'workbench.home': savedHome }, 'initial')
    expect(wrapper!.get('[aria-label="Download Docs"]').attributes('href')).toBe('https://new.example.com/download')
    expect(wrapper!.find('[aria-label="GitHub / source Docs"]').exists()).toBe(false)
  })

  it('retains the editor draft when the saved revision conflicts', async () => {
    const update = vi.spyOn(api, 'updateSettings').mockRejectedValue(new Error('Settings changed since they were last read'))
    await openTools()
    await editInput('.home-tool-editor input', 'My edited docs')
    useWorkbenchStore().settings = snapshot({ ...initialHome, tools: [{ ...initialHome.tools[0]!, title: 'Externally changed' }] }, 'external-revision')
    await flushPromises()
    await submitTools()

    expect(update).toHaveBeenCalledWith({ 'workbench.home': { ...initialHome, tools: [{ ...initialHome.tools[0]!, title: 'My edited docs' }] } }, 'initial')
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Your draft is retained')
    expect(document.body.querySelector<HTMLInputElement>('.home-tool-editor input')?.value).toBe('My edited docs')
    expect(useWorkbenchStore().settings?.revision).toBe('external-revision')
  })

  it('saves grouped tool changes through the settings API and applies its returned revision', async () => {
    const savedHome: PersonalWorkbenchHome = { ...initialHome, tools: [{ ...initialHome.tools[0]!, title: 'Team docs', group: 'Reference', url: 'https://reference.example.com/', description: 'Developer reference' }] }
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(snapshot(savedHome, 'saved-revision'))
    await openTools()
    await editInput('.home-tool-editor input', 'Team docs')
    await editInput('.home-tool-editor input[list]', 'Reference')
    await editInput('.home-tool-editor input[type="url"]', 'https://reference.example.com/')
    await editInput('.home-tool-editor input[maxlength="512"]', 'Developer reference')
    await submitTools()

    expect(update).toHaveBeenCalledWith({ 'workbench.home': savedHome }, 'initial')
    expect(useWorkbenchStore().settings?.revision).toBe('saved-revision')
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper!.get('.home-tool').attributes()).toMatchObject({ href: 'https://reference.example.com/', target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper!.get('.home-tool-group h3').text()).toBe('Reference')
    expect(window.localStorage.getItem('workbench.home')).toBeNull()
  })

  it('persists a project pin while opening projects remains an explicit navigation event', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'project-a', name: 'Project A', path: '/repos/project-a', trust: 'untrusted', addedAt: '2026-10-08T00:00:00.000Z' }]
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(snapshot({ ...initialHome, pinnedProjectIds: ['project-a'] }, 'pinned-revision'))
    await openHome()
    await wrapper!.get('[aria-label="Pin Project A"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith({ 'workbench.home': { ...initialHome, pinnedProjectIds: ['project-a'] } }, 'initial')
    expect(wrapper!.get('[aria-label="Unpin Project A"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.emitted('openProject')).toBeUndefined()
    await wrapper!.get('.home-project-open').trigger('click')
    expect(wrapper!.emitted('openProject')).toEqual([['project-a']])
    expect(vi.mocked(api.invokeIntegrationAction)).not.toHaveBeenCalled()
  })

  it('never invokes writes, confirmed reads, or project-only work sources on opening', async () => {
    const safe = workProvider('safe', 'Safe work')
    const write = workProvider('write', 'Write action')
    write.actions[0]!.effect = 'remote-write'
    const confirmed = workProvider('confirmed', 'Confirmed read')
    confirmed.actions[0]!.effectiveConfirmation = 'always'
    const projectOnly = workProvider('project-only', 'Project-only work')
    projectOnly.views[0]!.scope = 'project'
    const projectRequired = workProvider('project-required', 'Requires project')
    projectRequired.views[0]!.blocks[0]!.requiresProject = true
    useWorkbenchStore().integrationContributions = [safe, write, confirmed, projectOnly, projectRequired]
    await openHome()

    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
    expect(api.invokeIntegrationAction).toHaveBeenCalledWith('safe', 'list', { limit: 20 })
    expect(wrapper!.get('.home-work-source').text()).toContain('This source has not provided your account identity')
  })

  it('keeps each provider identity and error state isolated when previews load independently', async () => {
    useWorkbenchStore().integrationContributions = [workProvider('alpha', 'Alpha work'), workProvider('beta', 'Beta work'), workProvider('unknown', 'Unknown identity'), workProvider('offline', 'Offline source')]
    vi.mocked(api.invokeIntegrationAction).mockImplementation(async (integrationId) => {
      if (integrationId === 'offline')
        throw new Error('Offline')
      if (integrationId === 'unknown')
        return { items: [{ id: 'unknown-work', title: 'Never presented as mine', assignees: [{ id: 'alpha-user' }] }] }
      return {
        currentUser: { id: `${integrationId}-user` },
        items: [
          { id: 'same-id', title: `${integrationId} assigned work`, statusCategory: 'active', assignees: [{ id: `${integrationId}-user` }] },
          { id: 'other-user', title: `${integrationId} other account`, assignees: [{ id: 'alpha-user' }] },
          { id: 'completed', title: `${integrationId} completed work`, statusCategory: 'done', assignees: [{ id: `${integrationId}-user` }] },
        ],
      }
    })
    await openHome()

    const sources = wrapper!.findAll('.home-work-source')
    expect(sources[0]!.text()).toContain('alpha assigned work')
    expect(sources[1]!.text()).toContain('beta assigned work')
    expect(sources[1]!.text()).not.toContain('beta other account')
    expect(sources[1]!.text()).not.toContain('beta completed work')
    expect(sources[2]!.text()).toContain('This source has not provided your account identity')
    expect(sources[2]!.find('.home-work-item').exists()).toBe(false)
    expect(sources[3]!.get('[role="alert"]').text()).toContain('Could not load work items')
    await sources[1]!.get('.home-work-item').trigger('click')
    expect(wrapper!.emitted('openIntegration')).toEqual([['beta', 'work', 'global']])
  })

  it('shows usable empty states without fetching the plugin navigation catalog', async () => {
    useWorkbenchStore().settings = snapshot({ tools: [] })
    vi.mocked(api.navigationPanels).mockRejectedValue(new Error('Unavailable'))
    await openHome()

    expect(wrapper!.text()).toContain('Add your favorite tools')
    expect(wrapper!.text()).toContain('Bring your projects here')
    expect(wrapper!.text()).toContain('Connect your work items')
    expect(api.navigationPanels).not.toHaveBeenCalled()
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.find('.home-work-item').exists()).toBe(false)
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
    bodyButton('Browse plugins').click()
    expect(wrapper!.emitted('openMarketplace')).toEqual([[]])
  })

  it('waits for initial project and integration discovery before showing empty or failed states', async () => {
    const store = useWorkbenchStore()
    store.projectsLoadState = 'idle'
    store.integrationsLoadState = 'idle'
    await openHome()

    expect(wrapper!.get('.home-projects [role="status"]').text()).toBe('Loading projects…')
    expect(wrapper!.get('.home-work [role="status"]').text()).toBe('Loading work sources…')
    expect(wrapper!.text()).not.toContain('Bring your projects here')
    expect(wrapper!.text()).not.toContain('Connect your work items')
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)

    store.projectsLoadState = 'error'
    store.integrationsLoadState = 'error'
    await flushPromises()

    expect(wrapper!.get('.home-projects [role="alert"]').text()).toContain('Projects could not be loaded')
    expect(wrapper!.get('.home-work [role="alert"]').text()).toContain('Work sources could not be loaded')
    expect(wrapper!.find('[role="status"]').exists()).toBe(false)
    expect(wrapper!.text()).not.toContain('Bring your projects here')
    expect(wrapper!.text()).not.toContain('Connect your work items')
    expect(api.invokeIntegrationAction).not.toHaveBeenCalled()
  })

  it('keeps home tools compact and leaves plugin navigation to its dedicated page', async () => {
    const tools = Array.from({ length: 8 }, (_, index) => ({ id: `tool-${index}`, title: `Favorite ${index + 1}`, group: 'Tools', url: `https://example.com/tool-${index}` }))
    useWorkbenchStore().settings = snapshot({ tools })
    vi.mocked(api.navigationPanels).mockResolvedValue([{
      id: 'resources',
      pluginId: 'example-resources',
      pluginName: 'Resources plugin',
      pluginVersion: '1.0.0',
      title: 'Developer resources',
      links: [{ id: 'handbook', title: 'Engineering handbook', url: 'https://example.com/handbook', keywords: [] }],
    }])
    await openHome()

    expect(wrapper!.findAll('.home-tool strong').map(name => name.text())).toEqual(tools.slice(0, 6).map(tool => tool.title))
    expect(wrapper!.find('input[type="search"]').exists()).toBe(false)
    expect(wrapper!.find('a[href="https://example.com/handbook"]').exists()).toBe(false)
    await wrapper!.get('[data-testid="view-all-tools"]').trigger('click')
    expect(wrapper!.emitted('openNavigation')).toEqual([[]])
    await wrapper!.setProps({ refreshKey: 1 })
    await flushPromises()
    expect(api.navigationPanels).not.toHaveBeenCalled()
  })

  it('shows all favorites on the tools page and preserves grouped editing and local launch', async () => {
    const tools = Array.from({ length: 8 }, (_, index) => ({ id: `tool-${index}`, title: `Favorite ${index + 1}`, group: index < 4 ? 'Reference' : 'Work tools', url: `https://example.com/tool-${index}` }))
    const nativeTool = { ...tools[7]!, launch: { application: 'orca' as const } }
    const home = { tools: [...tools.slice(0, 7), nativeTool] }
    useWorkbenchStore().settings = snapshot(home)
    const open = vi.fn().mockResolvedValue({ destination: 'application', contextTransferred: false })
    window.craftHubDesktop = { openWorkbenchTool: open }
    await openToolsPage()

    expect(wrapper!.get('h1').text()).toBe('Favorite tools')
    expect(wrapper!.findAll('.home-tool strong').map(name => name.text())).toEqual(tools.map(tool => tool.title))
    expect(wrapper!.find('.workbench-frame-sidebar').exists()).toBe(false)
    await wrapper!.findAll('.home-tool')[7]!.trigger('click')
    await flushPromises()
    expect(open).toHaveBeenCalledWith(nativeTool.id)
    bodyButton('Customize tools').click()
    await flushPromises()
    expect(document.body.querySelectorAll('.home-tool-editor')).toHaveLength(8)
    expect(api.navigationPanels).not.toHaveBeenCalled()
  })

  it('prepares provider work without guessing its project, then copies the selected context', async () => {
    const store = useWorkbenchStore()
    store.projects = [{ id: 'project-a', name: 'Project A', path: '/repos/project-a', trust: 'untrusted', addedAt: '2026-10-08T00:00:00.000Z' }]
    store.integrationContributions = [workProvider('issues', 'Issue source')]
    vi.mocked(api.invokeIntegrationAction).mockResolvedValue({ currentUser: { id: 'me' }, items: [{ id: '42', title: 'Fix workbench', assignees: [{ id: 'me' }], metadata: { workspaceId: 'one', type: 'issue' } }] })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
    await openHome()
    await wrapper!.get('[aria-label="Prepare handoff Fix workbench"]').trigger('click')
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Confirm the project and objective, then copy the context to continue in your tool.')
    const select = dialog.querySelector<HTMLElement>('[data-testid="handoff-project"]')!
    expect(select.textContent).toContain('Choose a project')
    expect(dialog.querySelector<HTMLTextAreaElement>('.home-handoff-preview')!.value).toContain('No project selected')
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent?.includes('Project A · /repos/project-a'))!
    option.focus()
    option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    await editInput('.home-handoff-form textarea:not(.home-handoff-preview)', 'Fix navigation without starting a second agent')
    bodyButton('Copy context').click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0]![0]).toContain('Local path: /repos/project-a')
    expect(writeText.mock.calls[0]![0]).toContain('workspaceId: one')
    expect(writeText.mock.calls[0]![0]).toContain('Fix navigation without starting a second agent')
    expect(dialog.textContent).toContain('Context copied')
    expect(api.invokeIntegrationAction).toHaveBeenCalledOnce()
  })

  it('retains selectable handoff text if clipboard access is denied', async () => {
    useWorkbenchStore().projects = [{ id: 'p', name: 'Project', path: '/repos/project', trust: 'untrusted', addedAt: '2026-10-08T00:00:00.000Z' }]
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'))
    await openHome()
    await wrapper!.get('[aria-label="Prepare handoff Project"]').trigger('click')
    await flushPromises()
    bodyButton('Copy context').click()
    await flushPromises()
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Select the text below')
    expect(document.body.querySelector<HTMLTextAreaElement>('.home-handoff-preview')!.value).toContain('/repos/project')
  })

  it('uses HTTPS in browsers and reports native application requests without claiming task submission', async () => {
    useWorkbenchStore().settings = snapshot({ tools: [{ id: 'orca', title: 'Orca', group: 'Work tools', url: 'https://www.onorca.dev/', launch: { application: 'orca' } }] })
    await openHome()
    expect(wrapper!.get('.home-tool').text()).toContain('Browser mode · Open website')
    expect(wrapper!.get('.home-tool').attributes('href')).toBe('https://www.onorca.dev/')
    wrapper!.unmount()
    const open = vi.fn().mockResolvedValue({ destination: 'application', application: 'orca', contextTransferred: false })
    window.craftHubDesktop = { openWorkbenchTool: open }
    await openHome()
    await wrapper!.get('.home-tool').trigger('click')
    await flushPromises()
    expect(open).toHaveBeenCalledWith('orca')
    expect(wrapper!.get('.home-tools [role="status"]').text()).toContain('paste work context separately')
    open.mockResolvedValue({ destination: 'website', application: 'orca', contextTransferred: false })
    await wrapper!.get('.home-tool').trigger('click')
    await flushPromises()
    expect(wrapper!.get('.home-tools [role="status"]').text()).toContain('local application could not be launched')
  })

  it('clears a Raycast command without mutating saved configuration before the user saves', async () => {
    const tool = { id: 'raycast', title: 'Raycast', group: 'Work tools', url: 'https://www.raycast.com/', launch: { application: 'raycast' as const, commandUrl: 'raycast://extensions/owner/extension/command' } }
    const store = useWorkbenchStore()
    store.settings = snapshot({ tools: [tool] })
    const update = vi.spyOn(api, 'updateSettings').mockResolvedValue(snapshot({ tools: [{ ...tool, launch: { application: 'raycast' } }] }, 'cleared'))
    await openTools()
    await editInput('input[placeholder="raycast://extensions/owner/extension/command"]', '')
    expect(store.settings?.settings['workbench.home'].tools[0]!.launch).toEqual(tool.launch)
    await submitTools()
    expect(update).toHaveBeenCalledWith({ 'workbench.home': { tools: [{ ...tool, launch: { application: 'raycast' } }] } }, 'initial')
  })
})
