import { afterEach, expect, it, vi } from 'vitest'
import { syncDirectory, syncDirectoryAncestors } from '../src/sync-directory'

const io = vi.hoisted(() => ({ platform: 'linux' as NodeJS.Platform, open: vi.fn(), sync: vi.fn(), close: vi.fn() }))
vi.mock('node:process', () => ({ default: {
  get platform() {
    return io.platform
  },
} }))
vi.mock('node:fs/promises', () => ({ open: io.open }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

it.each(['/fixtures', '/FIXTURES'])('bounds ancestor flushing even when the reported parent differs: %s', async (ancestor) => {
  io.platform = 'linux'
  const visited = new Set<string>()
  io.open.mockImplementation(async (path: string) => {
    // Fail immediately if traversal repeats a root, rather than hanging the test runner.
    if (visited.has(path))
      throw new Error('Directory traversal did not make progress')
    visited.add(path)
    return { sync: io.sync, close: io.close }
  })
  await syncDirectoryAncestors('/fixtures/new/guards', ancestor)
  expect([...visited]).toEqual(ancestor === '/fixtures'
    ? ['/fixtures/new/guards', '/fixtures/new', '/fixtures']
    : ['/fixtures/new/guards', '/fixtures/new', '/fixtures', '/'])
  expect(io.close).toHaveBeenCalledTimes(visited.size)
})

it('avoids unsupported directory handles on Windows', async () => {
  io.platform = 'win32'
  io.open.mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'EPERM' }))
  await syncDirectory('C:\\fixture')
  await syncDirectoryAncestors('C:/Fixture/new', 'c:/fixture')
  expect(io.open).not.toHaveBeenCalled()
})

it.each(['darwin', 'linux'] as const)('propagates durability failures and closes the directory on %s', async (platform) => {
  io.platform = platform
  const failure = Object.assign(new Error('cannot flush'), { code: 'EIO' })
  io.open.mockResolvedValue({ sync: io.sync, close: io.close })
  io.sync.mockRejectedValue(failure)
  await expect(syncDirectory('/fixture')).rejects.toBe(failure)
  expect(io.close).toHaveBeenCalledOnce()
})
