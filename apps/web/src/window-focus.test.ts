// @vitest-environment happy-dom
/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackWindowFocus } from './window-focus'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('window focus', () => {
  it('marks the root inactive while another window has focus', () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const root = document.createElement('div')
    const stop = trackWindowFocus(root)
    expect(root.hasAttribute('data-window-inactive')).toBe(false)

    hasFocus.mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    expect(root.hasAttribute('data-window-inactive')).toBe(true)

    hasFocus.mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    expect(root.hasAttribute('data-window-inactive')).toBe(false)

    hasFocus.mockReturnValue(false)
    stop()
    window.dispatchEvent(new Event('blur'))
    expect(root.hasAttribute('data-window-inactive')).toBe(false)
  })

  it('starts inactive when the window opens in the background', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const root = document.createElement('div')
    trackWindowFocus(root)()
    expect(root.hasAttribute('data-window-inactive')).toBe(false)
    trackWindowFocus(root)
    expect(root.hasAttribute('data-window-inactive')).toBe(true)
  })
})
