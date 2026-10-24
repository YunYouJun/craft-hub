import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'

/** Kernel-held migration barrier. Active clients share leases; migration requires exclusive ownership. */
export interface ProfileLease {
  readonly paths: readonly string[]
  release: () => void
}

/** Durable interlock kept outside profile rename/copy operations. It contains no device key or ciphertext. */
export interface ProfileMigrationGuard { version: 1, root: string, transaction: string, state: 'pending' | 'source-retained' }
/** Ordinary clients and unrelated maintenance fail closed while identity migration needs coordination. */
export class ProfileMigrationGuardError extends Error {
  constructor() { super('This profile has a pending or retained identity migration. Use its reviewed migration recovery before opening it.') }
}
interface HeldLease { roots: Set<string>, mode: 'client' | 'migration', directory: string, released: boolean, pending: number, close: () => void }
const heldLeases = new WeakMap<ProfileLease, HeldLease>()
const guardName = (root: string): string => `${createHash('sha256').update(root).digest('hex')}.migration.json`

async function guardDirectory(create: boolean): Promise<string> {
  // OS account metadata, not HOME/XDG/TMPDIR: GUI hosts and isolated sidecars must share durable interlocks.
  const home = userInfo().homedir
  if (!isAbsolute(home))
    throw new ProfileMigrationGuardError()
  const base = process.platform === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Craft Hub Migration', 'guards')
    : process.platform === 'win32'
      ? join(home, 'AppData', 'Local', 'Craft Hub Migration', 'guards')
      : join(home, '.local', 'state', 'craft-hub-migration', 'guards')
  const path = await canonicalProfilePath(base)
  if (create) {
    const firstCreated = await mkdir(path, { recursive: true, mode: 0o700 })
    if (firstCreated) {
      // Persist the newly created directory links as well as the eventual marker file itself.
      let current = path
      const ancestor = dirname(firstCreated)
      for (;;) {
        const file = await open(current, 'r')
        try {
          await file.sync()
        }
        finally { await file.close() }
        if (current === ancestor)
          break
        current = dirname(current)
      }
    }
  }
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
  })
  if (info && (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))))
    throw new ProfileMigrationGuardError()
  return path
}

/** Read-only location for maintenance inspection. Guards live in OS-account state, outside profiles and /tmp. */
export async function profileMigrationGuardPath(path: string): Promise<string> {
  return join(await guardDirectory(false), guardName(await canonicalProfilePath(path)))
}

async function leaseDirectory(create: boolean): Promise<string | undefined> {
  const path = join(await realpath(process.platform === 'win32' ? tmpdir() : '/tmp'), `craft-hub-profile-leases-${process.getuid?.() ?? 'user'}`)
  if (create) {
    await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST')
        throw error
    })
  }
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
  })
  if (!info)
    return undefined
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)))
    throw new Error('The profile lease directory is not private')
  return path
}

async function readGuardFile(root: string, directory: string): Promise<ProfileMigrationGuard | undefined> {
  try {
    const file = await open(join(directory, guardName(root)), constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        throw error
    })
    if (!file)
      return undefined
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)))
        throw new ProfileMigrationGuardError()
      const buffer = Buffer.alloc(16 * 1024 + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      if (bytesRead > 16 * 1024)
        throw new ProfileMigrationGuardError()
      const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as ProfileMigrationGuard
      if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'root,state,transaction,version'
        || value.version !== 1 || value.root !== root || !['pending', 'source-retained'].includes(value.state)
        || typeof value.transaction !== 'string' || !isAbsolute(value.transaction) || value.transaction.length > 4096
        || await canonicalProfilePath(value.transaction) !== value.transaction) {
        throw new ProfileMigrationGuardError()
      }
      return value
    }
    finally { await file.close() }
  }
  catch { throw new ProfileMigrationGuardError() }
}

async function readGuard(root: string, legacyDirectory?: string): Promise<ProfileMigrationGuard | undefined> {
  const durable = await readGuardFile(root, await guardDirectory(false))
  const legacy = legacyDirectory ? await readGuardFile(root, legacyDirectory) : undefined
  if (durable && legacy && durable.transaction !== legacy.transaction)
    throw new ProfileMigrationGuardError()
  // An interrupted state transition may leave pending/source-retained in different copies. Both block clients.
  return durable ?? legacy
}

/** Read only: does not create profile files or the shared lock directory. */
export async function inspectProfileMigrationGuard(path: string): Promise<ProfileMigrationGuard | undefined> {
  const root = await canonicalProfilePath(path)
  const directory = await leaseDirectory(false)
  return readGuard(root, directory)
}

/** Resolve existing ancestors without creating or reading profile contents. */
export async function canonicalProfilePath(path: string): Promise<string> {
  if (!isAbsolute(path))
    throw new Error('Profile paths must be absolute')
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(absolute) === absolute)
      throw error
    return join(await canonicalProfilePath(dirname(absolute)), basename(absolute))
  }
}

