import { describe, expect, it } from 'vitest'
import { formatWorkItemDueDate, formatWorkItemTimestamp } from './work-item-presentation'

describe('work item dates', () => {
  it('keeps a local deadline at its provider wall time in either UI language', () => {
    const due = { dateTime: '2026-10-12T09:30:00', timeZone: 'Asia/Shanghai' }
    expect(formatWorkItemDueDate(due, 'en')).toContain('9:30')
    expect(formatWorkItemDueDate(due, 'zh-CN')).toContain('9:30')
    expect(formatWorkItemDueDate(due, 'en')).not.toContain(due.dateTime)
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
