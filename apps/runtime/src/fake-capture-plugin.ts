import type { SharedCaptureProvider } from 'craft-hub/shared-runtime'
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

/** Local acceptance adapter, never installed as a real cloud provider. Faults are explicit targets. */
export function fakeCapturePlugin(dataDir: string): SharedCaptureProvider {
  const operations = new Set<AbortController>()
  return {
    targets: ['normal', 'slow', 'lost-reply', 'hang'].map(kind => ({ id: `fake:${kind}`, title: `Local fixture: ${kind}`, revision: 'fixture-1' })),
    validate() {},
    async create(request) {
      const abort = new AbortController()
      operations.add(abort)
      const cancel = (): void => abort.abort()
      request.signal.addEventListener('abort', cancel, { once: true })
      if (request.signal.aborted)
        abort.abort()
      try {
        if (request.targetId === 'fake:slow' || request.targetId === 'fake:hang')
          await setTimeout(request.targetId === 'fake:slow' ? 800 : 60_000, undefined, { signal: abort.signal })
        const remoteId = randomUUID()
        const file = await open(join(dataDir, 'fake-remote-notes.jsonl'), 'a', 0o600)
        try {
          await file.writeFile(`${JSON.stringify({ attemptId: request.attemptId, remoteId, text: request.text })}\n`)
          await file.sync()
        }
        finally {
          await file.close()
        }
        if (request.targetId === 'fake:lost-reply')
          throw new Error('Fixture remote accepted but reply was lost')
        return { remoteId }
      }
      finally {
        request.signal.removeEventListener('abort', cancel)
        operations.delete(abort)
      }
    },
    async close() {
      for (const operation of operations)
        operation.abort()
    },
  }
}
