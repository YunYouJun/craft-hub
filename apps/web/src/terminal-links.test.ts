// @vitest-environment happy-dom
/// <reference lib="dom" />

import { describe, expect, it } from 'vitest'
import { shouldActivateTerminalLink, terminalHttpUrl } from './terminal-links'

describe('terminal links', () => {
  it('requires Command on macOS and Control on other platforms', () => {
    expect(shouldActivateTerminalLink({ ctrlKey: false, metaKey: true }, 'darwin')).toBe(true)
    expect(shouldActivateTerminalLink({ ctrlKey: true, metaKey: false }, 'MacIntel')).toBe(false)
    expect(shouldActivateTerminalLink({ ctrlKey: true, metaKey: false }, 'Linux x86_64')).toBe(true)
    expect(shouldActivateTerminalLink({ ctrlKey: false, metaKey: true }, 'Win32')).toBe(false)
  })

  it('allows only HTTP links from terminal output', () => {
    expect(terminalHttpUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(terminalHttpUrl('file:///tmp/script')).toBeUndefined()
    expect(terminalHttpUrl('javascript:alert(1)')).toBeUndefined()
  })
})
