// @vitest-environment happy-dom
/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('workbench theme', () => {
  let onChange: ((event: MediaQueryListEvent) => void) | undefined
  let matches = false

  beforeEach(() => {
    vi.resetModules()
    matches = false
    onChange = undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return matches },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { onChange = listener },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    delete window.craftHubDesktop
    delete document.documentElement.dataset.theme
  })

  afterEach(() => vi.unstubAllGlobals())

  it('applies explicit themes and forwards the preference to Electron', async () => {
    const setTheme = vi.fn(async () => {})
    window.craftHubDesktop = { setTheme }
    const { applyWorkbenchTheme, resolvedWorkbenchTheme } = await import('./theme')

    applyWorkbenchTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(resolvedWorkbenchTheme.value).toBe('dark')
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('tracks operating-system changes only while using the system theme', async () => {
    const { applyWorkbenchTheme } = await import('./theme')
    applyWorkbenchTheme('system')

    matches = true
    onChange?.({ matches: true } as MediaQueryListEvent)
    expect(document.documentElement.dataset.theme).toBe('dark')

    applyWorkbenchTheme('light')
    matches = false
    onChange?.({ matches: false } as MediaQueryListEvent)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
