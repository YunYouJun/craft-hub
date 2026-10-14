import { describe, expect, it, vi } from 'vitest'
import { captureDueInstant, localDateTime, parseQuickCapture } from './quick-capture'

const now = new Date(2026, 9, 13, 10, 0)
const lists = [{ id: 'work', title: '工作' }, { id: 'life', title: '生活' }]
describe('quick capture', () => {
  it('extracts a reviewed deadline, explicit list and importance without changing meaning', () => {
    expect(parseQuickCapture('明天下午三点跟进发布 #工作 !重要', lists, now)).toMatchObject({ title: '跟进发布', listId: 'work', dueLocal: '2026-10-14T15:00', important: true, remind: true })
    expect(parseQuickCapture('下周一上午九点半整理反馈', lists, now)).toMatchObject({ title: '整理反馈', dueLocal: '2026-10-19T09:30' })
    expect(parseQuickCapture('tomorrow 15:30 review', lists, now)).toMatchObject({ title: 'review', dueLocal: '2026-10-14T15:30' })
  })
  it('uses end of day only for explicit dates and leaves vague tasks unscheduled', () => {
    expect(parseQuickCapture('明天寄快递', lists, now)).toMatchObject({ dueLocal: '2026-10-14T23:59', remind: false })
    expect(parseQuickCapture('看看新设计', lists, now).dueLocal).toBeNull()
    expect(parseQuickCapture('今晚提醒我买水果', lists, now).warnings.length).toBeGreaterThan(0)
  })
  it('does not normalize invalid dates or times and round-trips local wall time', () => {
    expect(parseQuickCapture('2026-02-30 18:00 发布', lists, now).dueLocal).toBeNull()
    expect(parseQuickCapture('明天25:00发布', lists, now).dueLocal).toBeNull()
    expect(() => captureDueInstant('2026-02-30T18:00')).toThrow()
    expect(localDateTime(new Date(captureDueInstant('2026-10-14T15:00')!))).toBe('2026-10-14T15:00')
  })
  it('keeps a deadline in a daylight-saving gap unscheduled for review', () => {
    vi.stubEnv('TZ', 'America/New_York')
    try {
      const draft = parseQuickCapture('today 02:30 review', lists, new Date(2026, 2, 8, 0, 0))
      expect(draft.dueLocal).toBeNull()
      expect(draft.title).toBe('today 02:30 review')
      expect(draft.warnings.length).toBeGreaterThan(0)
    }
    finally {
      vi.unstubAllEnvs()
    }
  })
})
