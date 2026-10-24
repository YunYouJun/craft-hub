import type { CAC } from 'cac'
import type { ProfileMigrationPreview } from './profile-migration'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { applyProfileMigration, previewProfileMigration, previewProfileRollback, recoverProfileMigration, rollbackProfileMigration } from './profile-migration'

/** Older hosts do not hold the migration barrier. Refuse known running app executables without stopping them. */
export async function assertLegacyHostsStopped(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('Native profile migration currently requires macOS')
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
  if (stdout.split('\n').some(line => /\/Craft Hub[^/]*\.app\/Contents\/MacOS\//i.test(line)))
    throw new Error('A Craft Hub app is still running. Quit both hosts before migrating; no process was stopped.')
}
function requireStopped(confirmed: boolean | undefined): void {
  if (confirmed !== true)
    throw new Error('Close both hosts and all older CLI clients, then pass --confirm-stopped')
}
function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
/** Offline maintenance commands never start plugins, connect accounts or execute project commands. */
export function registerProfileMigrationCommands(cli: CAC): void {
  cli.command('profile:preflight <sourceData> <sourceConfig> <target>', 'Review an offline Electron-to-native profile copy without changing data')
    .option('--out <path>', 'Write a private, new review file containing paths and hashes')
    .action(async (sourceData: string, sourceConfig: string, target: string, options: { out?: string }) => {
      const result = await previewProfileMigration({ sourceData: resolve(sourceData), sourceConfig: resolve(sourceConfig), target: resolve(target) })
      if (options.out)
        await writeFile(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      output(result)
    })
  cli.command('profile:migrate <review>', 'Apply an exact preflight review, preserving source and previous candidate backups')
    .option('--confirm-stopped', 'Confirm both hosts and all older CLI writers have been closed')
    .action(async (review: string, options: { confirmStopped?: boolean }) => {
      requireStopped(options.confirmStopped)
      const plan = JSON.parse(await readFile(resolve(review), 'utf8')) as ProfileMigrationPreview
      if (plan.version !== 1 || typeof plan.revision !== 'string')
        throw new Error('Unsupported migration review')
      output(await applyProfileMigration(plan.paths, plan.revision, assertLegacyHostsStopped))
    })
  cli.command('profile:rollback <transaction>', 'Preview rollback; with a reviewed revision, archive later native edits and restore the prior candidate')
    .option('--revision <hash>', 'Current candidate revision from rollback preview')
    .option('--confirm-stopped', 'Confirm both hosts and all older CLI writers have been closed')
    .action(async (transaction: string, options: { revision?: string, confirmStopped?: boolean }) => {
      const location = resolve(transaction)
      if (!options.revision) {
        output(await previewProfileRollback(location))
        return
      }
      requireStopped(options.confirmStopped)
      output(await rollbackProfileMigration(location, options.revision, assertLegacyHostsStopped))
    })
  cli.command('profile:recover <transaction>', 'Recover an interrupted migration using its journal and verified directory state')
    .option('--confirm-stopped', 'Confirm both hosts and all older CLI writers have been closed')
    .action(async (transaction: string, options: { confirmStopped?: boolean }) => {
      requireStopped(options.confirmStopped)
      output(await recoverProfileMigration(resolve(transaction), assertLegacyHostsStopped))
    })
}
