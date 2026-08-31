import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDevelopmentSessionLock } from './dev-session-lock.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

async function lockPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'craft-hub-dev-lock-'))
  temporaryDirectories.push(directory)
  return join(directory, 'development.lock')
}

describe('development session lock', () => {
  it('rejects a second development environment while the owner is running', async () => {
    const path = await lockPath()
    const first = await acquireDevelopmentSessionLock({
      isProcessRunning: () => true,
      lockPath: path,
      pid: 101,
    })

    await expect(acquireDevelopmentSessionLock({
      isProcessRunning: () => true,
      lockPath: path,
      pid: 202,
    })).rejects.toThrow('Craft Hub development environment is already running (PID 101)')

    await first.release()
    const second = await acquireDevelopmentSessionLock({
      isProcessRunning: () => true,
      lockPath: path,
      pid: 202,
    })
    await second.release()
  })

  it('recovers a lock left by a process that is no longer running', async () => {
    const path = await lockPath()
    await writeFile(path, JSON.stringify({ pid: 101, token: 'stale' }), 'utf8')

    const session = await acquireDevelopmentSessionLock({
      isProcessRunning: () => false,
      lockPath: path,
      pid: 202,
    })

    await session.release()
  })
})
