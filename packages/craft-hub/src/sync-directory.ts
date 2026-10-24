import { open } from 'node:fs/promises'
import process from 'node:process'

/** Flush directory entries on POSIX. Callers must flush file contents before rename on every platform. */
export async function syncDirectory(path: string): Promise<void> {
  // Windows does not support fsync on directory handles. Do not suppress file flush failures.
  if (process.platform === 'win32')
    return
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  }
  finally { await directory.close() }
}
