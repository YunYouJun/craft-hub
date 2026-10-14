// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { WorkbenchSidebarSetting } from 'craft-hub'
import type { ActivityNavigationItem } from './sidebar-navigation'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityNavigation from './ActivityNavigation.vue'
import { useI18n } from './i18n'

const items: ActivityNavigationItem[] = [
  { id: 'builtin:home', title: 'Home', builtinIcon: 'home', testId: 'open-overview', className: 'overview-button' },
  { id: 'builtin:tools', title: 'Tools', builtinIcon: 'package', testId: 'open-tools' },
  { id: 'plugin:acme:issues', title: 'Issues', icon: 'emoji:🧩', testId: 'open-plugin-workbench', className: 'plugin-workbench-button' },
]
const utilityItems: ActivityNavigationItem[] = [
  { id: 'builtin:marketplace', title: 'Plugins', builtinIcon: 'plugins', testId: 'open-marketplace', className: 'marketplace-button' },
  { id: 'builtin:diagnostics', title: 'Diagnostics', builtinIcon: 'error', testId: 'open-diagnostics' },
  { id: 'builtin:settings', title: 'Settings', builtinIcon: 'settings', testId: 'open-settings' },
]
const groupedSetting: WorkbenchSidebarSetting = {
  entries: [
    { kind: 'item', id: 'builtin:home', visible: true },
    { kind: 'separator', id: 'separator:group' },
    { kind: 'item', id: 'plugin:acme:issues', visible: true },
    { kind: 'item', id: 'builtin:tools', visible: true },
  ],
}

function bodyElement(selector: string): DOMWrapper<HTMLElement> {
  const element = document.body.querySelector<HTMLElement>(selector)
  expect(element).not.toBeNull()
  return new DOMWrapper(element!)
}

function dragTransfer(): DataTransfer {
  return new DataTransfer()
}

function targetBounds(element: Element): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 140, left: 100, right: 200, width: 100, height: 40, x: 100, y: 100, toJSON: () => ({}) })
}

