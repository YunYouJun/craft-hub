import type { SharedCaptureProvider, SharedCaptureReceipt } from '../src/shared-capture-runtime'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { acquireProfileLease } from '../src/profile-lease'
import { RuntimeAvailability } from '../src/runtime-availability'
import { SharedCaptureRuntime } from '../src/shared-capture-runtime'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse())
    await close()
})

async function fixture(create: SharedCaptureProvider['create'] = async () => ({ remoteId: randomUUID() })) {
  const root = await mkdtemp(join(tmpdir(), 'craft-shared-capture-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const provider = { targets: [{ id: 'fake', title: 'Local fake notes', revision: '1' }], validate: vi.fn(), create: vi.fn(create), close: vi.fn(async () => {}) }
  const load = vi.fn(async () => provider)
  const options = { dataDir: join(root, 'data'), configDir: join(root, 'config'), provider: load, onIdle: vi.fn(), idleMs: 1000, requestMs: 100 }
  const runtime = await SharedCaptureRuntime.open(options)
  cleanup.push(() => runtime.close())
  const prepare = async (content = '中文\n草稿 🌿') => {
    const review = await runtime.request('client', { method: 'capture.prepare', targetId: 'fake', text: content }) as { reviewId: string }
    return { method: 'capture.commit' as const, attemptId: randomUUID(), reviewId: review.reviewId, targetId: 'fake', text: content }
  }
  return { root, runtime, options, load, provider, prepare }
}

it('keeps hello lazy and excludes legacy clients, nested owners and migrations until closed', async () => {
  const f = await fixture()
  await f.runtime.request('client', { method: 'hello', protocol: 1 })
  expect(f.load).not.toHaveBeenCalled()
  for (const mode of ['client', 'runtime-owner', 'migration'] as const)
    await expect(acquireProfileLease([f.options.dataDir], mode)).rejects.toThrow('profile is in use')
  await expect(acquireProfileLease([join(f.options.dataDir, 'nested')], 'runtime-owner')).rejects.toThrow('profile is in use')
  await expect(acquireProfileLease([f.root], 'runtime-owner')).rejects.toThrow('profile is in use')
  await f.runtime.close()
  const lease = await acquireProfileLease([f.options.dataDir], 'migration')
  lease.release()
})

it('merges concurrent same-id commits and rejects changed payloads or another client', async () => {
  const f = await fixture(async () => {
    await new Promise(resolve => setTimeout(resolve, 15))
    return { remoteId: 'one-note' }
  })
  const command = await f.prepare()
  const receipts = await Promise.all(Array.from({ length: 10 }, () => f.runtime.request('client', command))) as SharedCaptureReceipt[]
  expect(f.provider.create).toHaveBeenCalledTimes(1)
  expect(receipts.some(receipt => receipt.status === 'succeeded')).toBe(true)
  await expect(f.runtime.request('client', { ...command, text: 'different' })).rejects.toThrow('identity conflict')
  await expect(f.runtime.request('other-client', command)).rejects.toThrow('identity conflict')
  await expect(f.runtime.request('other-client', { method: 'capture.receipt', attemptId: command.attemptId })).rejects.toThrow('not found')
  await f.runtime.close()
  const restarted = await SharedCaptureRuntime.open(f.options)
  cleanup.push(() => restarted.close())
  expect(await restarted.request('client', command)).toMatchObject({ status: 'succeeded', remoteId: 'one-note' })
  expect(f.provider.create).toHaveBeenCalledTimes(1)
})

it('persists uncertain timeouts, bounds shutdown, and never replays them on restart', async () => {
  const f = await fixture(async () => new Promise(() => {}))
  const command = await f.prepare()
  expect(await f.runtime.request('client', command)).toMatchObject({ status: 'uncertain' })
  await f.runtime.close()
  const restarted = await SharedCaptureRuntime.open(f.options)
  cleanup.push(() => restarted.close())
  expect(await restarted.request('client', command)).toMatchObject({ status: 'uncertain' })
  expect(f.provider.create).toHaveBeenCalledTimes(1)
  expect(f.provider.close).toHaveBeenCalledTimes(1)
})

it('binds review to client/content/revision and closes accepted writes after parent loss', async () => {
  const f = await fixture(async () => new Promise(() => {}))
  const command = await f.prepare()
  await expect(f.runtime.request('client', { ...command, text: 'changed' })).rejects.toThrow('review changed')
  await expect(f.runtime.request('other-client', command)).rejects.toThrow('review changed')
  f.provider.targets[0]!.revision = '2'
  await expect(f.runtime.request('client', command)).rejects.toThrow('review changed')
  const next = await f.prepare()
  const pending = f.runtime.request('client', next)
  await vi.waitFor(() => expect(f.provider.create).toHaveBeenCalledTimes(1))
  f.runtime.abort()
  expect(await pending).toMatchObject({ status: 'uncertain' })
  await f.runtime.close()
})

it('uses one idle deadline, releases idempotently and pins work independently of connections', () => {
  vi.useFakeTimers()
  const idle = vi.fn()
  const availability = new RuntimeAvailability(30, idle)
  const workbench = availability.acquire('session')
  vi.advanceTimersByTime(100)
  expect(idle).not.toHaveBeenCalled()
  const operation = availability.acquire('operation')
  workbench()
  workbench()
  vi.advanceTimersByTime(100)
  expect(idle).not.toHaveBeenCalled()
  operation()
  vi.advanceTimersByTime(20)
  const next = availability.acquire('operation')
  vi.advanceTimersByTime(100)
  expect(idle).not.toHaveBeenCalled()
  next()
  vi.advanceTimersByTime(30)
  expect(idle).toHaveBeenCalledTimes(1)
  expect(() => availability.acquire('operation')).toThrow('draining')
  availability.stop()
})

it('bounds plugin startup failure and releases ownership after initialization errors', async () => {
  const f = await fixture()
  await f.runtime.close()
  const hung = await SharedCaptureRuntime.open({ ...f.options, provider: async () => new Promise(() => {}) })
  cleanup.push(() => hung.close())
  await expect(hung.request('client', { method: 'capture.targets' })).rejects.toThrow('startup deadline')
  await hung.close()
  await writeFile(join(f.options.dataDir, 'capture-attempts.sqlite'), 'invalid database')
  await expect(SharedCaptureRuntime.open(f.options)).rejects.toThrow()
  const lease = await acquireProfileLease([f.options.dataDir], 'runtime-owner')
  lease.release()
})

it('does not dispatch late plugin loads after parent loss and rejects unsupported requests', async () => {
  const f = await fixture()
  await expect(async () => f.runtime.request('client', { method: 'shell.exec', command: 'ignored' })).rejects.toThrow()
  expect(f.load).not.toHaveBeenCalled()
  await f.runtime.close()
  let resolveProvider!: (provider: SharedCaptureProvider) => void
  const runtime = await SharedCaptureRuntime.open({ ...f.options, provider: () => new Promise(resolve => resolveProvider = resolve) })
  cleanup.push(() => runtime.close())
  const pending = runtime.request('client', { method: 'capture.prepare', targetId: 'fake', text: 'saved draft' })
  await vi.waitFor(() => expect(resolveProvider).toBeTypeOf('function'))
  runtime.abort()
  resolveProvider(f.provider)
  await expect(pending).rejects.toThrow('stopped before dispatch')
  await runtime.close()
  expect(f.provider.create).not.toHaveBeenCalled()
})

it('does not turn a late success into a second delivery or send a failed preflight', async () => {
  let complete!: (result: { remoteId: string }) => void
  const f = await fixture(() => new Promise(resolve => complete = resolve))
  const command = await f.prepare()
  expect(await f.runtime.request('client', command)).toMatchObject({ status: 'uncertain' })
  complete({ remoteId: 'late-receipt' })
  await Promise.resolve()
  expect(await f.runtime.request('client', command)).toMatchObject({ status: 'uncertain' })
  expect(f.provider.create).toHaveBeenCalledTimes(1)
  const rejected = await f.prepare('preflight changes after review')
  f.provider.validate.mockImplementation(() => {
    throw new Error('Target unavailable before dispatch')
  })
  expect(await f.runtime.request('client', rejected)).toMatchObject({ status: 'failed-before-dispatch' })
  expect(await f.runtime.request('client', rejected)).toMatchObject({ status: 'failed-before-dispatch' })
  expect(f.provider.create).toHaveBeenCalledTimes(1)
})

it('retains exclusive ownership until transport cleanup has actually completed', async () => {
  const f = await fixture()
  await f.runtime.request('client', { method: 'capture.targets' })
  let finish!: () => void
  f.provider.close.mockImplementation(() => new Promise(resolve => finish = resolve))
  const closing = f.runtime.close()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  await expect(acquireProfileLease([f.options.dataDir], 'runtime-owner')).rejects.toThrow('profile is in use')
  finish()
  await closing
  const next = await acquireProfileLease([f.options.dataDir], 'runtime-owner')
  next.release()
})
