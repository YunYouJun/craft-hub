// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { VueWrapper } from '@vue/test-utils'
import type { ProjectRecord, ProjectReference } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DesktopNavigationDialog from './DesktopNavigationDialog.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const reference = { repository: 'https://github.com/YunYouJun/craft-hub', subdir: 'apps/web' }
const projects: ProjectRecord[] = [
  { id: 'one', name: 'One', path: '/one/apps/web', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'two', name: 'Two', path: '/two/apps/web', trust: 'untrusted', addedAt: '2026-01-01T00:00:00.000Z' },
]

let wrapper: VueWrapper | undefined

function mountDialog(props: { matches: ProjectRecord[], reference?: ProjectReference, capabilityId?: string }): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  wrapper = mount(DesktopNavigationDialog, {
    props: { open: true, reference, ...props },
    attachTo: document.body,
    global: { plugins: [pinia] },
  })
  return wrapper
}

function query<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return document.body.querySelector<T>(selector)
}

describe('desktop navigation dialog', () => {
  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    Reflect.deleteProperty(window, 'craftHubDesktop')
  })

  it('makes the user choose when multiple registered Projects match', async () => {
    const dialog = mountDialog({ matches: projects, capabilityId: 'command:dev' })
    const store = useWorkbenchStore()
    const selectProject = vi.spyOn(store, 'selectProject').mockResolvedValue()
    const selectCapability = vi.spyOn(store, 'selectCapability')
    await flushPromises()

    expect(selectProject).not.toHaveBeenCalled()
    expect(query('[data-testid="choose-checkout"]')).toBeNull()
    query('.desktop-project-matches button')!.click()
    await flushPromises()
    expect(selectProject).toHaveBeenCalledWith('one')
    expect(selectCapability).toHaveBeenCalledWith('command:dev')
    expect(dialog.emitted('resolved')).toHaveLength(1)
  })

  it('verifies a selected checkout before offering explicit registration', async () => {
    const verifyProjectReference = vi.fn(async () => true)
    window.craftHubDesktop = {
      selectProjectDirectory: vi.fn(async () => '/checkout/apps/web'),
      verifyProjectReference,
    }
    const dialog = mountDialog({ matches: [] })
    const addProject = vi.spyOn(useWorkbenchStore(), 'addProject').mockResolvedValue()
    await flushPromises()

    expect(query('.desktop-selected-checkout')).toBeNull()
    expect(query('[data-testid="choose-checkout"]')!.className).toContain('ui-button--primary')
    expect(query('[data-testid="register-checkout"]')).toBeNull()
    query('[data-testid="choose-checkout"]')!.click()
    await flushPromises()
    expect(verifyProjectReference).toHaveBeenCalledWith(reference, '/checkout/apps/web')
    expect(query('.desktop-selected-checkout')!.textContent).toContain('/checkout/apps/web')
    expect(query('[data-testid="choose-checkout"]')!.className).toContain('ui-button--secondary')
    expect(addProject).not.toHaveBeenCalled()

    query('[data-testid="register-checkout"]')!.click()
    await flushPromises()
    expect(addProject).toHaveBeenCalledWith('/checkout/apps/web')
    expect(dialog.emitted('resolved')).toHaveLength(1)
  })

  it('shortens the repository label and copies the full URL', async () => {
    const copyText = vi.fn(async () => {})
    window.craftHubDesktop = { copyText }
    mountDialog({ matches: [], reference: { repository: 'git@github.com:YunYouJun/craft-hub.git', subdir: 'packages/craft-hub' } })
    await flushPromises()

    const values = [...document.body.querySelectorAll('.desktop-reference dd')]
    expect(values.map(value => value.textContent)).toEqual(['github.com/YunYouJun/craft-hub', 'packages/craft-hub'])
    expect(values[0]!.getAttribute('title')).toBe('git@github.com:YunYouJun/craft-hub.git')

    const copy = query<HTMLButtonElement>('.desktop-reference-copy')!
    copy.click()
    await flushPromises()
    expect(copyText).toHaveBeenCalledWith('git@github.com:YunYouJun/craft-hub.git')
    const { t } = useI18n()
    expect(copy.getAttribute('aria-label')).toBe(t('desktopLinkRepositoryCopied'))
    expect(query('[role="status"].sr-only')!.textContent).toBe(t('desktopLinkRepositoryCopied'))
  })

  it('closes from cancel and Escape but stays open while a checkout is being verified', async () => {
    let finishVerification: () => void = () => {}
    window.craftHubDesktop = {
      selectProjectDirectory: vi.fn(async () => '/checkout/apps/web'),
      verifyProjectReference: vi.fn(() => new Promise<boolean>((resolve) => {
        finishVerification = () => resolve(true)
      })),
    }
    const dialog = mountDialog({ matches: [] })
    await flushPromises()

    query('[data-testid="choose-checkout"]')!.click()
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(dialog.emitted('update:open')).toBeUndefined()

    finishVerification()
    await flushPromises()
    const { t } = useI18n()
    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('.dialog-panel-footer button')].find(button => button.textContent?.trim() === t('cancel'))!
    cancel.click()
    await flushPromises()
    expect(dialog.emitted('update:open')).toEqual([[false]])
  })
})
