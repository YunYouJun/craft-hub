import type { Router } from 'vue-router'

/** Window event carrying a command from a native host's toolbar or menu to the workbench. */
export const nativeCommandEvent = 'craft-hub:native-command'
export const nativeSelectionEvent = 'craft-hub:native-selection'

/** Selection only: the existing workbench still owns trust, review and execution. */
export interface NativeSelection { projectId: string, capabilityId?: string }

/** Ask the macOS host for an independent panel; ordinary browsers keep their web dialogs. */
export function requestNativePanel(type: 'palette' | 'capture', mode?: string, target: Window = window): boolean {
  const host = target as NativeHostWindow
  const handler = host.webkit?.messageHandlers?.craftHubNative
  if (host.__craftHubNativeHost !== 'macos' || !handler)
    return false
  handler.postMessage({ type, ...(mode ? { mode } : {}) })
  return true
}

/** Report readiness only after the initial project catalog and application listeners are installed. */
export function nativeWorkbenchReady(target: Window = window): void {
  const host = target as NativeHostWindow
  if (host.__craftHubNativeHost === 'macos')
    host.webkit?.messageHandlers?.craftHubNative?.postMessage({ type: 'ready' })
}

/** Commands a native host may send; each maps to an action the web UI already offers through its own chrome. */
export type NativeCommand = 'palette' | 'settings'

const nativeCommands = new Set<string>(['palette', 'settings'] satisfies NativeCommand[])

interface NativeHostWindow extends Window {
  __craftHubNativeHost?: unknown
  __craftHubNavigate?: (path: string) => Promise<void>
  __craftHubCommand?: (command: string) => void
  __craftHubSelect?: (selection: unknown) => void
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
  host.__craftHubSelect = (selection) => {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection))
      return
    const input = selection as Record<string, unknown>
    if (Object.keys(input).some(key => !['projectId', 'capabilityId'].includes(key))
      || typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 1024
      || (input.capabilityId !== undefined && (typeof input.capabilityId !== 'string' || input.capabilityId.length > 4096))) {
      return
    }
    host.dispatchEvent(new CustomEvent<NativeSelection>(nativeSelectionEvent, { detail: {
      projectId: input.projectId,
      ...(typeof input.capabilityId === 'string' ? { capabilityId: input.capabilityId } : {}),
    } }))
  }
  router.afterEach((to) => {
    host.webkit?.messageHandlers?.craftHubNative?.postMessage({ type: 'route', path: to.path })
  })
  return true
}
