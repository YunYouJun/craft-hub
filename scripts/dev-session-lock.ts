import { randomUUID } from 'node:crypto'
import { open, readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export interface DevelopmentSessionLock {
  release: () => Promise<void>
}

export interface DevelopmentSessionLockOptions {
  isProcessRunning?: (pid: number) => boolean
  lockPath?: string
  pid?: number
}

interface DevelopmentSessionOwner {
  pid: number
  token: string
}

const defaultLockPath = join(tmpdir(), 'craft-hub-development.lock')

/** Acquire exclusive ownership of the local Craft Hub development environment. */
export async function acquireDevelopmentSessionLock(options: DevelopmentSessionLockOptions = {}): Promise<DevelopmentSessionLock> {
  const isProcessRunning = options.isProcessRunning ?? processIsRunning
  const lockPath = options.lockPath ?? defaultLockPath
  const pid = options.pid ?? process.pid
  const token = randomUUID()

  for (;;) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid, token } satisfies DevelopmentSessionOwner), 'utf8')
      }
      catch (error) {
        await unlink(lockPath).catch(() => {})
        throw error
      }
      finally {
        await handle.close()
      }

      return {
        release: async () => {
          const owner = await readOwner(lockPath)
          if (owner?.token === token)
            await unlink(lockPath).catch(error => ignoreMissing(error))
        },
      }
    }
    catch (error) {
      if (!hasCode(error, 'EEXIST'))
        throw error
    }

    const owner = await readOwner(lockPath)
    if (owner && isProcessRunning(owner.pid))
      throw new Error(`Craft Hub development environment is already running (PID ${owner.pid})`)

    await unlink(lockPath).catch(error => ignoreMissing(error))
  }
}

async function readOwner(lockPath: string): Promise<DevelopmentSessionOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<DevelopmentSessionOwner>
    return Number.isInteger(value.pid) && typeof value.token === 'string'
      ? { pid: value.pid!, token: value.token }
      : undefined
  }
  catch (error) {
    if (hasCode(error, 'ENOENT'))
      return undefined
    if (error instanceof SyntaxError)
      return undefined
    throw error
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return hasCode(error, 'EPERM')
  }
}

function ignoreMissing(error: unknown): void {
  if (!hasCode(error, 'ENOENT'))
    throw error
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
