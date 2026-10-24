import type { IntegrationEntity, IntegrationEntityPage } from './integrations'
import { z } from 'zod'

const identitySchema = z.string().min(1).max(512).refine(
  value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)),
  'Work item identities cannot contain control characters',
)
const instantSchema = z.iso.datetime({ offset: true }).max(64)
const classificationSchema = z.object({ id: identitySchema, title: z.string().min(1).max(512) }).strict()

/** Validate the provider, installation, account and typed container owning a work item. */
export const workItemContainerRefSchema = z.object({
  providerId: identitySchema,
  instanceId: identitySchema,
  accountId: identitySchema,
  containerId: identitySchema,
  kind: identitySchema,
}).strict()

/** Validate a complete source identity without inferring account or container identifiers. */
export const workItemSourceRefSchema = workItemContainerRefSchema.extend({ itemId: identitySchema }).strict()

/** Validate the account and provider-declared relationship used to identify personal work. */
export const workItemPersonalMembershipSchema = z.object({
  accountId: identitySchema,
  relation: z.enum(['owned', 'assigned', 'unknown']),
}).strict()

/** Preserve the provider's due date, precision and timezone without converting local values to UTC. */
export const workItemDueDateSchema = z.object({
  dateTime: z.iso.datetime({ local: true, offset: true }).max(64),
  timeZone: identitySchema,
  precision: z.enum(['date', 'datetime']).optional(),
}).strict()

/** Additional work-item fields accepted at a provider result boundary alongside legacy fields. */
export const workItemFieldsSchema = z.object({
  sourceRef: workItemSourceRefSchema.optional(),
  personalMembership: workItemPersonalMembershipSchema.optional(),
  dueDate: workItemDueDateSchema.optional(),
  reminderDate: workItemDueDateSchema.optional(),
  updatedAt: instantSchema.optional(),
  important: z.boolean().optional(),
  project: classificationSchema.optional(),
  type: classificationSchema.optional(),
}).passthrough().superRefine((item, context) => {
  if (item.sourceRef && item.personalMembership && item.sourceRef.accountId !== item.personalMembership.accountId) {
    context.addIssue({
      code: 'custom',
      message: 'Personal membership must identify the source account',
      path: ['personalMembership', 'accountId'],
    })
  }
})

/** Provider-declared coverage and snapshot time, independent of opaque pagination cursors. */
export const workItemPageFieldsSchema = z.object({
  collections: z.array(z.object({ id: identitySchema, title: z.string().min(1).max(512) }).strict()).optional(),
  coverage: z.enum(['complete', 'partial']).optional(),
  fetchedAt: instantSchema.optional(),
  nextCursor: z.string().min(1).max(8192).optional(),
}).passthrough()

/** Account-isolated, typed work-item container identity suitable for persisted links. */
export type WorkItemContainerRef = z.infer<typeof workItemContainerRefSchema>
/** Exact provider-native identity of a work item; titles and display IDs are never keys. */
export type WorkItemSourceRef = z.infer<typeof workItemSourceRefSchema>
/** Personal relationship declared by the provider rather than inferred from a host identity. */
export type WorkItemPersonalMembership = z.infer<typeof workItemPersonalMembershipSchema>
/** Provider-local deadline; date precision applies to the whole day in its explicit timezone. */
export type WorkItemDueDate = z.infer<typeof workItemDueDateSchema>

/** Return a collision-safe container key, preserving every identity field exactly. */
export function workItemContainerKey(ref: WorkItemContainerRef): string {
  const value = workItemContainerRefSchema.parse(ref)
  return JSON.stringify([value.providerId, value.instanceId, value.accountId, value.containerId, value.kind])
}

/** Return a collision-safe source key, isolating installations, accounts and containers. */
export function workItemSourceKey(ref: WorkItemSourceRef): string {
  const value = workItemSourceRefSchema.parse(ref)
  return JSON.stringify([value.providerId, value.instanceId, value.accountId, value.containerId, value.kind, value.itemId])
}

/** Identify an item within one source page; legacy keys remain usable only for display deduplication. */
export function workItemIdentityKey(item: IntegrationEntity): string {
  return item.sourceRef
    ? workItemSourceKey(item.sourceRef)
    : JSON.stringify(['legacy', item.metadata?.workspaceId ?? '', item.metadata?.containerId ?? '', item.metadata?.type ?? '', item.id])
}

/** Locate a provider action by its native item ID and complete source scope, preserving legacy metadata inputs. */
export function workItemActionInput(item: IntegrationEntity): Record<string, unknown> {
  return {
    ...item.metadata,
    itemId: item.sourceRef?.itemId ?? item.id,
    ...(item.sourceRef ? { sourceRef: { ...item.sourceRef } } : {}),
  }
}

/** Match personal ownership or assignment against the provider's authorized account, for any status. */
export function isPersonalWorkItem(item: IntegrationEntity, currentUser: IntegrationEntityPage['currentUser']): boolean {
  const userId = currentUser?.id
  if (!userId || (item.sourceRef && item.sourceRef.accountId !== userId))
    return false
  const membership = item.personalMembership
  return membership
    ? Boolean(item.sourceRef && membership.accountId === userId && ['owned', 'assigned'].includes(membership.relation))
    : Boolean(item.assignees?.some(assignee => assignee.id === userId))
}

/** Shared unfinished-state presentation for workbench lists; native status strings stay provider-owned. */
export function isActiveWorkItem(item: IntegrationEntity): boolean {
  return !item.archived && !['resolved', 'done', 'closed', 'cancelled'].includes(item.statusCategory ?? '')
}

/** Return unfinished personal work only when the authorized account and membership agree. */
export function personalActiveWork(page: IntegrationEntityPage): IntegrationEntity[] {
  const userId = page.currentUser?.id
  if (!userId)
    return []
  const seen = new Set<string>()
  return page.items.filter((item) => {
    if (!isActiveWorkItem(item))
      return false
    if (!isPersonalWorkItem(item, page.currentUser))
      return false
    const key = workItemIdentityKey(item)
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

/** Compare deadlines in their declared timezone; unknown offsetless zones are not guessed. */
export function isWorkItemOverdue(dueDate: WorkItemDueDate | undefined, now: number): boolean {
  if (!dueDate || !Number.isFinite(now))
    return false
  if (dueDate.precision === 'date') {
    const dueDay = dueDate.dateTime.slice(0, 10)
    const date = new Date(`${dueDay}T00:00:00Z`)
    if (!/^\d{4}-\d{2}-\d{2}T/.test(dueDate.dateTime) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dueDay)
      return false
    try {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: dueDate.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
      const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === name)!.value
      return dueDay < `${part('year')}-${part('month')}-${part('day')}`
    }
    catch { return false }
  }
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(dueDate.dateTime))
    return new Date(dueDate.dateTime).getTime() < now
  const wallTime = new Date(`${dueDate.dateTime}Z`).getTime()
  if (!Number.isFinite(wallTime))
    return false
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: dueDate.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now)
    const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === name)!.value
    const localNow = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`) + now % 1000
    return wallTime < localNow
  }
  catch { return false }
}
