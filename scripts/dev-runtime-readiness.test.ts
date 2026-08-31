import { describe, expect, it, vi } from 'vitest'
import { waitForRuntimeReady } from './dev-runtime-readiness.ts'

describe('development Runtime readiness', () => {
  it('retries until the health endpoint reports ok', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))

    await waitForRuntimeReady('http://127.0.0.1:4318/api/health', {
      fetch,
      intervalMs: 0,
      timeoutMs: 100,
    })

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fails with the health URL after the readiness deadline', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('connection refused'))

    await expect(waitForRuntimeReady('http://127.0.0.1:4318/api/health', {
      fetch,
      intervalMs: 0,
      timeoutMs: 0,
    })).rejects.toThrow('Runtime did not become ready at http://127.0.0.1:4318/api/health')
  })
})
