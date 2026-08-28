export const commandPaletteShortcutId = 'workbench.showCommandPalette'
export const capabilityShortcutPrefix = 'capability:'
export const defaultCommandPaletteShortcut = 'Mod+K'

export const applicationShortcutReferences = [
  { id: 'paletteNavigate', shortcuts: ['ArrowUp', 'ArrowDown'] },
  { id: 'paletteBoundary', shortcuts: ['Home', 'End'] },
  { id: 'paletteSelect', shortcuts: ['Enter'] },
  { id: 'closeOverlay', shortcuts: ['Escape'] },
  { id: 'reorderPinned', shortcuts: ['Alt+ArrowUp', 'Alt+ArrowDown'] },
  { id: 'resizePanels', shortcuts: ['ArrowLeft', 'ArrowRight'] },
  { id: 'settingsTabs', shortcuts: ['ArrowUp', 'ArrowDown'] },
  { id: 'addWorkspacePath', shortcuts: ['Enter'] },
  { id: 'openTerminalLink', shortcuts: ['Mod+Click'] },
] as const

const modifierKeys = new Set(['Alt', 'Control', 'Meta', 'Shift'])

export function capabilityShortcutId(projectId: string, capabilityId: string): string {
  return `${capabilityShortcutPrefix}${projectId}:${capabilityId}`
}

export function parseCapabilityShortcutId(id: string): { capabilityId: string, projectId: string } | undefined {
  if (!id.startsWith(capabilityShortcutPrefix))
    return undefined
  const separator = id.indexOf(':', capabilityShortcutPrefix.length)
  if (separator < 0)
    return undefined
  return {
    projectId: id.slice(capabilityShortcutPrefix.length, separator),
    capabilityId: id.slice(separator + 1),
  }
}

export function isMacPlatform(platform = navigator.platform): boolean {
  return /Mac|darwin/i.test(platform)
}

function normalizedKey(key: string): string {
  if (key === ' ')
    return 'Space'
  if (key.length === 1)
    return key.toUpperCase()
  return key
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent, platform = navigator.platform): string | undefined {
  if (modifierKeys.has(event.key))
    return undefined
  const parts: string[] = []
  const mac = isMacPlatform(platform)
  if ((mac && event.metaKey) || (!mac && event.ctrlKey))
    parts.push('Mod')
  if ((mac && event.ctrlKey) || (!mac && event.metaKey))
    parts.push('Control')
  if (event.altKey)
    parts.push('Alt')
  if (event.shiftKey)
    parts.push('Shift')
  const key = normalizedKey(event.key)
  if (!parts.length && !/^F\d{1,2}$/.test(key))
    return undefined
  return [...parts, key].join('+')
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string, platform = navigator.platform): boolean {
  const expected = shortcut.split('+').filter(Boolean)
  if (!expected.length)
    return false
  const mac = isMacPlatform(platform)
  const modifiers = new Set(expected.slice(0, -1))
  const modPressed = mac ? event.metaKey : event.ctrlKey
  const controlPressed = mac ? event.ctrlKey : event.metaKey
  return normalizedKey(event.key) === expected.at(-1)
    && modPressed === modifiers.has('Mod')
    && controlPressed === modifiers.has('Control')
    && event.altKey === modifiers.has('Alt')
    && event.shiftKey === modifiers.has('Shift')
}

export function formatShortcut(shortcut: string, platform = navigator.platform): string {
  const mac = isMacPlatform(platform)
  return shortcut.split('+').map((part) => {
    if (part === 'Mod')
      return mac ? '⌘' : 'Ctrl'
    if (part === 'Control')
      return mac ? '⌃' : 'Meta'
    if (part === 'Alt')
      return mac ? '⌥' : 'Alt'
    if (part === 'Shift')
      return mac ? '⇧' : 'Shift'
    if (part === 'ArrowUp')
      return '↑'
    if (part === 'ArrowDown')
      return '↓'
    if (part === 'ArrowLeft')
      return '←'
    if (part === 'ArrowRight')
      return '→'
    return part
  }).join(' ')
}
