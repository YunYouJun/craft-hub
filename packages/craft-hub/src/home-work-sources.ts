import type { ResolvedIntegrationContribution } from './integrations'
import type { WorkbenchLocale } from './settings'

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
        const connection = connectionBlock ? { actionId: connectionBlock.actionId, input: { ...connectionBlock.input, locale } } : undefined
        const key = JSON.stringify([
          contribution.pluginId,
          contribution.provider.id,
          contribution.providerVersion,
          contribution.id,
          action.id,
          Object.entries(input).sort(([left], [right]) => left.localeCompare(right)),
          connection && [connection.actionId, Object.entries(connection.input).sort(([left], [right]) => left.localeCompare(right))],
        ])
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
            ...(connection ? { connection } : {}),
          })
        }
      }
    }
  }
  return [...sources.values()]
}
