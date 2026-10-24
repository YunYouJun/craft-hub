import type { Stats } from 'node:fs'
import type { ProfileLease } from './profile-lease'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, readlink, realpath, rename, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import process from 'node:process'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { acquireProfileLease, canonicalProfilePath, clearProfileMigrationGuard, inspectProfileMigrationGuard, setProfileMigrationGuard } from './profile-lease'
import { parseJsoncDocument } from './user-config'

/** Explicit local roots. Electron browser profiles are never migration sources. */
export interface ProfileMigrationPaths { sourceData: string, sourceConfig: string, target: string }
interface Entry { path: string, kind: 'file' | 'directory' | 'symlink', bytes: number, mode: number, sha256?: string, link?: string }
/** Review metadata contains filenames and hashes, never configuration contents or credentials. */
export interface ProfileMigrationPreview {
  version: 1
  paths: ProfileMigrationPaths
  revision: string
  sourceRevision: string
  targetRevision: string
  runtime: Entry[]
  config: Entry[]
  target: Entry[]
  excluded: string[]
  blockers: string[]
  bytes: number
}
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const identitySchema = z.object({
  id: digest,
  sourceRevision: digest,
  publicKey: z.string().min(1).max(1024),
  deviceId: z.string().regex(/^[\w.-]{1,128}$/).optional(),
  endpoint: z.string().url().max(2048),
  webOrigin: z.string().url().max(2048),
}).strict()
/** Public identity binding only. The authenticated host adapter owns encryption, recipient verification and Keychain. */
export type ProfileIdentityBinding = z.infer<typeof identitySchema>
/** Every participant call must match this complete binding, including canonical profile paths and transaction owner. */
export interface ProfileIdentityContext { transaction: string, paths: ProfileMigrationPaths, identity: ProfileIdentityBinding }
/** No private key or ciphertext crosses this runtime interface. Operations must be recoverable by inspect(). */
export interface ProfileIdentityParticipant {
  inspect: (context: ProfileIdentityContext) => Promise<'empty' | 'staged' | 'activated' | 'active'>
  stage: (context: ProfileIdentityContext) => Promise<void>
  activate: (context: ProfileIdentityContext) => Promise<void>
  finish: (context: ProfileIdentityContext) => Promise<void>
  rollback: (context: ProfileIdentityContext) => Promise<void>
}
const journalSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  paths: z.object({ sourceData: z.string(), sourceConfig: z.string(), target: z.string() }).strict(),
  revision: digest,
  sourceRevision: digest,
  targetRevision: digest,
  hadTarget: z.boolean(),
  installedRevision: digest.optional(),
  phase: z.enum(['copying', 'prepared', 'target-saved', 'installed', 'complete', 'rolled-back', 'aborted']),
  identity: z.object({ binding: identitySchema, decision: z.enum(['pending', 'commit', 'rollback']), settled: z.boolean(), rollbackRevision: digest.optional() }).strict().optional(),
}).strict()
type Journal = z.infer<typeof journalSchema>
/** A transaction directory contains the source snapshot, prior candidate and durable recovery journal. */
export interface ProfileMigrationReceipt { version: 1, transaction: string, phase: Journal['phase'], alreadyApplied?: boolean }
/** Data-only recovery approval binds the journal and every directory recovery may preserve or restore. */
export interface ProfileRecoveryPreview {
  version: 1
  transaction: string
  paths: ProfileMigrationPaths
  phase: Journal['phase']
  revision: string
  reviewRevision: string
}
/** A copy that reached its journal retains a discoverable recovery location, including after automatic rollback. */
export class ProfileMigrationRecoveryError extends Error {
  readonly transaction: string
  constructor(transaction: string, cause: unknown) {
    super(`Profile migration requires recovery at ${transaction}`, { cause })
    this.transaction = transaction
  }
}

