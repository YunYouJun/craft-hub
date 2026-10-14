import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CraftHubSettingsService } from '../src/settings'

const { watchMock } = vi.hoisted(() => ({ watchMock: vi.fn() }))

vi.mock('chokidar', () => ({ watch: watchMock }))

function controlledWatcher() {
  const watcher = new EventEmitter()
  return Object.assign(watcher, {
    close: vi.fn(async () => {
      watcher.removeAllListeners()
    }),
  })
}

let root: string
let service: CraftHubSettingsService
let watcher: ReturnType<typeof controlledWatcher>

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craft-hub-settings-watcher-'))
  service = new CraftHubSettingsService(root)
  await service.get()
  watcher = controlledWatcher()
  watchMock.mockReset().mockReturnValue(watcher)
})

afterEach(async () => {
  watcher.emit('ready')
  await service.close()
  await rm(root, { recursive: true, force: true })
})

describe('settings watcher readiness', () => {
  it('keeps startup pending until the watcher is ready', async () => {
    let started = false
    const startup = service.startWatching().then(() => {
      started = true
    })
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledOnce())

    expect(started).toBe(false)
    expect(watcher.listenerCount('change')).toBe(1)
    watcher.emit('ready')
    await startup
    expect(started).toBe(true)

    await service.startWatching()
    expect(watchMock).toHaveBeenCalledOnce()
  })

  it('makes concurrent callers wait for the same watcher', async () => {
    const completed: number[] = []
    const startup = Promise.all([0, 1, 2].map(index => service.startWatching().then(() => completed.push(index))))
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledOnce())

    expect(completed).toEqual([])
    watcher.emit('ready')
    await startup
    expect(completed).toHaveLength(3)
    expect(watchMock).toHaveBeenCalledOnce()
  })

  it('rejects a failed startup for all callers and lets them retry', async () => {
    const failure = new Error('Watcher could not start')
    const startup = Promise.allSettled([service.startWatching(), service.startWatching()])
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledOnce())
    watcher.emit('error', failure)
    expect(await startup).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])
    expect(watcher.close).toHaveBeenCalledOnce()

    watcher = controlledWatcher()
    watchMock.mockReturnValue(watcher)
    const retry = service.startWatching()
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2))
    watcher.emit('ready')
    await retry
  })

  it('finishes pending startup before closing and can start a new watcher afterward', async () => {
    const startup = service.startWatching()
    let closed = false
    const closing = service.close().then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledOnce())

    expect(closed).toBe(false)
    expect(watcher.close).not.toHaveBeenCalled()
    watcher.emit('ready')
    await Promise.all([startup, closing])
    expect(closed).toBe(true)
    expect(watcher.close).toHaveBeenCalledOnce()
    expect(watcher.eventNames()).toEqual([])

    watcher = controlledWatcher()
    watchMock.mockReturnValue(watcher)
    const restarted = service.startWatching()
    await vi.waitFor(() => expect(watchMock).toHaveBeenCalledTimes(2))
    watcher.emit('ready')
    await restarted
  })
})
