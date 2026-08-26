import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

describe('craft hub server lifecycle', () => {
  it('exposes marketplace catalog, source, and installed-plugin state', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-server-marketplace-'))
    const runtime = new CraftHubRuntime({
      dataDir,
      distribution: {
        id: 'test',
        name: 'Test',
        marketplaceSources: [{
          id: 'test',
          name: 'Test catalog',
          kind: 'builtin',
          enabled: true,
          catalog: {
            schemaVersion: 1,
            id: 'test',
            name: 'Test catalog',
            plugins: [{
              package: '@acme/craft-hub-plugin-test',
              version: '1.0.0',
              displayName: 'Test plugin',
              publisher: 'Acme',
              permissions: [],
              categories: [],
            }],
          },
        }],
      },
    })
    const app = await startCraftHubServer({ port: 0, runtime })
    try {
      await expect(fetch(`${app.url}/api/marketplace/catalog`).then(response => response.json())).resolves.toEqual([
        expect.objectContaining({ package: '@acme/craft-hub-plugin-test', sourceId: 'test' }),
      ])
      await expect(fetch(`${app.url}/api/marketplace/sources`).then(response => response.json())).resolves.toEqual([
        expect.objectContaining({ id: 'test', kind: 'builtin' }),
      ])
      await expect(fetch(`${app.url}/api/plugins`).then(response => response.json())).resolves.toEqual([])
    }
    finally {
      await app.close()
    }
  })

  it('releases initialized resources when the requested port is occupied', async () => {
    const occupiedServer = createServer()
    await new Promise<void>((resolve, reject) => {
      occupiedServer.once('error', reject)
      occupiedServer.listen(0, '127.0.0.1', resolve)
    })
    const port = (occupiedServer.address() as AddressInfo).port
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-server-'))
    const runtime = new CraftHubRuntime(dataDir)
    const closeRuntime = vi.spyOn(runtime, 'close')
    const closeSettings = vi.spyOn(runtime.settings, 'close')

    try {
      await expect(startCraftHubServer({ port, runtime })).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(closeRuntime).toHaveBeenCalledOnce()
      expect(closeSettings).toHaveBeenCalledOnce()
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        occupiedServer.close(error => error ? reject(error) : resolve())
      })
    }
  })
})
