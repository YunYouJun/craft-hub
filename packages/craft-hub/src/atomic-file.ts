import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Replace one UTF-8 document atomically, tolerating brief file locks and cleaning up failed writes. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporaryPath, path)
        return
      }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        const transientLock = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
        if (!transientLock || attempt >= 5)
          throw error
        await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt))
      }
    }
  }
  finally {
    await rm(temporaryPath, { force: true })
  }
}