/** Acquire all roots in deterministic order. Locks survive renames and release automatically on process death. */
export async function acquireProfileLease(paths: string[], mode: 'client' | 'migration' = 'client', recoveryTransaction?: string): Promise<ProfileLease> {
  const canonical = [...new Set(await Promise.all(paths.map(canonicalProfilePath)))].sort()
  if (recoveryTransaction !== undefined && (mode !== 'migration' || await canonicalProfilePath(recoveryTransaction) !== recoveryTransaction))
    throw new ProfileMigrationGuardError()
  // GUI hosts and isolated sidecars can have different TMPDIR values. They must still meet at one lock inode.
  const lockDirectory = (await leaseDirectory(true))!
  const databases: DatabaseSync[] = []
  try {
    for (const path of canonical) {
      const lockPath = join(lockDirectory, `${createHash('sha256').update(path).digest('hex')}.sqlite`)
      const file = await open(lockPath, 'ax', 0o600).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST')
          throw error
      })
      await file?.close()
      const before = await lstat(lockPath)
      if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (process.getuid && before.uid !== process.getuid()))
        throw new Error('The profile lease is not a private regular file')
      await chmod(lockPath, 0o600)
      const database = new DatabaseSync(lockPath)
      databases.push(database)
      const after = await lstat(lockPath)
      if (before.ino !== after.ino || before.dev !== after.dev)
        throw new Error('The profile lease changed while opening')
      // No profile data is stored in SQLite. Never unlink a lease file: its inode is the shared lock identity.
      database.exec('CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY)')
      database.exec(mode === 'migration' ? 'BEGIN EXCLUSIVE' : 'BEGIN')
      database.prepare('SELECT id FROM lease').all()
      const guard = await readGuard(path, lockDirectory)
      if (guard && guard.transaction !== recoveryTransaction)
        throw new ProfileMigrationGuardError()
    }
  }
  catch (error) {
    for (const database of databases.reverse())
      database.close()
    if (error instanceof ProfileMigrationGuardError)
      throw error
    throw new Error('This profile is in use or its migration lease is unavailable. Close its hosts and CLI clients before migrating.')
  }
  const state: HeldLease = { roots: new Set(canonical), mode, directory: lockDirectory, released: false, pending: 0, close: () => {
    for (const database of databases.splice(0).reverse())
      database.close()
  } }
  const lease: ProfileLease = {
    paths: Object.freeze([...canonical]),
    release() {
      if (state.released)
        return
      state.released = true
      if (!state.pending)
        state.close()
    },
  }
  heldLeases.set(lease, state)
  return lease
}

async function changeGuard(lease: ProfileLease, path: string, transaction: string, next?: ProfileMigrationGuard['state']): Promise<void> {
  const held = heldLeases.get(lease)
  if (!held || held.mode !== 'migration' || held.released || held.pending)
    throw new ProfileMigrationGuardError()
  held.pending += 1
  try {
    const root = await canonicalProfilePath(path)
    if (!held.roots.has(root) || transaction.length > 4096 || await canonicalProfilePath(transaction) !== transaction)
      throw new ProfileMigrationGuardError()
    const current = await readGuard(root, held.directory)
    if (current && current.transaction !== transaction)
      throw new ProfileMigrationGuardError()
    const durableDirectory = await guardDirectory(true)
    const directories = next ? [durableDirectory, held.directory] : [held.directory, durableDirectory]
    for (const directory of directories)
      await writeGuard(directory, root, transaction, next)
  }
  finally {
    held.pending -= 1
    if (held.released)
      held.close()
  }
}

async function writeGuard(directory: string, root: string, transaction: string, next?: ProfileMigrationGuard['state']): Promise<void> {
  const destination = join(directory, guardName(root))
  if (next) {
    const temporary = `${destination}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify({ version: 1, root, transaction, state: next })}\n`)
      await file.sync()
    }
    finally { await file.close() }
    await rename(temporary, destination)
  }
  else {
    await rm(destination, { force: true })
  }
  const directoryFile = await open(directory, 'r')
  try {
    await directoryFile.sync()
  }
  finally { await directoryFile.close() }
}

/** Install/transition a durable interlock while an actual exclusive lease is held. Await before key mutations. */
export async function setProfileMigrationGuard(lease: ProfileLease, path: string, transaction: string, state: ProfileMigrationGuard['state'] = 'pending'): Promise<void> {
  if (!['pending', 'source-retained'].includes(state))
    throw new ProfileMigrationGuardError()
  await changeGuard(lease, path, transaction, state)
}

/** Remove only this transaction's guard after verified commit/rollback; SQLite lease files are never removed. */
export async function clearProfileMigrationGuard(lease: ProfileLease, path: string, transaction: string): Promise<void> {
  await changeGuard(lease, path, transaction)
}
