import type { IntegrationEntity, IntegrationEntityPage } from './integrations'
import { z } from 'zod'

const identitySchema = z.string().min(1).max(512).refine(
  value => !Array.from(value).some(character => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159)),
  'Work item identities cannot contain control characters',
)
const instantSchema = z.iso.datetime({ offset: true }).max(64)

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

/** Preserve the provider's due date and timezone; local date-times are not converted to UTC. */
export const workItemDueDateSchema = z.object({
  dateTime: z.iso.datetime({ local: true, offset: true }).max(64),
  timeZone: identitySchema,
}).strict()

/** Additional work-item fields accepted at a provider result boundary alongside legacy fields. */
export const workItemFieldsSchema = z.object({
  sourceRef: workItemSourceRefSchema.optional(),
  personalMembership: workItemPersonalMembershipSchema.optional(),
  dueDate: workItemDueDateSchema.optional(),
  updatedAt: instantSchema.optional(),
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
/** Provider-local deadline with its explicit timezone. */
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

/** Return unfinished personal work only when the authorized account and membership agree. */
export function personalActiveWork(page: IntegrationEntityPage): IntegrationEntity[] {
  const userId = page.currentUser?.id
  if (!userId)
    return []
  const terminalStatuses = new Set(['resolved', 'done', 'closed', 'cancelled'])
  const seen = new Set<string>()
  return page.items.filter((item) => {
    if (item.archived || terminalStatuses.has(item.statusCategory ?? ''))
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
