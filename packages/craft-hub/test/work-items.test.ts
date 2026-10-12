import type { IntegrationEntity } from '../src/integrations'
import type { WorkItemSourceRef } from '../src/work-items'
import { describe, expect, it } from 'vitest'
import {
  isPersonalWorkItem,
  personalActiveWork,
  workItemActionInput,
  workItemContainerKey,
  workItemContainerRefSchema,
  workItemDueDateSchema,
  workItemFieldsSchema,
  workItemIdentityKey,
  workItemPageFieldsSchema,
  workItemPersonalMembershipSchema,
  workItemSourceKey,
  workItemSourceRefSchema,
} from '../src/work-items'

function sourceRef(overrides: Partial<WorkItemSourceRef> = {}): WorkItemSourceRef {
  return { providerId: 'example', instanceId: 'example-tools', accountId: 'account-1', containerId: 'list-1', kind: 'task', itemId: 'item-1', ...overrides }
}

function ownedItem(overrides: Partial<IntegrationEntity> = {}): IntegrationEntity {
  return {
    id: '1',
    title: 'Review proposal',
    sourceRef: sourceRef(),
    personalMembership: { accountId: 'account-1', relation: 'owned' },
    ...overrides,
  }
}

describe('work-item identities', () => {
  it('validates strict complete source and typed container identities without normalizing native IDs', () => {
    const ref = sourceRef({ accountId: ' Account 1 ', itemId: 'opaque:/item?x=a|b' })
    expect(workItemSourceRefSchema.parse(ref)).toEqual(ref)
    const { itemId: _itemId, ...container } = ref
    expect(workItemContainerRefSchema.parse(container)).toEqual(container)
    expect(() => workItemContainerRefSchema.parse(ref)).toThrow()
    expect(() => workItemSourceRefSchema.parse({ ...ref, unexpected: true })).toThrow()
    expect(() => workItemSourceRefSchema.parse({ ...ref, containerId: undefined })).toThrow()
    for (const value of ['', 'x'.repeat(513), 'id\nnext', 'id\0next', 'id\x7Fnext', 'id\u0085next'])
      expect(() => workItemSourceRefSchema.parse(sourceRef({ itemId: value }))).toThrow()
  })

  it('keeps identical native IDs independent across providers, installations, accounts, containers and kinds', () => {
    const ref = sourceRef()
    const keys = new Set([
      workItemSourceKey(ref),
      ...Object.keys(ref).map(key => workItemSourceKey({ ...ref, [key]: `${ref[key as keyof WorkItemSourceRef]}-other` })),
    ])
    expect(keys.size).toBe(7)
    expect(workItemSourceKey(sourceRef({ containerId: 'a|b', kind: 'c' })))
      .not
      .toBe(workItemSourceKey(sourceRef({ containerId: 'a', kind: 'b|c' })))
    const { itemId: _itemId, ...container } = ref
    expect(workItemContainerKey(container)).not.toBe(workItemContainerKey({ ...container, kind: 'issue' }))
  })

  it('uses source identity rather than display title or ID and keeps legacy scope only for display', () => {
    expect(workItemIdentityKey(ownedItem())).toBe(workItemIdentityKey(ownedItem({ id: 'display-2', title: 'Renamed' })))
    expect(workItemIdentityKey({ id: '1', title: 'Legacy', metadata: { workspaceId: 'workspace', containerId: 'list-1' } }))
      .not
      .toBe(workItemIdentityKey({ id: '1', title: 'Legacy', metadata: { workspaceId: 'workspace', containerId: 'list-2' } }))
    expect(workItemIdentityKey({ id: '1', title: 'Legacy' })).not.toBe(workItemIdentityKey(ownedItem()))
  })

  it('forwards native item identity and complete scope while preserving legacy action inputs', () => {
    const item = ownedItem({ id: 'display-1', metadata: { type: 'task', itemId: 'metadata-id' } })
    expect(workItemActionInput(item)).toEqual({ type: 'task', itemId: 'item-1', sourceRef: sourceRef() })
    expect(workItemActionInput({ id: 'legacy-1', title: 'Legacy', metadata: { workspaceId: 'one', type: 'issue', itemId: 'metadata-id' } }))
      .toEqual({ workspaceId: 'one', type: 'issue', itemId: 'legacy-1' })
    expect(workItemActionInput({ id: 'legacy-2', title: 'Legacy' })).toEqual({ itemId: 'legacy-2' })
    expect(item.metadata?.itemId).toBe('metadata-id')
  })
})

