import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { CraftHubRuntime } from './runtime'

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.from(chunk))
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {}
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function serveStatic(response: ServerResponse, staticDir: string, pathname: string): Promise<void> {
  const relativePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  let path = join(staticDir, relativePath || 'index.html')
  try {
    await access(path)
  }
  catch {
    path = join(staticDir, 'index.html')
  }
  response.writeHead(200, {
    'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:`,
    'content-type': contentTypes[extname(path)] ?? 'application/octet-stream',
  })
  createReadStream(path).pipe(response)
}

export interface CraftHubServerOptions {
  host?: string
  port?: number
  staticDir?: string
  runtime?: CraftHubRuntime
}

export interface CraftHubServer {
  runtime: CraftHubRuntime
  server: Server
  url: string
  close: () => Promise<void>
}

/** Start the local-only HTTP API used by the web and Electron clients. */
export async function startCraftHubServer(options: CraftHubServerOptions = {}): Promise<CraftHubServer> {
  const runtime = options.runtime ?? new CraftHubRuntime()
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean)

      if (request.method === 'GET' && url.pathname === '/api/projects')
        return sendJson(response, 200, await runtime.projects.list())

      if (request.method === 'POST' && url.pathname === '/api/projects') {
        const body = await jsonBody(request)
        if (typeof body.path !== 'string')
          return sendJson(response, 400, { error: 'path is required' })
        return sendJson(response, 201, await runtime.addProject(body.path))
      }

      if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
        const projectId = parts[2]
        if (request.method === 'GET' && parts[3] === 'capabilities')
          return sendJson(response, 200, await runtime.capabilities(projectId))
        if (request.method === 'POST' && parts[3] === 'trust')
          return sendJson(response, 200, await runtime.projects.setTrust(projectId, 'trusted'))
        if (request.method === 'POST' && parts[3] === 'run') {
          const body = await jsonBody(request)
          if (typeof body.capabilityId !== 'string')
            return sendJson(response, 400, { error: 'capabilityId is required' })
          const handle = await runtime.run(projectId, body.capabilityId)
          return sendJson(response, 200, await handle.completion)
        }
      }

      if (options.staticDir)
        return serveStatic(response, options.staticDir, url.pathname)
      sendJson(response, 404, { error: 'Not found' })
    }
    catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4318, options.host ?? '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return {
    runtime,
    server,
    url: `http://${address.address}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}