const durable = new Set([
  'projects.json',
  'workspace-state.json',
  'workspace-bindings.json',
  'owner-scope-state.json',
  'settings.json',
  'settings.schema.json',
  'settings.last-good.json',
  'settings-backups',
  'plugins.json',
  'plugins',
  'plugin-data',
  'host-extensions.json',
  'integrations',
  'integration-state',
  'runs',
  'agent-tasks',
  'work-item-projects.json',
  'software-sources.v1.json',
  'setup-profile.v1.json',
  'personal-git-sync.json',
  'team-git-sync.json',
  'personal-config-repository.json',
  'dotfiles-manager.json',
  'workspace-subscriptions.json',
  'user-config-last-good',
  'migration-backups',
])
const browserOrTransient = /^(?:Cache|Code Cache|GPUCache|Dawn.*Cache|GraphiteDawnCache|Crashpad|blob_storage|IndexedDB|Local Storage|Session Storage|Service Worker|Network|Cookies(?:-journal)?|Local State|Preferences|TransportSecurity|Trust Tokens(?:-journal)?|Network Persistent State|Shared Dictionary|shared_proto_db|Singleton.*|\.DS_Store|chrome_debug\.log|logs|desktop-update\.json|window-state\.json|codex-hook-.*|.*\.lock(?:\.sqlite(?:-journal)?)?)$/
// Chromium owns these exact profile names and SQLite companions. The native WebKit profile must
// start fresh; excluded browser state remains untouched at the source. See native-profile-migration.md.
const chromiumStorage = /^(?:(?:DIPS|SharedStorage|declarative_performance_observer\.db)(?:-(?:journal|wal|shm))?|WebStorage|DevToolsActivePort)$/
// ImportantFileWriter uses .<bundle-id>.<basename>.<mkstemp six-character suffix> on macOS.
// Only these two already-excluded network stores qualify; arbitrary hidden files/backups do not.
const chromiumNetworkTemporary = /^\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\.(?:Network Persistent State|TransportSecurity)\.[A-Za-z0-9]{6}$/
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** The authenticated host may resolve this one blocker through its bound Keychain participant. */
export const encryptedIdentityBlocker = 'The encrypted device identity needs a separate authenticated Keychain transfer before migration.'
const inside = (root: string, path: string): boolean => path === root || path.startsWith(root + sep)
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw error
  }
}
async function normalize(paths: ProfileMigrationPaths): Promise<ProfileMigrationPaths> {
  const [sourceData, sourceConfig, target] = await Promise.all([paths.sourceData, paths.sourceConfig, paths.target].map(canonicalProfilePath))
  const all = [sourceData!, sourceConfig!, target!]
  if (all.some(path => dirname(path) === path) || all.some((path, index) => all.some((other, otherIndex) => index !== otherIndex && inside(path, other))))
    throw new Error('Migration roots must be separate, non-overlapping directories')
  return { sourceData: sourceData!, sourceConfig: sourceConfig!, target: target! }
}
async function bytes(path: string, expected?: Stats): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0))
  try {
    const current = await file.stat()
    if (!current.isFile() || current.nlink !== 1 || current.size > 256 * 1024 * 1024
      || (expected && (current.ino !== expected.ino || current.dev !== expected.dev || current.size !== expected.size))) {
      throw new Error('A migration file changed, is linked or exceeds 256 MiB')
    }
    return await file.readFile()
  }
  finally { await file.close() }
}
function parseJson(content: string, label: string): any {
  try {
    return JSON.parse(content)
  }
  catch { throw new Error(`Invalid migration JSON: ${label}`) }
}
async function snapshot(root: string, select?: (name: string) => boolean): Promise<Entry[]> {
  if (!await exists(root))
    return []
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Migration roots must be real directories')
  const entries: Entry[] = []
  let total = 0
  async function visit(path: string): Promise<void> {
    const local = relative(root, path)
    const stat = await lstat(path)
    const entry: Entry = { path: local.split(sep).join('/'), kind: 'directory', mode: stat.mode & 0o777, bytes: 0 }
    if (stat.isSymbolicLink()) {
      const link = await readlink(path)
      const destination = await realpath(path)
      if (isAbsolute(link) || !inside(join(root, local.split(sep)[0]!), destination))
        throw new Error(`Migration cannot copy an external, absolute or cross-section link: ${entry.path}`)
      entry.kind = 'symlink'
      entry.link = link
    }
    else if (stat.isFile()) {
      entry.kind = 'file'
      entry.bytes = stat.size
      total += stat.size
      if (total > 2 * 1024 * 1024 * 1024)
        throw new Error('Migration snapshot exceeds 2 GiB')
      entry.sha256 = createHash('sha256').update(await bytes(path, stat)).digest('hex')
    }
    else if (!stat.isDirectory()) {
      throw new Error(`Migration cannot copy a special file: ${entry.path}`)
    }
    entries.push(entry)
    if (entries.length > 50_000)
      throw new Error('Migration snapshot exceeds 50,000 entries')
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name))
    }
  }
  for (const name of (await readdir(root)).sort()) {
    if (!select || select(name))
      await visit(join(root, name))
  }
  return entries
}
async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  }
  finally { await directory.close() }
}
async function writePrivate(path: string, data: Uint8Array | string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const file = await open(path, 'wx', mode)
  try {
    await file.writeFile(data)
    await file.sync()
  }
  finally { await file.close() }
}
async function journalWrite(transaction: string, journal: Journal): Promise<void> {
  const temporary = join(transaction, `journal-${randomUUID()}.tmp`)
  await writePrivate(temporary, `${JSON.stringify(journal, null, 2)}\n`)
  await rename(temporary, join(transaction, 'journal.json'))
  await syncDirectory(transaction)
}
async function copyEntries(root: string, destination: string, entries: Entry[]): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o700 })
  for (const entry of entries) {
    const source = join(root, entry.path)
    const target = join(destination, entry.path)
    if (entry.kind === 'directory') {
      await mkdir(target, { recursive: true, mode: 0o700 })
    }
    else if (entry.kind === 'symlink') {
      if (await readlink(source) !== entry.link)
        throw new Error('A migration link changed')
      await symlink(entry.link!, target)
    }
    else {
      const content = await bytes(source)
      if (createHash('sha256').update(content).digest('hex') !== entry.sha256)
        throw new Error('A migration file changed')
      await writePrivate(target, content, 0o600 | (entry.mode & 0o100))
    }
  }
  for (const entry of entries.filter(item => item.kind === 'directory').reverse())
    await syncDirectory(join(destination, entry.path))
  await syncDirectory(destination)
}

