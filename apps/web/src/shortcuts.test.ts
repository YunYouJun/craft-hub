// @vitest-environment happy-dom
/// <reference lib="dom" />

import { describe, expect, it } from 'vitest'
import { applicationShortcutReferences, capabilityShortcutId, formatShortcut, matchesShortcut, parseCapabilityShortcutId, shortcutFromKeyboardEvent } from './shortcuts'

describe('keyboard shortcuts', () => {
  it('normalizes the platform primary modifier', () => {
    const event = new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true })
    expect(shortcutFromKeyboardEvent(event, 'MacIntel')).toBe('Mod+Shift+P')
    expect(matchesShortcut(event, 'Mod+Shift+P', 'MacIntel')).toBe(true)
    expect(formatShortcut('Mod+Shift+P', 'MacIntel')).toBe('⌘ ⇧ P')
  })

  it('uses Control as Mod away from macOS', () => {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })
    expect(shortcutFromKeyboardEvent(event, 'Linux x86_64')).toBe('Mod+K')
    expect(matchesShortcut(event, 'Mod+K', 'Linux x86_64')).toBe(true)
    expect(formatShortcut('Mod+K', 'Linux x86_64')).toBe('Ctrl K')
  })

  it('does not turn unmodified typing into a global shortcut', () => {
    expect(shortcutFromKeyboardEvent(new KeyboardEvent('keydown', { key: 'k' }), 'MacIntel')).toBeUndefined()
  })

  it('round trips a capability shortcut action identifier', () => {
    expect(parseCapabilityShortcutId(capabilityShortcutId('project', 'build'))).toEqual({ projectId: 'project', capabilityId: 'build' })
  })

  it('keeps the complete built-in shortcut reference in one registry', () => {
    expect(applicationShortcutReferences.map(reference => reference.id)).toEqual([
      'paletteNavigate',
      'paletteBoundary',
      'paletteSelect',
      'closeOverlay',
      'reorderPinned',
      'resizePanels',
      'settingsTabs',
      'addWorkspacePath',
      'openTerminalLink',
    ])
  })
})
