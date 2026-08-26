export type RemoteRequestStatus
  = 'queued'
    | 'claimed'
    | 'awaiting_approval'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'rejected'
    | 'cancelled'
    | 'expired'

export interface CloudDocument<T = unknown> {
  key: string
  schemaVersion: 1
  revision: string
  parentRevision?: string
  payload: T
}

export interface SyncConflict {
  key: string
  localRevision: string
  remoteRevision: string
}

export interface SyncExchange {
  documents: CloudDocument[]
  conflicts: SyncConflict[]
  accepted: Array<{ key: string, revision: string }>
}

export interface RemoteRequest {
  requestId: string
  targetDeviceId: string
  projectKey: string
  capabilityId: string
  status: RemoteRequestStatus
  expiresAt: string
  leaseUntil?: string
  claimId?: string
}

export interface RemoteRequestUpdate {
  requestId: string
  claimId: string
  status: Exclude<RemoteRequestStatus, 'queued' | 'claimed'>
  exitCode?: number | null
  finishedAt?: string
}

/** Vendor-neutral seam implemented by CloudBase HTTP and in-memory adapters. */
export interface PersonalCloudBackend {
  synchronize: (documents: CloudDocument[]) => Promise<SyncExchange>
  claimRequests: () => Promise<RemoteRequest[]>
  updateRequest: (update: RemoteRequestUpdate) => Promise<void>
  heartbeat: () => Promise<void>
  revokeDevice?: () => Promise<void>
}

export interface SyncDecision {
  action: 'unchanged' | 'apply-remote' | 'push-local' | 'conflict'
  document?: CloudDocument
  conflict?: SyncConflict
}