/** Inspect only: no runtime startup, plugin imports, trust changes, file writes or account requests. */
export async function previewProfileMigration(input: ProfileMigrationPaths): Promise<ProfileMigrationPreview> {
  return previewMigration(input)
}
async function previewMigration(input: ProfileMigrationPaths, recoveryTransaction?: string): Promise<ProfileMigrationPreview> {
  const paths = await normalize(input)
  if (!await exists(paths.sourceData))
    throw new Error('The source runtime data directory does not exist')
  const names = (await readdir(paths.sourceData)).sort()
  const excluded = names.filter(name => !durable.has(name))
  const blockers = excluded.filter(name => !browserOrTransient.test(name) && !chromiumStorage.test(name) && !chromiumNetworkTemporary.test(name)).map(name => name === 'personal-cloud-device.json'
    ? encryptedIdentityBlocker
    : `Unclassified runtime entry needs a migration policy: ${name}`)
  for (const root of leasePaths(paths)) {
    const guard = await inspectProfileMigrationGuard(root)
    if (guard && guard.transaction !== recoveryTransaction)
      blockers.push('A pending or retained device identity migration must be recovered before copying this profile.')
  }
  const [runtime, config, target] = await Promise.all([
    snapshot(paths.sourceData, name => durable.has(name)),
    snapshot(paths.sourceConfig),
    snapshot(paths.target),
  ])
  for (const entry of runtime.filter(item => item.kind === 'file' && ((item.path.endsWith('.json') && !item.path.includes('/')) || /^(?:runs|agent-tasks)\/[^/]+\.json$/.test(item.path)))) {
    const value = parseJson((await bytes(join(paths.sourceData, entry.path))).toString('utf8'), entry.path)
    if (/^(?:runs|agent-tasks)\//.test(entry.path) && ['running', 'queued', 'pending'].includes(value?.status))
      blockers.push(`An unfinished operation needs recovery before migration: ${entry.path}`)
    if (entry.path === 'projects.json' && (!Array.isArray(value) || value.some(project => !project || typeof project.id !== 'string' || typeof project.path !== 'string' || !isAbsolute(project.path) || !['trusted', 'untrusted'].includes(project.trust))))
      blockers.push('The project registry is invalid; preserve and repair it before migration.')
  }
  // Validate portable document syntax without instantiating services that could repair or rewrite the source.
  for (const entry of config.filter(item => item.kind === 'file' && /^(?:config|owner-scopes|workspaces\/[^/]+)\.(?:jsonc|yaml)$/.test(item.path))) {
    const content = (await bytes(join(paths.sourceConfig, entry.path))).toString('utf8')
    try {
      const value = entry.path.endsWith('.jsonc') ? parseJsoncDocument(content) : parseYaml(content)
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1)
        throw new Error('Unsupported configuration document')
    }
    catch { blockers.push(`Invalid portable configuration needs repair before migration: ${entry.path}`) }
  }
  const capture = target.find(entry => entry.path === 'native/capture-draft.json' && entry.kind === 'file')
  if (capture && parseJson((await bytes(join(paths.target, capture.path))).toString('utf8'), capture.path)?.requestID)
    blockers.push('Resolve the native capture retry identity before replacing its runtime profile.')
  const sourceRevision = hash({ paths, runtime, config, excluded })
  const targetRevision = hash(target)
  return { version: 1, paths, revision: hash({ sourceRevision, targetRevision, blockers }), sourceRevision, targetRevision, runtime, config, target, excluded, blockers, bytes: [...runtime, ...config, ...target].reduce((sum, entry) => sum + entry.bytes, 0) }
}

