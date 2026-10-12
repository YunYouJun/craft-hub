import type { Input, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchMenuShortcutMatcher, createWorkbenchViewMenu } from './application-menu.ts'

function commands(platform: string, onAction = vi.fn()) {
  return createWorkbenchViewMenu(onAction, platform).submenu as MenuItemConstructorOptions[]
}

describe('desktop navigation menu', () => {
  it('uses the five primary destinations in navigation order', () => {
    expect(commands('darwin').filter(item => /CommandOrControl\+[1-5]$/.test(item.accelerator ?? '')).map(item => ({
      label: item.label,
      accelerator: item.accelerator,
    }))).toEqual([
      { label: 'Home', accelerator: 'CommandOrControl+1' },
      { label: 'Projects', accelerator: 'CommandOrControl+2' },
      { label: 'Tools', accelerator: 'CommandOrControl+3' },
      { label: 'Development Environment', accelerator: 'CommandOrControl+4' },
      { label: 'Workbenches', accelerator: 'CommandOrControl+5' },
    ])
  })

  it('forwards every command through the renderer action boundary', () => {
    const onAction = vi.fn()
    for (const item of commands('darwin', onAction))
      item.click?.({} as never, undefined, {} as never)

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      'back',
      'forward',
      'home',
      'workbench',
      'tools',
      'environment',
      'workbenches',
      'marketplace',
      'toggle-sidebar',
      'refresh',
      'palette-all',
      'palette-projects',
      'palette-commands',
    ])
  })

  it('uses the macOS sidebar accelerator and keeps application refresh separate from reload', () => {
    const menu = commands('darwin')
    expect(menu.find(item => item.label === 'Toggle Sidebar')?.accelerator).toBe('Command+Control+S')
    expect(menu.find(item => item.label === 'Refresh Workbench')?.accelerator).toBe('CommandOrControl+Shift+R')
    expect(menu.some(item => item.role === 'reload' || item.role === 'forceReload')).toBe(false)
    expect(menu.find(item => item.label === 'Back')?.accelerator).toBe('CommandOrControl+[')
    expect(menu.find(item => item.label === 'Forward')?.accelerator).toBe('CommandOrControl+]')
    const accelerators = menu.flatMap(item => item.accelerator ? [item.accelerator] : [])
    expect(new Set(accelerators).size).toBe(accelerators.length)
  })

  it('keeps Find Anything customizable and Marketplace available without taking a primary shortcut', () => {
    const menu = commands('darwin')
    expect(menu.find(item => item.label === 'Find Anything…')?.accelerator).toBeUndefined()
    expect(menu.find(item => item.label === 'Marketplace')?.accelerator).toBeUndefined()
    expect(menu.find(item => item.label === 'Find Project…')?.accelerator).toBe('CommandOrControl+P')
    expect(menu.find(item => item.label === 'Find Command…')?.accelerator).toBe('CommandOrControl+Shift+P')
  })

  it('uses a Control and Alt sidebar accelerator on other desktop platforms', () => {
    expect(commands('win32').find(item => item.label === 'Toggle Sidebar')?.accelerator).toBe('Control+Alt+S')
    expect(commands('linux').find(item => item.label === 'Toggle Sidebar')?.accelerator).toBe('Control+Alt+S')
  })
})

describe('renderer-owned menu accelerators', () => {
  const input = (key: string, overrides: Partial<Input> = {}): Input => ({
    type: 'keyDown',
    key,
    code: key,
    location: 0,
    modifiers: [],
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: true,
    ...overrides,
  })

  it('hands primary navigation, history, settings and palette keys to the renderer', () => {
    const matches = createWorkbenchMenuShortcutMatcher('darwin')
    for (const key of ['1', '2', '3', '4', '5', '[', ']', ',', 'p', 'P'])
      expect(matches(input(key))).toBe(true)
    expect(matches(input('p', { shift: true }))).toBe(true)
    expect(matches(input('r', { shift: true }))).toBe(true)
    expect(matches(input('s', { control: true }))).toBe(true)
  })

  it('preserves native edit, quit and ordinary reload shortcuts', () => {
    const matches = createWorkbenchMenuShortcutMatcher('darwin')
    for (const key of ['c', 'v', 'q', 'r', '0', '+', '-', 'k', 'a'])
      expect(matches(input(key))).toBe(false)
  })

  it('requires the exact menu modifier combination', () => {
    const matches = createWorkbenchMenuShortcutMatcher('darwin')
    expect(matches(input('1', { meta: false }))).toBe(false)
    expect(matches(input('1', { alt: true }))).toBe(false)
    expect(matches(input('1', { shift: true }))).toBe(false)
    expect(matches(input('1', { control: true }))).toBe(false)
    expect(matches(input('s'))).toBe(false)
    expect(matches(input('s', { control: true, shift: true }))).toBe(false)
    expect(matches(input('r', { shift: true, alt: true }))).toBe(false)
  })

  it('lets the renderer apply its typing, composition and repeat guards', () => {
    const matches = createWorkbenchMenuShortcutMatcher('darwin')
    expect(matches(input('p', { isAutoRepeat: true }))).toBe(true)
    expect(matches(input('p', { isComposing: true }))).toBe(true)
    expect(matches(input('p', { type: 'keyUp' }))).toBe(true)
    expect(matches(input('s', { type: 'keyUp', control: true }))).toBe(true)
  })

  it('resets suppression when the released key or the next key is not owned', () => {
    const matches = createWorkbenchMenuShortcutMatcher('darwin')
    expect(matches(input('p'))).toBe(true)
    expect(matches(input('p', { type: 'keyUp' }))).toBe(true)
    expect(matches(input('Meta', { type: 'keyUp', meta: false }))).toBe(false)
    expect(matches(input('c'))).toBe(false)
  })

  it('uses Control on other platforms without stealing Meta or extra-modifier shortcuts', () => {
    for (const platform of ['linux', 'win32']) {
      const matches = createWorkbenchMenuShortcutMatcher(platform)
      expect(matches(input('1', { meta: false, control: true }))).toBe(true)
      expect(matches(input('s', { meta: false, control: true, alt: true }))).toBe(true)
      expect(matches(input('p', { meta: false, control: true, shift: true }))).toBe(true)
      expect(matches(input('1'))).toBe(false)
      expect(matches(input('1', { control: true }))).toBe(false)
      expect(matches(input('c', { meta: false, control: true }))).toBe(false)
    }
  })
})
