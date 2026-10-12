import type { WorkItemDueDate } from 'craft-hub'

const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
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
    if (hasOffset) {
      instant = new Date(dueDate.dateTime)
      displayZone = dueDate.timeZone
    }
  }
  catch {
    // Provider-specific timezone names remain readable without guessing an offset.
  }
  if (Number.isNaN(instant.getTime()))
    return unavailable(locale)
  const formatted = new Intl.DateTimeFormat(locale, { ...dateOptions, timeZone: displayZone }).format(instant)
  return `${formatted} · ${sourceZone}`
}
