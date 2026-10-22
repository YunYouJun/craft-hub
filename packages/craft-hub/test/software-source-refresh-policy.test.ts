import type { SoftwareRepositoryReader, SoftwareSourceRefreshPolicy } from '../src/software-sources'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { softwareSourceCommandSchema, SoftwareSourceService } from '../src/software-sources'

const repository = 'https://github.com/example/catalog'
const initialTime = Date.parse('2026-01-01T00:00:00.000Z')
const minute = 60 * 1000
const day = 24 * 60 * minute
const commit = 'a'.repeat(40)

function config(name = 'Editor'): string {
  const groups = [{ id: 'coding', label: { en: 'Coding' }, items: [{ id: 'editor', name: { en: name }, url: 'https://example.com/editor' }] }]
  return `export const softwareGroups = ${JSON.stringify(groups)} as const; throw new Error('Repository code must never execute')`
}

let root: string
let dataDir: string
let reader: SoftwareRepositoryReader
let service: SoftwareSourceService
let id: string

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(initialTime)
  root = await mkdtemp(join(tmpdir(), 'software-source-refresh-policy-'))
  dataDir = join(root, 'data')
  reader = {
    remote: vi.fn(async () => ({ content: config(), commit })),
    local: vi.fn(async () => ({ content: config('Local editor'), localPath: join(root, 'checkout'), repository, commit })),
  }
  service = new SoftwareSourceService(dataDir, true, reader)
  const preview = await service.preview({ repository, mode: 'remote' })
  await service.apply(preview.previewId)
  id = preview.source.id
  vi.mocked(reader.remote).mockClear()
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

async function configure(policy: SoftwareSourceRefreshPolicy) {
  return service.configureRefresh(id, policy, (await service.snapshot()).revision)
}

