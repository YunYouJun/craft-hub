// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

const originalClipboard = navigator.clipboard
afterEach(() => {
  delete window.craftHubDesktop
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard })
})

it('copies through a native host when the WebView has no browser clipboard API', async () => {
  const nativeCopy = vi.fn().mockResolvedValue(undefined)
  window.craftHubDesktop = { copyText: nativeCopy }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  await copyText('Reviewed handoff text')
  expect(nativeCopy).toHaveBeenCalledWith('Reviewed handoff text')
})

it('uses browser clipboard permissions when no native clipboard capability exists', async () => {
  window.craftHubDesktop = { platform: 'darwin' }
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await copyText('Reviewed handoff text')
  expect(writeText).toHaveBeenCalledWith('Reviewed handoff text')
})

it('surfaces a native copy failure without retrying through a second permission path', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  window.craftHubDesktop = { copyText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable')) }
  await expect(copyText('Reviewed handoff text')).rejects.toThrow('Clipboard unavailable')
  expect(writeText).not.toHaveBeenCalled()
})
