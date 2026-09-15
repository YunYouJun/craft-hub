import type { DeliveryOperationProvider, DeliveryWorkItemRef } from '../src/delivery'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeliveryCoordinator, DeliveryStore, deliveryWorkItemKey, initialDeliveryState } from '../src/delivery'

const stores: DeliveryStore<ReturnType<typeof initialDeliveryState>>[] = []
const directories: string[] = []
const owner = { id: 'alice' }
const member = { id: 'bob' }
const item: DeliveryWorkItemRef = { provider: 'issue-tracker', containerId: 'repo-one', kind: 'issue', itemId: '1', title: 'Fix the toolbar', url: 'https://example.com/issues/1', status: 'open', fetchedAt: 1 }

function fixture(operations?: DeliveryOperationProvider, path = ':memory:') {
  let now = 1_000_000
  const store = new DeliveryStore(path, initialDeliveryState)
  stores.push(store)
  const authorize = vi.fn(async (_actor, _project, permission, channel) => permission !== 'channel-read' || channel === 'shared-group')
  const coordinator = new DeliveryCoordinator(store, authorize, operations, () => now)
  return { store, coordinator, authorize, advance: (ms: number) => {
    now += ms
  } }
}

async function pair(coordinator: DeliveryCoordinator, actor = owner) {
  const verifier = 'test-local-verifier'
  const pairing = coordinator.beginPairing('Development device', createHash('sha256').update(verifier).digest('hex'))
  await coordinator.approvePairing(actor, pairing.id, ['project-one'])
  const device = coordinator.redeemPairing(pairing.id, verifier)
  coordinator.poll(device.id, device.token, { worktree: true, followup: false })
  return device
}

afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close()
    }
    catch {}
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('delivery identity and sharing', () => {
  it('distinguishes identical numbers across containers and kinds', () => {
    expect(deliveryWorkItemKey(item)).not.toBe(deliveryWorkItemKey({ ...item, containerId: 'repo-two' }))
    expect(deliveryWorkItemKey(item)).not.toBe(deliveryWorkItemKey({ ...item, kind: 'task' }))
    expect(deliveryWorkItemKey(item)).toBe(deliveryWorkItemKey({ ...item, title: 'Renamed', url: 'https://example.com/new-url' }))
  })

  it('retains one primary item and deduplicates related items', async () => {
    const { coordinator } = fixture()
    const first = await coordinator.bind(owner, 'project-one', item)
    expect((await coordinator.bind(owner, 'project-one', item)).id).toBe(first.id)
    const related = { ...item, provider: 'other-tracker' }
    await coordinator.relate(owner, first.id, related)
    const link = await coordinator.relate(owner, first.id, related)
    expect(link.primary).toEqual(item)
    expect(link.related).toHaveLength(1)
  })

  it('does not disclose a private task or permit unrelated channel readers', async () => {
    const { coordinator, authorize } = fixture()
    const link = await coordinator.bind(owner, 'project-one', item)
    await expect(coordinator.get(member, link.id)).rejects.toMatchObject({ status: 404 })
    expect(await coordinator.list(member)).toEqual([])
    await coordinator.share(owner, link.id, 'private-group', true)
    await expect(coordinator.get(member, link.id)).rejects.toMatchObject({ status: 404 })
    expect(await coordinator.list(member, 'private-group')).toEqual([])
    await coordinator.share(owner, link.id, 'shared-group', true)
    expect(await coordinator.list(member, 'shared-group')).toHaveLength(1)
    authorize.mockResolvedValue(false)
    expect(await coordinator.list(member, 'shared-group')).toEqual([])
  })
})

