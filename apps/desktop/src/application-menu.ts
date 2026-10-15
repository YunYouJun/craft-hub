import type { ContextMenuParams, Input, MenuItemConstructorOptions } from 'electron'

export const desktopSettingsAccelerator = 'CommandOrControl+,'

export type DesktopMenuLocale = 'en' | 'zh-CN'

/** Validate the renderer's locale before applying it to native menus. */
export function isDesktopMenuLocale(value: unknown): value is DesktopMenuLocale {
  return value === 'en' || value === 'zh-CN'
}

function menuLabel(locale: DesktopMenuLocale, en: string, zh: string): string {
  return locale === 'zh-CN' ? zh : en
}

type WorkbenchMenuInput = Pick<Input, 'type' | 'key' | 'shift' | 'control' | 'alt' | 'meta'>

export type DesktopMenuAction
  = | 'back'
    | 'forward'
    | 'home'
    | 'workbench'
    | 'tools'
    | 'environment'
    | 'workbenches'
    | 'marketplace'
    | 'toggle-sidebar'
    | 'refresh'
    | 'palette-all'
    | 'palette-projects'
    | 'palette-commands'

/** Create navigation commands without importing or launching the Electron runtime. */
export function createWorkbenchViewMenu(onAction: (action: DesktopMenuAction) => void, platform: string, locale: DesktopMenuLocale = 'en'): MenuItemConstructorOptions {
  const label = (en: string, zh: string): string => menuLabel(locale, en, zh)
  const command = (label: string, action: DesktopMenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => onAction(action),
  })
  return {
    label: label('View', '视图'),
    submenu: [
      command(label('Back', '后退'), 'back', 'CommandOrControl+['),
      command(label('Forward', '前进'), 'forward', 'CommandOrControl+]'),
      { type: 'separator' },
      command(label('Home', '首页'), 'home', 'CommandOrControl+1'),
      command(label('Projects', '项目'), 'workbench', 'CommandOrControl+2'),
      command(label('Tools', '工具'), 'tools', 'CommandOrControl+3'),
      command(label('Development Environment', '开发环境'), 'environment', 'CommandOrControl+4'),
      command(label('Workbenches', '工作台'), 'workbenches', 'CommandOrControl+5'),
      command(label('Marketplace', '插件市场'), 'marketplace'),
      { type: 'separator' },
      command(label('Toggle Sidebar', '显示或隐藏侧栏'), 'toggle-sidebar', platform === 'darwin' ? 'Command+Control+S' : 'Control+Alt+S'),
      command(label('Refresh Workbench', '刷新工作台'), 'refresh', 'CommandOrControl+Shift+R'),
      { type: 'separator' },
      command(label('Find Anything…', '查找…'), 'palette-all'),
      command(label('Find Project…', '查找项目…'), 'palette-projects', 'CommandOrControl+P'),
      command(label('Find Command…', '查找命令…'), 'palette-commands', 'CommandOrControl+Shift+P'),
      { type: 'separator' },
      { role: 'resetZoom', label: label('Actual Size', '实际大小') },
      { role: 'zoomIn', label: label('Zoom In', '放大') },
      { role: 'zoomOut', label: label('Zoom Out', '缩小') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: label('Toggle Full Screen', '切换全屏') },
    ],
  }
}

interface ApplicationMenuOptions {
  applicationName: string
  locale: DesktopMenuLocale
  platform: string
  onAction: (action: DesktopMenuAction) => void
  onAbout: () => void
  onCheckForUpdates?: () => void
  onSettings: () => void
  onHelp: () => void
  onReplayOnboarding: () => void
}

