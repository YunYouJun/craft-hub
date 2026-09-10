import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentConnectionService } from './agent-connection'
import { Buffer } from 'node:buffer'
import { ZodError } from 'zod'
import { AgentAccessError } from './agent-connection'

/** Handle local connection management separately from the credential-protected agent reads. */
export async function handleAgentConnectionRequest(service: AgentConnectionService, origin: string, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  const path = new URL(request.url ?? '/', origin).pathname
  if (!['/api/agent-connection', '/api/agent-access'].includes(path))
    return false
  const send = (status: number, body: unknown): true => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(body))
    return true
  }
  const hosts = new Set([new URL(origin).host, new URL(origin).host.replace('127.0.0.1', 'localhost')])
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') || !hosts.has(request.headers.host ?? ''))
    return send(403, { error: 'Agent connections are only available on this device' })
  const agentCall = path === '/api/agent-access'
  if ((agentCall && (request.headers.origin || request.headers['sec-fetch-site']))
    || (!agentCall && (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)))) {
    return send(403, { error: 'Agent connection request has an invalid origin' })
  }
  try {
    if (!agentCall && request.method === 'GET')
      return send(200, await service.status(origin))
    if (request.method !== 'POST')
      return send(405, { error: 'Method not allowed' })
    if (!request.headers['content-type']?.startsWith('application/json'))
      return send(415, { error: 'A JSON request is required' })
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk)
      if (size > 64 * 1024)
        return send(413, { error: 'Agent request exceeds the size limit' })
      chunks.push(Buffer.from(chunk))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return send(400, { error: 'A JSON object is required' })
    if (agentCall)
      return send(200, await service.invoke(request.headers.authorization, body.name, body.arguments ?? {}))
    await service.update(body)
    return send(200, await service.status(origin))
  }
  catch (error) {
    return send(error instanceof AgentAccessError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500, { error: error instanceof Error ? error.message : String(error) })
  }
}
