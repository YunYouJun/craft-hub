import type { IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import { describe, expect, it } from 'vitest'
import { mergeIntegrationEntityPages } from './work-item-pagination'

function item(containerId: string, title = containerId): IntegrationEntity {
  return { id: '1', title, sourceRef: { providerId: 'tasks', instanceId: 'tasks', accountId: 'me', containerId, kind: 'task', itemId: '1' } }
}

describe('integration entity pagination', () => {
  it('preserves equal native IDs in different containers and updates duplicate source references', () => {
    const previous: IntegrationEntityPage = { currentUser: { id: 'me' }, items: [item('one')], nextCursor: 'next', coverage: 'partial' }
    const next: IntegrationEntityPage = { currentUser: { id: 'me' }, items: [item('one', 'Updated'), item('two')], coverage: 'complete', fetchedAt: '2026-10-12T01:00:00Z' }
    const merged = mergeIntegrationEntityPages(previous, next)
    expect(merged.identityChanged).toBe(false)
    expect(merged.page.items.map(item => item.title)).toEqual(['Updated', 'two'])
    expect(merged.page.nextCursor).toBeUndefined()
    expect(merged.page.coverage).toBe('complete')
    expect(merged.page.fetchedAt).toBe(next.fetchedAt)
  })

  it('keeps legacy scopes separate and does not infer complete coverage', () => {
    const previous = { items: [{ id: '1', title: 'One', metadata: { containerId: 'one' } }], nextCursor: 'next', coverage: 'partial' as const }
    const next = { items: [{ id: '1', title: 'Two', metadata: { containerId: 'two' } }] }
    const merged = mergeIntegrationEntityPages(previous, next)
    expect(merged.page.items).toHaveLength(2)
    expect(merged.page.coverage).toBeUndefined()
  })

  it.each([{ id: 'other' }, undefined])('replaces the old account page when the next identity is %j', (currentUser) => {
    const previous = { currentUser: { id: 'me' }, items: [item('one')] }
    const next = { currentUser, items: [item('two')] }
    expect(mergeIntegrationEntityPages(previous, next)).toEqual({ page: next, identityChanged: true })
  })
})
