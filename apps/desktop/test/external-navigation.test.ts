import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installExternalNavigationHandlers } from '../src/external-navigation.ts'

type WindowOpenHandler = (details: { url: string }) => { action: 'allow' | 'deny' }

function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn<(handler: WindowOpenHandler) => void>(),
  })
  const openExternal = vi.fn(async (_url: string) => {})
  const onError = vi.fn()
  installExternalNavigationHandlers(contents as never, 'http://127.0.0.1:4318/workbench', openExternal, onError)

  function openWindow(url: string) {
    return contents.setWindowOpenHandler.mock.calls[0]![0]({ url })
  }

  function navigate(url: string) {
    const event = { preventDefault: vi.fn() }
    contents.emit('will-navigate', event, url)
    return event
  }

  return { navigate, onError, openExternal, openWindow }
}

describe('desktop external navigation', () => {
  it.each(['https://example.com/work/items/123', 'http://example.com/docs'])('opens a new-window HTTP link in the system browser: %s', (url) => {
    const { onError, openExternal, openWindow } = fixture()

    expect(openWindow(url)).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(['file:///tmp/example', 'javascript:alert(1)', 'data:text/html,example', 'contact://message?user=alice', 'invalid-url'])('denies a new window without handing a non-HTTP URL to the system: %s', (url) => {
    const { openExternal, openWindow } = fixture()

    expect(openWindow(url)).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each(['http://127.0.0.1:4318/projects/example', 'http://127.0.0.1:4318/workbench?tab=items#today'])('preserves navigation within the workbench origin: %s', (url) => {
    const { navigate, openExternal } = fixture()

    expect(navigate(url).preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each([
    'https://example.com/work/items/123',
    'http://127.0.0.1:43180/projects/example',
    'https://127.0.0.1:4318/projects/example',
    'http://127.0.0.1:4318@example.com/projects/example',
  ])('opens a navigation outside the workbench origin in the system browser: %s', (url) => {
    const { navigate, openExternal } = fixture()

    expect(navigate(url).preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it.each(['contact://message?user=alice', 'invalid-url'])('leaves existing non-HTTP navigation handling unchanged: %s', (url) => {
    const { navigate, openExternal } = fixture()

    expect(navigate(url).preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it.each(['window', 'navigation'] as const)('reports a system-browser failure from %s without reopening an Electron window', async (mode) => {
    const { navigate, onError, openExternal, openWindow } = fixture()
    const failure = new Error('No browser available')
    openExternal.mockRejectedValueOnce(failure)

    if (mode === 'window')
      expect(openWindow('https://example.com/docs')).toEqual({ action: 'deny' })
    else
      expect(navigate('https://example.com/docs').preventDefault).toHaveBeenCalledOnce()
    await Promise.resolve()

    expect(openExternal).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
  })
})
