import type { DocumentSpaceChangeEvent } from 'craft-hub'

type DocumentSpaceChangeListener = (event: DocumentSpaceChangeEvent) => void

const listeners = new Set<DocumentSpaceChangeListener>()

/** Observe coalesced Document Space filesystem change notifications pushed over SSE. */
export function subscribeDocumentSpaceChanges(listener: DocumentSpaceChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Fan out an external Document Space change event to active views without letting a subscriber throw. */
export function emitDocumentSpaceChange(event: DocumentSpaceChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    }
    catch (error) {
      console.error('Document space change listener failed', error)
    }
  }
}
