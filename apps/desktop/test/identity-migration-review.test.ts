import type { IdentityMigrationReview } from '../src/identity-migration.ts'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { confirmIdentityMigration, showIdentityMigrationResult } from '../src/identity-migration-review.ts'

const native = vi.hoisted(() => ({ message: vi.fn(), save: vi.fn(), focus: vi.fn() }))
vi.mock('electron', () => ({ app: { whenReady: async () => {}, focus: native.focus }, dialog: { showMessageBox: native.message, showSaveDialog: native.save } }))
const roots: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function review(): IdentityMigrationReview {
  return {
    kind: 'migrate',
    peer: { application: '/fixture/Native.app', executable: '/fixture/Native.app/Contents/MacOS/Native', sourceApplication: '/fixture/Source.app', team: 'ABCDE12345', sourceCodeHash: 'a'.repeat(40), recipientCodeHash: 'b'.repeat(40) },
    profile: { version: 1, paths: { sourceData: '/fixture/source', sourceConfig: '/fixture/config', target: '/fixture/native' }, revision: 'a', sourceRevision: 'b', targetRevision: 'c', runtime: [], config: [], target: [], excluded: ['Cache'], blockers: [], bytes: 0 },
    identity: { sourceData: '/fixture/source', sourceRevision: 'a'.repeat(64), publicKey: 'public-key-fixture' },
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
  }
}
it.each([{ response: 0, checkboxChecked: true }, { response: 2, checkboxChecked: false }])('requires both the action and explicit stopped-host acknowledgement %#', async (result) => {
  native.message.mockResolvedValue(result)
  expect(await confirmIdentityMigration(review())).toBe(false)
  expect(native.message).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0, checkboxChecked: false, buttons: ['取消', '保存审阅报告…', '迁移'] }))
  expect(native.message.mock.calls[0]![0].detail).toContain('/fixture/native')
  expect(native.message.mock.calls[0]![0].detail).not.toContain('public-key-fixture')
})
it('saves a new private metadata report and requires a fresh explicit confirmation afterward', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-migration-review-'))
  roots.push(root)
  const filePath = join(root, 'review.json')
  native.message.mockResolvedValueOnce({ response: 1, checkboxChecked: true }).mockResolvedValueOnce({ response: 2, checkboxChecked: true })
  native.save.mockResolvedValue({ canceled: false, filePath })
  const value = review()
  expect(await confirmIdentityMigration(value)).toBe(true)
  expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(value)
  expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  expect(native.message).toHaveBeenCalledTimes(2)
  native.message.mockReset().mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 })
  expect(await confirmIdentityMigration(value)).toBe(false)
  expect(native.message.mock.calls[1]![0]).toMatchObject({ type: 'error', message: '无法保存审阅报告' })
  expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(value)
})
it('does not accept a response after cancellation and shows only a durable outcome', async () => {
  const abort = new AbortController()
  native.message.mockImplementationOnce(async () => {
    abort.abort()
    return { response: 2, checkboxChecked: true }
  })
  expect(await confirmIdentityMigration(review(), abort.signal)).toBe(false)
  native.message.mockClear()
  await showIdentityMigrationResult({ status: 'cancelled' })
  expect(native.message).not.toHaveBeenCalled()
  await showIdentityMigrationResult({ status: 'recovery-required', transaction: '/fixture/transaction' })
  expect(native.message).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', message: '迁移需要恢复', detail: expect.stringContaining('/fixture/transaction') }))
})
