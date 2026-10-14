// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { celebration } from './celebration'
import { useI18n } from './i18n'
import SettingsDialog from './SettingsDialog.vue'
import { applicationShortcutReferencesForPlatform, desktopSidebarShortcut, formatShortcut, isMacPlatform } from './shortcuts'
import { useWorkbenchStore } from './store'

vi.mock('./celebration', () => ({
  celebration: {
    fire: vi.fn(() => true),
    reset: vi.fn(),
  },
}))

describe('settings dialog', () => {
  let personalRepositoryPath: string | undefined

  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    delete window.craftHubDesktop
    personalRepositoryPath = undefined
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    vi.mocked(celebration.fire).mockClear()
    useWorkbenchStore().settings = {
      explicitKeys: [],
      path: '/settings.json',
      revision: 'initial',
      settings: { 'workbench.codex': {}, 'workbench.editor': { default: 'vscode' }, 'workbench.home': { tools: [] }, 'workbench.locale': 'en', 'workbench.repositoriesRoot': '', 'workbench.sidebar': { entries: [] }, 'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' }, 'workbench.theme': 'system' },
    }
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(_input)
      if (path === '/api/personal-git-sync') {
        if (init?.method === 'PUT') {
          const target = JSON.parse(String(init.body)) as { repositoryPath: string, directory: string }
          personalRepositoryPath = target.repositoryPath
          return new Response(JSON.stringify({ state: 'local-ahead', target, snapshotPath: `${target.repositoryPath}/${target.directory}/personal.snapshot.json` }), { status: 200 })
        }
        return new Response(JSON.stringify(personalRepositoryPath
          ? { state: 'local-ahead', target: { repositoryPath: personalRepositoryPath, directory: '.craft-hub' }, snapshotPath: `${personalRepositoryPath}/.craft-hub/personal.snapshot.json` }
          : { state: 'unconfigured' }), { status: 200 })
      }
      if (path === '/api/personal-git-sync/synchronize')
        return new Response(JSON.stringify({ state: 'clean' }), { status: 200 })
      if (path === '/api/user-config')
        return new Response(JSON.stringify({ configDir: '/Users/me/.craft-hub', diagnostics: [], files: ['config.jsonc'], format: 'jsonc' }), { status: 200 })
      if (path === '/api/dotfiles-manager') {
        if (personalRepositoryPath) {
          return new Response(JSON.stringify({
            state: 'untrusted',
            repositoryPath: personalRepositoryPath,
            manifestPath: `${personalRepositoryPath}/.craft-hub/dotfiles.jsonc`,
            manifestRevision: 'manifest',
            manifest: { version: 1, adapter: 'command', operations: { check: { command: 'pnpm', args: ['doctor'] } } },
          }), { status: 200 })
        }
        return new Response(JSON.stringify({ state: 'unconfigured' }), { status: 200 })
      }
      if (path === '/api/dotfiles-manager/trust')
        return new Response(JSON.stringify({ state: 'ready', repositoryPath: '/Users/me/dotfiles', manifest: { version: 1, adapter: 'command', operations: { check: { command: 'pnpm', args: ['doctor'] } } } }), { status: 200 })
      if (path === '/api/dotfiles-manager/operations/check')
        return new Response(JSON.stringify({ operation: 'check', command: 'pnpm', args: ['doctor'], durationMs: 5, exitCode: 0, stdout: 'healthy', stderr: '', succeeded: true, timedOut: false }), { status: 200 })
      const patch = init?.body ? JSON.parse(String(init.body)).settings as Record<string, unknown> : {}
      return new Response(JSON.stringify({
        explicitKeys: Object.keys(patch),
        path: '/settings.json',
        revision: 'updated',
        settings: {
          'workbench.codex': patch['workbench.codex'] ?? {},
          'workbench.editor': patch['workbench.editor'] ?? { default: 'vscode' },
          'workbench.home': patch['workbench.home'] ?? { tools: [] },
          'workbench.locale': patch['workbench.locale'] ?? 'en',
          'workbench.repositoriesRoot': patch['workbench.repositoriesRoot'] ?? '',
          'workbench.sidebar': patch['workbench.sidebar'] ?? { entries: [] },
          'workbench.shortcuts': patch['workbench.shortcuts'] ?? { 'workbench.showCommandPalette': 'Mod+K' },
          'workbench.theme': patch['workbench.theme'] ?? 'system',
        },
      }), { status: 200 })
    }))
  })

  afterEach(() => vi.unstubAllGlobals())

  it('switches the workbench language from a visible setting', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('[data-testid="locale-zh-CN"]')!.click()
    await flushPromises()

    expect(document.body.textContent).toContain('显示语言')
    expect(useWorkbenchStore().settings?.settings['workbench.locale']).toBe('zh-CN')
    expect(window.localStorage.getItem('craft-hub-locale')).toBeNull()
  })

  it('associates grouped setting fields with visible labels', async () => {
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    for (const testId of ['repositories-root', 'default-editor', 'custom-editor-name', 'custom-editor-command', 'custom-editor-args', 'codex-model', 'codex-reasoning-effort']) {
      const control = document.body.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)!
      const label = document.body.querySelector<HTMLLabelElement>(`label[for="${control.id}"]`)!
      expect(label.textContent?.trim()).not.toBe('')
      expect(control.labels).toContain(label)
    }
    for (const section of document.body.querySelectorAll('[data-slot="settings-section"]')) {
      expect(document.getElementById(section.getAttribute('aria-labelledby')!)?.tagName).toBe('H3')
    }
    expect(document.body.querySelector('[data-testid="locale-en"]')?.getAttribute('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('saves a shell-free custom editor configuration', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    await document.body.querySelector<HTMLSelectElement>('[data-testid="default-editor"]')!.setAttribute('value', 'custom')
    const select = document.body.querySelector<HTMLSelectElement>('[data-testid="default-editor"]')!
    select.value = 'custom'
    select.dispatchEvent(new Event('change'))
    const name = document.body.querySelector<HTMLInputElement>('[data-testid="custom-editor-name"]')!
    name.value = 'Cursor'
    name.dispatchEvent(new Event('input'))
    const command = document.body.querySelector<HTMLInputElement>('[data-testid="custom-editor-command"]')!
    command.value = 'cursor'
    command.dispatchEvent(new Event('input'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="save-editor-setting"]')!.click()
    await flushPromises()

    expect(useWorkbenchStore().settings?.settings['workbench.editor']).toEqual({
      default: 'custom',
      custom: { name: 'Cursor', command: 'cursor', args: ['{path}'] },
    })
  })

  it('saves optional Codex model and reasoning defaults', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const model = document.body.querySelector<HTMLInputElement>('[data-testid="codex-model"]')!
    model.value = 'gpt-5.6-sol'
    model.dispatchEvent(new Event('input'))
    const effort = document.body.querySelector<HTMLSelectElement>('[data-testid="codex-reasoning-effort"]')!
    effort.value = 'high'
    effort.dispatchEvent(new Event('change'))
    document.body.querySelector<HTMLButtonElement>('[data-testid="save-codex-setting"]')!.click()
    await flushPromises()

    expect(useWorkbenchStore().settings?.settings['workbench.codex']).toEqual({ model: 'gpt-5.6-sol', reasoningEffort: 'high' })
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      body: expect.stringContaining('"workbench.codex":{"model":"gpt-5.6-sol","reasoningEffort":"high"}'),
      method: 'PATCH',
    }))
  })

  it('saves a global repositories root and uses it as the folder picker start', async () => {
    const selectProjectDirectory = vi.fn(async () => '/Users/example/new-repos')
    window.craftHubDesktop = { selectProjectDirectory }
    const store = useWorkbenchStore()
    store.settings!.settings['workbench.repositoriesRoot'] = '/Users/example/repos'
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('[data-testid="choose-repositories-root"]')!.click()
    await flushPromises()
    expect(selectProjectDirectory).toHaveBeenCalledWith('/Users/example/repos')
    expect(document.body.querySelector<HTMLInputElement>('[data-testid="repositories-root"]')!.value).toBe('/Users/example/new-repos')

    document.body.querySelector<HTMLButtonElement>('[data-testid="save-repositories-root"]')!.click()
    await flushPromises()
    expect(store.settings?.settings['workbench.repositoriesRoot']).toBe('/Users/example/new-repos')
  })

  it('uses the narrow desktop cloud bridge without exposing execution controls', async () => {
    const cloudConnect = vi.fn(async () => {})
    window.craftHubDesktop = {
      cloudStatus: vi.fn(async () => ({ state: 'disconnected' as const })),
      cloudConnect,
    }
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const cloudTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Personal cloud')
    cloudTab!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    const connect = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Connect YunLeFun')
    expect(connect).toBeTruthy()
    connect!.click()
    await flushPromises()

    expect(cloudConnect).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('terminal output')
    expect(document.body.textContent).not.toContain('Codex prompt')
    delete window.craftHubDesktop
  })

  it('separates settings into keyboard-accessible tab panels', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const tabs = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs.map(tab => tab.textContent)).toEqual(['General', 'Agent connection', 'Keyboard shortcuts', 'Personal cloud', 'Configuration', 'Run history', 'Import and export', 'Help'])
    expect(document.body.textContent).not.toContain('Export changed settings')

    const importTab = tabs.find(tab => tab.textContent === 'Import and export')!
    importTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    expect(importTab.getAttribute('data-state')).toBe('active')
    expect(document.body.textContent).toContain('Export changed settings')
    expect(document.body.textContent).not.toContain('Choose the language used throughout Craft Hub.')
  })

  it('restores the selected pane when reopening and honors an explicit new pane', async () => {
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const shortcuts = document.body.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Keyboard shortcuts"]')!
    shortcuts.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()
    expect(document.body.querySelector('.settings-header h2')?.textContent).toContain('Keyboard shortcuts')
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Settings')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Keyboard shortcuts')

    await wrapper.setProps({ open: false, initialTab: 'help' })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.body.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Help')
    expect(document.body.querySelector('.settings-header h2')?.textContent).toContain('Help')
    wrapper.unmount()
  })

  it('labels source-list entries while keeping their icons decorative', async () => {
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const tabs = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')]
    expect(tabs).toHaveLength(8)
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-label')).toBe(tab.textContent?.trim())
      expect(tab.getAttribute('title')).toBe(tab.getAttribute('aria-label'))
      expect(tab.querySelector('.app-icon')?.getAttribute('aria-hidden')).toBe('true')
    }
    wrapper.unmount()
  })

  it('adapts arrow-key navigation when the source list becomes horizontal', async () => {
    const media = Object.assign(new EventTarget(), {
      matches: false,
      media: '(max-width: 620px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as MediaQueryList
    const originalMatchMedia = window.matchMedia.bind(window)
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(query => query === media.media ? media : originalMatchMedia(query))
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    try {
      await flushPromises()
      const list = document.body.querySelector<HTMLElement>('[role="tablist"]')!
      const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
      expect(list.getAttribute('aria-orientation')).toBe('vertical')
      tabs[0]!.focus()
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      await flushPromises()
      expect(document.activeElement).toBe(tabs[0])
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
      await flushPromises()
      expect(document.activeElement).toBe(tabs[1])
      expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')

      Object.defineProperty(media, 'matches', { value: true })
      media.dispatchEvent(Object.assign(new Event('change'), { matches: true }))
      await flushPromises()
      expect(list.getAttribute('aria-orientation')).toBe('horizontal')
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
      await flushPromises()
      expect(document.activeElement).toBe(tabs[1])
      tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      await flushPromises()
      expect(document.activeElement).toBe(tabs[2])
      expect(tabs[2]!.getAttribute('aria-selected')).toBe('true')
      expect(document.body.querySelector('[role="tabpanel"][data-state="active"]')?.getAttribute('aria-labelledby')).toBe(tabs[2]!.id)
    }
    finally {
      wrapper.unmount()
      matchMedia.mockRestore()
    }
  })

  it('reveals the selected help entry when opening on a narrow viewport', async () => {
    const originalMatchMedia = window.matchMedia.bind(window)
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(max-width: 620px)'
      ? { matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }
      : originalMatchMedia(query))
    const reveal = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    const wrapper = mount(SettingsDialog, { props: { initialTab: 'help', open: true }, attachTo: document.body })
    try {
      await flushPromises()
      const help = document.body.querySelector<HTMLElement>('[role="tab"][aria-label="Help"]')!
      expect(help.getAttribute('aria-selected')).toBe('true')
      expect(reveal.mock.contexts).toContain(help)
      expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
      expect(document.body.textContent).toContain('Confetti is visual only')
    }
    finally {
      wrapper.unmount()
      matchMedia.mockRestore()
      reveal.mockRestore()
    }
  })

  it('offers a confetti test in general settings', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    expect(document.body.textContent).toContain('Preview confetti in this window.')
    document.body.querySelector<HTMLButtonElement>('[data-testid="test-celebration-settings"]')!.click()

    expect(celebration.fire).toHaveBeenCalledOnce()
  })

  it('opens directly to help with a safe celebration explanation and test', async () => {
    mount(SettingsDialog, { props: { initialTab: 'help', open: true }, attachTo: document.body })
    await flushPromises()

    const helpTab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent === 'Help')
    expect(helpTab?.getAttribute('data-state')).toBe('active')
    expect(document.body.textContent).toContain('Confetti is visual only: it does not confirm, change, or complete a task.')
    expect(document.body.textContent).toContain('Celebrate this milestone in Craft Hub.')

    document.body.querySelector<HTMLButtonElement>('[data-testid="test-celebration-help"]')!.click()
    expect(celebration.fire).toHaveBeenCalledOnce()
  })

  it('records and persists a custom command palette shortcut', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const shortcutTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Keyboard shortcuts')!
    shortcutTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    const recorder = document.body.querySelector<HTMLButtonElement>('[data-testid="shortcut-workbench.showCommandPalette"]')!
    recorder.click()
    const primaryModifier = isMacPlatform() ? { metaKey: true } : { ctrlKey: true }
    recorder.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'p', shiftKey: true, ...primaryModifier }))
    await flushPromises()

    expect(useWorkbenchStore().settings?.settings['workbench.shortcuts']['workbench.showCommandPalette']).toBe('Mod+Shift+P')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      body: expect.stringContaining('"workbench.showCommandPalette":"Mod+Shift+P"'),
      method: 'PATCH',
    }))
  })

  it('lists every built-in application shortcut with its purpose', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const shortcutTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Keyboard shortcuts')!
    shortcutTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    const rows = [...document.body.querySelectorAll('.shortcut-reference-row')]
    expect(rows).toHaveLength(applicationShortcutReferencesForPlatform().length)
    expect(rows.map(row => row.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Navigate Command Palette results'),
      expect.stringContaining('Open Home'),
      expect.stringContaining('Open Development Environment'),
      expect.stringContaining('Show or hide the sidebar'),
      expect.stringContaining('Refresh the workbench'),
      expect.stringContaining('Reorder a pinned command or skill'),
      expect.stringContaining('Resize workbench panels'),
      expect.stringContaining('Open a terminal link'),
    ]))
    expect(rows.find(row => row.textContent?.includes('Show or hide the sidebar'))?.textContent).toContain(formatShortcut(desktopSidebarShortcut()))
    expect(document.body.textContent).toContain('Built-in keyboard and pointer shortcuts supported throughout Craft Hub.')
  })

  it('persists and applies a color theme from general settings', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    document.body.querySelector<HTMLButtonElement>('[data-testid="theme-dark"]')!.click()
    await flushPromises()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(useWorkbenchStore().settings?.settings['workbench.theme']).toBe('dark')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/settings', expect.objectContaining({
      body: expect.stringContaining('"workbench.theme":"dark"'),
      method: 'PATCH',
    }))
  })

  it('checks for signed desktop updates and persists the automatic-check switch', async () => {
    const setAutomaticUpdates = vi.fn(async (automaticCheck: boolean) => ({
      automaticCheck,
      currentVersion: '0.0.1',
      phase: automaticCheck ? 'checking' as const : 'disabled' as const,
    }))
    const checkForUpdates = vi.fn(async () => ({
      automaticCheck: false,
      currentVersion: '0.0.1',
      phase: 'checking' as const,
    }))
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => ({ automaticCheck: true, currentVersion: '0.0.1', phase: 'idle' as const })),
      setAutomaticUpdates,
      checkForUpdates,
      onUpdateStatus: vi.fn(() => () => {}),
    }

    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const toggle = document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-updates"]')!
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    await flushPromises()

    expect(setAutomaticUpdates).toHaveBeenCalledWith(false)
    const checkButton = document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!
    expect(checkButton.classList).toContain('ui-button--secondary')
    checkButton.click()
    await flushPromises()
    expect(checkForUpdates).toHaveBeenCalledOnce()
  })

  it('keeps the downloaded update available after postponing a restart and cleans up status events', async () => {
    let status: DesktopUpdateStatus = { automaticCheck: true, currentVersion: '0.0.1', phase: 'idle' }
    let onStatus: ((status: DesktopUpdateStatus) => void) | undefined
    let finishInstall!: (status: DesktopUpdateStatus) => void
    const installUpdate = vi.fn(() => new Promise<DesktopUpdateStatus>((resolve) => {
      finishInstall = resolve
    }))
    const removeListener = vi.fn()
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => status),
      setAutomaticUpdates: vi.fn(async () => status),
      checkForUpdates: vi.fn(async () => status),
      installUpdate,
      onUpdateStatus: vi.fn((callback) => {
        onStatus = callback
        return removeListener
      }),
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    status = { ...status, phase: 'available', releaseName: '0.0.2' }
    onStatus!(status)
    await flushPromises()
    const progress = document.body.querySelector<HTMLProgressElement>('[data-testid="update-download-progress"]')!
    expect(progress.hasAttribute('value')).toBe(false)
    expect(progress.getAttribute('aria-label')).toBe('Update found · downloading')
    expect(document.body.textContent).toContain('Update: 0.0.2')

    status = { ...status, phase: 'downloaded' }
    onStatus!(status)
    await flushPromises()
    expect(document.body.textContent).toContain('Update downloaded · restart when ready')
    expect(document.body.querySelector('[data-testid="update-download-progress"]')).toBeNull()
    expect(document.body.querySelector('[data-testid="check-for-updates"]')).toBeNull()
    expect(installUpdate).not.toHaveBeenCalled()

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    const installButton = document.body.querySelector<HTMLButtonElement>('[data-testid="install-update"]')!
    expect(installButton.textContent).toBe('Restart and install')
    expect(installButton.disabled).toBe(false)
    installButton.click()
    await flushPromises()
    expect(installButton.disabled).toBe(true)
    installButton.click()
    expect(installUpdate).toHaveBeenCalledOnce()
    finishInstall(status)
    await flushPromises()

    wrapper.unmount()
    expect(removeListener).toHaveBeenCalledOnce()
  })

  it.each(['unsupported', 'checking', 'available'] as const)('disables unsupported or active update controls when %s', async (phase) => {
    const status: DesktopUpdateStatus = { automaticCheck: true, currentVersion: '0.0.1', phase }
    const setAutomaticUpdates = vi.fn(async () => status)
    const checkForUpdates = vi.fn(async () => status)
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => status),
      setAutomaticUpdates,
      checkForUpdates,
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const toggle = document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-updates"]')!
    const check = document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!
    expect(toggle.disabled).toBe(true)
    expect(check.disabled).toBe(true)
    toggle.click()
    check.click()
    await flushPromises()
    expect(setAutomaticUpdates).not.toHaveBeenCalled()
    expect(checkForUpdates).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocks repeated checks while the desktop bridge request is pending', async () => {
    let finishCheck!: (status: DesktopUpdateStatus) => void
    const checkForUpdates = vi.fn(() => new Promise<DesktopUpdateStatus>((resolve) => {
      finishCheck = resolve
    }))
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => ({ automaticCheck: true, currentVersion: '0.0.1', phase: 'idle' as const })),
      setAutomaticUpdates: vi.fn(),
      checkForUpdates,
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const check = document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!
    check.click()
    await flushPromises()
    expect(check.disabled).toBe(true)
    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-updates"]')!.disabled).toBe(true)
    check.click()
    expect(checkForUpdates).toHaveBeenCalledOnce()
    finishCheck({ automaticCheck: true, currentVersion: '0.0.1', phase: 'up-to-date' })
    await flushPromises()
    expect(check.disabled).toBe(false)
    wrapper.unmount()
  })

  it('shows an update-status read error beside the disabled update controls', async () => {
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => { throw new Error('Could not read updater status') }),
      setAutomaticUpdates: vi.fn(),
      checkForUpdates: vi.fn(),
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    expect(document.body.querySelector('.desktop-update-settings [role="alert"]')?.textContent).toContain('Could not read updater status')
    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!.disabled).toBe(true)
    wrapper.unmount()
  })

  it.each(['check', 'preference'] as const)('reports a failed update %s request beside the controls', async (action) => {
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => ({ automaticCheck: true, currentVersion: '0.0.1', phase: 'idle' as const })),
      setAutomaticUpdates: vi.fn(async () => { throw new Error('Could not save automatic updates') }),
      checkForUpdates: vi.fn(async () => { throw new Error('Could not check for updates') }),
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    if (action === 'check') {
      document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!.click()
    }
    else {
      const toggle = document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-updates"]')!
      toggle.click()
    }
    await flushPromises()
    expect(document.body.querySelector('.desktop-update-settings [role="alert"]')?.textContent)
      .toContain(action === 'check' ? 'Could not check for updates' : 'Could not save automatic updates')
    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="check-for-updates"]')!.disabled).toBe(false)
    expect(document.body.querySelector<HTMLButtonElement>('[data-testid="automatic-updates"]')!.disabled).toBe(false)
    wrapper.unmount()
  })

  it('reports a failed installation and leaves the downloaded update ready to retry', async () => {
    window.craftHubDesktop = {
      updateStatus: vi.fn(async () => ({ automaticCheck: true, currentVersion: '0.0.1', phase: 'downloaded' as const, releaseName: '0.0.2' })),
      installUpdate: vi.fn(async () => { throw new Error('Could not restart Craft Hub') }),
    }
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()

    const install = document.body.querySelector<HTMLButtonElement>('[data-testid="install-update"]')!
    install.click()
    await flushPromises()
    expect(document.body.querySelector('.desktop-update-settings [role="alert"]')?.textContent).toContain('Could not restart Craft Hub')
    expect(install.disabled).toBe(false)
    expect(document.body.textContent).toContain('Update: 0.0.2')
    wrapper.unmount()
  })

  it('keeps browser settings usable without a desktop update bridge', async () => {
    const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    expect(document.body.querySelector('.desktop-update-settings')).toBeNull()
    expect(document.body.querySelector('[data-testid="locale-zh-CN"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('enables official Codex activity hooks through the desktop bridge', async () => {
    const installCodexActivityHooks = vi.fn(async () => ({
      installed: true,
      requiresTrustReview: true,
      runningSessionIds: [],
      supported: true,
    }))
    window.craftHubDesktop = {
      codexActivityStatus: vi.fn(async () => ({ installed: false, runningSessionIds: [], supported: true })),
      installCodexActivityHooks,
    }

    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const activityButton = document.body.querySelector<HTMLButtonElement>('[data-testid="toggle-codex-activity"]')!
    expect(activityButton.classList).toContain('ui-button--secondary')
    activityButton.click()
    await flushPromises()

    expect(installCodexActivityHooks).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Live activity enabled')
    expect(document.body.textContent).toContain('Open /hooks in Codex')
  })

  it('configures a Personal Git sync target from the configuration panel', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const configurationTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Configuration')!
    configurationTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    const repository = document.body.querySelector<HTMLInputElement>('input[name="git-repository-path"]')!
    repository.value = '/Users/me/dotfiles'
    repository.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="personal-git-sync-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/personal-git-sync', expect.objectContaining({
      body: JSON.stringify({ repositoryPath: '/Users/me/dotfiles', directory: '.craft-hub' }),
      method: 'PUT',
    }))
    expect(document.body.querySelectorAll('input[name="git-repository-path"]')).toHaveLength(1)
    expect(document.body.querySelector('input[name="dotfiles-repository-path"]')).toBeNull()
    expect(document.body.textContent).toContain('Local configuration has changes to export')
    expect(document.body.textContent).toContain('pnpm doctor')
  })

  it('reviews, trusts, and runs a read-only dotfiles operation', async () => {
    mount(SettingsDialog, { props: { open: true }, attachTo: document.body })
    await flushPromises()
    const configurationTab = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === 'Configuration')!
    configurationTab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    const repository = document.body.querySelector<HTMLInputElement>('input[name="git-repository-path"]')!
    repository.value = '/Users/me/dotfiles'
    repository.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector<HTMLFormElement>('[data-testid="personal-git-sync-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('pnpm doctor')
    expect(document.body.querySelectorAll('.dotfiles-command')).toHaveLength(1)
    expect(document.body.querySelector('.dotfiles-command code')?.textContent).toBe('check')

    document.body.querySelector<HTMLButtonElement>('[data-testid="trust-dotfiles"]')!.click()
    await flushPromises()
    document.body.querySelector<HTMLButtonElement>('[data-testid="run-dotfiles-check"]')!.click()
    await flushPromises()

    expect(document.body.textContent).toContain('healthy')
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/dotfiles-manager/operations/check', expect.objectContaining({ method: 'POST' }))
  })
})
