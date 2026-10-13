import type { IntegrationEntity, WorkItemDueDate } from 'craft-hub'
import type { IconName } from './icons'

const dateOnlyOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}
const dateOptions: Intl.DateTimeFormatOptions = {
  ...dateOnlyOptions,
  hour: 'numeric',
  minute: '2-digit',
}
const offsetPattern = /(?:Z|[+-]\d{2}:\d{2})$/i

/** Compare deadlines in their declared timezone; unknown offsetless zones are not guessed. */
export function isWorkItemOverdue(dueDate: WorkItemDueDate | undefined, now: number): boolean {
  if (!dueDate || !Number.isFinite(now))
    return false
  if (dueDate.precision === 'date') {
    const dueDay = dueDate.dateTime.slice(0, 10)
    const date = new Date(`${dueDay}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}T/.test(dueDate.dateTime) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dueDay)
      return false
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: dueDate.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
      const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === name)!.value
      return dueDay < `${part('year')}-${part('month')}-${part('day')}`
    }
    catch { return false }
  }
  if (offsetPattern.test(dueDate.dateTime))
    return new Date(dueDate.dateTime).getTime() < now
  const wallTime = new Date(`${dueDate.dateTime}Z`).getTime()
  if (!Number.isFinite(wallTime))
    return false
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: dueDate.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === name)!.value
    const localNow = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`) + now % 1000
    return wallTime < localNow
  }
  catch { return false }
}

function unavailable(locale: string): string {
  return locale === 'zh-CN' ? '日期不可用' : 'Date unavailable'
}

/** Display an instant in the user's local timezone without exposing the raw ISO value. */
export function formatWorkItemTimestamp(timestamp: string, locale: string): string {
  if (!offsetPattern.test(timestamp))
    return unavailable(locale)
  const instant = new Date(timestamp)
  return Number.isNaN(instant.getTime())
    ? unavailable(locale)
    : new Intl.DateTimeFormat(locale, dateOptions).format(instant)
}

/** Keep provider-local deadlines in their source timezone; unknown zones retain their wall time. */
export function formatWorkItemDueDate(dueDate: WorkItemDueDate, locale: string): string {
  const hasOffset = offsetPattern.test(dueDate.dateTime)
  const wallTime = new Date(`${dueDate.dateTime.replace(offsetPattern, '')}Z`)
  if (Number.isNaN(wallTime.getTime()))
    return unavailable(locale)

  let sourceZone = dueDate.timeZone
  let instant = wallTime
  let displayZone = 'UTC'
  try {
    const zoneFormat = new Intl.DateTimeFormat(locale, { timeZone: dueDate.timeZone, timeZoneName: 'longGeneric' })
    sourceZone = zoneFormat.formatToParts(wallTime).find(part => part.type === 'timeZoneName')?.value ?? dueDate.timeZone
    if (hasOffset && dueDate.precision !== 'date') {
      instant = new Date(dueDate.dateTime)
      displayZone = dueDate.timeZone
    }
  }
  catch {
    // Provider-specific timezone names remain readable without guessing an offset.
  }
  if (Number.isNaN(instant.getTime()))
    return unavailable(locale)
  const formatted = new Intl.DateTimeFormat(locale, { ...(dueDate.precision === 'date' ? dateOnlyOptions : dateOptions), timeZone: displayZone }).format(instant)
  return `${formatted} · ${sourceZone}`
}

/** Use semantic item kinds while retaining the provider's text labels. */
export function workItemTypeIcon(item: Pick<IntegrationEntity, 'type' | 'sourceRef'>): IconName {
  const kind = item.type?.id ?? item.sourceRef?.kind
  if (kind === 'bug' || kind === 'defect')
    return 'bug'
  if (kind === 'story' || kind === 'requirement')
    return 'story'
  if (kind === 'task' || kind === 'todo')
    return 'task'
  return 'list'
}

/** Pair workflow state with a stable, non-animated symbol. */
export function workItemStatusIcon(category: IntegrationEntity['statusCategory']): IconName {
  if (category === 'active')
    return 'progress'
  if (category === 'review')
    return 'review'
  if (category === 'testing')
    return 'experiment'
  if (category === 'releasing')
    return 'rocket'
  if (category === 'resolved' || category === 'done' || category === 'closed')
    return 'check'
  if (category === 'cancelled')
    return 'close'
  if (category === 'planning')
    return 'calendar'
  return 'pending'
}
