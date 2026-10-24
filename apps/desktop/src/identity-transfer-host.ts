import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'
import { canonicalProfilePath } from 'craft-hub'
import { app, dialog, safeStorage } from 'electron'
import { DeviceVault } from './device-vault.ts'
import { identityLauncher } from './identity-launcher.ts'
import { confirmIdentityMigration, showIdentityMigrationResult } from './identity-migration-review.ts'
import { coordinateIdentityMigration } from './identity-migration.ts'
import { identitySourceContext } from './identity-source-context.ts'
import { identitySourceRequest, inspectIdentityRecipient } from './identity-transfer-recipient.ts'
import { operateIdentityTransferSource, readIdentityTransferInput } from './identity-transfer-source.ts'

/** Runs inside the selected Electron application so safeStorage uses that application's supported identity. */
export async function prepareIdentityTransferHost(): Promise<() => Promise<void>> {
  let temporary: string | undefined
  try {
    if (process.platform !== 'darwin' || process.stdin.isTTY || process.stdout.isTTY)
      throw new Error('A private macOS transfer pipe is required')
    const input = identitySourceRequest(await readIdentityTransferInput(process.stdin))
    // Read-only operations load the packaged ABI without launching a recipient. Mutating commands must pass
    // the release contract, a source-owned native review, and fresh native code validation before transfer.
    if (app.isPackaged)
      identityLauncher()
    const source = identitySourceContext()
    app.setName(source.name)
    // No browser session, source preference writes, runtime initialization or account startup.
    // Chromium may flush after JS teardown. The coordinator owns this scratch root and removes it after exit.
    const scratch = process.env.CRAFT_HUB_IDENTITY_SOURCE_SCRATCH
    if (!scratch || !isAbsolute(scratch) || await canonicalProfilePath(scratch) !== scratch)
      throw new Error('A private coordinator scratch directory is required')
    const info = await lstat(scratch)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0)
      throw new Error('The coordinator scratch directory is not private')
    temporary = await mkdtemp(join(scratch, 'host-'))
    app.setPath('userData', temporary)
    app.setPath('sessionData', temporary)
    app.disableHardwareAcceleration()
    const runtimeDataDir = source.sourceData
    return async () => {
      let success = false
      let reviewed = false
      const cancellation = new AbortController()
      const cancel = (): void => cancellation.abort()
      process.once('SIGTERM', cancel)
      process.once('SIGINT', cancel)
      try {
        let result: unknown
        const capabilities = ['preview', 'recipient-preflight']
        if (input.action === 'recipient-preflight') {
          result = await inspectIdentityRecipient(input.application).then(
            recipient => ({ available: true, recipient }),
            () => ({ available: false, reason: 'peer-verification-failed' }),
          )
        }
        else if (input.action === 'preview') {
          result = await operateIdentityTransferSource(input, {
            vault: new DeviceVault(runtimeDataDir, safeStorage, process.platform),
            sourceData: runtimeDataDir,
            assertHostsStopped: async () => { throw new Error('Read-only operation') },
            confirm: async () => false,
          })
        }
        else {
          const migration = await coordinateIdentityMigration(input, {
            vault: new DeviceVault(runtimeDataDir, safeStorage, process.platform),
            sourceData: runtimeDataDir,
            sourceConfig: source.sourceConfig,
            endpoint: process.env.CRAFT_HUB_CLOUD_ENDPOINT ?? '',
            webOrigin: process.env.CRAFT_HUB_CLOUD_ORIGIN ?? '',
            signal: cancellation.signal,
            confirm: async (review) => {
              reviewed = true
              return confirmIdentityMigration(review, cancellation.signal)
            },
          })
          result = migration
          capabilities.push('coordinated-transfer')
          if (!cancellation.signal.aborted)
            await showIdentityMigrationResult(migration)
        }
        await new Promise<void>((resolveOutput, reject) => {
          process.stdout.write(`${JSON.stringify({ version: 1, capabilities, value: result })}\n`, error => error ? reject(error) : resolveOutput())
        })
        success = true
      }
      catch {
        process.stderr.write('Craft Hub device identity transfer was rejected\n')
        if (reviewed && !cancellation.signal.aborted)
          await dialog.showMessageBox({ type: 'error', message: '迁移审阅已失效或操作不可用', detail: '请保留源资料，检查两个宿主均已退出，然后重新审阅。', buttons: ['关闭'] })
      }
      finally {
        process.removeListener('SIGTERM', cancel)
        process.removeListener('SIGINT', cancel)
        if (temporary)
          await rm(temporary, { recursive: true, force: true }).catch(() => {})
        app.exit(success ? 0 : 1)
      }
    }
  }
  catch {
    if (temporary)
      await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw new Error('Craft Hub identity source could not initialize')
  }
}
