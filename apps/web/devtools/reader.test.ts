import { describe, expect, it, vi } from 'vitest'
import { createInspectorReader } from './reader'

describe('development inspector API reader', () => {
  it('uses GET-only routes, keeps the latest 30 runs, and excludes output logs', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = new URL(String(input)).pathname
      const bodies: Record<string, unknown> = {
        '/api/health': { status: 'ok' },
        '/api/projects': { projects: [], diagnostics: [] },
        '/api/diagnostics': { diagnostics: [], summary: { errors: 0, warnings: 0 } },
        '/api/runs': Array.from({ length: 35 }, (_, index) => ({
          id: String(index),
          startedAt: new Date(index * 1000).toISOString(),
          stdout: 'large output',
          stderr: 'private output',
          status: 'completed',
        })),
        '/api/projects/sample/capability-discovery': { capabilities: [], diagnostics: [] },
      }
      return Response.json(bodies[path])
    })
    const reader = createInspectorReader(fetcher)
    const snapshot = await reader.snapshot()
    await reader.discover('sample')

    expect(snapshot.errors).toEqual([])
    expect(snapshot.runs).toHaveLength(30)
    expect(snapshot.runs[0]?.id).toBe('34')
    expect(snapshot.runs[29]?.id).toBe('5')
    expect(snapshot.runs[0]).not.toHaveProperty('stdout')
    expect(snapshot.runs[0]).not.toHaveProperty('stderr')
    expect(fetcher).toHaveBeenCalledTimes(5)
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:4318\/api\//)
      expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
    }
  })

  it('preserves available sections when diagnostics fail and recovers on refresh', async () => {
    let failing = true
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/diagnostics'))
        return failing ? new Response('Unavailable', { status: 503 }) : Response.json({ diagnostics: [], summary: { errors: 0, warnings: 0 } })
      if (String(url).endsWith('/health'))
        return Response.json({ status: 'ok' })
      if (String(url).endsWith('/projects'))
        return Response.json({ projects: [{ id: 'sample', trust: 'untrusted' }], diagnostics: [] })
      return Response.json([])
    })
    const reader = createInspectorReader(fetcher)
    const snapshot = await reader.snapshot()
    expect(snapshot.health?.status).toBe('ok')
    expect(snapshot.catalog.projects[0]?.trust).toBe('untrusted')
    expect(snapshot.errors).toEqual([{ section: 'Diagnostics', message: 'Runtime returned HTTP 503 for /api/diagnostics' }])
    failing = false
    expect((await reader.snapshot()).errors).toEqual([])
  })

  it('rejects project IDs that could escape the discovery route without sending a request', () => {
    const fetcher = vi.fn<typeof fetch>()
    const reader = createInspectorReader(fetcher)
    for (const id of ['../trust', 'sample?execute=true', 'sample/../../runs', ''])
      expect(() => reader.discover(id)).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
