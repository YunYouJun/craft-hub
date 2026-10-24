import type { DeviceIdentity, DeviceIdentityVault, PersonalCloudControllerOptions } from '../src/controller'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PersonalCloudController } from '../src/controller'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0))
    await close()
  vi.restoreAllMocks()
})

async function fixture(registered = false, overrides: Partial<PersonalCloudControllerOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-cloud-controller-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const pair = generateKeyPairSync('ed25519')
  const identity: DeviceIdentity = {
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
  let stored: DeviceIdentity | undefined = registered ? { ...identity, deviceId: 'fixture-device' } : undefined
  const vault = {
    load: vi.fn(async () => stored && { ...stored }),
    loadOrCreate: vi.fn(async () => ({ ...(stored ??= identity) })),
    register: vi.fn<DeviceIdentityVault['register']>(async (value, deviceId) => ({ ...(stored = { ...value, deviceId }) })),
    clear: vi.fn(async () => { stored = undefined }),
  }
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/v1/devices/adopt')
      return json({ device: { deviceId: 'fixture-device' } })
    if (path === '/v1/device-requests/claim')
      return json([])
    if (path === '/v1/sync')
      return json({ documents: [], accepted: [], conflicts: [] })
    return json({})
  })
  const openExternal = vi.fn(async (_url: string) => {})
  const controller = new PersonalCloudController({
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
    callbackScheme: 'craft-hub-native',
    dataDir: runtime.store.dataDir,
    platform: 'darwin',
    runtime,
    vault,
    fetch: fetcher,
    openExternal,
    approve: async () => false,
    ...overrides,
  })
  cleanup.push(async () => {
    await controller.close()
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const callback = () => {
    const opening = new URL(openExternal.mock.calls.at(-1)![0])
    const result = new URL(opening.searchParams.get('callback')!)
    result.searchParams.set('code', 'fixture-code')
    result.searchParams.set('challenge', opening.searchParams.get('challenge')!)
    return result.toString()
  }
  return {
    controller,
    vault,
    fetcher,
    openExternal,
    identity,
    runtime,
    callback,
    setStored: (value: DeviceIdentity) => {
      stored = value
    },
    hasStored: () => stored !== undefined,
  }
}

describe('personal-cloud controller lifecycle', () => {
  it.each([
    { endpoint: undefined, webOrigin: undefined, state: 'disabled' },
    { endpoint: 'http://api.example.com', webOrigin: 'https://cloud.example.com', state: 'error' },
    { endpoint: 'https://api.example.com', webOrigin: undefined, state: 'error' },
  ])('does not touch storage or the network for $state configuration', async ({ endpoint, webOrigin, state }) => {
    const f = await fixture(false, { endpoint, webOrigin })
    await f.controller.start()
    expect(f.controller.status().state).toBe(state)
    expect(f.vault.load).not.toHaveBeenCalled()
    await expect(f.controller.connect()).rejects.toThrow('HTTPS')
    expect(f.vault.loadOrCreate).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
  })

  it('connects through the configured callback, exposes status only, and consumes the challenge once', async () => {
    const f = await fixture()
    await f.controller.start()
    expect(f.controller.status()).toMatchObject({ state: 'disconnected', busy: false })
    await f.controller.connect()
    const callback = f.callback()
    await expect(f.controller.adopt(callback.replace('craft-hub-native:', 'craft-hub:'))).rejects.toThrow('callback')
    await expect(f.controller.adopt(`${callback}&code=second`)).rejects.toThrow('callback')
    expect(f.fetcher).not.toHaveBeenCalled()
    await f.controller.adopt(callback)
    expect(f.controller.status()).toMatchObject({ state: 'connected', deviceId: 'fixture-device', busy: false })
    expect(JSON.stringify(f.controller.status()).includes('PRIVATE KEY')).toBe(false)
    const request = f.fetcher.mock.calls[0]![1]!
    expect(request.redirect).toBe('error')
    expect(request.body).not.toContain('PRIVATE KEY')
    await expect(f.controller.adopt(callback)).rejects.toThrow('callback')
    await f.controller.disconnect()
    expect(f.controller.status()).toMatchObject({ state: 'disconnected', busy: false })
    expect(f.vault.clear).toHaveBeenCalledOnce()
    expect(f.hasStored()).toBe(false)
  })

  it('waits for an in-flight identity creation before disconnecting and never opens its late login URL', async () => {
    const f = await fixture()
    const started = deferred<void>()
    const created = deferred<DeviceIdentity>()
    f.vault.loadOrCreate.mockImplementation(async () => {
      started.resolve()
      const identity = await created.promise
      f.setStored(identity)
      return identity
    })
    const connect = f.controller.connect()
    const rejected = expect(connect).rejects.toThrow('cancelled')
    await started.promise
    const disconnect = f.controller.disconnect()
    await expect(f.controller.connect()).rejects.toThrow('in progress')
    expect(f.controller.status().busy).toBe(true)
    created.resolve(f.identity)
    await rejected
    await disconnect
    expect(f.openExternal).not.toHaveBeenCalled()
    expect(f.vault.clear).toHaveBeenCalledOnce()
    expect(f.hasStored()).toBe(false)
    expect(f.controller.status().state).toBe('disconnected')
  })

  it('drains an already-started vault mutation on close without opening a late browser or retrying', async () => {
    const f = await fixture()
    const started = deferred<void>()
    const created = deferred<DeviceIdentity>()
    f.vault.loadOrCreate.mockImplementation(async () => {
      started.resolve()
      return created.promise
    })
    const connect = f.controller.connect()
    const rejected = expect(connect).rejects.toThrow('cancelled')
    await started.promise
    let closed = false
    const closing = f.controller.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    created.resolve(f.identity)
    await rejected
    await closing
    expect(f.openExternal).not.toHaveBeenCalled()
    expect(f.vault.loadOrCreate).toHaveBeenCalledOnce()
    expect(f.vault.clear).not.toHaveBeenCalled()
  })

  it('does not reactivate an identity loaded after disconnect starts', async () => {
    const f = await fixture(true)
    const load = deferred<DeviceIdentity>()
    f.vault.load.mockImplementation(() => load.promise)
    const start = f.controller.start()
    const disconnect = f.controller.disconnect()
    load.resolve({ ...f.identity, deviceId: 'fixture-device' })
    await Promise.all([start, disconnect])
    expect(f.controller.status().state).toBe('disconnected')
    expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v1/devices/revoke'])
    expect(f.hasStored()).toBe(false)
  })

  it('waits for an in-flight registration, then revokes and clears that exact identity', async () => {
    const f = await fixture()
    const started = deferred<void>()
    const registration = deferred<DeviceIdentity>()
    f.vault.register.mockImplementation(async () => {
      started.resolve()
      const registered = await registration.promise
      f.setStored(registered)
      return registered
    })
    await f.controller.connect()
    const adopting = f.controller.adopt(f.callback())
    const rejected = expect(adopting).rejects.toThrow('cancelled')
    await started.promise
    const disconnect = f.controller.disconnect()
    registration.resolve({ ...f.identity, deviceId: 'fixture-device' })
    await rejected
    await disconnect
    expect(f.fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/v1/devices/adopt', '/v1/devices/revoke'])
    expect(f.vault.clear).toHaveBeenCalledOnce()
    expect(f.hasStored()).toBe(false)
    expect(f.controller.status().state).toBe('disconnected')
  })

  it('deduplicates synchronization and discards a late reply after disconnect', async () => {
    const f = await fixture(true)
    await f.controller.start()
    const started = deferred<void>()
    const response = deferred<Response>()
    f.fetcher.mockImplementation(async (input) => {
      if (new URL(String(input)).pathname === '/v1/sync') {
        started.resolve()
        return response.promise
      }
      return json({})
    })
    const first = f.controller.synchronize()
    const rejected = expect(first).rejects.toThrow('cancelled')
    expect(f.controller.synchronize()).toBe(first)
    await started.promise
    const disconnect = f.controller.disconnect()
    response.resolve(json({ documents: [], accepted: [], conflicts: [] }))
    await rejected
    await disconnect
    expect(f.controller.status()).toMatchObject({ state: 'disconnected', busy: false })
    expect(f.controller.status().lastSyncAt).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps Keychain and network errors private and does not create an identity after an automatic read failure', async () => {
    const f = await fixture()
    f.vault.load.mockRejectedValue(new Error('private-fixture-storage-detail'))
    await f.controller.start()
    expect(f.controller.status()).toMatchObject({ state: 'error', diagnostic: expect.stringContaining('secure storage') })
    expect(f.controller.status().diagnostic).not.toContain('private-fixture')
    expect(f.vault.loadOrCreate).not.toHaveBeenCalled()
    await f.controller.connect()
    f.fetcher.mockResolvedValue(json({ error: 'private-fixture-provider-detail' }, 503))
    const callback = f.callback()
    await expect(f.controller.adopt(callback)).rejects.toThrow('request failed')
    await expect(f.controller.adopt(callback)).rejects.toThrow('callback')
    expect(f.controller.status().diagnostic).not.toContain('private-fixture')
    expect(f.vault.register).not.toHaveBeenCalled()
  })

  it('clears locally even when revocation cannot be confirmed and reports that partial outcome', async () => {
    const f = await fixture(true)
    await f.controller.start()
    f.fetcher.mockRejectedValue(new Error('private-fixture-network-detail'))
    await expect(f.controller.disconnect()).rejects.toThrow('Local device was disconnected')
    expect(f.controller.status()).toMatchObject({ state: 'disconnected', diagnostic: expect.stringContaining('revocation') })
    expect(f.controller.status().diagnostic).not.toContain('private-fixture')
    expect(f.hasStored()).toBe(false)
  })

  it('does not confuse an unread or failed vault with an empty disconnected identity', async () => {
    const f = await fixture(true)
    f.vault.load.mockRejectedValue(new Error('private-fixture-locked'))
    await f.controller.start()
    await expect(f.controller.disconnect()).rejects.toThrow('secure storage')
    expect(f.controller.status().state).toBe('error')
    expect(f.vault.clear).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.hasStored()).toBe(true)
    f.vault.load.mockResolvedValue({ ...f.identity, deviceId: 'fixture-device' })
    await f.controller.disconnect()
    expect(f.controller.status().state).toBe('disconnected')
    expect(f.hasStored()).toBe(false)
    expect(f.vault.clear).toHaveBeenCalledOnce()
  })

  it('expires pending callbacks and ignores a registration response received after close', async () => {
    const f = await fixture()
    await f.controller.connect()
    const expired = f.callback()
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1)
    expect(f.controller.status().state).toBe('error')
    await expect(f.controller.adopt(expired)).rejects.toThrow('challenge')
    expect(f.fetcher).not.toHaveBeenCalled()
    await f.controller.connect()
    const response = deferred<Response>()
    f.fetcher.mockImplementation(() => response.promise)
    const adopt = f.controller.adopt(f.callback())
    const rejected = expect(adopt).rejects.toThrow('cancelled')
    f.controller.close()
    response.resolve(json({ device: { deviceId: 'fixture-device' } }))
    await rejected
    expect(f.vault.register).not.toHaveBeenCalled()
    await expect(f.controller.connect()).rejects.toThrow('cancelled')
  })
})