function leasePaths(paths: ProfileMigrationPaths): string[] {
  return [paths.sourceData, paths.sourceConfig, paths.target, join(paths.target, 'runtime'), join(paths.target, 'config')]
}
async function relocatePlugins(path: string, source: string, target: string): Promise<void> {
  if (!await exists(path))
    return
  const content = parseJson((await bytes(path)).toString('utf8'), 'plugins.json')
  for (const plugin of [...(content.installed ?? []), ...(content.linked ?? [])]) {
    if (typeof plugin.packagePath === 'string' && isAbsolute(plugin.packagePath)) {
      const canonical = await canonicalProfilePath(plugin.packagePath)
      if (inside(source, canonical))
        plugin.packagePath = join(target, relative(source, canonical))
    }
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  await writePrivate(temporary, `${JSON.stringify(content, null, 2)}\n`)
  await rename(temporary, path)
}

async function installProfileCopy(transaction: string, journal: Journal, preview: ProfileMigrationPreview, assertHostsStopped: () => Promise<void>, onPhase?: (phase: Journal['phase']) => Promise<void>): Promise<void> {
  const { paths, revision } = journal
  const stage = join(transaction, 'stage')
  await copyEntries(paths.sourceData, join(transaction, 'source/runtime'), preview.runtime)
  await copyEntries(paths.sourceConfig, join(transaction, 'source/config'), preview.config)
  await copyEntries(paths.sourceData, join(stage, 'runtime'), preview.runtime)
  await copyEntries(paths.sourceConfig, join(stage, 'config'), preview.config)
  // Keep candidate-only Node installations, drafts and other native state; archive its old runtime/config separately.
  await copyEntries(paths.target, stage, preview.target.filter(entry => !['runtime', 'config', '.migration-receipt.json'].includes(entry.path.split('/')[0]!)))
  await relocatePlugins(join(stage, 'runtime/plugins.json'), paths.sourceData, join(paths.target, 'runtime'))
  await writePrivate(join(stage, '.migration-receipt.json'), `${JSON.stringify({ version: 1, revision, transaction })}\n`)
  await syncDirectory(join(transaction, 'source'))
  await syncDirectory(stage)
  journal.installedRevision = hash(await snapshot(stage))
  const rechecked = await previewMigration(paths, journal.identity ? transaction : undefined)
  if (rechecked.revision !== revision)
    throw new Error('Source or candidate changed while preparing the migration')
  await assertHostsStopped()
  journal.phase = 'prepared'
  await journalWrite(transaction, journal)
  await onPhase?.(journal.phase)
  if (journal.hadTarget)
    await rename(paths.target, join(transaction, 'previous'))
  await syncDirectory(dirname(paths.target))
  journal.phase = 'target-saved'
  await journalWrite(transaction, journal)
  await onPhase?.(journal.phase)
  await rename(stage, paths.target)
  await syncDirectory(dirname(paths.target))
  journal.phase = 'installed'
  await journalWrite(transaction, journal)
  await onPhase?.(journal.phase)
  if (hash(await snapshot(paths.target)) !== journal.installedRevision)
    throw new Error('Installed candidate did not match the staged snapshot')
}

/** Copy a reviewed profile without modifying its source. The caller must also check older, non-cooperating hosts. */
export async function applyProfileMigration(input: ProfileMigrationPaths, revision: string, assertHostsStopped: () => Promise<void>, onPhase?: (phase: Journal['phase']) => Promise<void>): Promise<ProfileMigrationReceipt> {
  const paths = await normalize(input)
  const lease = await acquireProfileLease(leasePaths(paths), 'migration')
  let transaction: string | undefined
  let journal: Journal | undefined
  try {
    await assertHostsStopped()
    const receiptPath = join(paths.target, '.migration-receipt.json')
    if (await exists(receiptPath)) {
      const receipt = parseJson((await bytes(receiptPath)).toString('utf8'), '.migration-receipt.json')
      if (receipt?.version === 1 && receipt.revision === revision && typeof receipt.transaction === 'string') {
        const completed = await readJournal(receipt.transaction)
        assertDataOnly(completed)
        if (completed.phase !== 'complete' || completed.revision !== revision || JSON.stringify(completed.paths) !== JSON.stringify(paths))
          throw new Error('Migration receipt requires journal recovery before repeating the operation')
        return { version: 1, transaction: receipt.transaction, phase: 'complete', alreadyApplied: true }
      }
    }
    const preview = await previewProfileMigration(paths)
    if (preview.revision !== revision || preview.blockers.length)
      throw new Error('Migration review changed or has unresolved blockers; run preflight again')
    const id = randomUUID()
    transaction = join(dirname(paths.target), `.${basename(paths.target)}.migration-${id}`)
    await mkdir(transaction, { mode: 0o700 })
    await syncDirectory(dirname(transaction))
    journal = { version: 1, id, paths, revision, sourceRevision: preview.sourceRevision, targetRevision: preview.targetRevision, hadTarget: await exists(paths.target), phase: 'copying' }
    await journalWrite(transaction, journal)
    await installProfileCopy(transaction, journal, preview, assertHostsStopped, onPhase)
    journal.phase = 'complete'
    await journalWrite(transaction, journal)
    return { version: 1, transaction, phase: journal.phase }
  }
  catch (error) {
    if (transaction && journal) {
      try {
        if (['target-saved', 'installed'].includes(journal.phase))
          await restorePrevious(transaction, journal)
      }
      catch (restoreError) { throw new ProfileMigrationRecoveryError(transaction, restoreError) }
      throw new ProfileMigrationRecoveryError(transaction, error)
    }
    throw error
  }
  finally { lease.release() }
}

async function readJournal(transaction: string): Promise<Journal> {
  const directory = await lstat(transaction)
  const info = await lstat(join(transaction, 'journal.json'))
  if (!directory.isDirectory() || directory.isSymbolicLink() || !info.isFile() || info.size > 64 * 1024
    || (process.getuid && (directory.uid !== process.getuid() || info.uid !== process.getuid() || (directory.mode & 0o077) !== 0 || (info.mode & 0o077) !== 0))) {
    throw new Error('Migration journal must be private regular metadata')
  }
  const parsed = journalSchema.safeParse(parseJson((await bytes(join(transaction, 'journal.json'))).toString('utf8'), 'journal.json'))
  if (!parsed.success)
    throw new Error('Invalid migration journal format')
  const journal = parsed.data
  if (journal.identity && (
    (journal.identity.decision === 'commit' && (!journal.installedRevision || !['installed', 'complete'].includes(journal.phase)))
    || (journal.identity.rollbackRevision && journal.identity.decision !== 'rollback')
    || (journal.identity.settled && !(journal.identity.decision === 'commit' && journal.phase === 'complete')
      && !(journal.identity.decision === 'rollback' && ['rolled-back', 'aborted'].includes(journal.phase)))
  )) {
    throw new Error('Inconsistent profile and identity migration journal')
  }
  if (await canonicalProfilePath(transaction) !== join(dirname(journal.paths.target), `.${basename(journal.paths.target)}.migration-${journal.id}`)) {
    throw new Error('Invalid migration journal location')
  }
  const paths = await normalize(journal.paths)
  if (JSON.stringify(paths) !== JSON.stringify(journal.paths))
    throw new Error('Migration root identity changed')
  return journal
}
function assertDataOnly(journal: Journal): void {
  if (journal.identity)
    throw new Error('This transaction requires authenticated profile and identity recovery')
}
async function restorePrevious(transaction: string, journal: Journal): Promise<void> {
  const previous = join(transaction, 'previous')
  if (journal.hadTarget && (!await exists(previous) || hash(await snapshot(previous)) !== journal.targetRevision))
    throw new Error('The saved candidate changed; preserve all migration directories for manual recovery')
  if (await exists(journal.paths.target))
    await rename(journal.paths.target, join(transaction, `returned-candidate-${randomUUID()}`))
  if (journal.hadTarget)
    await rename(previous, journal.paths.target)
  await syncDirectory(dirname(journal.paths.target))
  journal.phase = 'rolled-back'
  await journalWrite(transaction, journal)
}

/** Read the current candidate revision before explicitly archiving it and restoring its saved predecessor. */
export async function previewProfileRollback(transaction: string): Promise<{ revision: string, phase: Journal['phase'], paths: ProfileMigrationPaths }> {
  const journal = await readJournal(transaction)
  return { revision: hash(await snapshot(journal.paths.target)), phase: journal.phase, paths: journal.paths }
}
async function dataRecoveryReview(transaction: string, journal: Journal): Promise<ProfileRecoveryPreview> {
  assertDataOnly(journal)
  const directory = async (path: string): Promise<{ exists: boolean, entries: Entry[] }> => ({ exists: await exists(path), entries: await snapshot(path) })
  const [candidate, previous, stage] = await Promise.all([
    directory(journal.paths.target),
    directory(join(transaction, 'previous')),
    directory(join(transaction, 'stage')),
  ])
  return { version: 1, transaction: await canonicalProfilePath(transaction), paths: journal.paths, phase: journal.phase, revision: hash(candidate.entries), reviewRevision: hash({ journal, candidate, previous, stage }) }
}
/** Review data-only recovery without taking a write lease, touching identity storage or mutating a journal. */
export async function previewProfileRecovery(transaction: string): Promise<ProfileRecoveryPreview> {
  return dataRecoveryReview(transaction, await readJournal(transaction))
}
async function checkDataRecoveryReview(transaction: string, journal: Journal, expectedReview?: string): Promise<void> {
  if (expectedReview !== undefined && (await dataRecoveryReview(transaction, journal)).reviewRevision !== expectedReview)
    throw new Error('Recovery review changed; inspect the transaction again')
}
/** Roll back without deleting either the Electron source or edits made after migration. */
export async function rollbackProfileMigration(transaction: string, revision: string, assertHostsStopped: () => Promise<void>, expectedReview?: string): Promise<ProfileMigrationReceipt> {
  const before = await readJournal(transaction)
  assertDataOnly(before)
  const lease = await acquireProfileLease(leasePaths(before.paths), 'migration')
  try {
    const journal = await readJournal(transaction)
    assertDataOnly(journal)
    if (JSON.stringify(journal.paths) !== JSON.stringify(before.paths))
      throw new Error('Migration journal roots changed while acquiring its lease')
    await assertHostsStopped()
    await checkDataRecoveryReview(transaction, journal, expectedReview)
    if (journal.phase === 'rolled-back')
      return { version: 1, transaction, phase: journal.phase, alreadyApplied: true }
    if (!['complete', 'installed', 'target-saved'].includes(journal.phase) || hash(await snapshot(journal.paths.target)) !== revision)
      throw new Error('Rollback review changed or this transaction has not installed a candidate')
    await restorePrevious(transaction, journal)
    return { version: 1, transaction, phase: journal.phase }
  }
  finally { lease.release() }
}

/** Reconcile a process interruption from verified filesystem state, preserving all ambiguous candidates. */
export async function recoverProfileMigration(transaction: string, assertHostsStopped: () => Promise<void>, expectedReview?: string): Promise<ProfileMigrationReceipt> {
  const before = await readJournal(transaction)
  assertDataOnly(before)
  const lease = await acquireProfileLease(leasePaths(before.paths), 'migration')
  try {
    const journal = await readJournal(transaction)
    assertDataOnly(journal)
    if (JSON.stringify(journal.paths) !== JSON.stringify(before.paths))
      throw new Error('Migration journal roots changed while acquiring its lease')
    await assertHostsStopped()
    await checkDataRecoveryReview(transaction, journal, expectedReview)
    if (['complete', 'rolled-back', 'aborted'].includes(journal.phase))
      return { version: 1, transaction, phase: journal.phase, alreadyApplied: true }
    const previous = await exists(join(transaction, 'previous'))
    const target = await exists(journal.paths.target)
    const stage = await exists(join(transaction, 'stage'))
    const current = hash(await snapshot(journal.paths.target))
    if (!stage && target && current === journal.installedRevision) {
      journal.phase = 'complete'
    }
    else if (!target && (previous || !journal.hadTarget) && ['prepared', 'target-saved', 'installed'].includes(journal.phase)) {
      await restorePrevious(transaction, journal)
      return { version: 1, transaction, phase: journal.phase }
    }
    else if (!previous && current === journal.targetRevision) {
      journal.phase = ['copying', 'prepared'].includes(journal.phase) ? 'aborted' : 'rolled-back'
    }
    else { throw new Error('Migration recovery is ambiguous; preserve all directories and review them manually') }
    await journalWrite(transaction, journal)
    return { version: 1, transaction, phase: journal.phase }
  }
  finally { lease.release() }
}

/** A failed or interrupted identity operation has a durable recovery location; adapter errors never escape. */
export class ProfileIdentityRecoveryError extends Error {
  readonly transaction: string
  constructor(transaction: string) {
    super(`Profile and identity migration requires recovery at ${transaction}`)
    this.transaction = transaction
  }
}
/** Checkpoints are observations for host progress and process-interruption verification, never approvals. */
export type ProfileIdentityCheckpoint = Journal['phase'] | 'guarded' | 'staged' | 'activated' | 'commit-decided' | 'finished' | 'settled'

function identityContext(transaction: string, journal: Journal): ProfileIdentityContext {
  if (!journal.identity)
    throw new Error('This transaction has no authenticated identity participant')
  return { transaction, paths: { ...journal.paths }, identity: { ...journal.identity.binding } }
}
async function identityState(participant: ProfileIdentityParticipant, context: ProfileIdentityContext): Promise<'empty' | 'staged' | 'activated' | 'active'> {
  try {
    const state = await participant.inspect(context)
    if (!['empty', 'staged', 'activated', 'active'].includes(state))
      throw new Error('Invalid participant state')
    return state
  }
  catch { throw new Error('The native identity is unavailable or no longer matches this migration') }
}
async function verifyIdentitySource(paths: ProfileMigrationPaths, identity: ProfileIdentityBinding): Promise<void> {
  const path = join(paths.sourceData, 'personal-cloud-device.json')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > 16 * 1024 || (process.getuid && info.uid !== process.getuid()))
      throw new Error('Invalid source identity file')
    const buffer = Buffer.alloc(16 * 1024 + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > 16 * 1024 || createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex') !== identity.sourceRevision)
      throw new Error('The reviewed encrypted source identity changed; preserve the native identity for recovery')
  }
  finally { await file.close() }
}
async function guardIdentityRoots(lease: ProfileLease, transaction: string, paths: ProfileMigrationPaths): Promise<void> {
  for (const root of leasePaths(paths))
    await setProfileMigrationGuard(lease, root, transaction)
}
async function releaseIdentityRoots(lease: ProfileLease, transaction: string, journal: Journal): Promise<void> {
  if (journal.identity?.decision === 'commit') {
    for (const root of [journal.paths.sourceData, journal.paths.sourceConfig])
      await setProfileMigrationGuard(lease, root, transaction, 'source-retained')
    for (const root of [join(journal.paths.target, 'runtime'), join(journal.paths.target, 'config'), journal.paths.target])
      await clearProfileMigrationGuard(lease, root, transaction)
  }
  else {
    for (const root of leasePaths(journal.paths).reverse())
      await clearProfileMigrationGuard(lease, root, transaction)
  }
}
async function restoreIdentityProfile(transaction: string, journal: Journal): Promise<void> {
  const previous = await exists(join(transaction, 'previous'))
  const target = await exists(journal.paths.target)
  const current = hash(await snapshot(journal.paths.target))
  if (!previous && current === journal.targetRevision) {
    journal.phase = ['copying', 'prepared', 'aborted'].includes(journal.phase) ? 'aborted' : 'rolled-back'
    await journalWrite(transaction, journal)
    return
  }
  const expected = journal.identity?.rollbackRevision ?? journal.installedRevision
  if ((target && current !== expected) || (!previous && journal.hadTarget))
    throw new Error('Profile rollback is ambiguous; preserve every candidate for recovery')
  await restorePrevious(transaction, journal)
}
async function reconcileIdentity(transaction: string, journal: Journal, lease: ProfileLease, participant: ProfileIdentityParticipant, checkpoint?: (phase: ProfileIdentityCheckpoint) => Promise<void>): Promise<ProfileMigrationReceipt> {
  const identity = journal.identity!
  const alreadyApplied = identity.settled
  if (!identity.settled) {
    await guardIdentityRoots(lease, transaction, journal.paths)
    if (identity.decision === 'pending') {
      identity.decision = 'rollback'
      await journalWrite(transaction, journal)
    }
    const context = identityContext(transaction, journal)
    let state = await identityState(participant, context)
    if (identity.decision === 'commit') {
      if (!['installed', 'complete'].includes(journal.phase) || hash(await snapshot(journal.paths.target)) !== journal.installedRevision)
        throw new Error('The installed profile changed before identity commit')
      await verifyIdentitySource(journal.paths, identity.binding)
      if (state === 'staged') {
        await participant.activate(context)
        state = await identityState(participant, context)
      }
      if (state === 'activated') {
        await participant.finish(context)
        await checkpoint?.('finished')
        state = await identityState(participant, context)
      }
      if (state !== 'active')
        throw new Error('The native identity has not committed')
      journal.phase = 'complete'
    }
    else {
      // Never delete the last surviving copy if the retained source disappeared or changed.
      if (state !== 'empty')
        await verifyIdentitySource(journal.paths, identity.binding)
      await restoreIdentityProfile(transaction, journal)
      if (state !== 'empty') {
        await verifyIdentitySource(journal.paths, identity.binding)
        await participant.rollback(context)
      }
      if (await identityState(participant, context) !== 'empty')
        throw new Error('The native identity has not rolled back')
    }
    identity.settled = true
    await journalWrite(transaction, journal)
    await checkpoint?.('settled')
  }
  await releaseIdentityRoots(lease, transaction, journal)
  return { version: 1, transaction, phase: journal.phase, ...(alreadyApplied ? { alreadyApplied: true } : {}) }
}

