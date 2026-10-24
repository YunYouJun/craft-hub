import type { IdentityMigrationResult, IdentityMigrationReview } from './identity-migration.ts'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { app, dialog } from 'electron'

/** Native source-owned consent. Caller input cannot supply an approval flag or a replacement recipient key. */
export async function confirmIdentityMigration(review: IdentityMigrationReview, signal?: AbortSignal): Promise<boolean> {
  await app.whenReady()
  if (signal?.aborted)
    return false
  app.focus({ steal: true })
  const migrating = review.kind === 'migrate'
  const paths = migrating ? review.profile.paths : review.recovery.paths
  const identity = migrating ? review.identity : review.recovery.identity
  const endpoint = migrating ? review.endpoint : review.recovery.identity.endpoint
  const origin = migrating ? review.webOrigin : review.recovery.identity.webOrigin
  const fingerprint = createHash('sha256').update(identity.publicKey).digest('hex')
  const label = migrating ? '迁移' : review.kind === 'recover' ? '恢复迁移' : '回退迁移'
  const decision = !migrating && review.kind === 'recover'
    ? review.recovery.decision === 'commit' ? '已有提交决定：恢复会完成原生资料和身份的提交。' : '尚未提交或已决定回退：恢复会保留源资料并恢复原来的原生资料。'
    : ''
  const detail = [
    `源应用：${review.peer.sourceApplication}`,
    `原生应用：${review.peer.application}`,
    `签名团队：${review.peer.team}`,
    `源数据：${paths.sourceData}`,
    `便携配置：${paths.sourceConfig}`,
    `原生资料：${paths.target}`,
    `云 API：${endpoint}`,
    `云站点：${origin}`,
    `设备：${identity.deviceId ?? '未登记'}`,
    `公钥指纹（SHA-256）：${fingerprint}`,
    migrating ? `复制 ${review.profile.runtime.length} 个运行时条目、${review.profile.config.length} 个配置条目，共 ${review.profile.bytes} 字节。排除 ${review.profile.excluded.length} 个浏览器或临时条目；加密身份通过专用通道转移。` : `事务：${review.recovery.transaction}`,
    decision,
    review.kind === 'rollback' ? '当前原生资料和后续编辑会保存在事务归档中，再恢复之前的原生资料。不会把新编辑合并回 Electron。' : '源资料会保留，成功迁移后源宿主停止写入；如需返回使用，应先完成回退。现有原生资料会保存在事务归档中。',
    '此操作不会启动账号同步、运行项目命令、授予项目信任或接管默认应用。保存审阅报告可查看完整条目、排除项和版本。',
  ].filter(Boolean).join('\n\n')
  while (!signal?.aborted) {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: `Craft Hub · ${label}`,
      message: `${label}资料与设备身份`,
      detail,
      buttons: ['取消', '保存审阅报告…', label],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: '我已退出两个宿主及所有旧版命令行进程',
      checkboxChecked: false,
      signal,
    })
    if (signal?.aborted || result.response === 0)
      return false
    if (result.response === 2)
      return result.checkboxChecked === true
    const destination = await dialog.showSaveDialog({
      title: '保存本机迁移审阅报告',
      defaultPath: 'craft-hub-migration-review.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!destination.canceled && destination.filePath && !signal?.aborted) {
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

/** Show the durable result only after the participant is closed and the coordinator has released its leases. */
export async function showIdentityMigrationResult(result: IdentityMigrationResult): Promise<void> {
  if (result.status === 'cancelled')
    return
  const completed = result.status === 'complete'
  const message = !completed
    ? '迁移需要恢复'
    : result.receipt.phase === 'complete'
      ? '资料与设备身份已迁移'
      : result.receipt.phase === 'rolled-back'
        ? '已恢复之前的原生资料'
        : result.receipt.phase === 'aborted' ? '迁移已取消，源资料已保留' : '请检查迁移结果'
  await dialog.showMessageBox({
    type: completed ? 'info' : 'warning',
    title: 'Craft Hub · 迁移结果',
    message,
    detail: completed
      ? `请保留事务目录：\n${result.receipt.transaction}\n\n完成迁移后，请在原生版检查项目、设置和插件；回退后可重新打开源宿主。`
      : `操作结果需要从持久事务重新确认。请保留这个目录，不要删除或手动改写其中的文件：\n\n${result.transaction}\n\n重新审阅并恢复该事务后，再打开日用宿主。`,
    buttons: ['关闭'],
    defaultId: 0,
  })
}
