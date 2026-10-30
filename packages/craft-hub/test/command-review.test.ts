import type { CommandCapability, ProjectRecord } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { CommandReviewService } from '../src/command-review'

function fixture() {
  let now = Date.now()
  const project: ProjectRecord = { id: 'fixture', name: 'Fixture', path: '/fixture', trust: 'untrusted', addedAt: new Date(now).toISOString() }
  const capability: CommandCapability = {
    id: 'fixture:echo',
    kind: 'command',
    name: 'Echo',
    source: 'package.json',
    invocation: { command: 'node', args: ['echo.mjs'], cwd: '/fixture', requiredEnv: [] },
    inputs: [{ id: 'message', type: 'text', flag: '--message', required: true }],
  }
  const trust = vi.fn(async (_id: string, _path: string, assertActive: () => void) => {
    assertActive()
    project.trust = 'trusted'
    return structuredClone(project)
  })
  const host = { project: async () => structuredClone(project), capabilities: async () => [structuredClone(capability)], trust }
  const reviews = new CommandReviewService(host, () => now)
  return { project, capability, host, reviews, trust, advance: () => {
    now += 300_001
  } }
}

describe('command reviews', () => {
  it('prepares immutable read-only metadata, then retains a review across an explicit trust decision', async () => {
    const f = fixture()
    try {
      const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      expect(review).toMatchObject({ project: { trust: 'untrusted' }, invocation: { args: ['echo.mjs', '--message=hello'] } })
      expect(f.project.trust).toBe('untrusted')
      expect(f.trust).not.toHaveBeenCalled()
      review.capability.invocation.args.push('mutated outside runtime')
      await f.reviews.trust('owner', 'fixture', review.reviewId)
      const guard = await f.reviews.consume('owner', 'fixture', review.reviewId, 'fixture:echo', { message: 'hello' })
      expect(guard.capability.invocation.args).toEqual(['echo.mjs'])
      expect(guard.inputs).toEqual({ message: 'hello' })
      await expect(f.reviews.consume('owner', 'fixture', review.reviewId, 'fixture:echo', { message: 'hello' })).rejects.toThrow('already used')
    }
    finally { f.reviews.close() }
  })

  it('isolates caller and project identities without consuming another caller review', async () => {
    const f = fixture()
    try {
      const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      await expect(f.reviews.trust('other', 'fixture', review.reviewId)).rejects.toThrow('expired')
      await expect(f.reviews.consume('owner', 'other-project', review.reviewId, 'fixture:echo', { message: 'hello' })).rejects.toThrow('expired')
      expect(() => f.reviews.cancel('other', 'fixture', review.reviewId)).toThrow('expired')
      f.reviews.cancel('owner', 'fixture', review.reviewId)
      await expect(f.reviews.trust('owner', 'fixture', review.reviewId)).rejects.toThrow('cancelled')
      expect(f.trust).not.toHaveBeenCalled()
    }
    finally { f.reviews.close() }
  })

  it('rejects a changed command or project before granting trust', async () => {
    for (const change of ['command', 'path']) {
      const f = fixture()
      try {
        const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
        if (change === 'command')
          f.capability.invocation.args.push('unexpected')
        else
          f.project.path = '/replacement'
        await expect(f.reviews.trust('owner', 'fixture', review.reviewId)).rejects.toThrow('changed')
        expect(f.project.trust).toBe('untrusted')
        expect(f.trust).not.toHaveBeenCalled()
      }
      finally { f.reviews.close() }
    }
  })

  it('consumes changed input and concurrent confirmation attempts only once', async () => {
    const f = fixture()
    try {
      const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      await expect(f.reviews.consume('owner', 'fixture', review.reviewId, 'fixture:echo', { message: 'changed' })).rejects.toThrow('input changed')
      await expect(f.reviews.consume('owner', 'fixture', review.reviewId, 'fixture:echo', { message: 'hello' })).rejects.toThrow('already used')
      const next = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      const results = await Promise.allSettled([
        f.reviews.consume('owner', 'fixture', next.reviewId, 'fixture:echo', { message: 'hello' }),
        f.reviews.consume('owner', 'fixture', next.reviewId, 'fixture:echo', { message: 'hello' }),
      ])
      expect(results.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected'])
    }
    finally { f.reviews.close() }
  })

  it('rejects expiry and cancellation after asynchronous trust validation starts', async () => {
    for (const cancel of [true, false]) {
      const f = fixture()
      try {
        const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
        const entered = Promise.withResolvers<void>()
        const release = Promise.withResolvers<void>()
        f.host.capabilities = async () => {
          entered.resolve()
          await release.promise
          return [structuredClone(f.capability)]
        }
        const trusting = f.reviews.trust('owner', 'fixture', review.reviewId)
        await entered.promise
        if (cancel)
          f.reviews.cancel('owner', 'fixture', review.reviewId)
        else
          f.advance()
        release.resolve()
        await expect(trusting).rejects.toThrow()
        expect(f.project.trust).toBe('untrusted')
      }
      finally { f.reviews.close() }
    }
  })

  it('bounds live reviews per owner and retains other callers independently', async () => {
    const f = fixture()
    try {
      const first = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      const other = await f.reviews.prepare('other', 'fixture', 'fixture:echo', { message: 'hello' })
      for (let index = 0; index < 8; index++)
        await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: `${index}` })
      await expect(f.reviews.trust('owner', 'fixture', first.reviewId)).rejects.toThrow('expired')
      await expect(f.reviews.trust('other', 'fixture', other.reviewId)).resolves.toMatchObject({ trust: 'trusted' })
      f.reviews.close()
      await expect(f.reviews.trust('other', 'fixture', other.reviewId)).rejects.toThrow('expired')
    }
    finally { f.reviews.close() }
  })

  it('checks cancellation again at the project-trust persistence boundary', async () => {
    const f = fixture()
    try {
      const review = await f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      f.trust.mockImplementation(async (_id, _path, assertActive) => {
        entered.resolve()
        await release.promise
        assertActive()
        f.project.trust = 'trusted'
        return structuredClone(f.project)
      })
      const trusting = f.reviews.trust('owner', 'fixture', review.reviewId)
      await entered.promise
      f.reviews.cancel('owner', 'fixture', review.reviewId)
      release.resolve()
      await expect(trusting).rejects.toThrow('cancelled')
      expect(f.project.trust).toBe('untrusted')
    }
    finally { f.reviews.close() }
  })

  it('leaves release operations and invalid form inputs outside command review', async () => {
    const f = fixture()
    try {
      await expect(f.reviews.prepare('owner', 'fixture', 'fixture:echo', {})).rejects.toThrow()
      f.capability.operation = { kind: 'release', requiresCleanGit: false }
      await expect(f.reviews.prepare('owner', 'fixture', 'fixture:echo', { message: 'hello' })).rejects.toThrow('full release review')
      expect(f.trust).not.toHaveBeenCalled()
    }
    finally { f.reviews.close() }
  })
})