/** Coordinate an authenticated host-owned transfer with its exact data review. This is not exposed by the CLI/HTTP API. */
export async function applyIdentityProfileMigration(input: ProfileMigrationPaths, revision: string, binding: ProfileIdentityBinding, participant: ProfileIdentityParticipant, assertHostsStopped: () => Promise<void>, checkpoint?: (phase: ProfileIdentityCheckpoint) => Promise<void>): Promise<ProfileMigrationReceipt> {
  const paths = await normalize(input)
  const parsed = identitySchema.safeParse(binding)
  if (!parsed.success)
    throw new Error('Invalid public identity migration binding')
  const identity = parsed.data
  const receiptPath = join(paths.target, '.migration-receipt.json')
  if (await exists(receiptPath)) {
    const receipt = parseJson((await bytes(receiptPath)).toString('utf8'), '.migration-receipt.json')
    if (receipt?.version === 1 && receipt.revision === revision && typeof receipt.transaction === 'string') {
      const journal = await readJournal(receipt.transaction)
      if (!journal.identity || journal.revision !== revision || hash(journal.paths) !== hash(paths) || hash(journal.identity.binding) !== hash(identity))
        throw new Error('The existing migration receipt belongs to another reviewed transfer')
      return recoverIdentityProfileMigration(receipt.transaction, participant, assertHostsStopped)
    }
  }
  const lease = await acquireProfileLease(leasePaths(paths), 'migration')
  let transaction: string | undefined
  let journal: Journal | undefined
  try {
    await assertHostsStopped()
    const preview = await previewMigration(paths)
    if (preview.revision !== revision || preview.blockers.length !== 1 || preview.blockers[0] !== encryptedIdentityBlocker)
      throw new Error('Migration review changed or has unresolved non-identity blockers')
    await verifyIdentitySource(paths, identity)
    const id = randomUUID()
    const location = join(dirname(paths.target), `.${basename(paths.target)}.migration-${id}`)
    const next: Journal = { version: 1, id, paths, revision, sourceRevision: preview.sourceRevision, targetRevision: preview.targetRevision, hadTarget: await exists(paths.target), phase: 'copying', identity: { binding: identity, decision: 'pending', settled: false } }
    if (await identityState(participant, identityContext(location, next)) !== 'empty')
      throw new Error('The native identity destination is not empty')
    await mkdir(location, { mode: 0o700 })
    await syncDirectory(dirname(location))
    await journalWrite(location, next)
    transaction = location
    journal = next
    await guardIdentityRoots(lease, transaction, paths)
    await checkpoint?.('guarded')
    await participant.stage(identityContext(transaction, journal))
    if (await identityState(participant, identityContext(transaction, journal)) !== 'staged')
      throw new Error('The native identity reservation was not established')
    await checkpoint?.('staged')
    await installProfileCopy(transaction, journal, preview, assertHostsStopped, async (phase) => {
      await verifyIdentitySource(paths, identity)
      await checkpoint?.(phase)
    })
    await verifyIdentitySource(paths, identity)
    await participant.activate(identityContext(transaction, journal))
    if (await identityState(participant, identityContext(transaction, journal)) !== 'activated')
      throw new Error('The native identity was not prepared for commit')
    await checkpoint?.('activated')
    journal.identity!.decision = 'commit'
    await journalWrite(transaction, journal)
    await checkpoint?.('commit-decided')
    return await reconcileIdentity(transaction, journal, lease, participant, checkpoint)
  }
  catch (error) {
    if (!transaction || !journal)
      throw error
    if (journal.identity!.decision !== 'commit') {
      try {
        await reconcileIdentity(transaction, journal, lease, participant)
      }
      catch { /* Unknown outcomes retain the journal and guards for the matching recovery session. */ }
    }
    throw new ProfileIdentityRecoveryError(transaction)
  }
  finally { lease.release() }
}

