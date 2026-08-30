import type { AddressInfo } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { startWebDevServer } from './dev-vite.ts'

describe('web development server', () => {
  it('reports the actual URL when the preferred port is occupied', async () => {
    const occupiedServer = createHttpServer()
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once('error', reject)
      occupiedServer.listen(0, '127.0.0.1', resolve)
    })
    const preferredPort = (occupiedServer.address() as AddressInfo).port

    let webServer: Awaited<ReturnType<typeof startWebDevServer>> | undefined
    try {
      webServer = await startWebDevServer({ preferredPort })
      expect(new URL(webServer.url).port).not.toBe(String(preferredPort))
    }
    finally {
      await webServer?.close()
      await new Promise<void>((resolve, reject) => {
        occupiedServer.close(error => error ? reject(error) : resolve())
      })
    }
  }, 20_000)
})
