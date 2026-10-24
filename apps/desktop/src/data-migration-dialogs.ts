import type { DataMigrationCommand, DataMigrationResult, DataMigrationReview } from './data-migration.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalProfilePath } from 'craft-hub'
import { app, dialog } from 'electron'

/** Select a destination or existing data-only transaction; selecting never approves a write. */
export async function chooseDataMigration(signal: AbortSignal): Promise<DataMigrationCommand | undefined> {
  if (signal.aborted)
    return undefined
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: 'Craft Hub · 普通资料迁移',
    message: '迁移不含设备身份的资料',
    detail: '复制项目、设置和便携配置，保留源资料及原生版已有资料。包含加密设备身份或身份迁移保护的资料必须使用身份迁移流程，不能通过这里绕过。',
    buttons: ['取消', '复制到原生版…', '恢复已有复制…', '回退已有复制…'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    signal,
  })
  const action = [undefined, 'migrate-data', 'recover-data', 'rollback-data'][choice.response]
  if (signal.aborted || (action !== 'migrate-data' && action !== 'recover-data' && action !== 'rollback-data'))
    return undefined
  const selection = await dialog.showOpenDialog({
    title: action === 'migrate-data' ? '选择原生版资料目录' : '选择已有普通资料事务',
    message: action === 'migrate-data' ? '选择原生版使用的资料根目录。下一步只读检查并展示完整路径和复制范围。' : '选择复制回执中的事务目录。向导将核对源资料、候选资料和归档。',
    ...(action === 'migrate-data' ? { defaultPath: join(app.getPath('appData'), 'Craft Hub Prototype') } : {}),
    properties: action === 'migrate-data' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  })
  if (signal.aborted || selection.canceled || selection.filePaths.length !== 1)
    return undefined
  const path = await canonicalProfilePath(selection.filePaths[0]!)
  if (signal.aborted)
    return undefined
  return action === 'migrate-data' ? { version: 1, action, targetProfile: path } : { version: 1, action, transaction: path }
}

/** Confirm immutable metadata with a stopped-host acknowledgement; reports never overwrite an existing file. */
export async function confirmDataMigration(review: DataMigrationReview, signal: AbortSignal): Promise<boolean> {
  const copying = review.kind === 'migrate-data'
  const paths = copying ? review.profile.paths : review.recovery.paths
  const label = copying ? '复制资料' : review.kind === 'recover-data' ? '恢复复制' : '回退复制'
  const detail = [
    `源数据：${paths.sourceData}`,
    `便携配置：${paths.sourceConfig}`,
    `原生资料：${paths.target}`,
    copying
      ? `审阅范围：${review.profile.runtime.length} 个运行时条目、${review.profile.config.length} 个配置条目和 ${review.profile.target.length} 个现有候选条目，共 ${review.profile.bytes} 字节；排除 ${review.profile.excluded.length} 个浏览器或临时条目。`
      : `事务：${review.recovery.transaction}`,
    copying
      ? '源资料保留，原生版已有资料归档，尚未发送的原生草稿保留。两个宿主的数据之后不会自动合并。'
      : review.kind === 'rollback-data'
        ? '归档当前原生资料及后续编辑，再恢复之前的原生资料。后续编辑不会合并回源宿主。'
        : '根据已有事务和目录状态完成复制或恢复之前的原生资料。无法确认的状态将保留供人工处理。',
    '不会转移设备身份、启动账号同步、加载插件、运行命令、改变项目信任或接管默认应用。保存审阅报告可查看完整条目和版本。',
  ].join('\n\n')
  while (!signal.aborted) {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: `Craft Hub · ${label}`,
      message: label,
      detail,
      buttons: ['取消', '保存审阅报告…', label],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: '我已退出两个日用宿主及所有旧版命令行进程',
      checkboxChecked: false,
      signal,
    })
    if (signal.aborted || result.response === 0)
      return false
    if (result.response === 2)
      return result.checkboxChecked === true
    if (result.response !== 1)
      return false
    const destination = await dialog.showSaveDialog({ title: '保存普通资料审阅报告', defaultPath: 'craft-hub-data-migration-review.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (!destination.canceled && destination.filePath && !signal.aborted) {
      try {
        await writeFile(destination.filePath, `${JSON.stringify(review, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      }
      catch {
        await dialog.showMessageBox({ type: 'error', message: '无法保存审阅报告', detail: '请选一个新的本机文件名；已有文件不会被覆盖。', buttons: ['返回审阅'], signal })
      }
    }
  }
  return false
}

/** Display only the settled receipt or retained recovery location after all profile leases are released. */
export async function showDataMigrationResult(result: DataMigrationResult, signal: AbortSignal): Promise<void> {
  if (result.status === 'cancelled' || signal.aborted)
    return
  if (result.status === 'blocked') {
    await dialog.showMessageBox({
      type: 'warning',
      message: '资料尚不能复制',
      detail: `只读检查发现 ${result.blockers.length} 项需处理的问题，尚未修改资料：\n\n${result.blockers.slice(0, 8).map(value => value.slice(0, 500).replace(/\p{Cc}/gu, ' ')).join('\n\n')}\n\n加密设备身份请使用身份迁移流程；修复其他问题后重新审阅。`,
      buttons: ['关闭'],
      signal,
    })
    return
  }
  const completed = result.status === 'complete'
  const transaction = completed ? result.receipt.transaction : result.transaction
  await dialog.showMessageBox({
    type: completed ? 'info' : 'warning',
    message: completed
      ? result.receipt.phase === 'complete' ? '资料复制已完成' : result.receipt.phase === 'rolled-back' ? '已恢复之前的原生资料' : '复制已取消，原有资料保留'
      : '请重新审阅并恢复复制事务',
    detail: `请保留事务目录：\n${transaction}\n\n${completed ? '源资料保留。开始日用前，请在原生版检查项目、设置和插件。' : '现有文件与归档已保留。不要删除或手动改写事务，从迁移向导重新选择此目录并恢复。'}`,
    buttons: ['关闭'],
    signal,
  })
}
