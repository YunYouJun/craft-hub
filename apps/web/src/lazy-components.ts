import type { Component, Ref } from 'vue'
import { defineAsyncComponent, ref, watch } from 'vue'

type ComponentLoader<T extends Component> = () => Promise<{ default: T }>

const loaders = new Set<() => Promise<unknown>>()
let prefetchScheduled = false

/**
 * Splits a view or dialog out of the startup bundle. The loader is also registered for idle prefetch, so the first
 * open after startup renders from cache instead of waiting on a chunk.
 */
export function lazyComponent<T extends Component>(loader: ComponentLoader<T>): T {
  const component = defineAsyncComponent(loader)
  // Loading through the wrapper resolves it, so a prefetched view renders in the same frame instead of after a tick.
  const resolve = (component as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader
  loaders.add(resolve ?? loader)
  return component
}

/** Resolves every registered component now; tests use it to render lazy views synchronously. */
export async function loadLazyComponents(): Promise<void> {
  await Promise.all([...loaders].map(loader => loader()))
}

/**
 * Loads registered chunks one per idle period once startup work has settled. Failures are ignored: the component
 * retries its own import when it first renders.
 */
export function prefetchLazyComponents(): void {
  if (prefetchScheduled)
    return
  prefetchScheduled = true
  const pending = [...loaders]
  const schedule = (task: () => void): void => {
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(task, { timeout: 2_000 })
    else
      window.setTimeout(task, 200)
  }
  const next = (): void => {
    const loader = pending.shift()
    if (!loader)
      return
    void loader().catch(() => undefined).finally(() => schedule(next))
  }
  schedule(next)
}

/**
 * Mounts an on-demand dialog the first time it opens and keeps it mounted, so its close animation and state survive.
 */
export function useOpenedOnce(open: () => boolean): Ref<boolean> {
  const opened = ref(open())
  const stop = watch(open, (value) => {
    if (!value)
      return
    opened.value = true
    stop()
  }, { immediate: false })
  if (opened.value)
    stop()
  return opened
}
