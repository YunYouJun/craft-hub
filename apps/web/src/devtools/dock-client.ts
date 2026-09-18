import type { DevToolsFrameNavClient, DockEntryState, DocksEntriesContext } from '@vitejs/devtools-kit/client'
import { attachDevToolsFrameNav } from '@vitejs/devtools-kit/client'
import { inspectorFrameId, inspectorGroupId } from '../../devtools/navigation'

type NavigationDocks = Pick<DocksEntriesContext, 'register' | 'switchEntry' | 'getStateById'>
export interface InspectorDockContext {
  current: DockEntryState
  docks: NavigationDocks
}
interface FrameBinding {
  iframe?: HTMLIFrameElement
  adapter?: DevToolsFrameNavClient
  users: number
}
const bindings = new WeakMap<NavigationDocks, FrameBinding>()
const disposers = new Set<() => void>()

/** Attach the official adapter to the child that mounts, including restored child docks. */
export default function setupInspectorDock(ctx: InspectorDockContext): () => void {
  let binding = bindings.get(ctx.docks)
  if (!binding) {
    binding = { users: 0 }
    bindings.set(ctx.docks, binding)
  }
  const shared = binding
  shared.users++

  function mount(iframe: HTMLIFrameElement): void {
    if (shared.iframe === iframe)
      return
    shared.adapter?.dispose()
    shared.iframe = iframe
    shared.adapter = attachDevToolsFrameNav({
      frameId: inspectorFrameId,
      anchor: {
        type: 'iframe',
        id: inspectorFrameId,
        title: 'Craft Hub Inspector',
        icon: '/favicon.svg',
        url: '/__craft-hub/',
        frameId: inspectorFrameId,
        groupId: inspectorGroupId,
      },
      iframe,
      window: iframe.ownerDocument.defaultView ?? window,
      origin: window.location.origin,
      docks: ctx.docks,
    })
  }
  const off = ctx.current.events.on('dom:iframe:mounted', mount)
  if (ctx.current.domElements.iframe)
    mount(ctx.current.domElements.iframe)

  function dispose(): void {
    if (!disposers.delete(dispose))
      return
    off()
    if (--shared.users === 0) {
      shared.adapter?.dispose()
      bindings.delete(ctx.docks)
    }
  }
  disposers.add(dispose)
  return dispose
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const dispose of [...disposers])
      dispose()
  })
}
