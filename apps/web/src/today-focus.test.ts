import type { FocusEntry } from './today-focus'
import { expect, it } from 'vitest'
import { rankTodayFocus } from './today-focus'

function entry(id: string, extra: Partial<FocusEntry['item']> = {}, source = 'tasks'): FocusEntry {
  return { source: { key: source, integrationId: source, actionId: 'list', input: {}, viewId: 'tasks', title: source }, item: { id, title: id, ...extra } }
}
it('combines providers, explains priorities and does not mistake matching native IDs for duplicates', () => {
  const input = [entry('low'), entry('same', { important: true }), entry('same', { priority: { label: 'P0', tone: 'danger' } }, 'projects'), entry('due', { dueDate: { dateTime: '2026-10-13T20:00:00Z', timeZone: 'UTC' } }), entry('waiting', { important: true, status: 'waitingOnOthers' })]
  const result = rankTodayFocus(input, Date.parse('2026-10-13T10:00:00Z'), true)
  expect(result.map(row => row.item.id)).toEqual(['due', 'same', 'same', 'waiting', 'low'])
  expect(result[0]!.reasons).toContain('24 小时内到期')
  expect(input[0]!.item).toEqual({ id: 'low', title: 'low' })
})
