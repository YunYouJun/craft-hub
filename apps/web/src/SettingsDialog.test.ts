// @vitest-environment happy-dom
/// <reference lib="dom" />

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'
import SettingsDialog from './SettingsDialog.vue'
import { useWorkbenchStore } from './store'

describe('settings dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.localStorage.clear()
    delete window.craftHubDesktop
    setActivePinia(createPinia())
    useI18n().setLocale('en')
    useWorkbenchStore().settings = {
      explicitKeys: [],
      path: '/settings.json',
      revision: 'initial',
      settings: { 'workbench.locale': 'en', 'workbench.theme': 'system' },
    }
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const patch = init?.body ? JSON.parse(String(init.body)).settings as Record<string, string> : {}
      return new Response(JSON.stringify({
        explicitKeys: Object.keys(patch),
        path: '/settings.json',
        revision: 'updated',
        settings: {
          'workbench.locale': patch['workbench.locale'] ?? 'en',
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
    expect(tabs.map(tab => tab.textContent)).toEqual(['General', 'Personal cloud', 'Run history', 'Import and export'])
    expect(document.body.textContent).not.toContain('Export changed settings')

    tabs[3]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await flushPromises()

    expect(tabs[3]!.getAttribute('data-state')).toBe('active')
    expect(document.body.textContent).toContain('Export changed settings')
    expect(document.body.textContent).not.toContain('Choose the language used throughout Craft Hub.')
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
})
