import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

describe('software source background refresh lifecycle', () => {
  it('checks local schedules after startup and every minute, notifies clients and clears its timer on close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'software-source-scheduler-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const refresh = vi.spyOn(runtime.softwareSources, 'refreshDue').mockResolvedValue(true)
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const abort = new AbortController()
    const app = await startCraftHubServer({ runtime, port: 0 })
    try {
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith())
      const index = intervals.mock.calls.findIndex(([, delay]) => delay === 60 * 1000)
      expect(index).toBeGreaterThanOrEqual(0)
      const tick = intervals.mock.calls[index]![0]
      const timer = intervals.mock.results[index]!.value
      const response = await fetch(`${app.url}/api/events`, { signal: abort.signal })
      const events = response.body!.getReader()
      await events.read()
      tick()
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
      const notification = await events.read()
      expect(new TextDecoder().decode(notification.value)).toContain('event: software-source-change')
      await events.cancel()
      await app.close()
      expect(clear).toHaveBeenCalledWith(timer)
    }
    finally {
      abort.abort()
      await app.close()
      vi.restoreAllMocks()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not start repository checks or an update timer on hosted instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'software-source-hosted-'))
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), hostEnvironment: 'hosted' })
    const refresh = vi.spyOn(runtime.softwareSources, 'refreshDue')
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const app = await startCraftHubServer({ runtime, port: 0 })
    try {
      expect(refresh).not.toHaveBeenCalled()
      expect(intervals.mock.calls.some(([, delay]) => delay === 60 * 1000)).toBe(false)
    }
    finally {
      await app.close()
      vi.restoreAllMocks()
      await rm(root, { recursive: true, force: true })
    }
  })
})
