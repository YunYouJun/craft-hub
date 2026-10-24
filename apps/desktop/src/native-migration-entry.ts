import type { ProfileMigrationGuard } from 'craft-hub'
import process from 'node:process'
import { inspectProfileMigrationGuard } from 'craft-hub'
import { dialog } from 'electron'
import { identitySourceContext } from './identity-source-context.ts'

export const nativeMigrationArgument = '--craft-hub-native-migration'
export type NativeMigrationGate = { status: 'clear' }
  | { status: 'guarded', transaction: string, state: ProfileMigrationGuard['state'] }
  | { status: 'unavailable' }
export type DesktopHostMode = { kind: 'desktop' | 'identity-transfer' }
  | { kind: 'migration', gate: NativeMigrationGate }

/** Inspect both source roots before runtime/plugin/account initialization; malformed or conflicting guards fail closed. */
export async function inspectDesktopMigrationGate(): Promise<NativeMigrationGate> {
  try {
    const source = identitySourceContext()
    const guards = (await Promise.all([source.sourceData, source.sourceConfig].map(inspectProfileMigrationGuard)))
      .filter((guard): guard is ProfileMigrationGuard => guard !== undefined)
    if (!guards.length)
      return { status: 'clear' }
    if (guards.some(guard => guard.transaction !== guards[0]!.transaction))
      return { status: 'unavailable' }
    return { status: 'guarded', transaction: guards[0]!.transaction, state: guards.some(guard => guard.state === 'pending') ? 'pending' : 'source-retained' }
  }
  catch { return { status: 'unavailable' } }
}

/** A flag selects navigation only. It cannot approve migration, bypass a guard or supply a transaction or key. */
export async function selectDesktopHostMode(args: readonly string[], platform = process.platform): Promise<DesktopHostMode> {
  const transfer = args.includes('--craft-hub-native-identity-transfer')
  const interactive = args.includes(nativeMigrationArgument)
  if (transfer && interactive)
    throw new Error('Conflicting desktop maintenance modes')
  if (transfer)
    return { kind: 'identity-transfer' }
  if (platform !== 'darwin') {
    if (interactive)
      throw new Error('Native migration requires macOS')
    return { kind: 'desktop' }
  }
  const gate = await inspectDesktopMigrationGate()
  return interactive || gate.status !== 'clear' ? { kind: 'migration', gate } : { kind: 'desktop' }
}

/** Menu navigation drains the ordinary host before relaunch. Final migration consent belongs to the new maintenance host. */
export function createNativeMigrationEntry(options: {
  canRestart: () => boolean
  hasActiveWork: () => Promise<boolean>
  restart: () => void
}): () => Promise<void> {
  let presenting = false
  return async () => {
    if (presenting || !options.canRestart())
      return
    presenting = true
    try {
      if (await options.hasActiveWork()) {
        await dialog.showMessageBox({ type: 'info', message: '请先结束运行中的命令和 Agent 任务', detail: '工作完成后，再打开原生版资料迁移。', buttons: ['关闭'] })
        return
      }
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Craft Hub · 原生版资料迁移',
        message: '退出工作台并打开迁移向导？',
        detail: '当前工作台会先关闭。向导支持普通资料复制、资料与设备身份迁移，以及已有事务的恢复和回退；选择目录后仍须单独审阅并确认。请同时退出原生版和旧命令行进程。',
        buttons: ['取消', '打开迁移向导'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (result.response !== 1 || !options.canRestart())
        return
      if (await options.hasActiveWork()) {
        await dialog.showMessageBox({ type: 'info', message: '工作台出现了新的运行任务', detail: '请等待任务结束后重新打开迁移向导。', buttons: ['关闭'] })
        return
      }
      if (options.canRestart())
        options.restart()
    }
    catch {
      await dialog.showMessageBox({ type: 'error', message: '暂时无法打开迁移向导', detail: '工作台状态无法确认，请稍后重试。', buttons: ['关闭'] })
    }
    finally { presenting = false }
  }
}
