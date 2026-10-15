import type { ContextMenuParams, Input, MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createApplicationMenu, createEditContextMenu, createWorkbenchMenuShortcutMatcher, createWorkbenchViewMenu, isDesktopMenuLocale } from './application-menu.ts'

function commands(platform: string, onAction = vi.fn()) {
  return createWorkbenchViewMenu(onAction, platform).submenu as MenuItemConstructorOptions[]
}

describe('desktop navigation menu', () => {
  it('localizes Chinese navigation without changing actions or accelerators', () => {
    const onAction = vi.fn()
    const menu = createWorkbenchViewMenu(onAction, 'darwin', 'zh-CN')
    const items = menu.submenu as MenuItemConstructorOptions[]

    expect(menu.label).toBe('视图')
    expect(items.filter(item => /CommandOrControl\+[1-5]$/.test(item.accelerator ?? '')).map(item => item.label)).toEqual([
      '首页',
      '项目',
      '工具',
      '开发环境',
      '工作台',
    ])
    expect(items.map(item => item.accelerator)).toEqual(commands('darwin').map(item => item.accelerator))
    for (const item of items)
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

describe('localized application menu', () => {
  function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
    return items.flatMap(item => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])
  }

  function applicationMenu(locale: 'en' | 'zh-CN') {
    return createApplicationMenu({
      applicationName: 'Craft Hub',
      locale,
      platform: 'darwin',
      onAction: vi.fn(),
      onAbout: vi.fn(),
      onSettings: vi.fn(),
      onHelp: vi.fn(),
      onReplayOnboarding: vi.fn(),
    })
  }

  it('switches top-level menu names in both languages', () => {
    expect(applicationMenu('zh-CN').map(item => item.label)).toEqual(['Craft Hub', '文件', '编辑', '视图', '窗口', '帮助'])
    expect(applicationMenu('en').map(item => item.label)).toEqual(['Craft Hub', 'File', 'Edit', 'View', 'Window', 'Help'])
  })

  it('translates native role submenus while preserving their native behavior', () => {
    const chinese = flatten(applicationMenu('zh-CN'))
    const english = flatten(applicationMenu('en'))
    expect(chinese.map(item => item.role)).toEqual(english.map(item => item.role))
    expect(chinese.filter(item => item.role && !item.submenu).map(item => ({ role: item.role, label: item.label }))).toEqual([
      { role: 'services', label: '服务' },
      { role: 'hide', label: '隐藏 Craft Hub' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '显示全部' },
      { role: 'quit', label: '退出 Craft Hub' },
      { role: 'close', label: '关闭窗口' },
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
      { role: 'delete', label: '删除' },
      { role: 'selectAll', label: '全选' },
      { role: 'startSpeaking', label: '开始朗读' },
      { role: 'stopSpeaking', label: '停止朗读' },
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { role: 'togglefullscreen', label: '切换全屏' },
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放' },
      { role: 'front', label: '前置全部窗口' },
      { role: 'window', label: '窗口' },
    ])
    expect(chinese.every(item => item.type === 'separator' || typeof item.label === 'string')).toBe(true)
  })

  it.each(['zh-CN', 'en'] as const)('retains application callbacks and the settings shortcut in %s', (locale) => {
    const onAbout = vi.fn()
    const onSettings = vi.fn()
    const onHelp = vi.fn()
    const onReplayOnboarding = vi.fn()
    const menu = createApplicationMenu({
      applicationName: 'Example Workbench',
      locale,
      platform: 'darwin',
      onAction: vi.fn(),
      onAbout,
      onSettings,
      onHelp,
      onReplayOnboarding,
    })
    const appItems = menu[0]!.submenu as MenuItemConstructorOptions[]
    expect(appItems[0]?.label).toBe(locale === 'zh-CN' ? '关于 Example Workbench' : 'About Example Workbench')
    expect(appItems[2]?.accelerator).toBe('CommandOrControl+,')
    for (const item of [menu[0]!, menu.at(-1)!]) {
      for (const child of item.submenu as MenuItemConstructorOptions[])
        child.click?.({} as never, undefined, {} as never)
    }
    for (const callback of [onAbout, onSettings, onHelp, onReplayOnboarding])
      expect(callback).toHaveBeenCalledOnce()
  })

  it('accepts only supported locale values at the IPC boundary', () => {
    expect(isDesktopMenuLocale('en')).toBe(true)
    expect(isDesktopMenuLocale('zh-CN')).toBe(true)
    for (const value of ['zh', 'en-US', '', null, undefined, 1, true, { locale: 'en' }, ['zh-CN']])
      expect(isDesktopMenuLocale(value)).toBe(false)
  })

  it.each(['zh-CN', 'en'] as const)('offers a localized manual update check in %s', (locale) => {
    const onCheckForUpdates = vi.fn()
    const menu = createApplicationMenu({
      applicationName: 'Craft Hub',
      locale,
      platform: 'darwin',
      onAction: vi.fn(),
      onAbout: vi.fn(),
      onCheckForUpdates,
      onSettings: vi.fn(),
      onHelp: vi.fn(),
      onReplayOnboarding: vi.fn(),
    })
    const item = flatten(menu).find(item => item.label === (locale === 'zh-CN' ? '检查更新…' : 'Check for Updates…'))
    expect(item).toBeDefined()
    item!.click?.({} as never, undefined, {} as never)
    expect(onCheckForUpdates).toHaveBeenCalledOnce()
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

const editFlags = { canCopy: true, canCut: true, canDelete: true, canEditRichly: false, canPaste: true, canRedo: false, canSelectAll: true, canUndo: true }

function menuParams(overrides: Partial<ContextMenuParams>) {
  return { dictionarySuggestions: [], editFlags, isEditable: false, misspelledWord: '', selectionText: '', ...overrides }
}

describe('native edit context menu', () => {
  it('leaves non-editable regions without a selection to the page', () => {
    expect(createEditContextMenu(menuParams({ selectionText: '  ' }), vi.fn())).toEqual([])
  })

  it('offers copy for selected read-only text', () => {
    expect(createEditContextMenu(menuParams({ selectionText: 'pnpm build' }), vi.fn())).toEqual([{ role: 'copy', label: 'Copy', enabled: true }])
  })

  it('mirrors the field edit state for text fields', () => {
    const template = createEditContextMenu(menuParams({ isEditable: true }), vi.fn())
    expect(template.filter(item => item.role).map(item => [item.role, item.enabled])).toEqual([
      ['undo', true],
      ['redo', false],
      ['cut', true],
      ['copy', true],
      ['paste', true],
      ['pasteAndMatchStyle', true],
      ['selectAll', true],
    ])
  })

  it('puts spelling suggestions first and replaces the misspelled word', () => {
    const replace = vi.fn()
    const template = createEditContextMenu(menuParams({ dictionarySuggestions: ['project'], isEditable: true, misspelledWord: 'projcet' }), replace)
    expect(template[0]?.label).toBe('project')
    expect(template[1]?.type).toBe('separator')
    template[0]?.click?.({} as never, undefined, {} as never)
    expect(replace).toHaveBeenCalledExactlyOnceWith('project')
  })

  it('labels edit commands in the workbench locale', () => {
    const template = createEditContextMenu(menuParams({ isEditable: true }), vi.fn(), 'zh-CN')
    expect(template.filter(item => item.role).map(item => item.label)).toEqual(['撤销', '重做', '剪切', '复制', '粘贴', '粘贴并匹配样式', '全选'])
  })
})
