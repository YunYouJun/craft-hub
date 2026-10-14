import type { WorkbenchSidebarSetting } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { addSidebarSeparator, groupSidebarEntries, moveSidebarEntry, pluginSidebarId, removeSidebarEntry, resolveSidebarEntries, retainSidebarSeparatorGroups, setSidebarItemVisible, sidebarEntryGroup, visibleSidebarEntries } from './sidebar-navigation'

const items = [
  { id: 'builtin:home', title: 'Home' },
  { id: 'builtin:projects', title: 'Projects' },
  { id: pluginSidebarId('example', 'tasks'), title: 'Tasks' },
  { id: 'builtin:marketplace', title: 'Plugins' },
  { id: 'builtin:settings', title: 'Settings' },
]
const defaults = (): WorkbenchSidebarSetting => ({ entries: resolveSidebarEntries(items, { entries: [] }) })

describe('sidebar layout', () => {
  it('groups built-in destinations, plugin destinations and utilities by default', () => {
    expect(defaults().entries.map(entry => entry.id)).toEqual([
      'builtin:home',
      'builtin:projects',
      'separator:plugins',
      'plugin:example:tasks',
      'separator:utilities',
      'builtin:marketplace',
      'builtin:settings',
    ])
    expect(pluginSidebarId('a:b', 'c')).not.toBe(pluginSidebarId('a', 'b:c'))
    expect(pluginSidebarId('a', 'tasks')).not.toBe(pluginSidebarId('b', 'tasks'))
  })

  it('hides items without forgetting their order and keeps hidden active destinations hidden', () => {
    const setting = setSidebarItemVisible(defaults(), 'builtin:home', false)
    const visible = visibleSidebarEntries(items.map(item => ({ ...item, active: item.id === 'builtin:home' })), setting)
    expect(visible.some(entry => entry.id === 'builtin:home')).toBe(false)
    expect(setSidebarItemVisible(setting, 'builtin:home', true)).toEqual(defaults())
  })

  it('preserves plugin placement through disable, reorder and rediscovery', () => {
    const saved = moveSidebarEntry(defaults(), 'plugin:example:tasks', 'builtin:home', 'before')
    const disabled = items.filter(item => !item.id.startsWith('plugin:'))
    expect(resolveSidebarEntries(disabled, saved)).toEqual(saved.entries)
    expect(visibleSidebarEntries(disabled, saved).some(entry => entry.id.startsWith('plugin:'))).toBe(false)
    expect(visibleSidebarEntries(items, saved)[0]?.id).toBe('plugin:example:tasks')
    const added = resolveSidebarEntries([...items, { id: 'plugin:new:tasks', title: 'New tasks' }], saved)
    expect(added.findIndex(entry => entry.id === 'plugin:new:tasks')).toBeLessThan(added.findIndex(entry => entry.id === 'separator:utilities'))
  })

  it('removes empty and consecutive visible group boundaries', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'separator', id: 'start' },
      { kind: 'item', id: 'builtin:home', visible: true },
      { kind: 'separator', id: 'one' },
      { kind: 'item', id: 'builtin:projects', visible: false },
      { kind: 'separator', id: 'two' },
      { kind: 'item', id: 'plugin:missing:tasks', visible: true },
      { kind: 'item', id: 'builtin:settings', visible: true },
      { kind: 'separator', id: 'end' },
    ] }
    expect(visibleSidebarEntries(items.filter(item => ['builtin:home', 'builtin:settings'].includes(item.id)), saved).map(entry => entry.id)).toEqual(['builtin:home', 'two', 'builtin:settings'])
  })

  it('moves in both directions and retains hidden preferences between targets', () => {
    let setting = setSidebarItemVisible(defaults(), 'builtin:projects', false)
    setting = moveSidebarEntry(setting, 'builtin:settings', 'builtin:home', 'before')
    expect(setting.entries[0]?.id).toBe('builtin:settings')
    setting = moveSidebarEntry(setting, 'builtin:settings', 'builtin:marketplace', 'after')
    expect(setting.entries.at(-1)?.id).toBe('builtin:settings')
    expect(setting.entries.find(entry => entry.id === 'builtin:projects')).toMatchObject({ visible: false })
    expect(moveSidebarEntry(setting, 'external', 'builtin:home', 'before')).toBe(setting)
    expect(moveSidebarEntry(setting, 'builtin:home', 'external', 'after')).toBe(setting)
    expect(moveSidebarEntry(setting, 'builtin:home', 'builtin:home', 'after')).toBe(setting)
  })

  it('adds and removes draggable dividers while retaining every destination', () => {
    const added = addSidebarSeparator(defaults(), 'builtin:home')
    expect(added.entries[1]).toMatchObject({ kind: 'separator' })
    expect(added.entries[1]?.id).toMatch(/^separator:/)
    expect(removeSidebarEntry(added, added.entries[1]!.id)).toEqual(defaults())
    expect(removeSidebarEntry(added, 'builtin:home')).toEqual(added)
    expect(addSidebarSeparator(added, 'missing')).toBe(added)
  })
})

