// @vitest-environment happy-dom
/// <reference lib="dom" />

import { describe, expect, it } from 'vitest'
import shortcutContract from '../../desktop/test/fixtures/shortcut-contract.json'
import { applicationShortcutReferences, applicationShortcutReferencesForPlatform, capabilityShortcutId, defaultCommandPaletteShortcut, desktopWorkbenchShortcuts, formatShortcut, matchesShortcut, parseCapabilityShortcutId, shortcutFromKeyboardEvent } from './shortcuts'

describe('keyboard shortcuts', () => {
  it('records and matches the same portable bindings consumed by native macOS menus', () => {
    for (const fixture of shortcutContract) {
      const event = new KeyboardEvent('keydown', {
        key: fixture.key,
        metaKey: fixture.modifiers.includes('Mod'),
        ctrlKey: fixture.modifiers.includes('Control'),
        altKey: fixture.modifiers.includes('Alt'),
        shiftKey: fixture.modifiers.includes('Shift'),
      })
      expect(shortcutFromKeyboardEvent(event, 'MacIntel')).toBe(fixture.shortcut)
      expect(matchesShortcut(event, fixture.shortcut, 'MacIntel')).toBe(true)
    }
  })

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

  it('matches the five desktop destinations with the platform primary modifier', () => {
    const actions = ['home', 'workbench', 'tools', 'environment', 'workbenches']
    for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
      const registry = desktopWorkbenchShortcuts(platform)
      actions.forEach((action, index) => {
        const binding = registry.find(binding => binding.action === action)!
        const event = new KeyboardEvent('keydown', {
          key: String(index + 1),
          metaKey: platform === 'MacIntel',
          ctrlKey: platform !== 'MacIntel',
        })
        expect(matchesShortcut(event, binding.shortcut, platform)).toBe(true)
        expect(matchesShortcut(new KeyboardEvent('keydown', { key: String(index + 1) }), binding.shortcut, platform)).toBe(false)
      })
      expect(registry.some(binding => binding.shortcut === defaultCommandPaletteShortcut)).toBe(false)
    }
  })

  it('uses platform-specific sidebar modifiers without accepting partial or extra modifiers', () => {
    const macBinding = desktopWorkbenchShortcuts('darwin').find(binding => binding.action === 'toggle-sidebar')!
    const linuxBinding = desktopWorkbenchShortcuts('Linux').find(binding => binding.action === 'toggle-sidebar')!
    expect(macBinding.shortcut).toBe('Mod+Control+S')
    expect(linuxBinding.shortcut).toBe('Mod+Alt+S')
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true, ctrlKey: true }), macBinding.shortcut, 'darwin')).toBe(true)
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true }), macBinding.shortcut, 'darwin')).toBe(false)
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', metaKey: true, ctrlKey: true, shiftKey: true }), macBinding.shortcut, 'darwin')).toBe(false)
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, altKey: true }), linuxBinding.shortcut, 'Linux')).toBe(true)
    expect(formatShortcut(macBinding.shortcut, 'darwin')).toBe('⌘ ⌃ S')
    expect(formatShortcut(linuxBinding.shortcut, 'Linux')).toBe('Ctrl Alt S')
  })

  it('documents every desktop command with its actual platform binding', () => {
    const platform = 'MacIntel'
    const reference = applicationShortcutReferencesForPlatform(platform)
    const bindings = desktopWorkbenchShortcuts(platform)
    expect(reference.slice(0, bindings.length).map(item => item.shortcuts)).toEqual(bindings.map(binding => [binding.shortcut]))
    expect(reference.slice(-applicationShortcutReferences.length)).toEqual(applicationShortcutReferences)
    const shortcuts = desktopWorkbenchShortcuts(platform).map(binding => binding.shortcut)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    expect(desktopWorkbenchShortcuts(platform).find(binding => binding.action === 'settings')?.shortcut).toBe('Mod+,')
    expect(desktopWorkbenchShortcuts(platform).find(binding => binding.action === 'refresh')?.shortcut).toBe('Mod+Shift+R')
    expect(desktopWorkbenchShortcuts(platform).find(binding => binding.action === 'back')?.shortcut).toBe('Mod+[')
    expect(desktopWorkbenchShortcuts(platform).find(binding => binding.action === 'forward')?.shortcut).toBe('Mod+]')
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
