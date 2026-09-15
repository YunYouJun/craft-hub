import type { DeliveryStore } from './store'
import type { DeliveryActor, DeliveryDevice, DeliveryLink, DeliveryOperation, DeliveryOperationPlan, DeliveryOperationProvider, DeliveryPermission, DeliveryRequest, DeliveryRequestStatus, DeliveryState, DeliveryWorkItemRef } from './types'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DeliveryError, deliveryId, deliveryWorkItemKey, workItemRefSchema } from './types'

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const terminal = new Set<DeliveryRequestStatus>(['completed', 'failed', 'cancelled', 'declined'])
const active = new Set<DeliveryRequestStatus>(['dispatched', 'starting', 'running', 'needs_attention', 'cancel_requested'])
const requestSchema = z.object({ deliveryId, executorId: deliveryId, deviceId: deliveryId, prompt: z.string().trim().min(1).max(32000), mode: z.enum(['worktree', 'checkout']).default('worktree'), parentId: deliveryId.optional(), continuation: z.boolean().optional(), idempotencyKey: deliveryId }).strict()
const operationSchema = z.object({ kind: deliveryId, projectId: deliveryId, revision: deliveryId, title: z.string().min(1).max(500), details: z.record(z.string().max(200), z.string().max(16000)) }).strict()

/** Shared task ledger. Authorization and platform effects remain trusted host adapters. */
export class DeliveryCoordinator {
  constructor(
    readonly store: DeliveryStore<DeliveryState>,
    private readonly authorize: (actor: DeliveryActor, projectId: string, permission: DeliveryPermission, channelId?: string) => Promise<boolean>,
    private readonly operations?: DeliveryOperationProvider,
    private readonly now: () => number = Date.now,
    private readonly validateWorkItem?: (actor: DeliveryActor, link: DeliveryLink) => Promise<void>,
  ) {}

  private async require(actor: DeliveryActor, projectId: string, permission: DeliveryPermission, channelId?: string): Promise<void> {
    deliveryId.parse(actor.id)
    if (!await this.authorize(actor, projectId, permission, channelId))
      throw new DeliveryError(403, 'Operation is not permitted')
  }

  async get(actor: DeliveryActor, id: string): Promise<DeliveryLink> {
    const link = this.store.read().links.find(item => item.id === id)
    if (!link)
      throw new DeliveryError(404, 'Work item is unavailable')
    await this.require(actor, link.projectId, 'read')
    await this.validateWorkItem?.(actor, link)
    // A caller must own the item, be its assigned executor, or access an explicitly shared item.
    const state = this.store.read()
    if (link.ownerId !== actor.id && !state.requests.some(item => item.deliveryId === id && item.executorId === actor.id)) {
      const shared = await Promise.all(link.channels.map(channel => this.authorize(actor, link.projectId, 'channel-read', channel)))
      if (!shared.some(Boolean))
        throw new DeliveryError(404, 'Work item is unavailable')
    }
    return link
  }

  async bind(actor: DeliveryActor, projectId: string, primary: DeliveryWorkItemRef): Promise<DeliveryLink> {
    primary = workItemRefSchema.parse(primary)
    await this.require(actor, projectId, 'read')
    return this.store.transaction('link.bind', (state) => {
      const existing = state.links.find(link => link.ownerId === actor.id && link.projectId === projectId && deliveryWorkItemKey(link.primary) === deliveryWorkItemKey(primary))
      if (existing) {
        existing.primary = primary
        return existing
      }
      const link: DeliveryLink = { id: randomUUID(), ownerId: actor.id, projectId, primary, related: [], channels: [], createdAt: this.now() }
      state.links.push(link)
      return link
    })
  }

  async relate(actor: DeliveryActor, id: string, related: DeliveryWorkItemRef): Promise<DeliveryLink> {
    related = workItemRefSchema.parse(related)
    const link = await this.get(actor, id)
    if (link.ownerId !== actor.id)
      await this.require(actor, link.projectId, 'manage')
    return this.store.transaction('link.relate', (state) => {
      const target = state.links.find(item => item.id === id)!
      if (deliveryWorkItemKey(target.primary) !== deliveryWorkItemKey(related)) {
        target.related = target.related.filter(item => deliveryWorkItemKey(item) !== deliveryWorkItemKey(related))
        target.related.push(related)
      }
      return target
    })
  }

