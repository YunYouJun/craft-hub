// @vitest-environment happy-dom
/// <reference lib="dom" />

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'

describe('i18n', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('craftHubDesktop', undefined)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('switches between Chinese and English without maintaining a second storage source', () => {
    const { setLocale, t } = useI18n()

    setLocale('zh-CN')
    expect(t('addProject')).toBe('添加项目')
    expect(window.localStorage.getItem('craft-hub-locale')).toBeNull()

    setLocale('en')
    expect(t('addProject')).toBe('Add project')
    expect(document.documentElement.lang).toBe('en')
  })

  it('keeps existing consumers synchronized when the i18n module reloads', async () => {
    const existingConsumer = useI18n()
    existingConsumer.setLocale('zh-CN')

    vi.resetModules()
    const reloadedModule = await import('./i18n')
    reloadedModule.useI18n().setLocale('en')

    expect(existingConsumer.locale.value).toBe('en')
    expect(existingConsumer.t('addProject')).toBe('Add project')
  })

  it('synchronizes native menus for locale changes and persisted settings application', () => {
    const setDesktopLocale = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('craftHubDesktop', { setLocale: setDesktopLocale })
    const { setLocale, t } = useI18n()

    expect(setDesktopLocale).not.toHaveBeenCalled()
    setLocale('en')
    expect(setDesktopLocale).toHaveBeenLastCalledWith('en')
    expect(t('addProject')).toBe('Add project')
    setLocale('zh-CN')
    expect(setDesktopLocale).toHaveBeenLastCalledWith('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(setDesktopLocale).toHaveBeenCalledTimes(2)
  })

  it('continues rendering the selected locale if the desktop host rejects synchronization', async () => {
    vi.stubGlobal('craftHubDesktop', { setLocale: vi.fn().mockRejectedValue(new Error('Desktop host unavailable')) })
    const { setLocale, t } = useI18n()
    setLocale('en')
    await Promise.resolve()

    expect(t('addProject')).toBe('Add project')
    expect(document.documentElement.lang).toBe('en')
  })
})