describe('structural sidebar groups', () => {
  it('retains divider ownership when edits change neighboring groups without adding structural entries', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'plugin:example:tasks', visible: true },
      { kind: 'item', id: 'builtin:home', visible: true },
      { kind: 'separator', id: 'separator:custom' },
      { kind: 'item', id: 'builtin:projects', visible: true },
    ] }
    const moved = moveSidebarEntry(retainSidebarSeparatorGroups(saved), 'separator:custom', 'builtin:home', 'before')
    expect(moved.entries).toHaveLength(saved.entries.length)
    expect(sidebarEntryGroup(moved.entries, 'separator:custom')).toBe('builtins')
    expect(groupSidebarEntries(moved.entries).builtins.map(entry => entry.id)).toEqual(['separator:custom', 'builtin:home', 'builtin:projects'])
    expect(saved.entries[2]).toEqual({ kind: 'separator', id: 'separator:custom' })
    const added = addSidebarSeparator(moved, 'separator:custom')
    expect(added.entries[2]).toMatchObject({ kind: 'separator', group: 'builtins' })
  })

  it('separates interleaved saved destinations while preserving order within each group', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'plugin:second:tasks', visible: true },
      { kind: 'item', id: 'builtin:settings', visible: true },
      { kind: 'item', id: 'builtin:projects', visible: true },
      { kind: 'separator', id: 'separator:plugins' },
      { kind: 'item', id: 'plugin:first:tasks', visible: true },
      { kind: 'item', id: 'builtin:marketplace', visible: true },
      { kind: 'item', id: 'builtin:home', visible: true },
      { kind: 'separator', id: 'separator:utilities' },
      { kind: 'item', id: 'builtin:diagnostics', visible: true },
    ] }

    const groups = groupSidebarEntries(saved.entries)
    expect(groups.builtins.map(entry => entry.id)).toEqual(['builtin:projects', 'builtin:home'])
    expect(groups.plugins.map(entry => entry.id)).toEqual(['plugin:second:tasks', 'plugin:first:tasks'])
    expect(groups.utilities.map(entry => entry.id)).toEqual(['builtin:settings', 'builtin:marketplace', 'builtin:diagnostics'])
  })

  it('retains hidden and unavailable plugin preferences inside the plugin group through rediscovery', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'plugin:hidden:tasks', visible: false },
      { kind: 'item', id: 'builtin:home', visible: true },
      { kind: 'item', id: 'plugin:disabled:tasks', visible: true },
      { kind: 'item', id: 'builtin:settings', visible: true },
      { kind: 'item', id: 'plugin:visible:tasks', visible: true },
    ] }
    const available = [
      { id: 'plugin:hidden:tasks', title: 'Hidden' },
      { id: 'plugin:visible:tasks', title: 'Visible' },
    ]
    const groupSetting = { entries: groupSidebarEntries(saved.entries).plugins }

    expect(groupSetting.entries).toEqual([saved.entries[0], saved.entries[2], saved.entries[4]])
    expect(visibleSidebarEntries(available, groupSetting).map(entry => entry.id)).toEqual(['plugin:visible:tasks'])
    const rediscovered = [...available, { id: 'plugin:disabled:tasks', title: 'Enabled again' }]
    expect(visibleSidebarEntries(rediscovered, groupSetting).map(entry => entry.id)).toEqual(['plugin:disabled:tasks', 'plugin:visible:tasks'])
    const shown = setSidebarItemVisible(groupSetting, 'plugin:hidden:tasks', true)
    expect(visibleSidebarEntries(rediscovered, shown).map(entry => entry.id)).toEqual(['plugin:hidden:tasks', 'plugin:disabled:tasks', 'plugin:visible:tasks'])
  })

  it('keeps custom dividers with the previous saved item even when that item is hidden or unavailable', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'item', id: 'builtin:home', visible: false },
      { kind: 'separator', id: 'separator:builtin-custom' },
      { kind: 'item', id: 'plugin:disabled:tasks', visible: false },
      { kind: 'separator', id: 'separator:plugin-custom' },
      { kind: 'item', id: 'builtin:settings', visible: true },
      { kind: 'separator', id: 'separator:utility-custom' },
      { kind: 'item', id: 'builtin:projects', visible: true },
    ] }

    expect(sidebarEntryGroup(saved.entries, 'separator:builtin-custom')).toBe('builtins')
    expect(sidebarEntryGroup(saved.entries, 'separator:plugin-custom')).toBe('plugins')
    expect(sidebarEntryGroup(saved.entries, 'separator:utility-custom')).toBe('utilities')
    const groups = groupSidebarEntries(saved.entries)
    expect(groups.builtins.map(entry => entry.id)).toEqual(['builtin:home', 'separator:builtin-custom', 'builtin:projects'])
    expect(groups.plugins.map(entry => entry.id)).toEqual(['plugin:disabled:tasks', 'separator:plugin-custom'])
    expect(groups.utilities.map(entry => entry.id)).toEqual(['builtin:settings'])
  })

  it('assigns leading custom dividers to the next saved item and keeps consecutive dividers together', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'separator', id: 'separator:leading-one' },
      { kind: 'separator', id: 'separator:leading-two' },
      { kind: 'item', id: 'plugin:disabled:tasks', visible: false },
      { kind: 'item', id: 'builtin:home', visible: true },
    ] }

    expect(sidebarEntryGroup(saved.entries, 'separator:leading-one')).toBe('plugins')
    expect(sidebarEntryGroup(saved.entries, 'separator:leading-two')).toBe('plugins')
    expect(groupSidebarEntries(saved.entries).plugins.map(entry => entry.id)).toEqual([
      'separator:leading-one',
      'separator:leading-two',
      'plugin:disabled:tasks',
    ])
  })

  it('excludes reserved structural dividers even without any saved destinations', () => {
    const saved: WorkbenchSidebarSetting = { entries: [
      { kind: 'separator', id: 'separator:plugins' },
      { kind: 'separator', id: 'separator:utilities' },
    ] }

    expect(groupSidebarEntries(saved.entries)).toEqual({ builtins: [], plugins: [], utilities: [] })
  })
})
