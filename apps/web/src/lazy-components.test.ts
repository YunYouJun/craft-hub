// @vitest-environment happy-dom
/// <reference lib="dom" />

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

/** Vue unwraps only real module namespaces, so fake loaders mark theirs like `import()` does. */
function moduleOf(text: string) {
  return { default: defineComponent({ render: () => h('p', text) }), [Symbol.toStringTag]: 'Module' }
}

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('lazy components', () => {
  it('renders a resolved component in the first frame after preload', async () => {
    const { lazyComponent, loadLazyComponents } = await import('./lazy-components')
    const View = lazyComponent(async () => moduleOf('Loaded view'))
    await loadLazyComponents()
    expect(mount(View).text()).toBe('Loaded view')
  })

  it('prefetches registered chunks one idle period at a time and only once', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestIdleCallback', undefined)
    const { lazyComponent, prefetchLazyComponents } = await import('./lazy-components')
    const first = vi.fn(async () => moduleOf('First'))
    const second = vi.fn(async () => moduleOf('Second'))
    lazyComponent(first)
    lazyComponent(second)
    prefetchLazyComponents()
    prefetchLazyComponents()
    expect(first).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(second).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('keeps an on-demand dialog mounted after its first open', async () => {
    const { useOpenedOnce } = await import('./lazy-components')
    const open = ref(false)
    const opened = useOpenedOnce(() => open.value)
    expect(opened.value).toBe(false)
    open.value = true
    await nextTick()
    expect(opened.value).toBe(true)
    open.value = false
    await nextTick()
    expect(opened.value).toBe(true)
  })
})
