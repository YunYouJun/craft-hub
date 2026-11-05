/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import { useI18n } from './i18n'
import ProjectRail from './ProjectRail.vue'
import { useWorkbenchStore } from './store'
import './styles.css'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./AccountMenu.vue', () => ({ default: { template: '<button aria-label="Account" />' } }))

let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof mount> | undefined

beforeEach(async () => {
  await page.viewport(1280, 820)
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  useI18n().setLocale('zh-CN')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('project sidebar width', () => {
  it.each([188, 216, 346])('keeps controls inside a %ipx sidebar with an uncommitted sync snapshot', async (width) => {
    const store = useWorkbenchStore()
    store.ownerScopes = [{ id: 'example', kind: 'team', name: 'Example Studio' }]
    store.activeOwnerScopeId = 'example'
    store.workspaceGroups = [{ id: 'shared', name: 'Shared projects', ownerScopeId: 'example' }]
    store.activeTeamSyncStatus = { ownerScopeId: 'example', state: 'clean', workingTreeChanged: true }
    wrapper = mount(ProjectRail, {
      attachTo: document.body,
      global: { plugins: [pinia] },
    })
    const sidebar = wrapper.get<HTMLElement>('.project-rail').element
    sidebar.style.width = `calc(${width}px + var(--workbench-activity-width))`
    sidebar.style.height = '720px'
    await nextTick()
    const rail = wrapper.get<HTMLElement>('.rail-content').element
    const bounds = rail.getBoundingClientRect()
    expect(Math.round(bounds.width)).toBe(width)
    expect(rail.scrollWidth).toBeLessThanOrEqual(rail.clientWidth + 1)
    for (const selector of ['.rail-controls', '.project-section-tabs', '.team-sync-indicator', '[data-testid="manage-team"]', '.team-sync-status', '.rail-heading', '.rail-search', '.collection-filter', '[data-testid="add-workspace-group"]', '.rail-list']) {
      const control = wrapper.get<HTMLElement>(selector).element.getBoundingClientRect()
      expect(control.left, selector).toBeGreaterThanOrEqual(bounds.left)
      expect(control.right, selector).toBeLessThanOrEqual(bounds.right)
    }
    for (const state of ['conflict', 'unconfigured'] as const) {
      store.activeTeamSyncStatus = { ownerScopeId: 'example', state }
      await nextTick()
      const status = wrapper.get<HTMLElement>('.team-sync-status').element
      expect(status.scrollWidth, state).toBeLessThanOrEqual(status.clientWidth + 1)
    }
  })
})
