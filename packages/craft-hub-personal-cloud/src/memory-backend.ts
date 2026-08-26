import type { CloudDocument, PersonalCloudBackend, RemoteRequest, RemoteRequestUpdate, SyncExchange } from './types'
import { randomUUID } from 'node:crypto'
import { decideDocumentSync } from './sync'

/** Deterministic backend for local integration tests and offline development. */
export class MemoryPersonalCloudBackend implements PersonalCloudBackend {
  readonly documents = new Map<string, CloudDocument>()
  readonly requests = new Map<string, RemoteRequest>()
  readonly updates: RemoteRequestUpdate[] = []

  constructor(private readonly now: () => number = Date.now) {}

  enqueue(request: RemoteRequest): void {
    this.requests.set(request.requestId, structuredClone(request))
  }

  async synchronize(documents: CloudDocument[]): Promise<SyncExchange> {
    const accepted: SyncExchange['accepted'] = []
    const outgoing: CloudDocument[] = []
    const conflicts: SyncExchange['conflicts'] = []
    const requestedKeys = new Set(documents.map(document => document.key))
    for (const document of documents) {
      const decision = decideDocumentSync(document.parentRevision, document, this.documents.get(document.key))
      if (decision.action === 'push-local' || decision.action === 'unchanged') {
        this.documents.set(document.key, structuredClone(decision.document ?? document))
        accepted.push({ key: document.key, revision: document.revision })
      }
      if (decision.action === 'apply-remote' && decision.document)
        outgoing.push(structuredClone(decision.document))
      if (decision.action === 'conflict' && decision.conflict)
        conflicts.push(structuredClone(decision.conflict))
    }
    for (const document of this.documents.values()) {
      if (!requestedKeys.has(document.key))
        outgoing.push(structuredClone(document))
    }
    return { documents: outgoing, conflicts, accepted }
  }

  async claimRequests(): Promise<RemoteRequest[]> {
    const claimed: RemoteRequest[] = []
    for (const request of this.requests.values()) {
      const now = this.now()
      const leaseExpired = (request.status === 'claimed' || request.status === 'awaiting_approval')
        && request.leaseUntil !== undefined
        && Date.parse(request.leaseUntil) <= now
      if (request.status !== 'queued' && !leaseExpired)
        continue
      if (Date.parse(request.expiresAt) <= now) {
        request.status = 'expired'
        continue
      }
      request.status = 'claimed'
      request.claimId = randomUUID()
      request.leaseUntil = new Date(now + 30_000).toISOString()
      claimed.push(structuredClone(request))
    }
    return claimed
  }

  async updateRequest(update: RemoteRequestUpdate): Promise<void> {
    const request = this.requests.get(update.requestId)
    if (!request)
      throw new Error(`Unknown remote request: ${update.requestId}`)
    if (request.claimId !== update.claimId)
      throw new Error('Remote request claim is stale')
    request.status = update.status
    this.updates.push(structuredClone(update))
  }

  async heartbeat(): Promise<void> {}

  async revokeDevice(): Promise<void> {}
}
