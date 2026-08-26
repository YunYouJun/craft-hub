import type { CloudDocument, SyncDecision } from './types'

/** Decide one three-way document sync without silently choosing a conflicting side. */
export function decideDocumentSync(
  baseRevision: string | undefined,
  local: CloudDocument,
  remote: CloudDocument | undefined,
): SyncDecision {
  if (!remote)
    return { action: 'push-local', document: local }
  if (local.revision === remote.revision)
    return { action: 'unchanged', document: remote }
  if (local.revision === baseRevision)
    return { action: 'apply-remote', document: remote }
  if (remote.revision === baseRevision)
    return { action: 'push-local', document: local }
  return {
    action: 'conflict',
    conflict: {
      key: local.key,
      localRevision: local.revision,
      remoteRevision: remote.revision,
    },
  }
}
