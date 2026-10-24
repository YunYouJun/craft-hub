import { open } from 'node:fs/promises'
import { dirname } from 'node:path'
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

/** Persist newly created directory links up to their existing parent, stopping at the filesystem root. */
export async function syncDirectoryAncestors(path: string, ancestor: string): Promise<void> {
  if (process.platform === 'win32')
    return
  let current = path
  for (;;) {
    await syncDirectory(current)
    const parent = dirname(current)
    // Filesystem APIs can return different spellings for the same path. Never loop at a root.
    if (current === ancestor || parent === current)
      return
    current = parent
  }
}
