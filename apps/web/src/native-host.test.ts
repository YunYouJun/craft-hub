// @vitest-environment happy-dom
/// <reference lib="dom" />
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { installNativeHost, nativeCommandEvent } from './native-host'
import { createWorkbenchRouter } from './router'

type TestWindow = Window & Record<string, unknown>

afterEach(() => {
  const host = window as unknown as TestWindow
  for (const key of ['__craftHubNativeHost', '__craftHubNavigate', '__craftHubCommand', 'webkit'])
    delete host[key]
  delete document.documentElement.dataset.nativeHost
})

it('leaves an ordinary browser or Electron page untouched', () => {
  const router = createWorkbenchRouter(createMemoryHistory())
  expect(installNativeHost(router)).toBe(false)
  expect(document.documentElement.dataset.nativeHost).toBeUndefined()
  expect((window as unknown as TestWindow).__craftHubNavigate).toBeUndefined()
})

it('hides web chrome, follows native navigation and reports routes to the host', async () => {
  const postMessage = vi.fn()
  const host = window as unknown as TestWindow
  host.__craftHubNativeHost = 'macos'
  host.webkit = { messageHandlers: { craftHubNative: { postMessage } } }
  const router = createWorkbenchRouter(createMemoryHistory())
  expect(installNativeHost(router)).toBe(true)
  expect(document.documentElement.dataset.nativeHost).toBe('macos')

  await (host.__craftHubNavigate as (path: string) => Promise<void>)('/tools')
  expect(router.currentRoute.value.path).toBe('/tools')
  expect(postMessage).toHaveBeenLastCalledWith({ type: 'route', path: '/tools' })

  // Protocol-relative and absolute targets would leave the workbench, so they are ignored.
  await (host.__craftHubNavigate as (path: string) => Promise<void>)('//example.com/tools')
  await (host.__craftHubNavigate as (path: string) => Promise<void>)('https://example.com')
  expect(router.currentRoute.value.path).toBe('/tools')

  const commands: unknown[] = []
  const record = (event: Event): void => {
    commands.push((event as CustomEvent).detail)
  }
  window.addEventListener(nativeCommandEvent, record)
  const command = host.__craftHubCommand as (name: string) => void
  command('palette')
  command('settings')
  // Unknown commands do not reach the workbench.
  command('run-project')
  window.removeEventListener(nativeCommandEvent, record)
  expect(commands).toEqual(['palette', 'settings'])
})

it('ignores a host marker that is not a plain identifier', () => {
  const host = window as unknown as TestWindow
  host.__craftHubNativeHost = 'macos"><script>'
  expect(installNativeHost(createWorkbenchRouter(createMemoryHistory()))).toBe(false)
  expect(document.documentElement.dataset.nativeHost).toBeUndefined()
})
