import type { PresentedIntegrationEntity } from './integration-presentation'
import type { IntegrationEntity, IntegrationEntityPage } from './integrations'
import { createHash } from 'node:crypto'
import { isActiveWorkItem, isPersonalWorkItem, workItemIdentityKey } from './work-items'

/** Navigation context for a reviewed native action; provider authorization remains authoritative. */
export interface WorkItemActionTarget {
  integrationId: string
  item: Pick<PresentedIntegrationEntity, 'key' | 'id' | 'title' | 'active' | 'personal' | 'sourceRef' | 'metadata' | 'status' | 'statusLabel' | 'statusCategory' | 'statusUpdateAvailable'>
  readOnly: boolean
  accountKey?: string
  connectionCacheKey?: string
}

export interface WorkItemActionContext {
  integrationId: string
  connectionCacheKey?: string
}

/** Keep large descriptions out of overview snapshots; details are fetched when the user opens an item. */
export function workItemActionTarget(item: IntegrationEntity, page: IntegrationEntityPage, context: WorkItemActionContext): WorkItemActionTarget {
  const opaque = (value: string): string => createHash('sha256').update(value).digest('hex')
  return {
    integrationId: context.integrationId,
    item: {
      key: opaque(workItemIdentityKey(item)),
      id: item.id,
      title: item.title,
      active: isActiveWorkItem(item),
      personal: isPersonalWorkItem(item, page.currentUser),
      ...(item.sourceRef ? { sourceRef: item.sourceRef } : {}),
      ...(item.metadata ? { metadata: Object.fromEntries(Object.entries(item.metadata).filter(([name]) => ['workspaceId', 'containerId', 'projectId', 'listId', 'type'].includes(name))) } : {}),
      ...(item.status !== undefined ? { status: item.status } : {}),
      ...(item.statusLabel !== undefined ? { statusLabel: item.statusLabel } : {}),
      ...(item.statusCategory !== undefined ? { statusCategory: item.statusCategory } : {}),
      ...(item.statusUpdateAvailable !== undefined ? { statusUpdateAvailable: item.statusUpdateAvailable } : {}),
    },
    readOnly: Boolean(page.cache),
    ...(page.currentUser ? { accountKey: opaque(page.currentUser.id) } : {}),
    ...(context.connectionCacheKey ? { connectionCacheKey: context.connectionCacheKey } : {}),
  }
}
