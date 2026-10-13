import type { IntegrationEntity, ProjectRecord, ResolvedIntegrationContribution, WorkbenchLocale } from 'craft-hub'

export { personalActiveWork } from 'craft-hub/work-items'

export interface HomeWorkSource {
  key: string
  integrationId: string
  viewId: string
  title: string
  icon?: string
  sectionTitle?: string
  actionId: string
  input: Record<string, unknown>
  connection?: { actionId: string, input: Record<string, unknown> }
}

export interface HomeWorkGroup {
  integrationId: string
  title: string
  sources: HomeWorkSource[]
}

/** Group lists by integration identity while preserving each list's read and navigation target. */
export function homeWorkGroups(sources: HomeWorkSource[]): HomeWorkGroup[] {
  const groups = new Map<string, HomeWorkGroup>()
  for (const source of sources) {
    const group = groups.get(source.integrationId)
    if (group)
      group.sources.push(source)
    else
      groups.set(source.integrationId, { integrationId: source.integrationId, title: source.title, sources: [source] })
  }
  return [...groups.values()]
}

/** Only unconfirmed, global reads may run when the overview opens. */
export function homeWorkSources(contributions: ResolvedIntegrationContribution[], locale: WorkbenchLocale): HomeWorkSource[] {
  const sources = new Map<string, HomeWorkSource>()
  for (const contribution of contributions) {
    for (const view of contribution.views) {
      if (view.scope === 'project')
        continue
      const connectionBlock = view.blocks.find((block) => {
        const action = contribution.actions.find(action => action.id === block.actionId)
        return block.type === 'connection-status' && !block.requiresProject && action?.operation === 'connection.status'
          && ['local-read', 'remote-read'].includes(action.effect) && action.effectiveConfirmation === 'never'
      })
      for (const block of view.blocks) {
        const action = contribution.actions.find(action => action.id === block.actionId)
        if (block.type !== 'entity-list' || block.requiresProject || action?.operation !== 'work-items.list' || !['local-read', 'remote-read'].includes(action.effect) || action.effectiveConfirmation !== 'never')
          continue
        const input = { ...block.input, ...(contribution.translations ? { locale } : {}) }
        const key = JSON.stringify([contribution.provider.id, contribution.id, action.id, Object.entries(input).sort(([left], [right]) => left.localeCompare(right))])
        if (!sources.has(key)) {
          sources.set(key, {
            key,
            integrationId: contribution.id,
            viewId: view.id,
            icon: view.icon,
            title: contribution.translations?.[locale]?.[view.title] ?? view.title,
            sectionTitle: contribution.translations?.[locale]?.[block.title ?? action.title] ?? block.title ?? action.title,
            actionId: action.id,
            input,
            ...(connectionBlock ? { connection: { actionId: connectionBlock.actionId, input: { ...connectionBlock.input, locale } } } : {}),
          })
        }
      }
    }
  }
  return [...sources.values()]
}

/** Prepare reviewable text without invoking an agent, inferring a project, or changing provider state. */
export function workHandoffText(options: {
  locale: WorkbenchLocale
  project?: Pick<ProjectRecord, 'id' | 'name' | 'path'>
  work?: { source: HomeWorkSource, item: IntegrationEntity }
  objective?: string
}): string {
  const label = (zh: string, en: string): string => options.locale === 'zh-CN' ? zh : en
  const lines = [label('Craft Hub 工作交接', 'Craft Hub work handoff')]
  if (options.work) {
    const { source, item } = options.work
    lines.push(`${label('事项', 'Work item')}: ${item.title}`, `${label('来源', 'Source')}: ${source.title} (${source.integrationId})`, `${label('事项 ID', 'Item ID')}: ${item.id}`)
    if (source.sectionTitle)
      lines.push(`${label('列表', 'List')}: ${source.sectionTitle}`)
    for (const key of ['workspaceId', 'type']) {
      if (item.metadata?.[key] !== undefined && item.metadata[key] !== null)
        lines.push(`${key}: ${item.metadata[key]}`)
    }
    if (item.sourceRef) {
      lines.push(`${label('来源账号', 'Source account')}: ${item.sourceRef.accountId}`, `${label('来源容器', 'Source container')}: ${item.sourceRef.containerId}`, `${label('事项类型', 'Item kind')}: ${item.sourceRef.kind}`)
      lines.push(`${label('完整来源身份', 'Complete source identity')}: ${JSON.stringify(item.sourceRef)}`)
    }
    if (item.dueDate)
      lines.push(`${label('截止时间', 'Due date')}: ${item.dueDate.dateTime} (${item.dueDate.timeZone})`)
    if (item.statusLabel || item.status)
      lines.push(`${label('当前状态', 'Current status')}: ${item.statusLabel || item.status}`)
    if (item.url) {
      try {
        const url = new URL(item.url)
        if (url.protocol === 'https:' && !url.username && !url.password)
          lines.push(`${label('原始链接', 'Source URL')}: ${url.href}`)
      }
      catch { /* A provider may omit a browser-safe source URL. */ }
    }
    if (item.description)
      lines.push(`\n${label('事项说明', 'Work item description')}:\n${item.description}`)
  }
  lines.push(options.project
    ? `\n${label('已选择的项目', 'Selected project')}: ${options.project.name}\n${label('项目 ID', 'Project ID')}: ${options.project.id}\n${label('本机路径', 'Local path')}: ${options.project.path}`
    : `\n${label('项目尚未选择，请先确认目标项目。', 'No project selected. Confirm the target project first.')}`)
  if (options.objective?.trim())
    lines.push(`\n${label('本次目标', 'Objective')}:\n${options.objective.trim()}`)
  lines.push(`\n${label('以上内容仅供交接。执行前核对项目、事项和操作权限；完成后提供结果摘要，回到原始来源确认状态更新。', 'Review the project, work item and permissions before execution. Provide a result summary when finished, then confirm any status update in the original source.')}`)
  return lines.join('\n')
}