/** Build localized native menus while retaining Electron roles and accelerators. */
export function createApplicationMenu(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const { applicationName, locale, platform } = options
  const label = (en: string, zh: string): string => menuLabel(locale, en, zh)
  return [
    {
      label: applicationName,
      submenu: [
        { label: label(`About ${applicationName}`, `关于 ${applicationName}`), click: options.onAbout },
        ...(options.onCheckForUpdates ? [{ label: label('Check for Updates…', '检查更新…'), click: options.onCheckForUpdates }] : []),
        { type: 'separator' },
        { label: label('Settings…', '设置…'), accelerator: desktopSettingsAccelerator, click: options.onSettings },
        { type: 'separator' },
        { role: 'services', label: label('Services', '服务') },
        { type: 'separator' },
        { role: 'hide', label: label(`Hide ${applicationName}`, `隐藏 ${applicationName}`) },
        { role: 'hideOthers', label: label('Hide Others', '隐藏其他') },
        { role: 'unhide', label: label('Show All', '显示全部') },
        { type: 'separator' },
        { role: 'quit', label: label(`Quit ${applicationName}`, `退出 ${applicationName}`) },
      ],
    },
    {
      role: 'fileMenu',
      label: label('File', '文件'),
      submenu: [{ role: 'close', label: label('Close Window', '关闭窗口') }],
    },
    {
      role: 'editMenu',
      label: label('Edit', '编辑'),
      submenu: [
        { role: 'undo', label: label('Undo', '撤销') },
        { role: 'redo', label: label('Redo', '重做') },
        { type: 'separator' },
        { role: 'cut', label: label('Cut', '剪切') },
        { role: 'copy', label: label('Copy', '复制') },
        { role: 'paste', label: label('Paste', '粘贴') },
        { role: 'pasteAndMatchStyle', label: label('Paste and Match Style', '粘贴并匹配样式') },
        { role: 'delete', label: label('Delete', '删除') },
        { role: 'selectAll', label: label('Select All', '全选') },
        { type: 'separator' },
        {
          label: label('Speech', '语音'),
          submenu: [
            { role: 'startSpeaking', label: label('Start Speaking', '开始朗读') },
            { role: 'stopSpeaking', label: label('Stop Speaking', '停止朗读') },
          ],
        },
      ],
    },
    createWorkbenchViewMenu(options.onAction, platform, locale),
    {
      role: 'windowMenu',
      label: label('Window', '窗口'),
      submenu: [
        { role: 'minimize', label: label('Minimize', '最小化') },
        { role: 'zoom', label: label('Zoom', '缩放') },
        { type: 'separator' },
        { role: 'front', label: label('Bring All to Front', '前置全部窗口') },
        { type: 'separator' },
        { role: 'window', label: label('Window', '窗口') },
      ],
    },
    {
      role: 'help',
      label: label('Help', '帮助'),
      submenu: [
        { label: label(`${applicationName} Help`, `${applicationName} 帮助`), click: options.onHelp },
        { type: 'separator' },
        { label: label('Replay Getting Started', '重新查看入门引导'), click: options.onReplayOnboarding },
      ],
    },
  ]
}

/** Keep displayed workbench accelerators in the renderer's configurable shortcut order. */
export function createWorkbenchMenuShortcutMatcher(platform: string): (input: WorkbenchMenuInput) => boolean {
  const submenu = createWorkbenchViewMenu(() => {}, platform).submenu as MenuItemConstructorOptions[]
  const accelerators = [desktopSettingsAccelerator, ...submenu.flatMap(item => item.accelerator ? [item.accelerator] : [])]
  const bindings = accelerators.map((accelerator) => {
    const parts = accelerator.split('+')
    const modifiers = new Set(parts.slice(0, -1))
    return {
      key: parts.at(-1)!.toUpperCase(),
      meta: modifiers.has('Command') || (platform === 'darwin' && modifiers.has('CommandOrControl')),
      control: modifiers.has('Control') || (platform !== 'darwin' && modifiers.has('CommandOrControl')),
      alt: modifiers.has('Alt'),
      shift: modifiers.has('Shift'),
    }
  })
  return input => (input.type === 'keyDown' || input.type === 'keyUp') && bindings.some(binding =>
    input.key.toUpperCase() === binding.key
    && input.meta === binding.meta
    && input.control === binding.control
    && input.alt === binding.alt
    && input.shift === binding.shift,
  )
}

/**
 * Build the native edit menu for text fields and selected text. Returns no items when the page
 * should keep its own behavior, such as plain clicks on controls or custom renderer menus.
 */
export function createEditContextMenu(params: Pick<ContextMenuParams, 'dictionarySuggestions' | 'editFlags' | 'isEditable' | 'misspelledWord' | 'selectionText'>, replaceMisspelling: (word: string) => void, locale: DesktopMenuLocale = 'en'): MenuItemConstructorOptions[] {
  const label = (en: string, zh: string): string => menuLabel(locale, en, zh)
  const copy: MenuItemConstructorOptions = { role: 'copy', label: label('Copy', '复制'), enabled: params.editFlags.canCopy }
  if (!params.isEditable)
    return params.selectionText.trim() ? [copy] : []

  const suggestions: MenuItemConstructorOptions[] = params.misspelledWord
    ? [
        ...params.dictionarySuggestions.slice(0, 5).map(suggestion => ({ label: suggestion, click: () => replaceMisspelling(suggestion) })),
        { type: 'separator' as const },
      ]
    : []
  return [
    ...suggestions,
    { role: 'undo', label: label('Undo', '撤销'), enabled: params.editFlags.canUndo },
    { role: 'redo', label: label('Redo', '重做'), enabled: params.editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', label: label('Cut', '剪切'), enabled: params.editFlags.canCut },
    copy,
    { role: 'paste', label: label('Paste', '粘贴'), enabled: params.editFlags.canPaste },
    { role: 'pasteAndMatchStyle', label: label('Paste and Match Style', '粘贴并匹配样式'), enabled: params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', label: label('Select All', '全选'), enabled: params.editFlags.canSelectAll },
  ]
}
