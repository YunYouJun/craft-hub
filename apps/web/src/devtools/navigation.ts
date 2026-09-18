import type { DevToolsFrameNavFrameMessage, DevToolsFrameNavHostMessage, DevToolsFrameTab } from '@vitejs/devtools-kit/client'
import type { ComputedRef, Ref } from 'vue'
import type { InspectorTab } from '../../devtools/navigation'
import { FRAME_NAV_CHANNEL, FRAME_NAV_VERSION } from '@vitejs/devtools-kit/client'
import { onMounted, onScopeDispose, ref, watch } from 'vue'
import { inspectorFrameId, isInspectorTab } from '../../devtools/navigation'

/** The embedded half of Devframe's public frame-nav protocol; direct URLs also work. */
export function useInspectorNavigation(tabs: ComputedRef<DevToolsFrameTab[]>): {
  tab: Ref<InspectorTab>
  embedded: boolean
  navigate: (id: InspectorTab) => void
} {
  function readHash(): InspectorTab {
    const id = window.location.hash.replace(/^#\/?/, '')
    return isInspectorTab(id) ? id : 'projects'
  }
  const tab = ref<InspectorTab>(readHash())
  const embedded = window.parent !== window
  // This inspector and the Vite host always share an origin.
  const origin = window.location.origin
  type Payload = { type: 'ready' | 'manifest', tabs: DevToolsFrameTab[], current: InspectorTab }
    | { type: 'navigated', tabId: InspectorTab }

  function post(payload: Payload): void {
    if (embedded) {
      window.parent.postMessage({
        channel: FRAME_NAV_CHANNEL,
        v: FRAME_NAV_VERSION,
        frameId: inspectorFrameId,
        from: 'frame',
        ...payload,
      } satisfies DevToolsFrameNavFrameMessage, origin)
    }
  }
  function navigate(id: InspectorTab): void {
    tab.value = id
    if (window.location.hash !== `#/${id}`)
      window.location.hash = `/${id}`
    post({ type: 'navigated', tabId: id })
  }
  function onMessage(event: MessageEvent<DevToolsFrameNavHostMessage>): void {
    if (!embedded || event.source !== window.parent || event.origin !== origin)
      return
    const data = event.data
    if (!data || data.channel !== FRAME_NAV_CHANNEL || data.v !== FRAME_NAV_VERSION || data.frameId !== inspectorFrameId || data.from !== 'host')
      return
    if (data.type === 'hello')
      post({ type: 'ready', tabs: tabs.value, current: tab.value })
    else if (data.type === 'navigate' && isInspectorTab(data.tabId))
      navigate(data.tabId)
  }
  function onHashChange(): void {
    tab.value = readHash()
    post({ type: 'navigated', tabId: tab.value })
  }
  onMounted(() => {
    window.addEventListener('message', onMessage)
    window.addEventListener('hashchange', onHashChange)
    post({ type: 'ready', tabs: tabs.value, current: tab.value })
  })
  watch(tabs, () => post({ type: 'manifest', tabs: tabs.value, current: tab.value }))
  onScopeDispose(() => {
    window.removeEventListener('message', onMessage)
    window.removeEventListener('hashchange', onHashChange)
  })
  return { tab, navigate, embedded }
}
