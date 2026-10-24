import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CodexActivityMonitorOptions, CodexActivityStatus } from './codex-activity.ts'
import type { SidecarSessionGuard } from './sidecar-host.ts'
import { CodexActivityMonitor } from './codex-activity.ts'
import { inputBody } from './sidecar-host.ts'

const nativePath = '/api/native-host/codex-activity'
const statusPath = '/__craft_hub_host/codex-activity-status'
const eventsPath = '/__craft_hub_host/codex-activity-events'
function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Profile-owned activity service. The browser reads/subscribes; only native consent can mutate hooks. */
export class NativeCodexActivity {
  readonly #monitor: CodexActivityMonitor
  readonly #streams = new Set<ServerResponse>()
  #closed = false
  #revision = 0
  #change: Promise<CodexActivityStatus> | undefined

  constructor(options: Omit<CodexActivityMonitorOptions, 'onStatus'>) {
    this.#monitor = new CodexActivityMonitor({ ...options, onStatus: status => this.#publish(status) })
  }

  /** Start the profile's loopback receiver without installing or changing any Codex hooks. */
  async start(): Promise<void> { await this.#monitor.start() }

  /** Drain a confirmed write, close streams and retire the temporary receiver on host shutdown. */
  async close(): Promise<void> {
    this.#closed = true
    for (const stream of this.#streams)
      stream.end()
    this.#streams.clear()
    await this.#change?.catch(() => {})
    await this.#monitor.close()
  }

  #publish(status: CodexActivityStatus): void {
    this.#revision++
    if (!this.#closed) {
      for (const stream of this.#streams)
        this.#write(stream, status)
    }
  }

  #write(response: ServerResponse, status: CodexActivityStatus): void {
    if (response.destroyed || !response.write(`data: ${JSON.stringify(status)}\n\n`)) {
      this.#streams.delete(response)
      response.destroy()
    }
  }

  /** Enforce cookie-only browser reads and bearer-only, reviewed native writes independently of outer routing. */
  async handle(request: IncomingMessage, response: ServerResponse, guard: SidecarSessionGuard): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (![nativePath, statusPath, eventsPath].includes(url.pathname))
      return false
    const native = url.pathname === nativePath
    if (Boolean(request.headers.authorization) !== native || !guard.authorize(request)) {
      send(response, 403, { error: 'Activity requests require the matching host credential' })
      return true
    }
    if (this.#closed) {
      send(response, 503, { error: 'Activity monitoring is closing' })
      return true
    }
    try {
      if (url.search)
        throw new Error('Query parameters are not accepted')
      if (url.pathname === eventsPath) {
        if (request.method !== 'GET' || this.#streams.size >= 8)
          throw new Error('Activity subscriptions are unavailable')
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'connection': 'keep-alive' })
        response.write('retry: 2000\n\n')
        this.#streams.add(response)
        response.once('close', () => this.#streams.delete(response))
        const revision = this.#revision
        const initial = await this.#monitor.status()
        if (!this.#closed && !response.destroyed && revision === this.#revision)
          this.#write(response, initial)
        return true
      }
      if (native && request.method === 'GET') {
        send(response, 200, { version: 1, status: await this.#monitor.status() })
        return true
      }
      if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0] !== 'application/json'
        || (!native && request.headers['x-craft-hub-host'] !== '1')) {
        throw new Error('Use a same-origin JSON POST request')
      }
      const input = await inputBody(request)
      if (!native) {
        if (Object.keys(input).length)
          throw new Error('Status takes no input')
        send(response, 200, { value: await this.#monitor.status() })
        return true
      }
      if (this.#change)
        throw new Error('An activity change is already in progress')
      if (input.action === 'review' && Object.keys(input).sort().join(',') === 'action,operation' && (input.operation === 'install' || input.operation === 'uninstall')) {
        const review = await this.#monitor.review(input.operation)
        if (this.#closed) {
          this.#monitor.hooks.cancel(review.id)
          throw new Error('Activity monitoring is closing')
        }
        send(response, 200, { version: 1, review })
      }
      else if (['apply', 'cancel'].includes(String(input.action)) && Object.keys(input).sort().join(',') === 'action,id' && typeof input.id === 'string' && input.id.length <= 128) {
        if (input.action === 'cancel') {
          this.#monitor.hooks.cancel(input.id)
          send(response, 200, { version: 1 })
        }
        else {
          this.#change = this.#monitor.apply(input.id)
          try {
            send(response, 200, { version: 1, status: await this.#change })
          }
          finally { this.#change = undefined }
        }
      }
      else { throw new Error('A reviewed activity operation is required') }
    }
    catch (error) {
      if (response.headersSent)
        response.destroy()
      else
        send(response, 400, { error: error instanceof Error ? error.message : 'Activity request failed' })
    }
    return true
  }
}
