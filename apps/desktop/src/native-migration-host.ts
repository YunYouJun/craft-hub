import type { DataMigrationCommand } from './data-migration.ts'
import type { IdentityMigrationCommand } from './identity-migration.ts'
import type { NativeMigrationGate } from './native-migration-entry.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { canonicalProfilePath } from 'craft-hub'
import { app, dialog, Menu, safeStorage } from 'electron'
import { chooseDataMigration, confirmDataMigration, showDataMigrationResult } from './data-migration-dialogs.ts'
import { coordinateDataMigration } from './data-migration.ts'
import { DeviceVault } from './device-vault.ts'
import { identityLauncher } from './identity-launcher.ts'
import { confirmIdentityMigration, showIdentityMigrationResult } from './identity-migration-review.ts'
import { coordinateIdentityMigration } from './identity-migration.ts'
import { identitySourceContext } from './identity-source-context.ts'
import { identitySourceRequest, inspectIdentityRecipient } from './identity-transfer-recipient.ts'

/** Native selectors produce a declarative command, never an approval. A guarded startup pins its existing transaction. */
export async function chooseNativeMigration(gate: NativeMigrationGate, signal: AbortSignal): Promise<IdentityMigrationCommand | DataMigrationCommand | undefined> {
  if (signal.aborted)
    return undefined
  if (gate.status === 'unavailable') {
    await dialog.showMessageBox({ type: 'error', message: '无法读取资料迁移状态', detail: '为保留现有资料，工作台没有启动。请保留迁移事务和保护文件，检查本机目录权限后重试。', buttons: ['关闭'], signal })
    return undefined
  }
  const guarded = gate.status === 'guarded'
  const result = await dialog.showMessageBox({
    type: guarded ? 'warning' : 'info',
    title: 'Craft Hub · 原生版资料迁移',
    message: guarded ? '此资料需要处理已有迁移' : '原生版资料迁移',
    detail: guarded
      ? `现有事务：\n${gate.transaction}\n\n${gate.state === 'source-retained' ? '资料已迁入原生版，源资料保留并停止写入。' : '迁移尚未完成，请从持久事务恢复。'}\n恢复将遵守已有提交或回退决定；回退会保留原生版的后续编辑。`
      : '带设备身份的迁移将检查配套签名的应用及云范围。没有设备身份时可选择普通资料迁移。每项操作都须单独审阅确认，此处不会复制数据。',
    buttons: guarded ? ['关闭', '恢复已有迁移…', '回退已有迁移…'] : ['取消', '迁移资料与身份…', '恢复身份迁移…', '回退身份迁移…', '普通资料迁移…'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal,
  })
  if (signal.aborted || result.response === 0)
    return undefined
  if (!guarded && result.response === 4)
    return chooseDataMigration(signal)
  const action = (guarded ? [undefined, 'recover', 'rollback'] : [undefined, 'migrate', 'recover', 'rollback'])[result.response]
  if (action !== 'migrate' && action !== 'recover' && action !== 'rollback')
    return undefined
  const selectedApp = await dialog.showOpenDialog({
    title: '选择参与迁移的 Craft Hub 原生版',
    message: '选择与源应用配套签名并支持资料迁移的原生 App。此步骤只检查应用，不启动它。',
    defaultPath: '/Applications',
    // Pick bundles as files or directories; recipient verification owns the .app and signature boundary.
    // Selection alone cannot access a destination or vault.
    properties: ['openFile', 'openDirectory'],
  })
  if (signal.aborted || selectedApp.canceled || selectedApp.filePaths.length !== 1)
    return undefined
  const application = await canonicalProfilePath(selectedApp.filePaths[0]!)
  // Reject unsupported/ad hoc pairs before any vault access, recipient launch, or destination creation.
  await inspectIdentityRecipient(application)
  if (signal.aborted)
    return undefined
  let path = guarded ? gate.transaction : undefined
  if (!path) {
    const selected = await dialog.showOpenDialog({
      title: action === 'migrate' ? '选择原生版资料目录' : '选择已有迁移事务目录',
      message: action === 'migrate'
        ? '选择原生版实际使用的资料根目录。已有资料将归档保留；下一步核对完整路径和复制清单。'
        : '选择迁移回执中保留的事务目录。向导会核对它是否属于当前源资料。',
      ...(action === 'migrate' ? { defaultPath: join(app.getPath('appData'), 'Craft Hub Prototype') } : {}),
      properties: action === 'migrate' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
    })
    if (signal.aborted || selected.canceled || selected.filePaths.length !== 1)
      return undefined
    path = await canonicalProfilePath(selected.filePaths[0]!)
  }
  if (signal.aborted)
    return undefined
  const command = identitySourceRequest({ version: 1, action, application, ...(action === 'migrate' ? { targetProfile: path } : { transaction: path }) })
  if (command.action !== 'migrate' && command.action !== 'recover' && command.action !== 'rollback')
    throw new Error('Invalid migration selection')
  return command
}

/** Prepare the dialog-only host before Electron readiness; no ordinary runtime, account or browser profile is opened. */
export async function prepareNativeMigrationHost(gate: NativeMigrationGate): Promise<() => Promise<void>> {
  if (process.platform !== 'darwin')
    throw new Error('Native migration requires macOS')
  const source = identitySourceContext()
  app.setName(source.name)
  const temporary = await mkdtemp(join(await canonicalProfilePath(tmpdir()), 'craft-hub-migration-ui-'))
  try {
    app.setPath('userData', temporary)
    app.setPath('sessionData', temporary)
    app.disableHardwareAcceleration()
  }
  catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
  return async () => {
    const cancellation = new AbortController()
    const cancel = (): void => cancellation.abort()
    const quit = (event: Electron.Event): void => {
      event.preventDefault()
      cancel()
    }
    process.once('SIGTERM', cancel)
    process.once('SIGINT', cancel)
    app.on('before-quit', quit)
    let exitCode = gate.status === 'unavailable' ? 1 : 0
    try {
      await app.whenReady()
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: source.name, submenu: [{ role: 'quit' }] }, { role: 'editMenu' }]))
      app.focus({ steal: true })
      const command = await chooseNativeMigration(gate, cancellation.signal)
      if (command && !cancellation.signal.aborted) {
        if (!('application' in command)) {
          const result = await coordinateDataMigration(command, {
            sourceData: source.sourceData,
            sourceConfig: source.sourceConfig,
            signal: cancellation.signal,
            confirm: review => confirmDataMigration(review, cancellation.signal),
          })
          await showDataMigrationResult(result, cancellation.signal)
          return
        }
        if (app.isPackaged)
          identityLauncher()
        const result = await coordinateIdentityMigration(command, {
          vault: new DeviceVault(source.sourceData, safeStorage, process.platform),
          sourceData: source.sourceData,
          sourceConfig: source.sourceConfig,
          endpoint: process.env.CRAFT_HUB_CLOUD_ENDPOINT ?? '',
          webOrigin: process.env.CRAFT_HUB_CLOUD_ORIGIN ?? '',
          signal: cancellation.signal,
          confirm: review => confirmIdentityMigration(review, cancellation.signal),
        })
        if (!cancellation.signal.aborted)
          await showIdentityMigrationResult(result)
      }
    }
    catch {
      exitCode = 1
      if (!cancellation.signal.aborted) {
        await dialog.showMessageBox({
          type: 'error',
          message: '无法开始或继续迁移',
          detail: '请先退出两个日用宿主和旧命令行进程；资料、事务或归档变化后需重新审阅。带设备身份的迁移还须两份应用使用配套的发布签名。请保留源资料及已有事务，再从源应用打开向导。',
          buttons: ['关闭'],
          signal: cancellation.signal,
        })
      }
    }
    finally {
      process.removeListener('SIGTERM', cancel)
      process.removeListener('SIGINT', cancel)
      app.removeListener('before-quit', quit)
      await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
      app.exit(exitCode)
    }
  }
}