describe('device and request lifecycle', () => {
  it('rechecks the specific source before a receiver starts, even when project access remains', async () => {
    const store = new DeliveryStore(':memory:', initialDeliveryState)
    stores.push(store)
    const validate = vi.fn(async () => {})
    const coordinator = new DeliveryCoordinator(store, async () => true, undefined, Date.now, validate)
    const device = await pair(coordinator)
    const link = await coordinator.bind(owner, 'project-one', item)
    const request = await coordinator.createRequest(owner, { deliveryId: link.id, executorId: owner.id, deviceId: device.id, prompt: 'Build it', idempotencyKey: 'source-check' })
    validate.mockRejectedValue(new Error('Source access revoked'))
    await expect(coordinator.reportAuthorized(device.id, device.token, { id: request.id, sequence: 1, status: 'starting' })).rejects.toThrow('Source access revoked')
    expect(store.read().requests[0]?.status).toBe('dispatched')
    expect(await coordinator.list(owner)).toEqual([])
  })

  it('requires explicit approval and verifier proof before issuing a scoped token', async () => {
    const { coordinator } = fixture()
    const pairing = coordinator.beginPairing('Device', createHash('sha256').update('proof').digest('hex'))
    expect(() => coordinator.redeemPairing(pairing.id, 'wrong')).toThrow()
    expect(() => coordinator.redeemPairing(pairing.id, 'proof')).toThrow(/approval/)
    await coordinator.approvePairing(owner, pairing.id, ['project-one'])
    const device = coordinator.redeemPairing(pairing.id, 'proof')
    expect(() => coordinator.redeemPairing(pairing.id, 'proof')).toThrow()
    expect(JSON.stringify(coordinator.devices(owner))).not.toContain(device.token)
    coordinator.revokeDevice(owner, device.id)
    expect(() => coordinator.poll(device.id, device.token, { worktree: true, followup: false })).toThrow()
  })

  it('keeps offline drafts dormant when a device reconnects', async () => {
    const { coordinator, advance } = fixture()
    const device = await pair(coordinator)
    const link = await coordinator.bind(owner, 'project-one', item)
    advance(31000)
    const request = await coordinator.createRequest(owner, { deliveryId: link.id, executorId: owner.id, deviceId: device.id, prompt: 'Fix this', idempotencyKey: 'message-1' })
    expect(request.status).toBe('draft')
    expect(coordinator.poll(device.id, device.token, { worktree: true, followup: false })).toEqual([])
    expect((await coordinator.accept(owner, request.id)).status).toBe('dispatched')
  })

  it('does not execute an expired delivery that was never acknowledged', async () => {
    const { coordinator, advance } = fixture()
    const device = await pair(coordinator)
    const link = await coordinator.bind(owner, 'project-one', item)
    await coordinator.createRequest(owner, { deliveryId: link.id, executorId: owner.id, deviceId: device.id, prompt: 'Fix this', idempotencyKey: 'message-1' })
    advance(31000)
    expect(coordinator.poll(device.id, device.token, { worktree: true, followup: false })).toEqual([])
    expect((await coordinator.list(owner))[0].requests[0].status).toBe('draft')
  })

  it('requires the recipient to accept, and deduplicates replayed messages', async () => {
    const { coordinator } = fixture()
    const device = await pair(coordinator, member)
    const link = await coordinator.bind(owner, 'project-one', item)
    const input = { deliveryId: link.id, executorId: member.id, deviceId: device.id, prompt: 'Fix this', idempotencyKey: 'message-1' }
    const request = await coordinator.createRequest(owner, input)
    expect(request.status).toBe('awaiting_acceptance')
    expect(coordinator.poll(device.id, device.token, { worktree: true, followup: false })).toEqual([])
    await expect(coordinator.accept(owner, request.id)).rejects.toThrow()
    expect((await coordinator.accept(member, request.id)).status).toBe('dispatched')
    expect((await coordinator.createRequest(owner, input)).id).toBe(request.id)
    await expect(coordinator.createRequest(owner, { ...input, prompt: 'Changed' })).rejects.toMatchObject({ status: 409 })
  })

  it('rejects a second device report and preserves completion racing with cancellation', async () => {
    const { coordinator } = fixture()
    const device = await pair(coordinator)
    const other = await pair(coordinator)
    const link = await coordinator.bind(owner, 'project-one', item)
    const request = await coordinator.createRequest(owner, { deliveryId: link.id, executorId: owner.id, deviceId: device.id, prompt: 'Fix this', idempotencyKey: 'message-1' })
    expect(() => coordinator.report(other.id, other.token, { id: request.id, status: 'starting', sequence: 1 })).toThrow()
    coordinator.report(device.id, device.token, { id: request.id, status: 'starting', sequence: 1 })
    coordinator.report(device.id, device.token, { id: request.id, status: 'running', sequence: 2, localTaskId: 'local-one' })
    expect((await coordinator.cancel(owner, request.id)).status).toBe('cancel_requested')
    expect(coordinator.report(device.id, device.token, { id: request.id, status: 'completed', sequence: 3 }).status).toBe('completed')
    expect(coordinator.report(device.id, device.token, { id: request.id, status: 'running', sequence: 4 }).status).toBe('completed')
  })
})