/** Read-only metadata for the authenticated host's recovery/rollback review; no device secrets are returned. */
export async function previewIdentityProfileRecovery(transaction: string): Promise<ProfileIdentityContext & { phase: Journal['phase'], decision: 'pending' | 'commit' | 'rollback', settled: boolean, revision: string, reviewRevision: string }> {
  const journal = await readJournal(transaction)
  const revision = hash(await snapshot(journal.paths.target))
  return { ...identityContext(transaction, journal), phase: journal.phase, decision: journal.identity!.decision, settled: journal.identity!.settled, revision, reviewRevision: hash({ journal: hash(journal), revision }) }
}
async function withIdentityTransaction(transaction: string, participant: ProfileIdentityParticipant, assertHostsStopped: () => Promise<void>, rollbackRevision?: string, expectedReview?: string): Promise<ProfileMigrationReceipt> {
  const before = await readJournal(transaction)
  identityContext(transaction, before)
  const lease = await acquireProfileLease(leasePaths(before.paths), 'migration', transaction)
  try {
    const journal = await readJournal(transaction)
    if (hash(journal) !== hash(before))
      throw new Error('The identity migration journal changed while acquiring its lease')
    if (expectedReview !== undefined && hash({ journal: hash(journal), revision: hash(await snapshot(journal.paths.target)) }) !== expectedReview)
      throw new Error('The reviewed recovery journal or candidate changed')
    await assertHostsStopped()
    if (rollbackRevision !== undefined && journal.identity!.decision !== 'rollback') {
      if (hash(await snapshot(journal.paths.target)) !== rollbackRevision)
        throw new Error('Identity migration rollback review changed')
      await verifyIdentitySource(journal.paths, journal.identity!.binding)
      await identityState(participant, identityContext(transaction, journal))
      await guardIdentityRoots(lease, transaction, journal.paths)
      journal.identity!.decision = 'rollback'
      journal.identity!.settled = false
      journal.identity!.rollbackRevision = rollbackRevision
      await journalWrite(transaction, journal)
    }
    return await reconcileIdentity(transaction, journal, lease, participant)
  }
  catch { throw new ProfileIdentityRecoveryError(transaction) }
  finally { lease.release() }
}
/** Recover the persisted decision: pending rolls back and committed finishes. Interactive hosts supply the review token for a lease-held recheck. */
export async function recoverIdentityProfileMigration(transaction: string, participant: ProfileIdentityParticipant, assertHostsStopped: () => Promise<void>, expectedReview?: string): Promise<ProfileMigrationReceipt> {
  return withIdentityTransaction(transaction, participant, assertHostsStopped, undefined, expectedReview)
}
/** Explicitly roll back a reviewed candidate and its matching identity, preserving later profile edits in an archive. */
export async function rollbackIdentityProfileMigration(transaction: string, revision: string, participant: ProfileIdentityParticipant, assertHostsStopped: () => Promise<void>, expectedReview?: string): Promise<ProfileMigrationReceipt> {
  return withIdentityTransaction(transaction, participant, assertHostsStopped, revision, expectedReview)
}
