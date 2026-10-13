import type { IntegrationEntity } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { workItemIdentityKey } from 'craft-hub/work-items'
import { isWorkItemOverdue } from './work-item-presentation'

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
