import type { PersonalCloudDocumentSource } from '../src/service'
import type { PersonalCloudBackend, SyncExchange } from '../src/types'
import { expect, it, vi } from 'vitest'
import { PersonalCloudService } from '../src/service'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

it('does not apply any remote document returned after cancellation', async () => {
  const response = deferred<SyncExchange>()
  const sent = deferred<void>()
  const backend: PersonalCloudBackend = {
    synchronize: async () => {
      sent.resolve()
      return response.promise
    },
    claimRequests: async () => [],
    updateRequest: async () => {},
    heartbeat: async () => {},
  }
  const source: PersonalCloudDocumentSource = { documents: async () => [], apply: vi.fn(async () => {}), commit: vi.fn(async () => {}) }
  const signal = new AbortController()
  const service = new PersonalCloudService(backend, source, { handle: vi.fn(async () => {}) }, signal.signal)
  const operation = service.synchronize()
  const rejected = expect(operation).rejects.toThrow()
  await sent.promise
  signal.abort()
  response.resolve({ documents: [{ key: 'settings/global', schemaVersion: 1, revision: 'remote', payload: {} }], accepted: [], conflicts: [] })
  await rejected
  expect(source.apply).not.toHaveBeenCalled()
  expect(source.commit).not.toHaveBeenCalled()
})

it('lets an already-started apply settle but stops further documents and revision commits', async () => {
  const applied = deferred<void>()
  const finish = deferred<void>()
  const backend: PersonalCloudBackend = {
    synchronize: async () => ({ documents: ['first', 'second'].map(key => ({ key, schemaVersion: 1, revision: 'remote', payload: {} })), accepted: [], conflicts: [] }),
    claimRequests: async () => [],
    updateRequest: async () => {},
    heartbeat: async () => {},
  }
  const source: PersonalCloudDocumentSource = {
    documents: async () => [],
    apply: vi.fn(async () => {
      applied.resolve()
      await finish.promise
    }),
    commit: vi.fn(async () => {}),
  }
  const signal = new AbortController()
  const service = new PersonalCloudService(backend, source, { handle: vi.fn(async () => {}) }, signal.signal)
  const operation = service.synchronize()
  const rejected = expect(operation).rejects.toThrow()
  await applied.promise
  signal.abort()
  finish.resolve()
  await rejected
  expect(source.apply).toHaveBeenCalledOnce()
  expect(source.commit).not.toHaveBeenCalled()
})