describe('work-item presentation contracts', () => {
  it('keeps local due dates and timezone labels while requiring valid instant timestamps', () => {
    expect(workItemDueDateSchema.parse({ dateTime: '2026-10-15T18:00:00.0000000', timeZone: 'Pacific Standard Time' }))
      .toEqual({ dateTime: '2026-10-15T18:00:00.0000000', timeZone: 'Pacific Standard Time' })
    expect(workItemFieldsSchema.parse({ dueDate: { dateTime: '2026-10-15T18:00:00+08:00', timeZone: 'Asia/Shanghai' }, updatedAt: '2026-10-12T05:00:00Z' })).toMatchObject({ updatedAt: '2026-10-12T05:00:00Z' })
    for (const value of ['2026-02-30T00:00:00', '2026-10-15T25:00:00', 'not-a-date'])
      expect(() => workItemDueDateSchema.parse({ dateTime: value, timeZone: 'UTC' })).toThrow()
    expect(() => workItemDueDateSchema.parse({ dateTime: '2026-10-15T18:00:00', timeZone: '' })).toThrow()
    expect(() => workItemFieldsSchema.parse({ updatedAt: '2026-10-12T05:00:00' })).toThrow()
    expect(() => workItemDueDateSchema.parse({ dateTime: '2026-10-15T18:00:00', timeZone: 'UTC', offset: 0 })).toThrow()
  })

  it('validates declared personal relationships and page coverage without manufacturing legacy metadata', () => {
    expect(workItemFieldsSchema.parse({ id: 'old', title: 'Legacy' })).toEqual({ id: 'old', title: 'Legacy' })
    expect(workItemPageFieldsSchema.parse({ items: [], nextCursor: 'opaque://cursor?native=1', coverage: 'partial', fetchedAt: '2026-10-12T05:00:00Z' })).toMatchObject({ coverage: 'partial' })
    expect(() => workItemPageFieldsSchema.parse({ coverage: 'all' })).toThrow()
    expect(() => workItemPageFieldsSchema.parse({ fetchedAt: 'yesterday' })).toThrow()
    expect(() => workItemPersonalMembershipSchema.parse({ accountId: 'account-1', relation: 'watching' })).toThrow()
    expect(() => workItemPersonalMembershipSchema.parse({ accountId: 'account-1', relation: 'owned', label: 'Me' })).toThrow()
    expect(() => workItemFieldsSchema.parse(ownedItem({ personalMembership: { accountId: 'account-2', relation: 'owned' } }))).toThrow(/source account/)
  })
})

describe('personal work matching', () => {
  it('accepts owned and assigned source items without fabricating legacy assignees, including unknown statuses', () => {
    const owned = ownedItem({ statusCategory: 'unknown' })
    const assigned = ownedItem({ id: '2', sourceRef: sourceRef({ itemId: 'item-2' }), personalMembership: { accountId: 'account-1', relation: 'assigned' }, statusCategory: 'active' })
    const unknown = ownedItem({ id: '3', sourceRef: sourceRef({ itemId: 'item-3' }), personalMembership: { accountId: 'account-1', relation: 'unknown' }, assignees: [{ id: 'account-1' }] })
    expect(personalActiveWork({ items: [owned, assigned, unknown], currentUser: { id: 'account-1' } })).toEqual([owned, assigned])
    expect(owned.assignees).toBeUndefined()
  })

  it('requires the source account, membership and current identity to agree and rejects missing identities', () => {
    const item = ownedItem()
    expect(personalActiveWork({ items: [item] })).toEqual([])
    expect(personalActiveWork({ items: [item], currentUser: { id: 'account-2' } })).toEqual([])
    expect(isPersonalWorkItem(ownedItem({ sourceRef: sourceRef({ accountId: 'account-2' }), assignees: [{ id: 'account-1' }] }), { id: 'account-1' })).toBe(false)
    expect(isPersonalWorkItem(ownedItem({ personalMembership: { accountId: 'account-2', relation: 'owned' } }), { id: 'account-1' })).toBe(false)
    expect(isPersonalWorkItem(ownedItem({ sourceRef: undefined, assignees: [{ id: 'account-1' }] }), { id: 'account-1' })).toBe(false)
  })

  it('keeps legacy exact-assignee matching and sourced legacy assignments account-isolated', () => {
    const legacy = { id: 'old', title: 'Legacy task', assignees: [{ id: 'account-1' }] }
    const sourced = ownedItem({ personalMembership: undefined, assignees: [{ id: 'account-1' }] })
    expect(personalActiveWork({ items: [legacy, sourced], currentUser: { id: 'account-1' } })).toEqual([legacy, sourced])
    expect(isPersonalWorkItem({ ...legacy, assignees: [{ id: 'Account-1' }] }, { id: 'account-1' })).toBe(false)
    expect(isPersonalWorkItem({ ...sourced, sourceRef: sourceRef({ accountId: 'account-2' }) }, { id: 'account-1' })).toBe(false)
  })

  it('excludes archived and terminal items, and deduplicates complete identities while retaining other containers', () => {
    const active = ownedItem()
    const otherContainer = ownedItem({ sourceRef: sourceRef({ containerId: 'list-2' }) })
    const done = ownedItem({ statusCategory: 'done' })
    const archived = ownedItem({ archived: true })
    const page = { items: [active, { ...active, title: 'Duplicate' }, otherContainer, done, archived], currentUser: { id: 'account-1' } }
    expect(isPersonalWorkItem(done, page.currentUser)).toBe(true)
    expect(personalActiveWork(page)).toEqual([active, otherContainer])
  })
})
