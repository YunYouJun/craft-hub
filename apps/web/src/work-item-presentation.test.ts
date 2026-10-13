import { describe, expect, it } from 'vitest'
import { formatWorkItemDueDate, formatWorkItemTimestamp, isWorkItemOverdue } from './work-item-presentation'

describe('work item dates', () => {
  it('keeps a local deadline at its provider wall time in either UI language', () => {
    const due = { dateTime: '2026-10-12T09:30:00', timeZone: 'Asia/Shanghai' }
    expect(formatWorkItemDueDate(due, 'en')).toContain('9:30')
    expect(formatWorkItemDueDate(due, 'zh-CN')).toContain('9:30')
    expect(formatWorkItemDueDate(due, 'en')).not.toContain(due.dateTime)
  })

  it('displays whole-day deadlines without manufacturing a midnight cutoff', () => {
    const due = { dateTime: '2026-10-13T00:00:00', timeZone: 'Asia/Shanghai', precision: 'date' as const }
    for (const locale of ['en', 'zh-CN']) {
      const formatted = formatWorkItemDueDate(due, locale)
      expect(formatted).toContain('2026')
      expect(formatted).toContain('13')
      expect(formatted).not.toMatch(/\d+:\d+/)
    }
    const withOffset = formatWorkItemDueDate({ ...due, dateTime: '2026-10-13T00:00:00+08:00', timeZone: 'America/New_York' }, 'en')
    expect(withOffset).toContain('Oct 13, 2026')
    expect(withOffset).not.toMatch(/\d+:\d+/)
  })

  it('converts an explicit instant only to a recognized provider timezone', () => {
    expect(formatWorkItemDueDate({ dateTime: '2026-10-12T01:30:00Z', timeZone: 'Asia/Shanghai' }, 'en')).toContain('9:30')
    expect(formatWorkItemDueDate({ dateTime: '2026-10-12T09:30:00+08:00', timeZone: 'UTC' }, 'en')).toContain('1:30')
  })

  it('preserves wall time and source names for provider-specific zones instead of guessing an offset', () => {
    const due = { dateTime: '2026-10-12T09:30:00+08:00', timeZone: 'Provider Standard Time' }
    const formatted = formatWorkItemDueDate(due, 'en')
    expect(formatted).toContain('9:30')
    expect(formatted).toContain(due.timeZone)
    expect(formatted).not.toContain(due.dateTime)
    expect(formatWorkItemDueDate({ ...due, dateTime: '2026-10-12T09:30:00' }, 'en')).toContain('9:30')
  })

  it('does not infer a local deadline offset around daylight saving transitions', () => {
    const before = formatWorkItemDueDate({ dateTime: '2026-03-08T01:30:00', timeZone: 'America/New_York' }, 'en')
    const after = formatWorkItemDueDate({ dateTime: '2026-03-08T03:30:00', timeZone: 'America/New_York' }, 'en')
    expect(before).toContain('1:30')
    expect(after).toContain('3:30')
    expect(before).toContain('Eastern Time')
    expect(after).toContain('Eastern Time')
  })

  it('formats fetched instants in local time and safely handles invalid or unspecified instants', () => {
    const timestamp = '2026-10-12T01:00:00Z'
    const formatted = formatWorkItemTimestamp(timestamp, 'en')
    expect(formatted).toContain('2026')
    expect(formatted).not.toContain(timestamp)
    expect(formatWorkItemTimestamp('invalid', 'en')).toBe('Date unavailable')
    expect(formatWorkItemTimestamp('2026-10-12T01:00:00', 'zh-CN')).toBe('日期不可用')
    expect(formatWorkItemDueDate({ dateTime: 'invalid', timeZone: 'UTC' }, 'en')).toBe('Date unavailable')
  })
})

describe('overdue work categories', () => {
  const now = Date.parse('2026-10-13T02:00:00Z')
  it('compares explicit instants and provider wall times independently of the host timezone', () => {
    expect(isWorkItemOverdue({ dateTime: '2026-10-13T09:00:00', timeZone: 'Asia/Shanghai' }, now)).toBe(true)
    expect(isWorkItemOverdue({ dateTime: '2026-10-13T09:00:00', timeZone: 'UTC' }, now)).toBe(false)
    expect(isWorkItemOverdue({ dateTime: '2026-10-13T09:00:00+08:00', timeZone: 'Unknown' }, now)).toBe(true)
    expect(isWorkItemOverdue({ dateTime: '2026-10-13T02:00:00.0000000', timeZone: 'UTC' }, now)).toBe(false)
    expect(isWorkItemOverdue({ dateTime: '2026-10-13T02:00:00Z', timeZone: 'UTC' }, now + 1)).toBe(true)
  })

  it('keeps whole-day deadlines current until the next day starts in the provider timezone', () => {
    const due = { dateTime: '2026-10-13T00:00:00', timeZone: 'Asia/Shanghai', precision: 'date' as const }
    expect(isWorkItemOverdue(due, Date.parse('2026-10-12T16:00:00Z'))).toBe(false)
    expect(isWorkItemOverdue(due, now)).toBe(false)
    expect(isWorkItemOverdue(due, Date.parse('2026-10-13T15:59:59.999Z'))).toBe(false)
    expect(isWorkItemOverdue(due, Date.parse('2026-10-13T16:00:00Z'))).toBe(true)
    expect(isWorkItemOverdue({ ...due, timeZone: 'America/New_York' }, Date.parse('2026-10-13T16:00:00Z'))).toBe(false)
    expect(isWorkItemOverdue({ ...due, precision: 'datetime' }, now)).toBe(true)
  })

  it('does not guess a source timezone or normalize an invalid whole-day deadline', () => {
    const due = { dateTime: '2026-10-12T00:00:00', timeZone: 'Provider Standard Time', precision: 'date' as const }
    expect(isWorkItemOverdue(due, now)).toBe(false)
    expect(isWorkItemOverdue({ ...due, dateTime: '2026-02-30T00:00:00', timeZone: 'UTC' }, now)).toBe(false)
    expect(isWorkItemOverdue({ ...due, dateTime: 'invalid', timeZone: 'UTC' }, now)).toBe(false)
  })
  it('keeps unrecognized deadlines out of overdue results rather than guessing', () => {
    expect(isWorkItemOverdue(undefined, now)).toBe(false)
    expect(isWorkItemOverdue({ dateTime: 'invalid', timeZone: 'UTC' }, now)).toBe(false)
    expect(isWorkItemOverdue({ dateTime: '2026-10-12T00:00:00', timeZone: 'Provider Standard Time' }, now)).toBe(false)
  })
})
