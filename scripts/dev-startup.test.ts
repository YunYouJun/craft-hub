import { describe, expect, it, vi } from 'vitest'
import { startInitialDevelopmentServices } from './dev-startup.ts'

describe('initial development service startup', () => {
  it('waits for the Runtime before exposing Vite in web mode', async () => {
    const events: string[] = []
    const webServer = { url: 'http://127.0.0.1:5173/' }

    const result = await startInitialDevelopmentServices('web', {
      startRuntime: vi.fn(async () => {
        events.push('runtime-ready')
      }),
      startWeb: vi.fn(async () => {
        events.push('vite-ready')
        return webServer
      }),
    })

    expect(events).toEqual(['runtime-ready', 'vite-ready'])
    expect(result).toBe(webServer)
  })

  it('provides the Vite server to the desktop Runtime before waiting for readiness', async () => {
    const events: string[] = []
    const webServer = { url: 'http://127.0.0.1:5173/' }

    const result = await startInitialDevelopmentServices('desktop', {
      startRuntime: vi.fn(async (server) => {
        events.push(`runtime-ready:${server?.url}`)
      }),
      startWeb: vi.fn(async () => {
        events.push('vite-ready')
        return webServer
      }),
    })

    expect(events).toEqual(['vite-ready', 'runtime-ready:http://127.0.0.1:5173/'])
    expect(result).toBe(webServer)
  })
})
