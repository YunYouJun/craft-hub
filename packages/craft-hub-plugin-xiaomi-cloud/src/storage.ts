import type { CloudNote, CloudSession } from './transport'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { cloudSession, XiaomiCloudError } from './transport'

/** A host can inject its own system-backed vault; plaintext filesystem fallbacks are intentionally absent. */
export interface XiaomiCredentialStore {
  read: () => Promise<CloudSession | null>
  save: (session: CloudSession) => Promise<void>
  clear: () => Promise<void>
}
/** A complete local text snapshot. Attachment files are not downloaded in this version. */
export interface NoteSnapshot {
  version: 1
  accountId: string
  origin: string
  syncedAt: string
  skipped: number
  folders: Array<{ id: string, title: string }>
  notes: CloudNote[]
}

/** Stable opaque filesystem keys prevent note titles and cloud IDs from selecting local paths. */
export function storageKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Lazily use Keychain, Credential Manager or Secret Service, isolated by the host's data directory. */
export function createXiaomiCredentialStore(dataDir: string): XiaomiCredentialStore {
  const service = `dev.craft-hub.xiaomi-cloud.${storageKey(resolve(dataDir))}`
  async function vault(): Promise<typeof import('keytar')> {
    try {
      return (await import('keytar')).default
    }
    catch { throw new XiaomiCloudError('credentials') }
  }
  return {
    async read() {
      try {
        const value = await (await vault()).getPassword(service, 'connection')
        if (!value)
          return null
        const stored = JSON.parse(value) as CloudSession
        const parsed = cloudSession(stored.cookie, stored.origin)
        if (parsed.accountId !== stored.accountId)
          throw new XiaomiCloudError('credentials')
        return parsed
      }
      catch { throw new XiaomiCloudError('credentials') }
    },
    async save(session) {
      try {
        await (await vault()).setPassword(service, 'connection', JSON.stringify(cloudSession(session.cookie, session.origin)))
      }
      catch { throw new XiaomiCloudError('credentials') }
    },
    async clear() {
      try {
        await (await vault()).deletePassword(service, 'connection')
      }
      catch { throw new XiaomiCloudError('credentials') }
    },
  }
}

/** Account-scoped immutable snapshots: publish only after every note and export has been written. */
export class XiaomiSnapshotStore {
  constructor(private readonly directory: string) {}

  private accountDirectory(session: Pick<CloudSession, 'origin' | 'accountId'>): string {
    return join(this.directory, 'backups', storageKey(`${session.origin}\n${session.accountId}`))
  }

  /** Read the last completed backup without accessing the network or changing local state. */
  async read(session: Pick<CloudSession, 'origin' | 'accountId'>): Promise<{ snapshot: NoteSnapshot, directory: string } | null> {
    const root = this.accountDirectory(session)
    let pointer: { directory: string }
    try {
      pointer = JSON.parse(await readFile(join(root, 'current.json'), 'utf8')) as { directory: string }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return null
      throw new Error('The Xiaomi Cloud backup index could not be read.')
    }
    if (!/^snapshot-[\da-f-]{36}$/.test(pointer.directory))
      throw new Error('The Xiaomi Cloud backup index is invalid.')
    const directory = join(root, pointer.directory)
    const path = join(directory, 'snapshot.json')
    if ((await stat(path)).size > 150_000_000)
      throw new Error('The Xiaomi Cloud backup exceeds the supported size.')
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as NoteSnapshot
    if (snapshot.version !== 1 || snapshot.accountId !== session.accountId || snapshot.origin !== session.origin
      || typeof snapshot.syncedAt !== 'string' || !Array.isArray(snapshot.notes) || !Array.isArray(snapshot.folders)
      || snapshot.notes.length > 10000 || !Number.isSafeInteger(snapshot.skipped) || snapshot.skipped < 0
      || snapshot.notes.some(note => !note || typeof note.id !== 'string' || typeof note.title !== 'string'
        || typeof note.folderId !== 'string' || typeof note.modifiedAt !== 'number' || typeof note.createdAt !== 'number'
        || typeof note.content !== 'string' || typeof note.markdown !== 'string' || !Array.isArray(note.attachments))
      || snapshot.folders.some(folder => !folder || typeof folder.id !== 'string' || typeof folder.title !== 'string')) {
      throw new Error('The Xiaomi Cloud backup is invalid.')
    }
    return { snapshot, directory }
  }

  /** Keep earlier generations and failed-sync data separate; callers cannot supply export paths. */
  async publish(snapshot: NoteSnapshot, beforePublish: () => void): Promise<void> {
    const root = this.accountDirectory(snapshot)
    const name = `snapshot-${randomUUID()}`
    const staging = join(root, `.${name}.tmp`)
    const pointer = join(root, `.${randomUUID()}.tmp`)
    await mkdir(join(staging, 'notes'), { recursive: true, mode: 0o700 })
    try {
      for (const note of snapshot.notes) {
        beforePublish()
        // Titles are display data, never filenames. Equal titles remain separate notes.
        await writeFile(join(staging, 'notes', `${storageKey(note.id)}.md`), `# ${note.title.replace(/[\r\n<>]/g, ' ')}\n\n${note.markdown}\n`, { mode: 0o600 })
      }
      await writeFile(join(staging, 'snapshot.json'), JSON.stringify(snapshot), { mode: 0o600 })
      beforePublish()
      await rename(staging, join(root, name))
      await writeFile(pointer, JSON.stringify({ directory: name }), { mode: 0o600 })
      beforePublish()
      await rename(pointer, join(root, 'current.json'))
    }
    finally {
      await rm(staging, { recursive: true, force: true })
      await rm(pointer, { force: true })
    }
  }
}
