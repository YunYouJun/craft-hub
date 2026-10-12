import type { IntegrationEntityPage } from 'craft-hub'
import { workItemIdentityKey } from 'craft-hub/work-items'

/** Append one authenticated page without conflating source scopes or account identities. */
export function mergeIntegrationEntityPages(previous: IntegrationEntityPage, next: IntegrationEntityPage): { page: IntegrationEntityPage, identityChanged: boolean } {
  const identityChanged = previous.currentUser?.id !== next.currentUser?.id
  if (identityChanged)
    return { page: next, identityChanged }
  const items = new Map(previous.items.map(item => [workItemIdentityKey(item), item]))
  for (const item of next.items)
    items.set(workItemIdentityKey(item), item)
  return {
    page: { ...previous, ...next, items: [...items.values()], nextCursor: next.nextCursor, coverage: next.coverage, fetchedAt: next.fetchedAt },
    identityChanged,
  }
}
