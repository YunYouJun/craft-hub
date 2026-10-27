import type { IntegrationEntityPage } from '../src/integrations'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { todayWorkBrowser } from '../src/today-work-browser'
import { workItemActionTarget } from '../src/work-item-action-target'

it('retains native routing and status without forwarding descriptions or arbitrary provider metadata', () => {
  const page: IntegrationEntityPage = {
    currentUser: { id: 'account' },
    items: [{
      id: 'work',
      title: 'Review draft',
      status: 'active',
      statusLabel: 'In progress',
      statusUpdateAvailable: true,
      assignees: [{ id: 'account' }],
      description: '<p>Full detail</p>',
      metadata: { workspaceId: 'space', type: 'story', token: 'not-for-overview', arbitrary: 'private' },
    }],
  }
  const target = workItemActionTarget(page.items[0]!, page, { integrationId: 'work', connectionCacheKey: 'session' })
  expect(target).toMatchObject({ integrationId: 'work', connectionCacheKey: 'session', readOnly: false, item: {
    id: 'work',
    title: 'Review draft',
    status: 'active',
    statusLabel: 'In progress',
    active: true,
    personal: true,
    statusUpdateAvailable: true,
    metadata: { workspaceId: 'space', type: 'story' },
  } })
  expect(target.accountKey).toBe(createHash('sha256').update('account').digest('hex'))
  expect(JSON.stringify(target)).not.toMatch(/Full detail|not-for-overview|private|description/)
})

it('scopes same-ID items to their provider identity and preserves cached readonly state', () => {
  const sourceRef = { providerId: 'provider', instanceId: 'work', accountId: 'account', containerId: 'one', kind: 'task' as const, itemId: 'same' }
  const page: IntegrationEntityPage = { currentUser: { id: 'account' }, cache: { reason: 'offline', readOnly: true }, items: [
    { id: 'same', title: 'First', sourceRef, personalMembership: { accountId: 'account', relation: 'owned' } },
    { id: 'same', title: 'Second', sourceRef: { ...sourceRef, containerId: 'two' }, personalMembership: { accountId: 'account', relation: 'owned' } },
  ] }
  const browser = todayWorkBrowser(page, Date.now(), { integrationId: 'work' })
  expect(browser.items).toHaveLength(2)
  expect(browser.items[0]!.actionTarget).toMatchObject({ readOnly: true, item: { sourceRef } })
  expect(browser.items[0]!.actionTarget!.item.key).not.toBe(browser.items[1]!.actionTarget!.item.key)
  expect(browser.items.map(item => item.actionTarget!.item.key)).toEqual(browser.items.map(item => item.key))
})
