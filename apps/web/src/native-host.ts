import type { Router } from 'vue-router'

/** Window event carrying a command from a native host's toolbar or menu to the workbench. */
export const nativeCommandEvent = 'craft-hub:native-command'

/** Commands a native host may send; each maps to an action the web UI already offers through its own chrome. */
export type NativeCommand = 'palette' | 'settings'

const nativeCommands = new Set<string>(['palette', 'settings'] satisfies NativeCommand[])

interface NativeHostWindow extends Window {
  __craftHubNativeHost?: unknown
  __craftHubNavigate?: (path: string) => Promise<void>
  __craftHubCommand?: (command: string) => void
  webkit?: { messageHandlers?: { craftHubNative?: { postMessage: (message: unknown) => void } } }
}

/**
 * Connect the web UI to a native host that draws its own sidebar and toolbar around it. The host defines
 * `__craftHubNativeHost` before the page loads; the web UI then hides its own window chrome, accepts in-app
 * navigation and command requests, and reports each route back so the native sidebar can follow.
 */
export function installNativeHost(router: Router, target: Window = window): boolean {
  const host = target as NativeHostWindow
  const kind = host.__craftHubNativeHost
  if (typeof kind !== 'string' || !/^[a-z]+$/.test(kind))
    return false
  host.document.documentElement.dataset.nativeHost = kind
  host.__craftHubNavigate = async (path) => {
    // Only same-app paths; a protocol-relative or absolute URL would leave the workbench.
    if (path.startsWith('/') && !path.startsWith('//'))
      await router.push(path)
  }
  host.__craftHubCommand = (command) => {
    if (nativeCommands.has(command))
      host.dispatchEvent(new CustomEvent<NativeCommand>(nativeCommandEvent, { detail: command as NativeCommand }))
  }
  router.afterEach((to) => {
    host.webkit?.messageHandlers?.craftHubNative?.postMessage({ type: 'route', path: to.path })
  })
  return true
}
