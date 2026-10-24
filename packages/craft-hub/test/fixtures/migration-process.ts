import type { ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/** Fail promptly if a crash fixture cannot reach its durable checkpoint. */
export async function waitForMigrationCheckpoint(child: ChildProcess): Promise<unknown> {
  child.stderr?.resume()
  if (child.exitCode !== null || child.signalCode !== null)
    throw new Error('Migration fixture exited before its checkpoint')
  return new Promise((resolve, reject) => {
    function message(value: unknown): void {
      finish(undefined, value)
    }
    function exited(): void {
      finish(new Error('Migration fixture exited before its checkpoint'))
    }
    function failed(): void {
      finish(new Error('Migration fixture could not start'))
    }
    const timeout = setTimeout(() => finish(new Error('Migration fixture checkpoint timed out')), 10000)
    function finish(error?: Error, value?: unknown): void {
      clearTimeout(timeout)
      child.off('message', message)
      child.off('exit', exited)
      child.off('error', failed)
      if (error)
        reject(error)
      else
        resolve(value)
    }
    child.once('message', message)
    child.once('exit', exited)
    child.once('error', failed)
  })
}

/** Kill only the fixture child and do not wait for an exit event that already occurred. */
export async function stopMigrationFixture(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}
