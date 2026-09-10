import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { openCodexReader } from './client'

export async function configSnapshot(path: string): Promise<{ contents: string, revision: string, mode: number }> {
  try {
    const parent = await lstat(dirname(path))
    if (parent.isSymbolicLink())
      throw new Error('Configuration directory must not be a symbolic link.')
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Configuration must be a regular file.')
    const contents = await readFile(path, 'utf8')
    return { contents, revision: createHash('sha256').update(contents).digest('hex'), mode: stat.mode & 0o777 }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { contents: '', revision: 'missing', mode: 0o600 }
    throw error
  }
}

const writing = new Set<string>()

/** Use Codex's TOML editor in an isolated home, preserving comments and unrelated fields. */
export async function writePluginConfiguration(path: string, id: string, value: boolean | null, revision: string): Promise<void> {
  if (writing.has(path))
    throw new Error('Configuration is being updated. Refresh and try again.')
  writing.add(path)
  let scratch: string | undefined
  let staged: string | undefined
  try {
    const before = await configSnapshot(path)
    if (before.revision !== revision)
      throw new Error('Configuration changed. Refresh and try again.')
    scratch = await mkdtemp(join(tmpdir(), 'craft-hub-codex-'))
    await writeFile(join(scratch, 'config.toml'), before.contents, { mode: 0o600 })
    const editor = await openCodexReader(undefined, 20000, scratch)
    try {
      await editor.editPlugin!(id, value)
    }
    finally {
      editor.close()
    }
    const updated = await readFile(join(scratch, 'config.toml'), 'utf8')
    await mkdir(dirname(path), { recursive: true })
    staged = join(dirname(path), `.config-${randomUUID()}.tmp`)
    await writeFile(staged, updated, { mode: before.mode, flag: 'wx' })
    if ((await configSnapshot(path)).revision !== revision)
      throw new Error('Configuration changed. Refresh and try again.')
    await rename(staged, path)
  }
  finally {
    writing.delete(path)
    if (staged)
      await rm(staged, { force: true })
    if (scratch)
      await rm(scratch, { recursive: true, force: true })
  }
}