  async share(actor: DeliveryActor, id: string, channelId: string, enabled: boolean): Promise<void> {
    const link = await this.get(actor, id)
    if (link.ownerId !== actor.id)
      await this.require(actor, link.projectId, 'manage')
    deliveryId.parse(channelId)
    await this.require(actor, link.projectId, 'share', channelId)
    this.store.transaction('link.share', (state) => {
      const target = state.links.find(item => item.id === id)!
      target.channels = target.channels.filter(item => item !== channelId)
      if (enabled)
        target.channels.push(channelId)
    })
  }

  async list(actor: DeliveryActor, channelId?: string): Promise<Array<{ link: DeliveryLink, requests: DeliveryRequest[], operations: DeliveryOperation[] }>> {
    const state = this.store.read()
    const visible: Array<{ link: DeliveryLink, requests: DeliveryRequest[], operations: DeliveryOperation[] }> = []
    for (const link of state.links) {
      const requests = state.requests.filter(item => item.deliveryId === link.id)
      if (channelId ? !link.channels.includes(channelId) : link.ownerId !== actor.id && !requests.some(item => item.executorId === actor.id))
        continue
      if (!await this.authorize(actor, link.projectId, channelId ? 'channel-read' : 'read', channelId))
        continue
      try {
        await this.validateWorkItem?.(actor, link)
      }
      catch {
        continue
      }
      visible.push({ link, requests, operations: state.operations.filter(item => item.deliveryId === link.id) })
    }
    return visible.sort((a, b) => b.link.createdAt - a.link.createdAt)
  }

  beginPairing(name: string, verifierHash: string): { id: string, expiresAt: number } {
    z.string().regex(/^[a-f0-9]{64}$/).parse(verifierHash)
    z.string().trim().min(1).max(120).parse(name)
    return this.store.transaction('pairing.begin', (state) => {
      state.pairings = state.pairings.filter(item => item.expiresAt > this.now())
      if (state.pairings.length >= 100)
        throw new DeliveryError(429, 'Too many pending pairings')
      const pairing = { id: randomBytes(16).toString('hex'), verifierHash, name, expiresAt: this.now() + 600000, projectIds: [] }
      state.pairings.push(pairing)
      return { id: pairing.id, expiresAt: pairing.expiresAt }
    })
  }

  async approvePairing(actor: DeliveryActor, id: string, projectIds: string[]): Promise<void> {
    z.array(deliveryId).min(1).max(200).parse(projectIds)
    for (const project of projectIds)
      await this.require(actor, project, 'execute')
    this.store.transaction('pairing.approve', (state) => {
      const pairing = state.pairings.find(item => item.id === id && item.expiresAt > this.now())
      if (!pairing || pairing.ownerId)
        throw new DeliveryError(409, 'Pairing is unavailable')
      pairing.ownerId = actor.id
      pairing.projectIds = [...new Set(projectIds)]
    })
  }

  redeemPairing(id: string, verifier: string): { id: string, token: string } {
    return this.store.transaction('pairing.redeem', (state) => {
      const pairing = state.pairings.find(item => item.id === id && item.expiresAt > this.now() && item.verifierHash === digest(verifier))
      if (!pairing)
        throw new DeliveryError(401, 'Pairing is unavailable')
      if (!pairing.ownerId)
        throw new DeliveryError(409, 'Pairing awaits owner approval')
      const token = randomBytes(32).toString('hex')
      const device: DeliveryDevice = { id: randomUUID(), ownerId: pairing.ownerId, name: pairing.name, projectIds: pairing.projectIds, tokenHash: digest(token), capabilities: { worktree: false, followup: false }, lastSeenAt: 0, revoked: false }
      state.devices.push(device)
      state.pairings = state.pairings.filter(item => item.id !== id)
      return { id: device.id, token }
    })
  }

  private device(state: DeliveryState, id: string, token: string): DeliveryDevice {
    const device = state.devices.find(item => item.id === id && !item.revoked && item.tokenHash === digest(token))
    if (!device)
      throw new DeliveryError(401, 'Device authorization is unavailable')
    return device
  }

