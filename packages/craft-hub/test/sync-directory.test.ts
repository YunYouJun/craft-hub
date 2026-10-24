import { afterEach, expect, it, vi } from 'vitest'
import { syncDirectory } from '../src/sync-directory'

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

it('avoids unsupported directory handles on Windows', async () => {
  io.platform = 'win32'
  io.open.mockRejectedValue(Object.assign(new Error('unsupported'), { code: 'EPERM' }))
  await syncDirectory('C:\\fixture')
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