describe('software source refresh policies', () => {
  it('persists a policy offline without repository reads or changing the cached check', async () => {
    const previous = await service.snapshot()
    const policy: SoftwareSourceRefreshPolicy = { mode: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }
    vi.mocked(reader.remote).mockRejectedValue(new Error('Offline'))
    vi.mocked(reader.local).mockRejectedValue(new Error('Offline'))
    vi.setSystemTime(initialTime + 4 * day)

    const saved = await configure(policy)
    expect(saved.revision).not.toBe(previous.revision)
    expect(saved.sources[0]).toEqual({ ...previous.sources[0], refreshPolicy: policy })
    expect(reader.remote).not.toHaveBeenCalled()
    expect(reader.local).not.toHaveBeenCalled()
    const restarted = new SoftwareSourceService(dataDir, true, reader)
    expect(await restarted.snapshot()).toEqual(saved)
    expect((await restarted.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Editor')
  })

  it('keeps the existing 24-hour behavior for sources with no saved policy', async () => {
    const restarted = new SoftwareSourceService(dataDir, true, reader)
    vi.setSystemTime(initialTime + day - 1)
    expect(await restarted.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()
    vi.setSystemTime(initialTime + day)
    expect(await restarted.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('disables automatic reads in manual mode while retaining explicit refresh', async () => {
    await configure({ mode: 'manual' })
    vi.setSystemTime(initialTime + 30 * day)
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()

    vi.mocked(reader.remote).mockResolvedValue({ content: config('Manual update'), commit: 'b'.repeat(40) })
    const refreshed = await service.refresh(id)
    expect(reader.remote).toHaveBeenCalledTimes(1)
    expect(refreshed.sources[0]!.refreshPolicy).toEqual({ mode: 'manual' })
    expect((await service.catalogs())[0]!.catalog.items[0]!.title.en).toBe('Manual update')
    vi.setSystemTime(initialTime + 60 * day)
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('refreshes at the selected interval boundary and restarts the interval after a check', async () => {
    await configure({ mode: 'interval', intervalMinutes: 15 })
    vi.setSystemTime(initialTime + 15 * minute - 1)
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()
    vi.setSystemTime(initialTime + 15 * minute)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
    vi.setSystemTime(initialTime + 30 * minute - 1)
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime(initialTime + 30 * minute)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it('supports the maximum weekly interval after a restart', async () => {
    await configure({ mode: 'interval', intervalMinutes: 10080 })
    const restarted = new SoftwareSourceService(dataDir, true, reader)
    vi.setSystemTime(initialTime + 7 * day - 1)
    expect(await restarted.refreshDue()).toBe(false)
    vi.setSystemTime(initialTime + 7 * day)
    expect(await restarted.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('throttles failed checks by the selected interval and preserves its policy and cache', async () => {
    await configure({ mode: 'interval', intervalMinutes: 15 })
    const original = (await service.snapshot()).sources[0]!
    vi.mocked(reader.remote).mockRejectedValue(new Error('Offline'))
    vi.setSystemTime(initialTime + 15 * minute)
    expect(await service.refreshDue()).toBe(true)
    expect((await service.snapshot()).sources[0]).toMatchObject({
      refreshPolicy: original.refreshPolicy,
      cache: original.cache,
      checkedAt: new Date(initialTime + 15 * minute).toISOString(),
      error: 'unavailable',
    })
    vi.setSystemTime(initialTime + 30 * minute - 1)
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime(initialTime + 30 * minute)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it('uses the daily timezone boundary and refreshes only once for each scheduled occurrence', async () => {
    await configure({ mode: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' })
    vi.setSystemTime('2026-01-01T00:59:59.999Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-01-01T01:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    vi.setSystemTime('2026-01-01T23:59:59.999Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-01-02T01:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it('honors a UTC schedule independently from the machine timezone', async () => {
    await configure({ mode: 'daily', time: '09:00', timeZone: 'UTC' })
    vi.setSystemTime('2026-01-01T08:59:59.999Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-01-01T09:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    vi.setSystemTime('2026-01-01T23:59:59.999Z')
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('catches up once after multiple missed days and persists that check across a restart', async () => {
    await configure({ mode: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' })
    vi.setSystemTime('2026-01-05T04:00:00.000Z')
    const restarted = new SoftwareSourceService(dataDir, true, reader)
    expect(await restarted.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
    vi.setSystemTime('2026-01-05T05:00:00.000Z')
    const restartedAgain = new SoftwareSourceService(dataDir, true, reader)
    expect(await restartedAgain.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('catches up a previous missed occurrence before today’s scheduled time', async () => {
    await configure({ mode: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' })
    vi.setSystemTime('2026-01-02T00:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-01-02T01:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it('counts explicit refreshes against the latest daily occurrence without skipping a later one', async () => {
    await configure({ mode: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' })
    vi.setSystemTime('2026-01-01T00:30:00.000Z')
    await service.refresh(id)
    vi.setSystemTime('2026-01-01T01:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    vi.setSystemTime('2026-01-02T01:30:00.000Z')
    await service.refresh(id)
    vi.setSystemTime('2026-01-02T03:00:00.000Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-01-03T01:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['2026-03-07T14:00:00.000Z', '2026-03-08T12:59:59.999Z', '2026-03-08T13:00:00.000Z'],
    ['2026-10-31T13:00:00.000Z', '2026-11-01T13:59:59.999Z', '2026-11-01T14:00:00.000Z'],
  ])('keeps a daily local time across daylight saving changes from %s', async (previous, beforeDue, due) => {
    vi.setSystemTime(previous)
    await service.refresh(id)
    vi.mocked(reader.remote).mockClear()
    await configure({ mode: 'daily', time: '09:00', timeZone: 'America/New_York' })
    vi.setSystemTime(beforeDue)
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime(due)
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('catches up the first daily occurrence when starting inside a repeated daylight saving hour', async () => {
    vi.setSystemTime('2026-11-01T04:00:00.000Z')
    await service.refresh(id)
    await configure({ mode: 'daily', time: '01:30', timeZone: 'America/New_York' })
    vi.mocked(reader.remote).mockClear()

    // At the second 01:10, the first 01:30 has already passed.
    vi.setSystemTime('2026-11-01T06:10:00.000Z')
    const restarted = new SoftwareSourceService(dataDir, true, reader)
    expect(await restarted.refreshDue()).toBe(true)
    vi.setSystemTime('2026-11-01T06:30:00.000Z')
    expect(await restarted.refreshDue()).toBe(false)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('counts a manual check in a repeated hour after the first daily occurrence', async () => {
    vi.setSystemTime('2026-11-01T04:00:00.000Z')
    await service.refresh(id)
    await configure({ mode: 'daily', time: '01:30', timeZone: 'America/New_York' })
    vi.setSystemTime('2026-11-01T06:10:00.000Z')
    await service.refresh(id)
    vi.mocked(reader.remote).mockClear()

    vi.setSystemTime('2026-11-01T06:30:00.000Z')
    expect(await service.refreshDue()).toBe(false)
    expect(reader.remote).not.toHaveBeenCalled()
    vi.setSystemTime('2026-11-02T06:30:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(1)
  })

  it('catches up a missing springtime occurrence at the first valid local minute', async () => {
    vi.setSystemTime('2026-03-08T06:00:00.000Z')
    await service.refresh(id)
    await configure({ mode: 'daily', time: '02:30', timeZone: 'America/New_York' })
    vi.mocked(reader.remote).mockClear()

    vi.setSystemTime('2026-03-08T06:59:59.999Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-03-08T07:00:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    vi.setSystemTime('2026-03-08T07:30:00.000Z')
    expect(await service.refreshDue()).toBe(false)
    vi.setSystemTime('2026-03-09T06:30:00.000Z')
    expect(await service.refreshDue()).toBe(true)
    expect(reader.remote).toHaveBeenCalledTimes(2)
  })

  it.each([
    null,
    {},
    { mode: 'unknown' },
    { mode: 'manual', intervalMinutes: 15 },
    { mode: 'interval' },
    { mode: 'interval', intervalMinutes: 14 },
    { mode: 'interval', intervalMinutes: 10081 },
    { mode: 'interval', intervalMinutes: 15.5 },
    { mode: 'interval', intervalMinutes: '15' },
    { mode: 'daily', time: '9:00', timeZone: 'UTC' },
    { mode: 'daily', time: '24:00', timeZone: 'UTC' },
    { mode: 'daily', time: '12:60', timeZone: 'UTC' },
    { mode: 'daily', time: '09:00', timeZone: 'Not/A_Zone' },
    { mode: 'daily', time: '09:00', timeZone: '' },
    { mode: 'daily', time: '09:00' },
  ])('rejects invalid policy %j without mutating saved data', async (invalid) => {
    const previous = await service.snapshot()
    expect(softwareSourceCommandSchema.safeParse({ operation: 'configure-refresh', id, refreshPolicy: invalid, revision: previous.revision }).success).toBe(false)
    await expect(service.configureRefresh(id, invalid as SoftwareSourceRefreshPolicy, previous.revision)).rejects.toThrow()
    expect(await service.snapshot()).toEqual(previous)
    expect(reader.remote).not.toHaveBeenCalled()
    expect(reader.local).not.toHaveBeenCalled()
  })

  it('accepts configure-refresh commands with a validated policy and revision', async () => {
    const revision = (await service.snapshot()).revision
    const input = { operation: 'configure-refresh', id, refreshPolicy: { mode: 'interval', intervalMinutes: 60 }, revision }
    expect(softwareSourceCommandSchema.parse(input)).toEqual(input)
  })

  it('rejects stale revisions and missing sources without overwriting a newer policy', async () => {
    const previous = await service.snapshot()
    const saved = await configure({ mode: 'manual' })
    await expect(service.configureRefresh(id, { mode: 'interval', intervalMinutes: 60 }, previous.revision)).rejects.toMatchObject({ status: 409 })
    await expect(service.configureRefresh('f'.repeat(24), { mode: 'manual' }, saved.revision)).rejects.toMatchObject({ status: 404 })
    expect(await service.snapshot()).toEqual(saved)
    expect(reader.remote).not.toHaveBeenCalled()
    expect(reader.local).not.toHaveBeenCalled()
  })

  it('preserves the configured policy when previewing edits and changing source modes', async () => {
    const policy: SoftwareSourceRefreshPolicy = { mode: 'interval', intervalMinutes: 60 }
    await configure(policy)
    const edited = await service.preview({ id, mode: 'remote', repository, branch: 'next' })
    expect(edited.source.refreshPolicy).toEqual(policy)
    await service.apply(edited.previewId)
    const local = await service.preview({ id, mode: 'local', localPath: join(root, 'checkout'), branch: 'next' })
    expect(local.source.refreshPolicy).toEqual(policy)
    const saved = await service.apply(local.previewId)
    expect(saved.sources).toHaveLength(1)
    expect(saved.sources[0]).toMatchObject({ id, mode: 'local', branch: 'next', refreshPolicy: policy })
    const refreshed = await service.refresh(id)
    expect(refreshed.sources[0]!.refreshPolicy).toEqual(policy)
  })

  it('keeps a policy when associating a checkout by its existing repository identity', async () => {
    await configure({ mode: 'manual' })
    const linked = await service.preview({ mode: 'local', localPath: join(root, 'checkout') })
    expect(linked.replaces).toBe(id)
    expect(linked.source.refreshPolicy).toEqual({ mode: 'manual' })
    const saved = await service.apply(linked.previewId)
    expect(saved.sources).toHaveLength(1)
    expect(saved.sources[0]!.refreshPolicy).toEqual({ mode: 'manual' })
  })
})
