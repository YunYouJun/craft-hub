import { expect, it, vi } from 'vitest'
import { subscribeToProjectChanges } from './api'

it('refreshes a browser catalog when another client changes registration and releases the subscription', () => {
  const listeners = new Map<string, () => void>()
  const close = vi.fn()
  const onProjectCatalogChange = vi.fn()
  class Events {
    close = close
    addEventListener(name: string, listener: () => void) { listeners.set(name, listener) }
  }
  vi.stubGlobal('EventSource', Events)
  try {
    const stop = subscribeToProjectChanges({ onChange: vi.fn(), onProjectCatalogChange })
    listeners.get('project-catalog-change')!()
    expect(onProjectCatalogChange).toHaveBeenCalledOnce()
    stop()
    expect(close).toHaveBeenCalledOnce()
  }
  finally { vi.unstubAllGlobals() }
})

it('delivers integration invalidations only with a typed identity', () => {
  const listeners = new Map<string, (event: { data: string }) => void>()
  const changed = vi.fn()
  vi.stubGlobal('EventSource', class {
    close() {}
    addEventListener(name: string, listener: (event: { data: string }) => void) { listeners.set(name, listener) }
  })
  try {
    const stop = subscribeToProjectChanges({ onChange: vi.fn(), onIntegrationChange: changed })
    for (const data of ['{bad', '{"integrationId":42}', '{}'])
      listeners.get('integration-change')!({ data })
    expect(changed).not.toHaveBeenCalled()
    listeners.get('integration-change')!({ data: '{"integrationId":"tasks"}' })
    expect(changed).toHaveBeenCalledExactlyOnceWith('tasks')
    stop()
  }
  finally { vi.unstubAllGlobals() }
})
