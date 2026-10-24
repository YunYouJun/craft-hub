import type { HomeWorkSource } from './home-work-sources'
import type { IntegrationEntity } from './integrations'
import type { FocusCandidate } from './work-assistant'
import { isWorkItemOverdue, workItemIdentityKey } from './work-items'

export interface FocusEntry { source: HomeWorkSource, item: IntegrationEntity }
export interface RankedFocus extends FocusEntry { key: string, score: number, reasons: string[] }

/** Explainable baseline ranking; original priorities and source records are never changed. */
export function rankTodayFocus(entries: FocusEntry[], now: number, zh: boolean): RankedFocus[] {
  const seen = new Set<string>()
  const say = (cn: string, en: string): string => zh ? cn : en
  return entries.flatMap(({ source, item }) => {
    const key = item.sourceRef ? workItemIdentityKey(item) : `${source.key}:${workItemIdentityKey(item)}`
    if (seen.has(key))
      return []
    seen.add(key)
    let score = 0
    const reasons: string[] = []
    if (isWorkItemOverdue(item.dueDate, now)) {
      score += 70
      reasons.push(say('已逾期', 'Overdue'))
    }
    else if (item.dueDate && isWorkItemOverdue(item.dueDate, now + 24 * 60 * 60 * 1000)) {
      score += 85
      reasons.push(say('24 小时内到期', 'Due within 24 hours'))
    }
    else if (item.dueDate && isWorkItemOverdue(item.dueDate, now + 3 * 24 * 60 * 60 * 1000)) {
      score += 35
      reasons.push(say('3 天内到期', 'Due within 3 days'))
    }
    if (item.important) {
      score += 40
      reasons.push(say('已标记重要', 'Marked important'))
    }
    if (item.priority?.tone === 'danger') {
      score += 60
      reasons.push(say(`来源优先级：${item.priority.label}`, `Source priority: ${item.priority.label}`))
    }
    else if (!item.important && item.priority?.tone === 'warning') {
      score += 30
      reasons.push(say(`来源优先级：${item.priority.label}`, `Source priority: ${item.priority.label}`))
    }
    if (['active', 'review', 'testing'].includes(item.statusCategory ?? '')) {
      score += 15
      reasons.push(say('正在推进', 'In progress'))
    }
    if (item.status === 'waitingOnOthers') {
      score -= 25
      reasons.push(say('等待他人，可先跟进', 'Waiting on others; follow up'))
    }
    if (item.status === 'deferred') {
      score -= 60
      reasons.push(say('已暂缓', 'Deferred'))
    }
    if (!reasons.length)
      reasons.push(say('尚无截止时间或高优先级信号', 'No deadline or high-priority signal'))
    return [{ source, item, key, score, reasons }]
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
}

/** Send bounded task facts to analysis without local paths or source credentials. */
export function focusCandidates(entries: RankedFocus[]): FocusCandidate[] {
  // Reserve room for each integration before filling the remaining slots by score.
  const groups = new Map<string, RankedFocus[]>()
  for (const entry of entries) {
    const group = groups.get(entry.source.integrationId) ?? []
    group.push(entry)
    groups.set(entry.source.integrationId, group)
  }
  const selected = new Map<string, RankedFocus>()
  const quota = Math.max(1, Math.floor(40 / Math.max(groups.size, 1)))
  for (const group of groups.values()) {
    for (const entry of group.slice(0, quota)) selected.set(entry.key, entry)
  }
  for (const entry of entries) {
    if (selected.size >= 80)
      break
    selected.set(entry.key, entry)
  }
  return [...selected.values()].slice(0, 80).map(({ key, source, item, reasons }) => ({ key, title: item.title.slice(0, 1000), source: source.title.slice(0, 300), reasons, ...(item.project ? { project: item.project.title.slice(0, 500) } : {}), ...(item.statusLabel ? { status: item.statusLabel.slice(0, 200) } : {}), ...(item.priority ? { priority: item.priority.label.slice(0, 200) } : {}), ...(item.dueDate ? { due: `${item.dueDate.precision === 'date' ? item.dueDate.dateTime.slice(0, 10) : item.dueDate.dateTime} (${item.dueDate.timeZone})` } : {}) }))
}