describe('version-bound delivery operations', () => {
  function adapter() {
    return {
      plan: vi.fn(async () => ({ kind: 'publish', projectId: 'project-one', revision: 'commit-one', title: 'Publish preview', details: { environment: 'preview' } })),
      execute: vi.fn(async () => 'deployment-one'),
      reconcile: vi.fn(async () => ({ status: 'succeeded' as const, result: 'deployment-one' })),
    }
  }

  it('executes a reviewed operation only once under concurrent confirmations', async () => {
    const operations = adapter()
    const { coordinator } = fixture(operations)
    const link = await coordinator.bind(owner, 'project-one', item)
    const operation = await coordinator.planOperation(owner, link.id, 'publish', {})
    await Promise.all([coordinator.confirmOperation(owner, operation.id), coordinator.confirmOperation(owner, operation.id)])
    expect(operations.execute).toHaveBeenCalledTimes(1)
    expect((await coordinator.confirmOperation(owner, operation.id)).status).toBe('succeeded')
  })

  it('invalidates a confirmation when the revision changes', async () => {
    const operations = adapter()
    const { coordinator } = fixture(operations)
    const link = await coordinator.bind(owner, 'project-one', item)
    const operation = await coordinator.planOperation(owner, link.id, 'publish', {})
    operations.plan.mockResolvedValue({ ...operation.plan, revision: 'commit-two', details: { environment: 'preview' } })
    await expect(coordinator.confirmOperation(owner, operation.id)).rejects.toMatchObject({ status: 409 })
    expect(operations.execute).not.toHaveBeenCalled()
  })

  it('rejects another user and expired cards before writing', async () => {
    const operations = adapter()
    const { coordinator, advance } = fixture(operations)
    const link = await coordinator.bind(owner, 'project-one', item)
    const operation = await coordinator.planOperation(owner, link.id, 'publish', {})
    await expect(coordinator.confirmOperation(member, operation.id)).rejects.toMatchObject({ status: 404 })
    advance(600001)
    expect((await coordinator.confirmOperation(owner, operation.id)).status).toBe('expired')
    expect(operations.execute).not.toHaveBeenCalled()
  })

  it('reconciles uncertain writes without repeating the external operation', async () => {
    const operations = adapter()
    operations.execute.mockRejectedValue(new Error('Timed out after remote accepted the request'))
    const { coordinator } = fixture(operations)
    const link = await coordinator.bind(owner, 'project-one', item)
    const operation = await coordinator.planOperation(owner, link.id, 'publish', {})
    expect((await coordinator.confirmOperation(owner, operation.id)).status).toBe('unknown')
    await coordinator.confirmOperation(owner, operation.id)
    expect((await coordinator.reconcileOperation(owner, operation.id)).status).toBe('succeeded')
    expect(operations.execute).toHaveBeenCalledTimes(1)
  })
})

it('rolls back failed mutations and persists a JSON snapshot across reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'craft-delivery-'))
  directories.push(directory)
  const path = join(directory, 'state.sqlite')
  const { coordinator, store } = fixture(undefined, path)
  const link = await coordinator.bind(owner, 'project-one', item)
  expect(() => store.transaction('bad-write', (state) => {
    state.links = []
    throw new Error('Aborted')
  })).toThrow()
  store.close()
  const reopened = fixture(undefined, path)
  expect((await reopened.coordinator.get(owner, link.id)).primary).toEqual(item)
})