  devices(actor: DeliveryActor): Array<Omit<DeliveryDevice, 'tokenHash'> & { online: boolean }> {
    return this.store.read().devices.filter(item => item.ownerId === actor.id).map(({ tokenHash: _, ...item }) => ({ ...item, online: !item.revoked && item.lastSeenAt > this.now() - 30000 }))
  }

  revokeDevice(actor: DeliveryActor, id: string): void {
    this.store.transaction('device.revoke', (state) => {
      const device = state.devices.find(item => item.id === id && item.ownerId === actor.id)
      if (!device)
        throw new DeliveryError(404, 'Device is unavailable')
      device.revoked = true
    })
  }

  poll(id: string, token: string, capabilities: DeliveryDevice['capabilities']): DeliveryRequest[] {
    capabilities = z.object({ worktree: z.boolean(), followup: z.boolean() }).strict().parse(capabilities)
    return this.store.transaction('device.poll', (state) => {
      const device = this.device(state, id, token)
      device.lastSeenAt = this.now()
      device.capabilities = capabilities
      for (const request of state.requests) {
        if (request.deviceId === id && request.status === 'dispatched' && request.updatedAt <= this.now() - 30000) {
          request.status = 'draft'
          request.updatedAt = this.now()
        }
      }
      return state.requests.filter(item => item.deviceId === id && active.has(item.status))
    })
  }

