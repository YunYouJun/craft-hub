// @vitest-environment happy-dom
/// <reference lib="dom" />

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useI18n } from './i18n'

describe('i18n', () => {
  beforeEach(() => setActivePinia(createPinia()))

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
})
