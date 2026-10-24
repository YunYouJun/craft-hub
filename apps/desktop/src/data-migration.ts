import type { ProfileMigrationPreview, ProfileMigrationReceipt, ProfileRecoveryPreview } from 'craft-hub'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { applyProfileMigration, canonicalProfilePath, previewProfileMigration, previewProfileRecovery, ProfileMigrationRecoveryError, recoverProfileMigration, rollbackProfileMigration } from 'craft-hub'

/** Source-owned dialog navigation. No caller-supplied approval, source paths, or identity bypass exists. */
export type DataMigrationCommand = { version: 1, action: 'migrate-data', targetProfile: string }
  | { version: 1, action: 'recover-data' | 'rollback-data', transaction: string }
export type DataMigrationReview = { kind: 'migrate-data', profile: ProfileMigrationPreview }
  | { kind: 'recover-data' | 'rollback-data', recovery: ProfileRecoveryPreview }
export type DataMigrationResult = { status: 'cancelled' }
  | { status: 'blocked', blockers: string[] }
  | { status: 'complete', receipt: ProfileMigrationReceipt }
  | { status: 'recovery-required', transaction: string }

/** Exclude only this exact maintenance process. Other known hosts, including helpers, must already be stopped. */
export async function assertDataMigrationHostsStopped(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('Native profile migration requires macOS')
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axww', '-o', 'pid=,comm='], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    const match = /^\s*(\d+)\s+(\S.*)$/.exec(line)
    if (!match)
      throw new Error('Cannot inspect running hosts')
    const pid = Number(match[1])
    const executable = match[2]!
    if (pid === process.pid && executable === process.execPath)
      continue
    if (/\/Craft Hub[^/]*\.app\/Contents\/MacOS\//i.test(executable))
      throw new Error('A Craft Hub host is still running; no process was stopped')
  }
}

/** Reuse the offline runtime coordinator; this path never opens a vault or launches a receiving application. */
export async function coordinateDataMigration(command: DataMigrationCommand, options: {
  sourceData: string
  sourceConfig: string
  confirm: (review: DataMigrationReview) => Promise<boolean>
  signal?: AbortSignal
}): Promise<DataMigrationResult> {
  if (options.signal?.aborted)
    return { status: 'cancelled' }
  const sourceData = await canonicalProfilePath(options.sourceData)
  const sourceConfig = await canonicalProfilePath(options.sourceConfig)
  const stopped = async (): Promise<void> => {
    if (options.signal?.aborted)
      throw new Error('Migration cancelled')
    await assertDataMigrationHostsStopped()
  }
  const confirm = async (review: DataMigrationReview): Promise<boolean> =>
    !options.signal?.aborted && await options.confirm(structuredClone(review)) === true && !options.signal?.aborted
  try {
    if (command.action === 'migrate-data') {
      const profile = await previewProfileMigration({ sourceData, sourceConfig, target: command.targetProfile })
      if (profile.blockers.length)
        return { status: 'blocked', blockers: profile.blockers }
      if (!await confirm({ kind: 'migrate-data', profile }))
        return { status: 'cancelled' }
      return { status: 'complete', receipt: await applyProfileMigration(profile.paths, profile.revision, stopped) }
    }
    const recovery = await previewProfileRecovery(command.transaction)
    if (recovery.paths.sourceData !== sourceData || recovery.paths.sourceConfig !== sourceConfig)
      throw new Error('This transaction belongs to a different source profile')
    if (!await confirm({ kind: command.action, recovery }))
      return { status: 'cancelled' }
    const receipt = command.action === 'rollback-data'
      ? await rollbackProfileMigration(recovery.transaction, recovery.revision, stopped, recovery.reviewRevision)
      : await recoverProfileMigration(recovery.transaction, stopped, recovery.reviewRevision)
    return { status: 'complete', receipt }
  }
  catch (error) {
    if (error instanceof ProfileMigrationRecoveryError)
      return { status: 'recovery-required', transaction: error.transaction }
    throw error
  }
}
