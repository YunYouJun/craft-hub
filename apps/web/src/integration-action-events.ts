export interface IntegrationChangeEvent {
  integrationId: string
  phase: 'start' | 'settled'
}

type IntegrationChangeListener = (event: IntegrationChangeEvent) => void

const listeners = new Set<IntegrationChangeListener>()

/** Observes confirmed integration actions so cached reads can be invalidated before a write and refreshed after it settles. */
export function subscribeIntegrationChanges(listener: IntegrationChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reports action boundaries without allowing a cache subscriber to change the action's result. */
export function emitIntegrationChange(event: IntegrationChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    }
    catch (error) {
      console.error('Integration change listener failed', error)
    }
  }
}
