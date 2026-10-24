import type { HomeWorkSource } from './home-work-sources'
import type { IntegrationEntityPage } from './integrations'
import type { CraftHubRuntime } from './runtime'
import type { WorkbenchLocale } from './settings'
import type { FocusEntry } from './today-focus'
import type { FocusCandidate } from './work-assistant'
import { createHash } from 'node:crypto'
import { homeWorkSources } from './home-work-sources'
import { focusCandidates, rankTodayFocus } from './today-focus'
import { personalActiveWork } from './work-items'

/** Read coverage for one declared global source; a missing account never becomes an empty success. */
export interface TodayFocusSource {
  key: string
  title: string
  sectionTitle?: string
  path: string
  state: 'loaded' | 'disconnected' | 'error'
  complete: boolean
  cached: boolean
  count: number
}

/** Small, read-only projection for native clients; source credentials, query inputs and local paths stay private. */
export interface TodayFocusSnapshot {
  version: 1
  checkedAt: string
  sourceCount: number
  total: number
  sources: TodayFocusSource[]
  items: {
    key: string
    title: string
    sourceTitle: string
    path: string
    reasons: string[]
    status?: string
    project?: string
  }[]
  candidates: FocusCandidate[]
}

type FocusRuntime = Pick<CraftHubRuntime, 'integrationContributions' | 'invokeIntegrationAction'>

function sourcePath(source: HomeWorkSource): string {
  return `/integrations/${encodeURIComponent(source.integrationId)}/${encodeURIComponent(source.viewId)}`
}

function opaqueKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Read at most forty source pages, four concurrently. Use the same discovery, personal-account filtering and
 * explainable ranking as the web client. This never paginates, authorizes, writes, or invokes AI automatically.
 */
export async function todayFocusSnapshot(runtime: FocusRuntime, locale: WorkbenchLocale, now = Date.now()): Promise<TodayFocusSnapshot> {
  const { integrations } = await runtime.integrationContributions()
  const catalog = homeWorkSources(integrations, locale)
  const sources: TodayFocusSource[] = []
  const entries: FocusEntry[] = []
  const read = async (source: HomeWorkSource): Promise<{ status: TodayFocusSource, entries: FocusEntry[] }> => {
    const status: TodayFocusSource = { key: opaqueKey(source.key), title: source.title, sectionTitle: source.sectionTitle, path: sourcePath(source), state: 'error', complete: false, cached: false, count: 0 }
    try {
      if (source.connection) {
        const connection = await runtime.invokeIntegrationAction({ integrationId: source.integrationId, actionId: source.connection.actionId, input: source.connection.input })
        if ('connected' in connection && connection.connected === false)
          return { status: { ...status, state: 'disconnected' }, entries: [] }
      }
      const result = await runtime.invokeIntegrationAction({ integrationId: source.integrationId, actionId: source.actionId, input: source.input })
      if (!('items' in result) || !Array.isArray(result.items) || 'configuration' in result)
        return { status, entries: [] }
      const page = result as IntegrationEntityPage
      const items = personalActiveWork(page)
      return {
        status: { ...status, state: 'loaded', complete: page.coverage === 'complete' && !page.nextCursor, cached: Boolean(page.cache), count: items.length },
        entries: items.map(item => ({ source, item })),
      }
    }
    catch {
      // Provider errors may contain private configuration. The source view provides its own diagnostic flow.
      return { status, entries: [] }
    }
  }
  const selected = catalog.slice(0, 40)
  for (let start = 0; start < selected.length; start += 4) {
    const values = await Promise.all(selected.slice(start, start + 4).map(read))
    for (const value of values) {
      sources.push(value.status)
      entries.push(...value.entries)
    }
  }
  const ranked = rankTodayFocus(entries, now, locale === 'zh-CN')
  const candidates = focusCandidates(ranked)
  const candidateKeys = new Set(candidates.map(candidate => candidate.key))
  return {
    version: 1,
    checkedAt: new Date(now).toISOString(),
    sourceCount: catalog.length,
    total: ranked.length,
    sources,
    items: ranked.filter(entry => candidateKeys.has(entry.key)).map(({ key, source, item, reasons }) => ({
      key: opaqueKey(key),
      title: item.title,
      sourceTitle: source.title,
      path: sourcePath(source),
      reasons,
      ...(item.statusLabel ? { status: item.statusLabel } : {}),
      ...(item.project ? { project: item.project.title } : {}),
    })),
    candidates: candidates.map(candidate => ({ ...candidate, key: opaqueKey(candidate.key) })),
  }
}
