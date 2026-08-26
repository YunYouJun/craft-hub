const { randomUUID } = require('node:crypto')
const { decideDocumentExchange, isRequestClaimable } = require('./repository-rules.cjs')

class MemoryPersonalCloudRepository {
  constructor() {
    this.bootstraps = new Map()
    this.devices = new Map()
    this.documents = new Map()
    this.conflicts = []
    this.requests = new Map()
    this.nonces = new Set()
  }

  async createBootstrap(input) {
    if (this.bootstraps.has(input.codeHash))
      throw new Error('Bootstrap already exists')
    this.bootstraps.set(input.codeHash, { ...input })
  }

  async findBootstrap(codeHash) {
    return clone(this.bootstraps.get(codeHash))
  }

  async consumeBootstrap(codeHash, now) {
    const bootstrap = this.bootstraps.get(codeHash)
    if (!bootstrap || bootstrap.usedAt || bootstrap.expiresAt <= now)
      return false
    bootstrap.usedAt = now
    return true
  }

  async createDevice(input) {
    const device = {
      deviceId: randomUUID(),
      userId: input.userId,
      publicKey: input.publicKey,
      name: input.name,
      platform: input.platform,
      createdAt: input.now,
      lastSeenAt: input.now,
    }
    this.devices.set(device.deviceId, device)
    return publicDevice(device)
  }

  async getDevice(deviceId) {
    return clone(this.devices.get(deviceId))
  }

  async listDevices(userId) {
    return [...this.devices.values()].filter(device => device.userId === userId).map(publicDevice)
  }

  async touchDevice(deviceId, now) {
    const device = this.devices.get(deviceId)
    if (device)
      device.lastSeenAt = now
  }

  async revokeDevice(deviceId, now) {
    const device = this.devices.get(deviceId)
    if (device)
      device.revokedAt = now
  }

  async consumeNonce(deviceId, nonceHash) {
    const key = `${deviceId}:${nonceHash}`
    if (this.nonces.has(key))
      return false
    this.nonces.add(key)
    return true
  }

  async synchronize(userId, deviceId, documents, now) {
    const outgoing = []
    const conflicts = []
    const accepted = []
    const requestedKeys = new Set(documents.map(document => document.key))
    for (const incoming of documents) {
      const storageKey = `${userId}:${incoming.key}`
      const remote = this.documents.get(storageKey)
      const exchange = decideDocumentExchange(incoming, remote)
      if (exchange.action === 'accept') {
        this.documents.set(storageKey, { ...incoming, userId, updatedByDeviceId: deviceId, updatedAt: now })
        accepted.push({ key: incoming.key, revision: incoming.revision })
        continue
      }
      if (exchange.action === 'unchanged') {
        accepted.push({ key: incoming.key, revision: incoming.revision })
        continue
      }
      if (exchange.action === 'remote') {
        outgoing.push(documentValue(remote))
        continue
      }
      const conflict = { key: incoming.key, localRevision: incoming.revision, remoteRevision: remote.revision }
      conflicts.push(conflict)
      this.conflicts.push({ ...conflict, userId, deviceId, candidatePayload: incoming.payload, createdAt: now })
    }
    for (const [storageKey, remote] of this.documents) {
      if (storageKey.startsWith(`${userId}:`) && !requestedKeys.has(remote.key))
        outgoing.push(documentValue(remote))
    }
    return { documents: outgoing, conflicts, accepted }
  }

  async createRequest(input) {
    const request = {
      requestId: randomUUID(),
      userId: input.userId,
      targetDeviceId: input.targetDeviceId,
      projectKey: input.projectKey,
      capabilityId: input.capabilityId,
      status: 'queued',
      createdAt: input.now,
      expiresAt: new Date(input.expiresAt).toISOString(),
    }
    this.requests.set(request.requestId, request)
    return clone(request)
  }

  async listRequests(userId) {
    return [...this.requests.values()].filter(request => request.userId === userId).map(clone)
  }

  async cancelRequest(userId, requestId, now) {
    const request = this.requests.get(requestId)
    if (!request || request.userId !== userId)
      throw new Error('Unknown request')
    if (request.status === 'queued' || request.status === 'claimed' || request.status === 'awaiting_approval') {
      request.status = 'cancelled'
      request.finishedAt = new Date(now).toISOString()
    }
    return clone(request)
  }

  async claimRequests(userId, deviceId, now) {
    const claimed = []
    for (const request of this.requests.values()) {
      if (request.userId !== userId || request.targetDeviceId !== deviceId || !isRequestClaimable(request, now))
        continue
      if (new Date(request.expiresAt).getTime() <= now) {
        request.status = 'expired'
        continue
      }
      request.status = 'claimed'
      request.leaseUntil = new Date(now + 30_000).toISOString()
      request.claimId = randomUUID()
      claimed.push(clone(request))
    }
    return claimed
  }

  async updateRequest(userId, deviceId, update, now) {
    const request = this.requests.get(update.requestId)
    if (!request || request.userId !== userId || request.targetDeviceId !== deviceId)
      throw new Error('Unknown request')
    if (!update.claimId || update.claimId !== request.claimId)
      throw new Error('Stale request claim')
    const allowed = {
      claimed: ['awaiting_approval', 'running', 'rejected', 'expired'],
      awaiting_approval: ['running', 'rejected', 'expired'],
      running: ['succeeded', 'failed', 'cancelled'],
    }
    if (!(allowed[request.status] || []).includes(update.status))
      throw new Error('Invalid request status transition')
    request.status = update.status
    if (update.status === 'awaiting_approval')
      request.leaseUntil = new Date(now + 5 * 60_000).toISOString()
    if (update.status === 'running')
      request.leaseUntil = undefined
    if (update.exitCode === null || Number.isSafeInteger(update.exitCode))
      request.exitCode = update.exitCode
    if (['succeeded', 'failed', 'rejected', 'cancelled', 'expired'].includes(update.status))
      request.finishedAt = update.finishedAt || new Date(now).toISOString()
    return clone(request)
  }
}

function publicDevice(device) {
  return {
    deviceId: device.deviceId,
    name: device.name,
    platform: device.platform,
    lastSeenAt: device.lastSeenAt,
    ...(device.revokedAt ? { revokedAt: device.revokedAt } : {}),
  }
}

function documentValue(document) {
  return {
    key: document.key,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    ...(document.parentRevision ? { parentRevision: document.parentRevision } : {}),
    payload: clone(document.payload),
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

module.exports = { MemoryPersonalCloudRepository }
