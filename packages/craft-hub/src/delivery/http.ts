import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeliveryCoordinator } from './coordinator'
import type { DeliveryReceiverTransport } from './receiver'
import type { DeliveryActor, DeliveryWorkItemRef } from './types'
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { DeliveryError, deliveryId } from './types'

export interface DeliveryHttpOptions {
  coordinator: DeliveryCoordinator
  origin: string
  identify: (request: IncomingMessage) => Promise<DeliveryActor>
  /** Resolve with the caller's source credentials. Client-supplied titles and identities are not trusted. */
  resolveWorkItem: (actor: DeliveryActor, projectId: string, url: string) => Promise<DeliveryWorkItemRef>
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new DeliveryError(415, 'JSON content is required')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 128 * 1024)
      throw new DeliveryError(413, 'Request is too large')
    chunks.push(chunk)
  }
  return z.record(z.string(), z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

/** Mount behind a trusted identity gateway. Receiver credentials and browser identity remain separate. */
export function createDeliveryHttpHandler(options: DeliveryHttpOptions) {
  const { coordinator } = options
  const origin = new URL(options.origin).origin
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', origin)
    const prefix = '/api/delivery'
    if (!url.pathname.startsWith(`${prefix}/`))
      return false
    const send = (status: number, data: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(JSON.stringify(data))
    }
    try {
      if (request.headers.host !== new URL(origin).host)
        throw new DeliveryError(403, 'Request host does not match the configured origin')
      const path = url.pathname.slice(prefix.length)
      // Anonymous pairing requests require proof from a local receiver; they cannot execute code.
      if (request.method === 'POST' && path === '/pairings') {
        const input = z.object({ name: z.string(), verifierHash: z.string() }).strict().parse(await body(request))
        send(201, coordinator.beginPairing(input.name, input.verifierHash))
        return true
      }
      if (request.method === 'POST' && path === '/pairings/redeem') {
        const input = z.object({ id: deliveryId, verifier: z.string().min(32).max(200) }).strict().parse(await body(request))
        send(200, coordinator.redeemPairing(input.id, input.verifier))
        return true
      }
      if (path.startsWith('/receiver/')) {
        if (request.method !== 'POST')
          throw new DeliveryError(405, 'Method is not supported')
        const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1]
        if (!token)
          throw new DeliveryError(401, 'Device authorization is required')
        const input = await body(request)
        const deviceId = deliveryId.parse(input.deviceId)
        if (path === '/receiver/poll') {
          const capabilities = z.object({ worktree: z.boolean(), followup: z.boolean() }).strict().parse(input.capabilities)
          send(200, coordinator.poll(deviceId, token, capabilities))
          return true
        }
        if (path === '/receiver/report') {
          // Validate through the coordinator; no browser identity can substitute a receiver token.
          const data = z.object({ id: deliveryId, sequence: z.number().int().positive(), status: z.enum(['starting', 'running', 'needs_attention', 'completed', 'failed', 'cancelled']), localTaskId: deliveryId.optional(), summary: z.string().max(8000).optional() }).strict().parse(input.report)
          send(200, await coordinator.reportAuthorized(deviceId, token, data))
          return true
        }
        throw new DeliveryError(404, 'Receiver operation is unavailable')
      }
      const actor = await options.identify(request)
      if (request.method !== 'GET' && (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site'))
        throw new DeliveryError(403, 'A same-origin user action is required')
      if (path === '/devices' && request.method === 'GET') {
        send(200, coordinator.devices(actor))
        return true
      }
      if (path === '/tasks' && request.method === 'GET') {
        const channel = url.searchParams.get('channel') ?? undefined
        const tasks = await coordinator.list(actor, channel)
        send(200, channel ? tasks.map(({ link, requests }) => ({ id: link.id, projectId: link.projectId, title: link.primary.title, status: link.primary.status, fetchedAt: link.primary.fetchedAt, requests: requests.map(({ id, status, updatedAt }) => ({ id, status, updatedAt })) })) : tasks)
        return true
      }
      if (request.method !== 'POST')
        throw new DeliveryError(405, 'Method is not supported')
      const input = await body(request)
      if (path === '/links') {
        const data = z.object({ projectId: deliveryId, url: z.string().url() }).strict().parse(input)
        const source = await options.resolveWorkItem(actor, data.projectId, data.url)
        send(201, await coordinator.bind(actor, data.projectId, source))
      }
      else if (path === '/links/relate') {
        const data = z.object({ id: deliveryId, url: z.string().url() }).strict().parse(input)
        const link = await coordinator.get(actor, data.id)
        send(200, await coordinator.relate(actor, data.id, await options.resolveWorkItem(actor, link.projectId, data.url)))
      }
      else if (path === '/links/share') {
        const data = z.object({ id: deliveryId, channelId: deliveryId, enabled: z.boolean() }).strict().parse(input)
        await coordinator.share(actor, data.id, data.channelId, data.enabled)
        send(200, { ok: true })
      }
      else if (path === '/requests') {
        const data = z.object({ deliveryId, executorId: deliveryId, deviceId: deliveryId, prompt: z.string(), mode: z.enum(['worktree', 'checkout']).optional(), parentId: deliveryId.optional(), continuation: z.boolean().optional(), idempotencyKey: deliveryId }).strict().parse(input)
        send(201, await coordinator.createRequest(actor, data))
      }
      else if (path === '/pairings/approve') {
        const data = z.object({ id: deliveryId, projectIds: z.array(deliveryId).min(1) }).strict().parse(input)
        await coordinator.approvePairing(actor, data.id, data.projectIds)
        send(200, { ok: true })
      }
      else if (path === '/devices/revoke') {
        coordinator.revokeDevice(actor, deliveryId.parse(input.id))
        send(200, { ok: true })
      }
      else if (path === '/requests/accept') {
        send(200, await coordinator.accept(actor, deliveryId.parse(input.id), z.boolean().parse(input.accepted)))
      }
      else if (path === '/requests/cancel') {
        send(200, await coordinator.cancel(actor, deliveryId.parse(input.id)))
      }
      else if (path === '/operations/plan') {
        const data = z.object({ deliveryId, kind: deliveryId, input: z.record(z.string(), z.string()) }).strict().parse(input)
        send(201, await coordinator.planOperation(actor, data.deliveryId, data.kind, data.input))
      }
      else if (path === '/operations/confirm') {
        send(200, await coordinator.confirmOperation(actor, deliveryId.parse(input.id)))
      }
      else if (path === '/operations/reconcile') {
        send(200, await coordinator.reconcileOperation(actor, deliveryId.parse(input.id)))
      }
      else {
        throw new DeliveryError(404, 'Delivery operation is unavailable')
      }
    }
    catch (error) {
      send(error instanceof DeliveryError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500, { error: error instanceof DeliveryError ? error.message : 'Delivery request could not be completed' })
    }
    return true
  }
}

/** No redirects: credentials may only be sent to the explicitly configured broker origin. */
export function createDeliveryReceiverTransport(origin: string, device: { id: string, token: string }, fetch: typeof globalThis.fetch = globalThis.fetch): DeliveryReceiverTransport {
  const base = new URL(origin)
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))))
    throw new Error('Use an HTTPS broker origin or a loopback development server')
  const post = async <T>(path: string, input: unknown): Promise<T> => {
    const response = await fetch(new URL(`/api/delivery/receiver/${path}`, base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', 'authorization': `Bearer ${device.token}` }, body: JSON.stringify({ deviceId: device.id, ...input as object }) })
    if (!response.ok)
      throw new DeliveryError(response.status, 'Device connection request failed')
    return await response.json() as T
  }
  return { poll: capabilities => post('poll', { capabilities }), report: report => post('report', { report }) }
}
