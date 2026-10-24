import type { DataMigrationReview } from '../src/data-migration.ts'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterEach, expect, it, vi } from 'vitest'
import { chooseDataMigration, confirmDataMigration, showDataMigrationResult } from '../src/data-migration-dialogs.ts'

const dialogs = vi.hoisted(() => ({ message: vi.fn(), open: vi.fn(), save: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => resolve('/fixture/app-data') }, dialog: { showMessageBox: dialogs.message, showOpenDialog: dialogs.open, showSaveDialog: dialogs.save } }))
const directories: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const signal = (): AbortSignal => new AbortController().signal
const review: DataMigrationReview = {
  kind: 'migrate-data',
  profile: { version: 1, paths: { sourceData: resolve('/fixture/source'), sourceConfig: resolve('/fixture/config'), target: resolve('/fixture/native') }, revision: 'a'.repeat(64), sourceRevision: 'b'.repeat(64), targetRevision: 'c'.repeat(64), runtime: [], config: [], target: [], excluded: ['Cookies'], blockers: [], bytes: 0 },
}

it.each([1, 2, 3])('selects data-only navigation %s without an approval or source override', async (response) => {
  dialogs.message.mockResolvedValue({ response })
  dialogs.open.mockResolvedValue({ canceled: false, filePaths: [resolve('/fixture/destination')] })
  expect(await chooseDataMigration(signal())).toEqual(response === 1 ? { version: 1, action: 'migrate-data', targetProfile: resolve('/fixture/destination') } : { version: 1, action: response === 2 ? 'recover-data' : 'rollback-data', transaction: resolve('/fixture/destination') })
  expect(dialogs.message).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0 }))
})

it('cancels late selectors and requires explicit stopped-host acknowledgement for confirmation', async () => {
  const controller = new AbortController()
  dialogs.message.mockResolvedValue({ response: 1 })
  dialogs.open.mockImplementation(async () => {
    controller.abort()
    return { canceled: false, filePaths: [resolve('/fixture/native')] }
  })
  expect(await chooseDataMigration(controller.signal)).toBeUndefined()
  dialogs.message.mockResolvedValue({ response: 2, checkboxChecked: false })
  expect(await confirmDataMigration(review, signal())).toBe(false)
  dialogs.message.mockResolvedValue({ response: 2, checkboxChecked: true })
  expect(await confirmDataMigration(review, signal())).toBe(true)
  expect(dialogs.message).toHaveBeenLastCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0, checkboxChecked: false, detail: expect.stringContaining(resolve('/fixture/source')) }))
})

it('saves only private review metadata without overwriting files and returns to a fresh unchecked confirmation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-data-report-'))
  directories.push(root)
  const existing = join(root, 'existing.json')
  const saved = join(root, 'review.json')
  await writeFile(existing, 'keep original')
  dialogs.message.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 })
  dialogs.save.mockResolvedValueOnce({ canceled: false, filePath: existing }).mockResolvedValueOnce({ canceled: false, filePath: saved })
  expect(await confirmDataMigration(review, signal())).toBe(false)
  expect(await readFile(existing, 'utf8')).toBe('keep original')
  expect(JSON.parse(await readFile(saved, 'utf8'))).toEqual(review)
  if (process.platform !== 'win32')
    expect((await stat(saved)).mode & 0o777).toBe(0o600)
  expect(dialogs.message.mock.calls.filter(([options]) => options.checkboxLabel).every(([options]) => options.checkboxChecked === false)).toBe(true)
})

it('bounds blocker text and keeps a retained recovery path visible without reporting success', async () => {
  dialogs.message.mockResolvedValue({ response: 0 })
  await showDataMigrationResult({ status: 'cancelled' }, signal())
  expect(dialogs.message).not.toHaveBeenCalled()
  await showDataMigrationResult({ status: 'blocked', blockers: Array.from({ length: 100 }, () => `\n${'x'.repeat(1000)}`) }, signal())
  expect(dialogs.message.mock.lastCall![0].detail.length).toBeLessThan(5000)
  await showDataMigrationResult({ status: 'recovery-required', transaction: resolve('/fixture/retained-transaction') }, signal())
  expect(dialogs.message.mock.lastCall![0]).toMatchObject({ type: 'warning', message: '请重新审阅并恢复复制事务', detail: expect.stringContaining(resolve('/fixture/retained-transaction')) })
})
