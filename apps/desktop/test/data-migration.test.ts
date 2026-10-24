import type { DataMigrationReview } from '../src/data-migration.ts'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { acquireProfileLease } from 'craft-hub'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { assertDataMigrationHostsStopped, coordinateDataMigration } from '../src/data-migration.ts'

const hosts = vi.hoisted(() => ({ output: '', fail: false }))
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execute = async (file: string, args: string[]) => {
    if (file !== '/bin/ps')
      throw new Error('Unexpected executable')
    expect(args).toEqual(['-axww', '-o', 'pid=,comm='])
    if (hosts.fail)
      throw new Error('Cannot inspect')
    return { stdout: hosts.output, stderr: '' }
  }
  const execFile = Object.defineProperty(() => {
    throw new Error('Use promisified inspection')
  }, promisify.custom, { value: execute })
  return { ...real, execFile }
})
const roots: string[] = []
const macTest = it.skipIf(process.platform !== 'darwin')
beforeEach(() => {
  hosts.output = `${process.pid} ${process.execPath}\n1 /sbin/launchd\n`
  hosts.fail = false
})
afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-data-dialog-')))
  roots.push(root)
  const sourceData = join(root, 'source')
  const sourceConfig = join(root, 'portable')
  const target = join(root, 'native')
  await Promise.all([sourceData, sourceConfig, join(target, 'runtime')].map(path => mkdir(path, { recursive: true })))
  const projects = [{ id: 'fixture', path: join(root, 'project'), name: 'Fixture', trust: 'untrusted', addedAt: '2026-01-01T00:00:00Z' }]
  await writeFile(join(sourceData, 'projects.json'), JSON.stringify(projects))
  await writeFile(join(target, 'runtime/projects.json'), '[]')
  const confirm = vi.fn(async (_review: DataMigrationReview) => true)
  return { root, sourceData, sourceConfig, target, projects, confirm, options: { sourceData, sourceConfig, confirm }, command: { version: 1 as const, action: 'migrate-data' as const, targetProfile: target } }
}

macTest('cancels read-only review and discards approval returned after cancellation', async () => {
  const f = await fixture()
  const before = await readdir(f.root)
  f.confirm.mockResolvedValue(false)
  expect(await coordinateDataMigration(f.command, f.options)).toEqual({ status: 'cancelled' })
  const abort = new AbortController()
  f.confirm.mockImplementation(async () => {
    abort.abort()
    return true
  })
  expect(await coordinateDataMigration(f.command, { ...f.options, signal: abort.signal })).toEqual({ status: 'cancelled' })
  expect(await readdir(f.root)).toEqual(before)
  expect(await readFile(join(f.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
})

macTest('copies without changing trust or source, and reviews recovery and rollback that retain later edits', async () => {
  const f = await fixture()
  f.confirm.mockImplementation(async (review) => {
    if (review.kind === 'migrate-data')
      review.profile.paths.target = '/ignored-review-edit'
    return true
  })
  const result = await coordinateDataMigration(f.command, f.options)
  if (result.status !== 'complete')
    throw new Error('Expected receipt')
  expect(result.receipt.phase).toBe('complete')
  const restored = JSON.parse(await readFile(join(f.target, 'runtime/projects.json'), 'utf8'))
  expect(restored).toEqual(f.projects)
  const recovery = { version: 1 as const, action: 'recover-data' as const, transaction: result.receipt.transaction }
  expect(await coordinateDataMigration(recovery, f.options)).toMatchObject({ status: 'complete', receipt: { alreadyApplied: true } })
  await writeFile(join(f.target, 'later.txt'), 'later edit')
  expect(await coordinateDataMigration({ ...recovery, action: 'rollback-data' }, f.options)).toMatchObject({ status: 'complete', receipt: { phase: 'rolled-back' } })
  const archive = (await readdir(result.receipt.transaction)).find(name => name.startsWith('returned-candidate-'))!
  expect(await readFile(join(result.receipt.transaction, archive, 'later.txt'), 'utf8')).toBe('later edit')
  expect(await readFile(join(f.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
  expect(JSON.parse(await readFile(join(f.sourceData, 'projects.json'), 'utf8'))).toEqual(f.projects)
})

macTest('blocks encrypted identities and changed profiles without trusting callback edits', async () => {
  const f = await fixture()
  await writeFile(join(f.sourceData, 'personal-cloud-device.json'), '{"encryptedPrivateKey":"fixture-do-not-read"}')
  const blocked = await coordinateDataMigration(f.command, f.options)
  expect(blocked).toMatchObject({ status: 'blocked', blockers: [expect.stringContaining('Keychain')] })
  expect(JSON.stringify(blocked)).not.toContain('fixture-do-not-read')
  expect(f.confirm).not.toHaveBeenCalled()
  await rm(join(f.sourceData, 'personal-cloud-device.json'))
  f.confirm.mockImplementation(async () => {
    await writeFile(join(f.sourceData, 'settings.json'), '{}')
    return true
  })
  await expect(coordinateDataMigration(f.command, f.options)).rejects.toThrow('review changed')
  expect(await readFile(join(f.target, 'runtime/projects.json'), 'utf8')).toBe('[]')
})

macTest('rejects another source transaction, stale recovery approval, and a live runtime lease', async () => {
  const f = await fixture()
  const result = await coordinateDataMigration(f.command, f.options)
  if (result.status !== 'complete')
    throw new Error('Expected receipt')
  const command = { version: 1 as const, action: 'rollback-data' as const, transaction: result.receipt.transaction }
  f.confirm.mockClear()
  await expect(coordinateDataMigration(command, { ...f.options, sourceData: join(f.root, 'other-source') })).rejects.toThrow('different source')
  expect(f.confirm).not.toHaveBeenCalled()
  f.confirm.mockImplementation(async () => {
    await writeFile(join(f.target, 'new.txt'), 'retain')
    return true
  })
  await expect(coordinateDataMigration(command, f.options)).rejects.toThrow('Recovery review changed')
  f.confirm.mockResolvedValue(true)
  const lease = await acquireProfileLease([join(f.target, 'runtime')])
  try {
    await expect(coordinateDataMigration(command, f.options)).rejects.toThrow('profile is in use')
  }
  finally { lease.release() }
})

macTest('excludes only this exact process and rejects other hosts, malformed inspection and ps failure', async () => {
  await expect(assertDataMigrationHostsStopped()).resolves.toBeUndefined()
  for (const line of [`${process.pid + 1} ${process.execPath.includes('/Craft Hub') ? process.execPath : '/Applications/Craft Hub.app/Contents/MacOS/Craft Hub'}`, `${process.pid} /Applications/Craft Hub.app/Contents/MacOS/Another`, 'not a process row']) {
    hosts.output = line
    await expect(assertDataMigrationHostsStopped()).rejects.toThrow()
  }
  hosts.fail = true
  await expect(assertDataMigrationHostsStopped()).rejects.toThrow('Cannot inspect')
})
