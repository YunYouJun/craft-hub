const { createHash, randomUUID } = require('node:crypto')
const { decideDocumentExchange, isRequestClaimable } = require('./repository-rules.cjs')

const COLLECTIONS = {
  bootstraps: 'craft_hub_device_bootstrap_codes',
  devices: 'craft_hub_devices',
  documents: 'craft_hub_sync_documents',
  conflicts: 'craft_hub_sync_conflicts',
  requests: 'craft_hub_remote_requests',
  nonces: 'craft_hub_device_nonces',
}

class CloudBasePersonalCloudRepository {
  constructor(database) {
    this.database = database
  }

  async createBootstrap(input) {
    await this.database.collection(COLLECTIONS.bootstraps).doc(input.codeHash).set({ ...input, _id: input.codeHash })
  }

  async findBootstrap(codeHash) {
    return first(await this.database.collection(COLLECTIONS.bootstraps).doc(codeHash).get())
  }

  async consumeBootstrap(codeHash, now) {
    return this.database.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.bootstraps).doc(codeHash)
      const bootstrap = first(await ref.get())
      if (!bootstrap || bootstrap.usedAt || bootstrap.expiresAt <= now)
        return false
      await ref.update({ usedAt: now })
      return true
    })
  }

  async createDevice(input) {
    const deviceId = randomUUID()
    const device = {
      _id: deviceId,
      deviceId,
      userId: input.userId,
      publicKey: input.publicKey,
      name: input.name,
      platform: input.platform,
      createdAt: input.now,
      lastSeenAt: input.now,
    }
    await this.database.collection(COLLECTIONS.devices).doc(deviceId).set(device)
    return publicDevice(device)
  }

  async getDevice(deviceId) {
    return first(await this.database.collection(COLLECTIONS.devices).doc(deviceId).get())
  }

  async listDevices(userId) {
    const result = await this.database.collection(COLLECTIONS.devices).where({ userId }).limit(100).get()
    return list(result).map(publicDevice)
  }

  async touchDevice(deviceId, now) {
    await this.database.collection(COLLECTIONS.devices).doc(deviceId).update({ lastSeenAt: now })
  }

  async revokeDevice(deviceId, now) {
    await this.database.collection(COLLECTIONS.devices).doc(deviceId).update({ revokedAt: now })
  }

  async consumeNonce(deviceId, nonceHash, expiresAt) {
    const id = digest(`${deviceId}:${nonceHash}`)
    return this.database.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.nonces).doc(id)
      if (first(await ref.get()))
        return false
      await ref.set({ _id: id, deviceId, nonceHash, expiresAt })
      return true
    })
  }

  async synchronize(userId, deviceId, documents, now) {
    const outgoing = []
    const conflicts = []
    const accepted = []
    const requestedKeys = new Set(documents.map(document => document.key))
    for (const incoming of documents) {
      const id = digest(`${userId}:${incoming.key}`)
      const decision = await this.database.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTIONS.documents).doc(id)
        const remote = first(await ref.get())
        const exchange = decideDocumentExchange(incoming, remote)
        if (exchange.action === 'accept') {
          await ref.set({ _id: id, ...incoming, userId, updatedByDeviceId: deviceId, updatedAt: now })
          return { action: 'accepted' }
        }
        if (exchange.action === 'unchanged')
          return { action: 'accepted' }
        if (exchange.action === 'remote')
          return { action: 'remote', document: documentValue(remote) }
        return exchange
      })
      if (decision.action === 'remote')
        outgoing.push(decision.document)
      if (decision.action === 'accepted')
        accepted.push({ key: incoming.key, revision: incoming.revision })
      if (decision.action === 'conflict') {
        const conflict = { key: incoming.key, localRevision: incoming.revision, remoteRevision: decision.remoteRevision }
        conflicts.push(conflict)
        const conflictId = randomUUID()
        await this.database.collection(COLLECTIONS.conflicts).doc(conflictId).set({
          _id: conflictId,
          ...conflict,
          userId,
          deviceId,
          candidatePayload: incoming.payload,
          createdAt: now,
        })
      }
    }
    const allRemote = await this.database.collection(COLLECTIONS.documents).where({ userId }).limit(100).get()
    for (const remote of list(allRemote)) {
      if (!requestedKeys.has(remote.key))
        outgoing.push(documentValue(remote))
    }
    return { documents: outgoing, conflicts, accepted }
  }

  async createRequest(input) {
    const requestId = randomUUID()
    const request = {
      _id: requestId,
      requestId,
      userId: input.userId,
      targetDeviceId: input.targetDeviceId,
      projectKey: input.projectKey,
      capabilityId: input.capabilityId,
      status: 'queued',
      createdAt: input.now,
      expiresAt: new Date(input.expiresAt).toISOString(),
    }
    await this.database.collection(COLLECTIONS.requests).doc(requestId).set(request)
    return requestValue(request)
  }

  async listRequests(userId) {
    const result = await this.database.collection(COLLECTIONS.requests).where({ userId }).orderBy('createdAt', 'desc').limit(100).get()
    return list(result).map(requestValue)
  }

  async cancelRequest(userId, requestId, now) {
    return this.database.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.requests).doc(requestId)
      const request = first(await ref.get())
      if (!request || request.userId !== userId)
        throw new Error('Unknown request')
      if (['queued', 'claimed', 'awaiting_approval'].includes(request.status)) {
        request.status = 'cancelled'
        request.finishedAt = new Date(now).toISOString()
        await ref.update({ status: request.status, finishedAt: request.finishedAt })
      }
      return requestValue(request)
    })
  }

  async claimRequests(userId, deviceId, now) {
    const results = await Promise.all(['queued', 'claimed', 'awaiting_approval'].map(status => this.database.collection(COLLECTIONS.requests)
      .where({ userId, targetDeviceId: deviceId, status })
      .orderBy('createdAt', 'asc')
      .limit(10)
      .get()))
    const candidates = results.flatMap(list).sort((left, right) => left.createdAt - right.createdAt).slice(0, 10)
    const claimed = []
    for (const candidate of candidates) {
      const value = await this.database.runTransaction(async (transaction) => {
        const ref = transaction.collection(COLLECTIONS.requests).doc(candidate.requestId)
        const request = first(await ref.get())
        if (!request || !isRequestClaimable(request, now))
          return null
        if (new Date(request.expiresAt).getTime() <= now) {
          await ref.update({ status: 'expired', finishedAt: new Date(now).toISOString() })
          return null
        }
        const leaseUntil = new Date(now + 30_000).toISOString()
        const claimId = randomUUID()
        await ref.update({ status: 'claimed', leaseUntil, claimId })
        return requestValue({ ...request, status: 'claimed', leaseUntil, claimId })
      })
      if (value)
        claimed.push(value)
    }
    return claimed
  }

  async updateRequest(userId, deviceId, update, now) {
    return this.database.runTransaction(async (transaction) => {
      const ref = transaction.collection(COLLECTIONS.requests).doc(update.requestId)
      const request = first(await ref.get())
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
      const patch = { status: update.status }
      if (update.status === 'awaiting_approval')
        patch.leaseUntil = new Date(now + 5 * 60_000).toISOString()
      if (update.status === 'running')
        patch.leaseUntil = null
      if (update.exitCode === null || Number.isSafeInteger(update.exitCode))
        patch.exitCode = update.exitCode
      if (['succeeded', 'failed', 'rejected', 'cancelled', 'expired'].includes(update.status))
        patch.finishedAt = update.finishedAt || new Date(now).toISOString()
      await ref.update(patch)
      return requestValue({ ...request, ...patch })
    })
  }
}

function first(result) {
  const data = result && result.data
  if (Array.isArray(data))
    return data[0] || null
  return data && typeof data === 'object' && Object.keys(data).length ? data : null
}

function list(result) {
  return Array.isArray(result && result.data) ? result.data : []
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
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
    payload: document.payload,
  }
}

function requestValue(request) {
  const { _id, userId, ...value } = request
  return value
}

module.exports = { COLLECTIONS, CloudBasePersonalCloudRepository }
