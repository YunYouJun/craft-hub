const RECOVERABLE_REQUEST_STATUSES = new Set(['claimed', 'awaiting_approval'])

function decideDocumentExchange(incoming, remote) {
  if (!remote)
    return { action: 'accept' }
  if (remote.revision === incoming.revision)
    return { action: 'unchanged' }
  if (incoming.parentRevision === remote.revision)
    return { action: 'accept' }
  if (incoming.parentRevision && incoming.revision === incoming.parentRevision)
    return { action: 'remote' }
  return { action: 'conflict', remoteRevision: remote.revision }
}

function isRequestClaimable(request, now) {
  if (request.status === 'queued')
    return true
  return RECOVERABLE_REQUEST_STATUSES.has(request.status)
    && Number.isFinite(Date.parse(request.leaseUntil))
    && Date.parse(request.leaseUntil) <= now
}

module.exports = { decideDocumentExchange, isRequestClaimable }
