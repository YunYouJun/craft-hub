import type { RemoteRequestRunner } from './remote-runner'
import type { CloudDocument, PersonalCloudBackend, SyncConflict } from './types'

export interface PersonalCloudDocumentSource {
  documents: () => Promise<CloudDocument[]>
  apply: (document: CloudDocument) => Promise<void>
  commit: (key: string, revision: string) => Promise<void>
}

export interface PersonalCloudSyncResult {
  applied: string[]
  conflicts: SyncConflict[]
}

/** Coordinate sync and inbox polling behind a small host-facing interface. */
export class PersonalCloudService {
  constructor(
    private readonly backend: PersonalCloudBackend,
    private readonly source: PersonalCloudDocumentSource,
    private readonly runner: RemoteRequestRunner,
  ) {}

  async synchronize(): Promise<PersonalCloudSyncResult> {
    const exchange = await this.backend.synchronize(await this.source.documents())
    const applied: string[] = []
    const remoteDocuments = [...exchange.documents].sort((left, right) => applyPriority(left.key) - applyPriority(right.key))
    for (const document of remoteDocuments) {
      await this.source.apply(document)
      await this.source.commit(document.key, document.revision)
      applied.push(document.key)
    }
    for (const accepted of exchange.accepted)
      await this.source.commit(accepted.key, accepted.revision)
    return { applied, conflicts: exchange.conflicts }
  }

  async poll(): Promise<void> {
    const requests = await this.backend.claimRequests()
    for (const request of requests)
      await this.runner.handle(request)
  }

  heartbeat(): Promise<void> {
    return this.backend.heartbeat()
  }
}

function applyPriority(key: string): number {
  if (key.startsWith('workspaces/') && key !== 'workspaces/catalog')
    return 0
  if (key === 'workspaces/catalog')
    return 2
  return 1
}
