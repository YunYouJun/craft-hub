import { describe, expect, it, vi } from 'vitest'
import { createDeferredOnceTask } from '../src/shutdown-task.ts'

describe('createDeferredOnceTask', () => {
  it('registers the pending task before synchronously reentrant work can request it again', async () => {
    let requestShutdown!: () => Promise<void>
    const shutdown = vi.fn(async () => {
      void requestShutdown()
    })
    requestShutdown = createDeferredOnceTask(shutdown)

    const first = requestShutdown()
    const second = requestShutdown()

    expect(second).toBe(first)
    await first
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