  async createRequest(actor: DeliveryActor, input: z.input<typeof requestSchema>): Promise<DeliveryRequest> {
    const data = requestSchema.parse(input)
    const link = await this.get(actor, data.deliveryId)
    await this.require(actor, link.projectId, 'execute')
    // An assignment is not permission to run; the receiver must accept with their own identity.
    return this.store.transaction('request.create', (state) => {
      const key = digest(JSON.stringify([actor.id, 'request', data.idempotencyKey]))
      const fingerprint = digest(JSON.stringify(data))
      const previous = state.deduplication[key]
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new DeliveryError(409, 'Idempotency key was used for another request')
        return state.requests.find(item => item.id === previous.id)!
      }
      const device = state.devices.find(item => item.id === data.deviceId && item.ownerId === data.executorId && !item.revoked && item.projectIds.includes(link.projectId))
      if (!device)
        throw new DeliveryError(404, 'Execution target is unavailable')
      if (data.mode === 'worktree' && !device.capabilities.worktree)
        throw new DeliveryError(409, 'The selected device does not support isolated worktrees')
      if (data.continuation && (!data.parentId || !device.capabilities.followup))
        throw new DeliveryError(409, 'The original task or provider cannot accept follow-up work')
      if (data.parentId) {
        const parent = state.requests.find(item => item.id === data.parentId && item.deliveryId === link.id && terminal.has(item.status))
        if (data.continuation && (!parent || parent.deviceId !== device.id || parent.executorId !== actor.id || parent.mode !== data.mode || !parent.localTaskId))
          throw new DeliveryError(409, 'A continuation must use the original executor, device and workspace')
        if (!parent)
          throw new DeliveryError(409, 'Select a finished attempt before retrying')
      }
      const available = device.lastSeenAt > this.now() - 30000 && !state.requests.some(item => item.deviceId === device.id && active.has(item.status))
      const request: DeliveryRequest = { id: randomUUID(), deliveryId: link.id, requesterId: actor.id, executorId: data.executorId, deviceId: device.id, projectId: link.projectId, prompt: data.prompt, mode: data.mode, status: actor.id !== data.executorId ? 'awaiting_acceptance' : available ? 'dispatched' : 'draft', createdAt: this.now(), updatedAt: this.now(), reportSequence: 0, ...(data.parentId ? { parentId: data.parentId } : {}), ...(data.continuation ? { continuation: true } : {}) }
      state.requests.push(request)
      state.deduplication[key] = { id: request.id, fingerprint }
      return request
    })
  }

  async accept(actor: DeliveryActor, id: string, accepted = true): Promise<DeliveryRequest> {
    const request = this.store.read().requests.find(item => item.id === id && item.executorId === actor.id)
    if (!request)
      throw new DeliveryError(404, 'Request is unavailable')
    await this.require(actor, request.projectId, 'execute')
    await this.get(actor, request.deliveryId)
    return this.store.transaction('request.accept', (state) => {
      const item = state.requests.find(item => item.id === id)!
      if (!['draft', 'awaiting_acceptance'].includes(item.status))
        throw new DeliveryError(409, 'Request was already handled')
      const device = state.devices.find(device => device.id === item.deviceId && device.ownerId === actor.id && !device.revoked && device.projectIds.includes(item.projectId))
      if (!accepted) {
        item.status = 'declined'
      }
      else {
        if (!device || device.lastSeenAt <= this.now() - 30000 || state.requests.some(other => other.id !== id && other.deviceId === device.id && active.has(other.status)))
          throw new DeliveryError(409, 'Device is offline or busy; send this draft explicitly when available')
        item.status = 'dispatched'
      }
      item.updatedAt = this.now()
      return item
    })
  }

  async cancel(actor: DeliveryActor, id: string): Promise<DeliveryRequest> {
    const request = this.store.read().requests.find(item => item.id === id && item.executorId === actor.id)
    if (!request)
      throw new DeliveryError(404, 'Request is unavailable')
    return this.store.transaction('request.cancel', (state) => {
      const item = state.requests.find(item => item.id === id)!
      if (!terminal.has(item.status))
        item.status = ['draft', 'awaiting_acceptance', 'dispatched'].includes(item.status) ? 'cancelled' : 'cancel_requested'
      item.updatedAt = this.now()
      return item
    })
  }

  report(deviceId: string, token: string, input: { id: string, sequence: number, status: DeliveryRequestStatus, localTaskId?: string, summary?: string }): DeliveryRequest {
    const data = z.object({ id: deliveryId, sequence: z.number().int().positive(), status: z.enum(['starting', 'running', 'needs_attention', 'completed', 'failed', 'cancelled']), localTaskId: deliveryId.optional(), summary: z.string().max(8000).optional() }).strict().parse(input)
    return this.store.transaction('request.report', (state) => {
      this.device(state, deviceId, token)
      const item = state.requests.find(item => item.id === data.id && item.deviceId === deviceId)
      if (!item)
        throw new DeliveryError(404, 'Request is unavailable')
      if (data.sequence <= item.reportSequence)
        return item
      if (terminal.has(item.status))
        return item
      const transitions: Partial<Record<DeliveryRequestStatus, string[]>> = { dispatched: ['starting', 'failed'], starting: ['running', 'needs_attention', 'completed', 'failed', 'cancelled'], running: ['running', 'needs_attention', 'completed', 'failed', 'cancelled'], needs_attention: ['running', 'needs_attention', 'completed', 'failed', 'cancelled'], cancel_requested: ['running', 'completed', 'failed', 'cancelled'] }
      if (!transitions[item.status]?.includes(data.status))
        throw new DeliveryError(409, 'Invalid task transition')
      if (item.localTaskId && data.localTaskId && item.localTaskId !== data.localTaskId)
        throw new DeliveryError(409, 'Request is already attached to another task')
      if (item.status !== 'cancel_requested' || terminal.has(data.status))
        item.status = data.status
      item.reportSequence = data.sequence
      item.updatedAt = this.now()
      item.localTaskId ??= data.localTaskId
      if (data.summary !== undefined)
        item.summary = data.summary
      return item
    })
  }

  /** Check current execution authorization before a receiver claims a request. */
  async reportAuthorized(deviceId: string, token: string, input: { id: string, sequence: number, status: DeliveryRequestStatus, localTaskId?: string, summary?: string }): Promise<DeliveryRequest> {
    const state = this.store.read()
    const device = this.device(state, deviceId, token)
    const request = state.requests.find(item => item.id === input.id && item.deviceId === deviceId)
    if (!request)
      throw new DeliveryError(404, 'Request is unavailable')
    if (input.status === 'starting') {
      await this.require({ id: device.ownerId }, request.projectId, 'execute')
      await this.get({ id: device.ownerId }, request.deliveryId)
    }
    return this.report(deviceId, token, input)
  }

  async planOperation(actor: DeliveryActor, id: string, kind: string, input: Record<string, string>): Promise<DeliveryOperation> {
    const link = await this.get(actor, id)
    await this.require(actor, link.projectId, 'deliver')
    if (!this.operations)
      throw new DeliveryError(409, 'No delivery operation adapter is configured')
    const plan = operationSchema.parse(await this.operations.plan(actor, link, kind, input))
    if (plan.projectId !== link.projectId)
      throw new DeliveryError(409, 'Operation changed the selected project')
    return this.store.transaction('operation.plan', (state) => {
      const fingerprint = this.planFingerprint(plan)
      const existing = state.operations.find(item => item.deliveryId === id && item.actorId === actor.id && item.fingerprint === fingerprint && ['awaiting_confirmation', 'executing', 'unknown', 'succeeded'].includes(item.status) && (item.status !== 'awaiting_confirmation' || item.expiresAt > this.now()))
      if (existing)
        return existing
      const operation: DeliveryOperation = { id: randomUUID(), deliveryId: id, actorId: actor.id, plan, fingerprint, status: 'awaiting_confirmation', expiresAt: this.now() + 600000 }
      state.operations.push(operation)
      return operation
    })
  }

  private planFingerprint(plan: DeliveryOperationPlan): string {
    return digest(JSON.stringify({ ...plan, details: Object.fromEntries(Object.entries(plan.details).sort(([a], [b]) => a.localeCompare(b))) }))
  }

  async confirmOperation(actor: DeliveryActor, id: string): Promise<DeliveryOperation> {
    const operation = this.store.read().operations.find(item => item.id === id && item.actorId === actor.id)
    if (!operation || !this.operations)
      throw new DeliveryError(404, 'Operation is unavailable')
    const link = await this.get(actor, operation.deliveryId)
    await this.require(actor, link.projectId, 'deliver')
    if (operation.status !== 'awaiting_confirmation')
      return operation
    const refreshed = operationSchema.parse(await this.operations.plan(actor, link, operation.plan.kind, operation.plan.details))
    if (this.planFingerprint(refreshed) !== operation.fingerprint)
      throw new DeliveryError(409, 'The target changed; review a new plan')
    const claimed = this.store.transaction('operation.claim', (state) => {
      const item = state.operations.find(item => item.id === id)!
      if (item.status !== 'awaiting_confirmation')
        return false
      if (item.expiresAt <= this.now()) {
        item.status = 'expired'
        return false
      }
      item.status = 'executing'
      return true
    })
    if (!claimed)
      return this.store.read().operations.find(item => item.id === id)!
    try {
      const result = await this.operations.execute(actor, operation.plan, operation.id)
      return this.finishOperation(id, 'succeeded', result)
    }
    catch {
      // A thrown network error cannot prove that an external write did not happen.
      return this.finishOperation(id, 'unknown', 'The remote result must be reconciled before another attempt')
    }
  }

  async reconcileOperation(actor: DeliveryActor, id: string): Promise<DeliveryOperation> {
    const operation = this.store.read().operations.find(item => item.id === id && item.actorId === actor.id)
    if (!operation || !this.operations?.reconcile)
      throw new DeliveryError(404, 'Reconciliation is unavailable')
    await this.get(actor, operation.deliveryId)
    await this.require(actor, operation.plan.projectId, 'deliver')
    if (!['executing', 'unknown'].includes(operation.status))
      return operation
    const result = await this.operations.reconcile(actor, operation.plan, id)
    return this.finishOperation(id, result.status, result.result)
  }

  private finishOperation(id: string, status: 'succeeded' | 'failed' | 'unknown', result: string): DeliveryOperation {
    return this.store.transaction('operation.result', (state) => {
      const item = state.operations.find(item => item.id === id)!
      if (['succeeded', 'failed'].includes(item.status))
        return item
      item.status = status
      item.result = result.slice(0, 8000)
      return item
    })
  }

  /** Retain identity and outcomes while removing expired cloud prompt bodies and summaries. */
  pruneContent(retentionMs = 30 * 86400000): number {
    if (!Number.isFinite(retentionMs) || retentionMs < 0)
      throw new Error('Invalid retention duration')
    return this.store.transaction('content.prune', (state) => {
      let count = 0
      for (const item of state.requests) {
        if (terminal.has(item.status) && item.updatedAt < this.now() - retentionMs && (item.prompt || item.summary)) {
          item.prompt = ''
          delete item.summary
          count++
        }
      }
      return count
    })
  }
}
