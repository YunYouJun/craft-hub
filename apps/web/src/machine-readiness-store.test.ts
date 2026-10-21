// @vitest-environment happy-dom

import type { EnvironmentSetupSnapshot, SetupProfileReview } from 'craft-hub'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { useMachineReadinessStore } from './store'

const revision = 'a'.repeat(64)
const setup: EnvironmentSetupSnapshot = { version: 1, checkedAt: '2026-10-20T08:30:00.000Z', profileRevision: revision, platform: 'darwin', prerequisitesReady: true, steps: [] }
const review: SetupProfileReview = { snapshot: { version: 1, revision, profile: { version: 1, platform: 'darwin', name: 'Mine', software: [], configurations: [] } }, software: [], configurations: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(api, 'runtimeHealth').mockResolvedValue({ status: 'ok', projectConfigSchemaRevision: 'current', distribution: { id: 'community', name: 'Craft Hub' }, hostEnvironment: { kind: 'local', capabilities: { localProjectDirectories: true, localGitSync: true } } })
  vi.spyOn(api, 'environmentSetup').mockResolvedValue(structuredClone(setup))
  vi.spyOn(api, 'reviewSetupProfile').mockResolvedValue(structuredClone(review))
})
afterEach(() => vi.restoreAllMocks())

describe('machine readiness cache invalidation', () => {
  it.each(['before', 'after'] as const)('fences an old in-flight check resolving %s the new profile check', async (order) => {
    const store = useMachineReadinessStore()
    await store.refresh()
    const oldSetup = deferred<EnvironmentSetupSnapshot>()
    const oldReview = deferred<SetupProfileReview>()
    vi.mocked(api.environmentSetup).mockReturnValueOnce(oldSetup.promise)
    vi.mocked(api.reviewSetupProfile).mockReturnValueOnce(oldReview.promise)
    const oldRead = store.refresh({ force: true })

    store.invalidate()
    expect(store.setup).toEqual(setup)
    expect(store.review).toEqual(review)
    expect(store.setupFailed).toBe(true)
    expect(store.reviewFailed).toBe(true)
    expect(store.busy).toBe(false)

    const nextSetup = deferred<EnvironmentSetupSnapshot>()
    const nextReview = deferred<SetupProfileReview>()
    vi.mocked(api.environmentSetup).mockReturnValueOnce(nextSetup.promise)
    vi.mocked(api.reviewSetupProfile).mockReturnValueOnce(nextReview.promise)
    const nextRead = store.refresh()
    expect(api.environmentSetup).toHaveBeenCalledTimes(3)
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(3)
    const resolveOld = async () => {
      oldSetup.resolve({ ...setup, profileRevision: 'old-profile' })
      oldReview.resolve({ ...review, snapshot: { ...review.snapshot, revision: 'old-profile' } })
      await oldRead
    }
    if (order === 'before') {
      await resolveOld()
      expect(store.busy).toBe(true)
      expect(store.setupFailed).toBe(true)
      expect(store.reviewFailed).toBe(true)
      expect(store.review?.snapshot.revision).toBe(revision)
    }
    nextSetup.resolve({ ...setup, profileRevision: 'new-profile' })
    nextReview.resolve({ ...review, snapshot: { ...review.snapshot, revision: 'new-profile' } })
    await nextRead
    if (order === 'after')
      await resolveOld()

    expect(store.setup?.profileRevision).toBe('new-profile')
    expect(store.review?.snapshot.revision).toBe('new-profile')
    expect(store.setupFailed).toBe(false)
    expect(store.reviewFailed).toBe(false)
    expect(store.busy).toBe(false)
    await store.refresh()
    expect(api.environmentSetup).toHaveBeenCalledTimes(3)
    expect(api.reviewSetupProfile).toHaveBeenCalledTimes(3)
  })
})
