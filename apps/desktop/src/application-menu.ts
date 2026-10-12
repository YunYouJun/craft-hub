import type { Input, MenuItemConstructorOptions } from 'electron'

export const desktopSettingsAccelerator = 'CommandOrControl+,'

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
export function createWorkbenchViewMenu(onAction: (action: DesktopMenuAction) => void, platform: string): MenuItemConstructorOptions {
  const command = (label: string, action: DesktopMenuAction, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => onAction(action),
  })
  return {
    label: 'View',
    submenu: [
      command('Back', 'back', 'CommandOrControl+['),
      command('Forward', 'forward', 'CommandOrControl+]'),
      { type: 'separator' },
      command('Home', 'home', 'CommandOrControl+1'),
      command('Projects', 'workbench', 'CommandOrControl+2'),
      command('Tools', 'tools', 'CommandOrControl+3'),
      command('Development Environment', 'environment', 'CommandOrControl+4'),
      command('Workbenches', 'workbenches', 'CommandOrControl+5'),
      command('Marketplace', 'marketplace'),
      { type: 'separator' },
      command('Toggle Sidebar', 'toggle-sidebar', platform === 'darwin' ? 'Command+Control+S' : 'Control+Alt+S'),
      command('Refresh Workbench', 'refresh', 'CommandOrControl+Shift+R'),
      { type: 'separator' },
      command('Find Anything…', 'palette-all'),
      command('Find Project…', 'palette-projects', 'CommandOrControl+P'),
      command('Find Command…', 'palette-commands', 'CommandOrControl+Shift+P'),
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
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
