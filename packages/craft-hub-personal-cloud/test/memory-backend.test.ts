import { describe, expect, it } from 'vitest'
import { MemoryPersonalCloudBackend } from '../src/memory-backend'

describe('memory personal cloud backend', () => {
  it('claims a queued request only once', async () => {
    const backend = new MemoryPersonalCloudBackend()
    backend.enqueue({
      requestId: 'request-1',
      targetDeviceId: 'device-1',
      projectKey: 'project-1',
      capabilityId: 'build',
      status: 'queued',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    await expect(backend.claimRequests()).resolves.toHaveLength(1)
    await expect(backend.claimRequests()).resolves.toEqual([])
  })

  it('returns unknown remote documents and preserves three-way conflicts', async () => {
    const backend = new MemoryPersonalCloudBackend()
    backend.documents.set('workspaces/team', { key: 'workspaces/team', schemaVersion: 1, revision: 'remote', parentRevision: 'base', payload: { name: 'Remote' } })

    await expect(backend.synchronize([])).resolves.toMatchObject({
      documents: [expect.objectContaining({ key: 'workspaces/team', revision: 'remote' })],
    })
    await expect(backend.synchronize([{ key: 'workspaces/team', schemaVersion: 1, revision: 'local', parentRevision: 'base', payload: { name: 'Local' } }])).resolves.toMatchObject({
      conflicts: [{ key: 'workspaces/team', localRevision: 'local', remoteRevision: 'remote' }],
    })
  })

  it('reclaims an expired lease before running', async () => {
    let now = 1_000
    const backend = new MemoryPersonalCloudBackend(() => now)
    backend.enqueue({
      requestId: 'request-1',
      targetDeviceId: 'device-1',
      projectKey: 'project-1',
      capabilityId: 'build',
      status: 'queued',
      expiresAt: new Date(120_000).toISOString(),
    })
    await expect(backend.claimRequests()).resolves.toHaveLength(1)
    now = 31_000
    await expect(backend.claimRequests()).resolves.toHaveLength(1)
  })
})
