import type { IncomingMessage } from 'node:http'
import type { ProxyOptions } from 'vite'
import { describe, expect, it } from 'vitest'
import config from './vite.config'

/** Match routes in the same insertion order Vite uses for its proxy middleware. */
function environmentProxy(path: string): ProxyOptions | string | undefined {
  return Object.entries(config.server!.proxy!).find(([prefix]) => path.startsWith(prefix))?.[1]
}

describe('local environment development proxy', () => {
  it.each(['/api/environment/setup', '/api/setup-profile', '/api/environment/sources'])('preserves same-origin access for %s', async (path) => {
    const proxy = environmentProxy(path)
    expect(proxy).toMatchObject({ target: 'http://127.0.0.1:4318', changeOrigin: true })

    const request = {
      headers: { 'host': '127.0.0.1:5173', 'origin': 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' },
      socket: { localPort: 5173 },
    } as IncomingMessage
    const bypass = (proxy as ProxyOptions).bypass!
    expect(await bypass(request, undefined!, proxy as ProxyOptions)).toBeUndefined()
    expect(request.headers.origin).toBe('http://127.0.0.1:4318')
  })

  it.each(['/api/environment/setup', '/api/setup-profile', '/api/environment/sources'])('rejects cross-origin access for %s', async (path) => {
    const proxy = environmentProxy(path) as ProxyOptions
    const request = {
      headers: { 'host': '127.0.0.1:5173', 'origin': 'https://example.com', 'sec-fetch-site': 'cross-site' },
      socket: { localPort: 5173 },
    } as IncomingMessage

    expect(await proxy.bypass!(request, undefined!, proxy)).toBe(false)
    expect(request.headers.origin).toBe('https://example.com')
  })
})
