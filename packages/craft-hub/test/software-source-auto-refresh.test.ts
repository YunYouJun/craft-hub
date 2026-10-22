import type { SoftwareRepositoryReader } from '../src/software-sources'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoftwareSourceService } from '../src/software-sources'

const repository = 'https://github.com/example/catalog'
const otherRepository = 'https://github.com/example/other-catalog'
const localRepository = 'https://github.com/example/local-catalog'
const initialTime = Date.parse('2026-01-01T00:00:00.000Z')
const day = 24 * 60 * 60 * 1000
const commit = 'a'.repeat(40)

function config(name = 'Editor'): string {
  const groups = [{ id: 'coding', label: { en: 'Coding' }, items: [{ id: 'editor', name: { en: name }, url: 'https://example.com/editor' }] }]
  return `export const softwareGroups = ${JSON.stringify(groups)} as const; throw new Error('Repository code must never execute')`
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

let root: string
let dataDir: string
let reader: SoftwareRepositoryReader
let service: SoftwareSourceService

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(initialTime)
  root = await mkdtemp(join(tmpdir(), 'software-source-auto-refresh-'))
  dataDir = join(root, 'data')
  reader = {
    remote: vi.fn(async () => ({ content: config(), commit })),
    local: vi.fn(async () => ({ content: config('Local editor'), localPath: join(root, 'checkout'), repository: localRepository, commit })),
  }
  service = new SoftwareSourceService(dataDir, true, reader)
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

async function subscribe(sourceRepository = repository): Promise<string> {
  const preview = await service.preview({ repository: sourceRepository, mode: 'remote' })
  await service.apply(preview.previewId)
  return preview.source.id
}

describe('automatic software source refresh', () => {
  it('leaves fresh sources unchanged and refreshes at the 24-hour boundary', async () => {
    const id = await subscribe()
    const saved = await service.snapshot()
    vi.mocked(reader.remote).mockClear()

    vi.setSystemTime(initialTime + day - 1)
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()
    expect(await service.snapshot()).toEqual(saved)

    vi.setSystemTime(initialTime + day)
    vi.mocked(reader.remote).mockResolvedValue({ content: config('Updated editor'), commit: 'b'.repeat(40) })
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledExactlyOnceWith(repository, 'HEAD', 'software.config.ts')
    expect((await service.snapshot()).sources[0]).toMatchObject({
      id,
      checkedAt: new Date(initialTime + day).toISOString(),
      cache: { commit: 'b'.repeat(40) },
    })
    expect((await service.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Updated editor')
  })

  it('retains the daily throttle across service restarts', async () => {
    await subscribe()
    vi.setSystemTime(initialTime + day)
    expect(await service.refreshDue()).toBe(true)
    vi.mocked(reader.remote).mockClear()

    const restarted = new SoftwareSourceService(dataDir, true, reader)
    vi.setSystemTime(initialTime + 2 * day - 1)
    expect(await restarted.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()

    vi.setSystemTime(initialTime + 2 * day)
    expect(await restarted.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('retains cached metadata after failure and throttles the failed check across a restart', async () => {
    await subscribe()
    const original = (await service.snapshot()).sources[0]!
    vi.mocked(reader.remote).mockRejectedValue(new Error('Repository unavailable'))
    vi.mocked(reader.remote).mockClear()

    vi.setSystemTime(initialTime + day)
    expect(await service.refreshDue()).toBe(true)
    const failed = (await service.snapshot()).sources[0]!
    expect(failed.cache).toEqual(original.cache)
    expect(failed.checkedAt).toBe(new Date(initialTime + day).toISOString())
    expect(failed.error).toBe('unavailable')
    expect((await service.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Editor')

    const restarted = new SoftwareSourceService(dataDir, true, reader)
    vi.setSystemTime(initialTime + 2 * day - 1)
    expect(await restarted.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(1)
    expect((await restarted.snapshot()).sources[0]!.cache).toEqual(original.cache)
  })

  it('refreshes only the remote selections in a mixed source set', async () => {
    const remoteId = await subscribe()
    const localPreview = await service.preview({ mode: 'local', localPath: join(root, 'checkout') })
    await service.apply(localPreview.previewId)
    const localBefore = (await service.snapshot()).sources.find(source => source.id === localPreview.source.id)
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.local).mockClear()

    vi.setSystemTime(initialTime + day)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledExactlyOnceWith(repository, 'HEAD', 'software.config.ts')
    expect(reader.local).not.toHaveBeenCalled()
    const sources = (await service.snapshot()).sources
    expect(sources.find(source => source.id === localPreview.source.id)).toEqual(localBefore)
    expect(sources.find(source => source.id === remoteId)!.checkedAt).toBe(new Date(initialTime + day).toISOString())
  })

  it('does not perform automatic repository reads on hosted services', async () => {
    await subscribe()
    const saved = await service.snapshot()
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.local).mockClear()
    const hosted = new SoftwareSourceService(dataDir, false, reader)

    vi.setSystemTime(initialTime + 2 * day)
    expect(await hosted.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()
    expect(reader.local).not.toHaveBeenCalled()
    expect((await service.snapshot()).revision).toBe(saved.revision)
    expect((await hosted.snapshot()).sources).toEqual(saved.sources)
  })

  it('refreshes multiple due sources sequentially and persists each result', async () => {
    await subscribe()
    await subscribe(otherRepository)
    const firstStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const order: string[] = []
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.remote).mockImplementation(async (url) => {
      order.push(`start:${url}`)
      if (url === repository) {
        firstStarted.resolve()
        await releaseFirst.promise
      }
      order.push(`finish:${url}`)
      return { content: config(url === repository ? 'First update' : 'Second update'), commit: 'b'.repeat(40) }
    })

    vi.setSystemTime(initialTime + day)
    const refreshing = service.refreshDue()
    await firstStarted.promise
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(reader.remote).toHaveBeenCalledTimes(1)
    releaseFirst.resolve()
    expect(await refreshing).toBe(true)
    expect(order).toEqual([
      `start:${repository}`,
      `finish:${repository}`,
      `start:${otherRepository}`,
      `finish:${otherRepository}`,
    ])
    expect((await service.catalogs()).map(item => item.catalog.items[0]!.title.en)).toEqual(['First update', 'Second update'])
    expect((await service.snapshot()).sources.every(source => source.error === undefined)).toBe(true)
  })

  it('continues checking later sources after one repository fails', async () => {
    const failedId = await subscribe()
    const updatedId = await subscribe(otherRepository)
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.remote).mockRejectedValueOnce(new Error('First source unavailable'))
    vi.mocked(reader.remote).mockResolvedValueOnce({ content: config('Second update'), commit: 'b'.repeat(40) })

    vi.setSystemTime(initialTime + day)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
    const sources = (await service.snapshot()).sources
    expect(sources.find(source => source.id === failedId)).toMatchObject({ error: 'unavailable', cache: { commit } })
    expect(sources.find(source => source.id === updatedId)).toMatchObject({ cache: { commit: 'b'.repeat(40) } })
    expect(sources.find(source => source.id === updatedId)).not.toHaveProperty('error')
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent automatic refresh requests', async () => {
    await subscribe()
    const started = deferred<void>()
    const release = deferred<void>()
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.remote).mockImplementation(async () => {
      started.resolve()
      await release.promise
      return { content: config('Shared update'), commit: 'b'.repeat(40) }
    })

    vi.setSystemTime(initialTime + day)
    const requests = [service.refreshDue(), service.refreshDue(), service.refreshDue()]
    await started.promise
    expect(reader.remote).toHaveBeenCalledTimes(1)
    release.resolve()
    expect(await Promise.all(requests)).toEqual([true, true, true])
    expect(reader.remote).toHaveBeenCalledTimes(1)
    expect((await service.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Shared update')
  })

  it('does not restore a subscription removed while its repository is being read', async () => {
    const id = await subscribe()
    const started = deferred<void>()
    const release = deferred<void>()
    vi.mocked(reader.remote).mockImplementation(async () => {
      started.resolve()
      await release.promise
      return { content: config('Unsubscribed update'), commit: 'b'.repeat(40) }
    })

    vi.setSystemTime(initialTime + day)
    const refreshing = service.refreshDue()
    await started.promise
    await service.remove(id, (await service.snapshot()).revision)
    release.resolve()
    await refreshing
    expect((await service.snapshot()).sources).toEqual([])
    expect(await service.catalogs()).toEqual([])
  })

  it('respects a later source switched to local mode during an earlier repository read', async () => {
    await subscribe()
    const otherId = await subscribe(otherRepository)
    const started = deferred<void>()
    const release = deferred<void>()
    vi.mocked(reader.remote).mockClear()
    vi.mocked(reader.remote).mockImplementation(async () => {
      started.resolve()
      await release.promise
      return { content: config('Remote update'), commit: 'b'.repeat(40) }
    })
    vi.mocked(reader.local).mockResolvedValue({ content: config('Local selection'), localPath: join(root, 'checkout'), repository: otherRepository, commit })

    vi.setSystemTime(initialTime + day)
    const refreshing = service.refreshDue()
    await started.promise
    const localPreview = await service.preview({ id: otherId, mode: 'local', localPath: join(root, 'checkout') })
    await service.apply(localPreview.previewId)
    release.resolve()
    await refreshing
    expect(reader.remote).toHaveBeenCalledExactlyOnceWith(repository, 'HEAD', 'software.config.ts')
    const selected = (await service.snapshot()).sources.find(source => source.id === otherId)
    expect(selected).toMatchObject({ mode: 'local', cache: { readFrom: 'local' } })
    expect((await service.catalogs()).find(item => item.source.id === otherId)!.catalog.items[0]!.title.en).toBe('Local selection')
  })

  it('statically reads refreshed TypeScript without executing its statements', async () => {
    await subscribe()
    vi.mocked(reader.remote).mockResolvedValue({ content: config('Literal metadata'), commit: 'b'.repeat(40) })

    vi.setSystemTime(initialTime + day)
    expect(await service.refreshDue()).toBe(true)
    expect((await service.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Literal metadata')
    expect((await service.snapshot()).sources[0]).not.toHaveProperty('error')
  })
})
