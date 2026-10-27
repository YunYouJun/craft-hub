import type { IntegrationEntityPage } from '../src/integrations'
import { expect, it } from 'vitest'
import { todayWorkBrowser } from '../src/today-work-browser'

it('preserves empty lists and classifies personal tasks in the source timezone without leaking account identities', () => {
  const page: IntegrationEntityPage = {
    currentUser: { id: 'private-account' },
    collections: [{ id: 'private-list', title: 'Tasks' }, { id: 'empty', title: 'Ideas' }],
    items: [{
      id: 'task',
      title: 'Review',
      important: true,
      sourceRef: { providerId: 'fixture', instanceId: 'installed', accountId: 'private-account', containerId: 'private-list', kind: 'task', itemId: 'task' },
      personalMembership: { accountId: 'private-account', relation: 'owned' },
      dueDate: { dateTime: '2026-10-26T00:00:00', timeZone: 'Asia/Tokyo', precision: 'date' },
      metadata: { token: 'private-token' },
    }, { id: 'other', title: 'Another account', assignees: [{ id: 'other' }] }, {
      id: 'done',
      title: 'Completed',
      statusCategory: 'done',
      assignees: [{ id: 'private-account' }],
    }],
  }
  const browser = todayWorkBrowser(page, Date.parse('2026-10-25T16:00:00Z'))
  expect(browser.collections).toHaveLength(2)
  expect(browser.items).toHaveLength(1)
  expect(browser.items[0]).toMatchObject({ title: 'Review', collectionKey: browser.collections[0]!.key, due: '2026-10-26', categories: ['important', 'planned', 'today'] })
  expect(JSON.stringify(browser)).not.toMatch(/private-account|private-list|private-token|Another account|Completed/)
  expect(todayWorkBrowser(page, Date.parse('2026-10-26T16:00:00Z')).items[0]!.categories).toEqual(['important', 'overdue', 'planned'])
  expect(todayWorkBrowser({ ...page, currentUser: undefined }, Date.now()).items).toEqual([])
  expect(todayWorkBrowser({ ...page, currentUser: { id: 'other-account' } }, Date.now()).accountKey).not.toBe(browser.accountKey)
})

it('groups project tasks by provider project identity and preserves unclassified work', () => {
  const browser = todayWorkBrowser({ currentUser: { id: 'me' }, items: [
    { id: 'one', title: 'First', project: { id: 'first', title: 'Project' }, assignees: [{ id: 'me' }] },
    { id: 'two', title: 'Second', project: { id: 'second', title: 'Project' }, assignees: [{ id: 'me' }] },
    { id: 'three', title: 'Unclassified', assignees: [{ id: 'me' }], reminderDate: { dateTime: '2026-10-26T12:00:00Z', timeZone: 'UTC' } },
  ] }, Date.now())
  expect(browser.projectMode).toBe(true)
  expect(browser.collections).toHaveLength(2)
  expect(browser.collections[0]!.key).not.toBe(browser.collections[1]!.key)
  expect(browser.items[2]).toMatchObject({ title: 'Unclassified', categories: ['planned'] })
  expect(browser.items[2]!.collectionKey).toBeUndefined()
})
