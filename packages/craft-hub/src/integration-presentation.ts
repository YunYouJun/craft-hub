import type { IntegrationActionResult, IntegrationConnectionStatus, IntegrationEntity, IntegrationEntityPage } from './integrations'
import type { ResourcePage } from './resource-pages'
import { presentConnection } from './integration-connection-review'
import { isActiveWorkItem, isPersonalWorkItem, workItemIdentityKey } from './work-items'

/** Portable display identity; provider IDs alone may collide across containers or accounts. */
export type PresentedIntegrationEntity = IntegrationEntity & { key: string, active: boolean, personal: boolean }

/** Optional presentation envelope for clients rendering declarative workbench blocks. */
export type IntegrationPresentation = { version: 1 } & (
  | { kind: 'connection', connection: IntegrationConnectionStatus & { reviewRevision: string } }
  | { kind: 'entities', page: Omit<IntegrationEntityPage, 'items'> & { items: PresentedIntegrationEntity[] } }
  | { kind: 'entity', entity: PresentedIntegrationEntity }
  | { kind: 'resources', resources: Omit<ResourcePage, 'entities'> & { entities?: PresentedIntegrationEntity[] } }
  | { kind: 'unsupported' }
)

/** Project a successful action result without changing its invocation, confirmation or trust checks. */
export function presentIntegrationAction(result: IntegrationActionResult): IntegrationPresentation {
  if ('connected' in result)
    return { version: 1, kind: 'connection', connection: presentConnection(result) }
  if ('configuration' in result)
    return { version: 1, kind: 'unsupported' }
  if ('kind' in result && result.kind === 'resource-page') {
    const { entities, ...page } = result
    const presented = entities && [...new Map(entities.map(item => [workItemIdentityKey(item), presentEntity(item)])).values()]
    return { version: 1, kind: 'resources', resources: { ...page, ...(presented && { entities: presented }) } }
  }
  if ('items' in result) {
    const items = new Map(result.items.map(item => [workItemIdentityKey(item), presentEntity(item, result.currentUser)]))
    return { version: 1, kind: 'entities', page: { ...result, items: [...items.values()] } }
  }
  if ('id' in result && 'title' in result)
    return { version: 1, kind: 'entity', entity: presentEntity(result) }
  return { version: 1, kind: 'unsupported' }
}

function presentEntity(item: IntegrationEntity, user?: IntegrationEntityPage['currentUser']): PresentedIntegrationEntity {
  return { ...item, key: workItemIdentityKey(item), active: isActiveWorkItem(item), personal: isPersonalWorkItem(item, user) }
}
