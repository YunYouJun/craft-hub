import type { IntegrationEntity, WorkItemDueDate } from 'craft-hub'
import type { IconName } from './icons'

export { isWorkItemDueToday, isWorkItemOverdue } from 'craft-hub/work-items'

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