describe('activity navigation', () => {
  const wrappers: ReturnType<typeof mount>[] = []

  function render(props: Partial<InstanceType<typeof ActivityNavigation>['$props']> = {}) {
    const wrapper = mount(ActivityNavigation, {
      attachTo: document.body,
      props: { items, setting: groupedSetting, collapsed: false, ...props },
    })
    wrappers.push(wrapper)
    return wrapper
  }

  async function openMore(wrapper: ReturnType<typeof render>): Promise<void> {
    await wrapper.get('[data-testid="sidebar-more"]').trigger('click')
    await flushPromises()
  }

  async function customize(wrapper: ReturnType<typeof render>): Promise<void> {
    await openMore(wrapper)
    await bodyElement('[data-testid="customize-sidebar"]').trigger('click')
    await flushPromises()
  }

  function lastUpdate(wrapper: ReturnType<typeof render>): WorkbenchSidebarSetting {
    return wrapper.emitted('update')!.at(-1)![0] as WorkbenchSidebarSetting
  }

  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    useI18n().setLocale('en')
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0))
      wrapper.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('separates built-in and plugin icons while preserving their configured group order', async () => {
    const wrapper = render({ items: items.map(item => ({ ...item, active: item.id === 'plugin:acme:issues', badge: item.id === 'builtin:tools' ? 3 : undefined })) })

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Main navigation')
    expect(wrapper.findAll('nav [data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual([
      'builtin:home',
      'separator:group',
      'builtin:tools',
      'plugin:acme:issues',
    ])
    expect(wrapper.get('.sidebar-builtins-entries').find('[data-testid="sidebar-more"]').exists()).toBe(true)
    expect(wrapper.get('.sidebar-plugins-entries').find('[data-testid="sidebar-more"]').exists()).toBe(false)
    const divider = wrapper.get('[data-testid="sidebar-plugin-divider"]')
    expect(divider.attributes('data-sidebar-entry')).toBeUndefined()
    expect(divider.attributes('draggable')).not.toBe('true')
    expect(wrapper.get('.sidebar-plugins-entries').element.firstElementChild).toBe(divider.element)
    expect(Array.from(wrapper.get('.sidebar-primary').element.children)).toEqual([
      wrapper.get('.sidebar-builtins-entries').element,
      wrapper.get('.sidebar-plugins-entries').element,
    ])
    expect(wrapper.get('[role="separator"]').attributes('aria-orientation')).toBe('horizontal')
    expect(wrapper.get('[data-testid="open-plugin-workbench"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('[data-testid="open-tools"] .activity-badge').text()).toBe('3')
    expect(wrapper.get('[data-testid="open-plugin-workbench"]').classes()).toContain('plugin-workbench-button')
    await wrapper.get('[data-testid="open-plugin-workbench"]').trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['plugin:acme:issues']])

    await wrapper.setProps({ collapsed: true })
    expect(wrapper.get('nav').classes()).toContain('sidebar-navigation-collapsed')
    expect(wrapper.get('[data-testid="open-overview"]').attributes('title')).toBe('Home')
  })

  it('adds the upper plugin boundary for a saved layout created before plugins were installed', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: [
        { kind: 'item', id: 'builtin:tools', visible: false },
        { kind: 'item', id: 'builtin:home', visible: true },
        ...utilityItems.map(item => ({ kind: 'item' as const, id: item.id, visible: true })),
      ],
    }
    const wrapper = render({ items: [...items.filter(item => !item.id.startsWith('plugin:')), ...utilityItems], setting })
    expect(wrapper.find('[data-testid="sidebar-plugin-divider"]').exists()).toBe(false)
    await wrapper.setProps({ items: [...items, ...utilityItems] })

    expect(wrapper.get('.sidebar-builtins-entries').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['builtin:home'])
    expect(wrapper.get('.sidebar-plugins-entries').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['plugin:acme:issues'])
    expect(wrapper.get('[data-testid="sidebar-plugin-divider"]').attributes('aria-orientation')).toBe('horizontal')
    expect(wrapper.get('.sidebar-utilities').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(utilityItems.map(item => item.id))
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('shows the plugin boundary only when pinned plugin icons are available', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: groupedSetting.entries.map(entry => entry.kind === 'item' && entry.id === 'plugin:acme:issues' ? { ...entry, visible: false } : entry),
    }
    const wrapper = render({ setting })
    expect(wrapper.find('[data-testid="sidebar-plugin-divider"]').exists()).toBe(false)
    await openMore(wrapper)
    await bodyElement('[data-sidebar-pin="plugin:acme:issues"]').trigger('click')
    await wrapper.setProps({ setting: lastUpdate(wrapper) })
    expect(wrapper.find('[data-testid="sidebar-plugin-divider"]').exists()).toBe(true)
    await wrapper.setProps({ items: items.filter(item => !item.id.startsWith('plugin:')) })
    expect(wrapper.find('[data-testid="sidebar-plugin-divider"]').exists()).toBe(false)
  })

  it('keeps automatic boundaries out of customization while retaining custom plugin dividers', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: [
        { kind: 'item', id: 'builtin:home', visible: true },
        { kind: 'separator', id: 'separator:plugins' },
        { kind: 'item', id: 'plugin:acme:issues', visible: true },
        { kind: 'separator', id: 'separator:plugin-custom' },
        { kind: 'item', id: 'builtin:tools', visible: true },
        { kind: 'item', id: 'plugin:acme:tasks', visible: true },
        { kind: 'separator', id: 'separator:utilities' },
        ...utilityItems.map(item => ({ kind: 'item' as const, id: item.id, visible: true })),
      ],
    }
    const wrapper = render({ items: [...items, ...utilityItems, { id: 'plugin:acme:tasks', title: 'Tasks', icon: 'emoji:✅' }], setting })
    expect(wrapper.get('.sidebar-builtins-entries').find('[data-sidebar-entry="separator:plugin-custom"]').exists()).toBe(false)
    expect(wrapper.get('.sidebar-plugins-entries').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['plugin:acme:issues', 'separator:plugin-custom', 'plugin:acme:tasks'])
    await customize(wrapper)

    expect(document.body.querySelector('.sidebar-customization-list [data-sidebar-entry="separator:plugins"]')).toBeNull()
    expect(document.body.querySelector('.sidebar-customization-list [data-sidebar-entry="separator:utilities"]')).toBeNull()
    expect(document.body.querySelectorAll('.sidebar-customization-list [data-sidebar-entry="separator:plugin-custom"]')).toHaveLength(1)
    expect(bodyElement('button[aria-label="Move Home down"]').attributes('disabled')).toBeUndefined()
    expect(bodyElement('button[aria-label="Move Tools down"]').attributes('disabled')).toBeDefined()
    expect(bodyElement('button[aria-label="Move Issues up"]').attributes('disabled')).toBeDefined()
  })

  it.each([
    {
      name: 'default',
      setting: { entries: [] } as WorkbenchSidebarSetting,
      expected: ['builtin:marketplace', 'builtin:diagnostics', 'builtin:settings'],
    },
    {
      name: 'custom',
      setting: {
        entries: [
          { kind: 'item', id: 'builtin:settings', visible: true },
          { kind: 'item', id: 'builtin:home', visible: true },
          { kind: 'item', id: 'builtin:diagnostics', visible: true },
          { kind: 'item', id: 'plugin:acme:issues', visible: true },
          { kind: 'item', id: 'builtin:marketplace', visible: true },
          { kind: 'item', id: 'builtin:tools', visible: true },
        ],
      } as WorkbenchSidebarSetting,
      expected: ['builtin:settings', 'builtin:diagnostics', 'builtin:marketplace'],
    },
  ])('keeps utilities in the footer group with $name ordering and More in the main group', ({ setting, expected }) => {
    const wrapper = render({ items: [...items, ...utilityItems], setting })
    const primary = wrapper.get('.sidebar-primary')
    const utilities = wrapper.get('.sidebar-utilities')

    expect(utilities.findAll('.activity-button[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(expected)
    expect(primary.findAll('.activity-button[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toHaveLength(3)
    expect(primary.find('[data-testid="sidebar-more"]').exists()).toBe(true)
    expect(utilities.find('[data-testid="sidebar-more"]').exists()).toBe(false)
    for (const item of utilityItems)
      expect(primary.find(`[data-sidebar-entry="${item.id}"]`).exists()).toBe(false)
    expect(Array.from(wrapper.get('nav').element.children).indexOf(primary.element)).toBeLessThan(Array.from(wrapper.get('nav').element.children).indexOf(utilities.element))
  })

  it('preserves footer visibility preferences and restores hidden utilities through More', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: [
        ...groupedSetting.entries,
        { kind: 'item', id: 'builtin:marketplace', visible: true },
        { kind: 'item', id: 'builtin:diagnostics', visible: false },
        { kind: 'item', id: 'builtin:settings', visible: true },
      ],
    }
    const wrapper = render({ items: [...items, ...utilityItems], setting })
    expect(wrapper.get('.sidebar-utilities').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['builtin:marketplace', 'builtin:settings'])
    await openMore(wrapper)
    const pin = bodyElement('[data-sidebar-pin="builtin:diagnostics"]')
    expect(pin.attributes('aria-pressed')).toBe('false')
    await pin.trigger('click')
    await wrapper.setProps({ setting: lastUpdate(wrapper) })

    expect(wrapper.get('.sidebar-utilities').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['builtin:marketplace', 'builtin:diagnostics', 'builtin:settings'])
    expect(wrapper.get('.sidebar-primary').find('[data-sidebar-entry="builtin:diagnostics"]').exists()).toBe(false)
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('drags utility entries within the footer while preserving the main navigation order', async () => {
    const wrapper = render({ items: [...items, ...utilityItems], setting: { entries: [] } })
    const primaryBefore = wrapper.get('.sidebar-primary').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))
    const transfer = dragTransfer()
    const plugins = wrapper.get('.sidebar-utilities [data-sidebar-entry="builtin:marketplace"]')
    targetBounds(plugins.element)

    await wrapper.get('.sidebar-utilities [data-sidebar-entry="builtin:settings"]').trigger('dragstart', { dataTransfer: transfer })
    await plugins.trigger('drop', { dataTransfer: transfer, clientY: 105 })
    await wrapper.setProps({ setting: lastUpdate(wrapper) })

    expect(wrapper.get('.sidebar-utilities').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['builtin:settings', 'builtin:marketplace', 'builtin:diagnostics'])
    expect(wrapper.get('.sidebar-primary').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(primaryBefore)
  })

  it.each([
    ['builtin:settings', 'builtin:home'],
    ['plugin:acme:issues', 'builtin:diagnostics'],
    ['plugin:acme:issues', 'builtin:home'],
    ['builtin:tools', 'plugin:acme:issues'],
  ])('prevents dragging %s into the other group near %s', async (sourceId, targetId) => {
    const wrapper = render({ items: [...items, ...utilityItems], setting: { entries: [] } })
    const transfer = dragTransfer()
    const target = wrapper.get(`[data-sidebar-entry="${targetId}"]`)
    targetBounds(target.element)

    await wrapper.get(`[data-sidebar-entry="${sourceId}"]`).trigger('dragstart', { dataTransfer: transfer })
    await target.trigger('dragover', { dataTransfer: transfer, clientY: 105 })
    expect(target.classes()).not.toContain('sidebar-drop-before')
    await target.trigger('drop', { dataTransfer: transfer, clientY: 105 })
    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('keeps hidden active destinations available in More and pins without navigating', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: groupedSetting.entries.map(entry => entry.kind === 'item' && entry.id === 'plugin:acme:issues' ? { ...entry, visible: false } : entry),
    }
    const wrapper = render({ setting, items: items.map(item => ({ ...item, active: item.id === 'plugin:acme:issues' })) })

    expect(wrapper.find('[data-testid="open-plugin-workbench"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="sidebar-more"]').classes()).toContain('active')
    await openMore(wrapper)
    const pin = bodyElement('[data-sidebar-pin="plugin:acme:issues"]')
    expect(pin.attributes('aria-pressed')).toBe('false')
    await pin.trigger('click')

    expect(lastUpdate(wrapper).entries).toContainEqual({ kind: 'item', id: 'plugin:acme:issues', visible: true })
    expect(wrapper.emitted('activate')).toBeUndefined()
    expect(document.body.querySelector('[data-sidebar-menu-item="plugin:acme:issues"]')).not.toBeNull()

    await bodyElement('[data-sidebar-menu-item="plugin:acme:issues"]').trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['plugin:acme:issues']])
  })

  it('leaves More reachable when every destination is hidden', async () => {
    const setting: WorkbenchSidebarSetting = { entries: items.map(item => ({ kind: 'item', id: item.id, visible: false })) }
    const wrapper = render({ setting })

    expect(wrapper.findAll('nav [data-sidebar-entry]')).toHaveLength(0)
    await openMore(wrapper)
    expect(document.body.querySelectorAll('[data-sidebar-menu-item]')).toHaveLength(3)
    await bodyElement('[data-sidebar-menu-item="builtin:tools"]').trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['builtin:tools']])
  })

  it('supports visibility, keyboard ordering, adding and removing dividers, and reset', async () => {
    const wrapper = render()
    await customize(wrapper)

    expect(bodyElement('[data-testid="sidebar-customization-dialog"]').attributes('role')).toBe('dialog')
    await bodyElement('input[aria-label="Show Tools in sidebar"]').setValue(false)
    expect(lastUpdate(wrapper).entries).toContainEqual({ kind: 'item', id: 'builtin:tools', visible: false })
    await wrapper.setProps({ setting: lastUpdate(wrapper) })

    expect(bodyElement('button[aria-label="Move Issues up"]').attributes('disabled')).toBeDefined()
    expect(bodyElement('button[aria-label="Move Tools down"]').attributes('disabled')).toBeDefined()
    await bodyElement('button[aria-label="Move Tools up"]').trigger('click')
    expect(lastUpdate(wrapper).entries.map(entry => entry.id)).toEqual(['builtin:home', 'builtin:tools', 'separator:group', 'plugin:acme:issues'])
    await wrapper.setProps({ setting: lastUpdate(wrapper) })

    await bodyElement('button[aria-label="Add divider after Home"]').trigger('click')
    expect(lastUpdate(wrapper).entries[1]?.kind).toBe('separator')
    expect(lastUpdate(wrapper).entries.filter(entry => entry.kind === 'separator')).toHaveLength(2)
    await bodyElement('button[aria-label="Remove divider"]').trigger('click')
    expect(lastUpdate(wrapper).entries.some(entry => entry.id === 'separator:group')).toBe(false)

    await bodyElement('[data-testid="reset-sidebar"]').trigger('click')
    expect(lastUpdate(wrapper)).toEqual({ entries: [] })
  })

  it('drags built-in entries across custom dividers within their own group', async () => {
    const wrapper = render()
    const transfer = dragTransfer()
    const home = wrapper.get('[data-sidebar-entry="builtin:home"]')
    targetBounds(home.element)
    await wrapper.get('[data-sidebar-entry="builtin:tools"]').trigger('dragstart', { dataTransfer: transfer })
    await home.trigger('dragover', { dataTransfer: transfer, clientY: 135 })
    expect(home.classes()).toContain('sidebar-drop-after')
    await home.trigger('drop', { dataTransfer: transfer, clientY: 135 })
    expect(lastUpdate(wrapper).entries.map(entry => entry.id)).toEqual(['builtin:home', 'builtin:tools', 'separator:group', 'plugin:acme:issues'])
  })

  it('moves custom dividers inside their owning built-in group', async () => {
    const wrapper = render()
    const tools = wrapper.get('[data-sidebar-entry="builtin:tools"]')
    targetBounds(tools.element)
    const dividerTransfer = dragTransfer()
    await wrapper.get('[data-sidebar-entry="separator:group"]').trigger('dragstart', { dataTransfer: dividerTransfer })
    await tools.trigger('drop', { dataTransfer: dividerTransfer, clientY: 135 })
    expect(lastUpdate(wrapper).entries.map(entry => entry.id)).toEqual(['builtin:home', 'plugin:acme:issues', 'builtin:tools', 'separator:group'])
  })

  it('retains a divider group when dragging before the first built-in in an interleaved saved layout', async () => {
    const setting: WorkbenchSidebarSetting = {
      entries: [
        { kind: 'item', id: 'plugin:acme:issues', visible: true },
        { kind: 'item', id: 'builtin:home', visible: true },
        { kind: 'separator', id: 'separator:custom' },
        { kind: 'item', id: 'builtin:tools', visible: true },
      ],
    }
    const wrapper = render({ setting })
    const home = wrapper.get('.sidebar-builtins-entries [data-sidebar-entry="builtin:home"]')
    targetBounds(home.element)
    const transfer = dragTransfer()
    await wrapper.get('.sidebar-builtins-entries [data-sidebar-entry="separator:custom"]').trigger('dragstart', { dataTransfer: transfer })
    await home.trigger('drop', { dataTransfer: transfer, clientY: 105 })

    expect(lastUpdate(wrapper).entries.find(entry => entry.id === 'separator:custom')).toMatchObject({ kind: 'separator', group: 'builtins' })
    await wrapper.setProps({ setting: lastUpdate(wrapper) })
    expect(wrapper.get('.sidebar-plugins-entries').find('[data-sidebar-entry="separator:custom"]').exists()).toBe(false)
    await customize(wrapper)
    expect(Array.from(document.body.querySelectorAll('.sidebar-customization-list [data-sidebar-entry]'), entry => entry.getAttribute('data-sidebar-entry'))).toEqual([
      'separator:custom',
      'builtin:home',
      'builtin:tools',
      'plugin:acme:issues',
    ])
    expect(bodyElement('button[aria-label="Move divider down"]').attributes('disabled')).toBeUndefined()
  })

  it('reorders plugin icons within the plugin group without moving built-in entries', async () => {
    const wrapper = render({ items: [...items, { id: 'plugin:acme:tasks', title: 'Tasks', icon: 'emoji:✅' }] })
    const transfer = dragTransfer()
    const issues = wrapper.get('.sidebar-plugins-entries [data-sidebar-entry="plugin:acme:issues"]')
    targetBounds(issues.element)
    await wrapper.get('.sidebar-plugins-entries [data-sidebar-entry="plugin:acme:tasks"]').trigger('dragstart', { dataTransfer: transfer })
    await issues.trigger('drop', { dataTransfer: transfer, clientY: 105 })
    await wrapper.setProps({ setting: lastUpdate(wrapper) })

    expect(wrapper.get('.sidebar-plugins-entries').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['plugin:acme:tasks', 'plugin:acme:issues'])
    expect(wrapper.get('.sidebar-builtins-entries').findAll('[data-sidebar-entry]').map(entry => entry.attributes('data-sidebar-entry'))).toEqual(['builtin:home', 'separator:group', 'builtin:tools'])
  })

  it('uses the horizontal midpoint for mobile drag ordering', async () => {
    const originalMatchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(max-width: 760px)'
      ? { matches: true, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }
      : originalMatchMedia(query))
    const wrapper = render({ collapsed: true })
    expect(wrapper.get('[role="separator"]').attributes('aria-orientation')).toBe('vertical')
    const transfer = dragTransfer()
    const home = wrapper.get('[data-sidebar-entry="builtin:home"]')
    targetBounds(home.element)

    await wrapper.get('[data-sidebar-entry="builtin:tools"]').trigger('dragstart', { dataTransfer: transfer })
    await home.trigger('drop', { dataTransfer: transfer, clientX: 110, clientY: 135 })
    expect(lastUpdate(wrapper).entries.map(entry => entry.id)).toEqual(['builtin:tools', 'builtin:home', 'separator:group', 'plugin:acme:issues'])
  })

  it('rejects external drops and preserves unavailable plugin preferences during customization', async () => {
    const missing = { kind: 'item', id: 'plugin:missing:view', visible: false } as const
    const wrapper = render({ setting: { entries: [...groupedSetting.entries, missing] } })
    const transfer = dragTransfer()
    transfer.setData('application/x-craft-hub-sidebar-entry', 'builtin:home')
    await wrapper.get('[data-sidebar-entry="builtin:tools"]').trigger('drop', { dataTransfer: transfer })
    expect(wrapper.emitted('update')).toBeUndefined()

    await customize(wrapper)
    expect(document.body.querySelector('.sidebar-customization-list [data-sidebar-entry="plugin:missing:view"]')).toBeNull()
    await bodyElement('input[aria-label="Show Tools in sidebar"]').setValue(false)
    expect(lastUpdate(wrapper).entries).toContainEqual(missing)
  })

  it('reports save failures and disables changes while saving without blocking navigation', async () => {
    const wrapper = render({ saving: true, error: 'Could not save sidebar' })
    expect(wrapper.get('[data-sidebar-entry="builtin:home"]').attributes('draggable')).toBe('false')
    await openMore(wrapper)
    expect(bodyElement('[data-sidebar-pin="builtin:home"]').attributes('disabled')).toBeDefined()
    expect(bodyElement('[role="alert"]').text()).toBe('Could not save sidebar')
    await bodyElement('[data-sidebar-menu-item="builtin:home"]').trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['builtin:home']])

    await customize(wrapper)
    expect(bodyElement('[data-testid="reset-sidebar"]').attributes('disabled')).toBeDefined()
    expect(bodyElement('[role="alert"]').text()).toBe('Could not save sidebar')
    await wrapper.setProps({ error: '' })
    expect(bodyElement('[role="status"]').text()).toBe('Saving…')
  })

  it('translates customization controls and retains the mobile account slot', async () => {
    const wrapper = mount(ActivityNavigation, {
      attachTo: document.body,
      props: { items, setting: groupedSetting, collapsed: true },
      slots: { default: '<button class="activity-button activity-account" aria-label="Account" />' },
    })
    wrappers.push(wrapper)
    expect(wrapper.get('.activity-account').attributes('aria-label')).toBe('Account')
    useI18n().setLocale('zh-CN')
    await flushPromises()
    expect(wrapper.get('nav').attributes('aria-label')).toBe('主导航')
    expect(wrapper.get('[data-testid="sidebar-more"]').attributes('aria-label')).toBe('更多导航')
    await customize(wrapper)
    expect(bodyElement('[data-testid="reset-sidebar"]').text()).toBe('恢复默认')
  })
})
