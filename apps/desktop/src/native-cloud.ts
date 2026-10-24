import type { PersonalCloudControllerOptions, PersonalCloudStatus, RemoteCommandReview } from '@craft-hub/personal-cloud'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SidecarSessionGuard } from './sidecar-host.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { PersonalCloudController, PersonalCloudError } from '@craft-hub/personal-cloud'

interface Approval {
  id: string
  projectName: string
  capabilityName: string
  review: RemoteCommandReview
}
interface PendingApproval { value: Approval, signal: AbortSignal, finish: (accepted: boolean) => void }

/** Bounded, generation-local review queue. No browser route or cloud document can approve an entry. */
export class NativeCloudApprovals {
  private readonly pending = new Map<string, PendingApproval>()
  private closed = false

  request = (projectName: string, capabilityName: string, review: RemoteCommandReview, signal: AbortSignal): Promise<boolean> => {
    if (this.closed || signal.aborted || this.pending.size >= 8 || !Number.isFinite(Date.parse(review.expiresAt)) || Date.parse(review.expiresAt) <= Date.now())
      return Promise.resolve(false)
    const value = structuredClone({ id: randomUUID(), projectName, capabilityName, review })
    if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024)
      return Promise.resolve(false)
    return new Promise((resolve) => {
      const finish = (accepted: boolean): void => {
        signal.removeEventListener('abort', abort)
        this.pending.delete(value.id)
        resolve(accepted)
      }
      function abort(): void {
        finish(false)
      }
      this.pending.set(value.id, { value, signal, finish })
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  list(): Approval[] {
    return [...this.pending.values()].flatMap((entry) => {
      if (entry.signal.aborted || Date.parse(entry.value.review.expiresAt) <= Date.now()) {
        entry.finish(false)
        return []
      }
      return [structuredClone(entry.value)]
    })
  }

  decide(id: string, accepted: boolean): boolean {
    const entry = this.pending.get(id)
    if (!entry)
      return false
    const current = !entry.signal.aborted && Date.parse(entry.value.review.expiresAt) > Date.now()
    entry.finish(current && accepted)
    return current
  }

  close(): void {
    this.closed = true
    for (const entry of this.pending.values())
      entry.finish(false)
  }
}

/** Compose cloud lifecycle and native-only account/review endpoints without exposing vault operations over HTTP. */
export class NativeCloudService {
  readonly approvals = new NativeCloudApprovals()
  readonly controller: PersonalCloudController
  private readonly invalidConfiguration: boolean
  constructor(options: Omit<PersonalCloudControllerOptions, 'approve'>, invalidConfiguration = false) {
    this.invalidConfiguration = invalidConfiguration
    this.controller = new PersonalCloudController({ ...options, approve: this.approvals.request })
  }

  snapshot(): { version: number, status: PersonalCloudStatus, approvals: Approval[] } {
    return {
      version: 1,
      status: this.invalidConfiguration ? { state: 'error' as const, diagnostic: new PersonalCloudError('configuration').message } : this.controller.status(),
      approvals: this.approvals.list(),
    }
  }

  async close(): Promise<void> {
    this.approvals.close()
    await this.controller.close()
  }

  async handle(request: IncomingMessage, response: ServerResponse, guard: SidecarSessionGuard): Promise<boolean> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/api/native-host/cloud')
      return false
    const send = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (!request.headers.authorization || !guard.authorize(request)) {
      send(403, { error: 'Native authorization is required' })
      return true
    }
    try {
      if (url.search)
        throw new PersonalCloudError('configuration')
      if (request.method === 'GET') {
        send(200, this.snapshot())
        return true
      }
      if (request.method !== 'POST' || request.headers['content-type']?.split(';')[0] !== 'application/json') {
        send(405, { error: 'Use a JSON POST request' })
        return true
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk)
        size += bytes.length
        if (size > 4096)
          throw new PersonalCloudError('response')
        chunks.push(bytes)
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new PersonalCloudError('response')
      const value = input as Record<string, unknown>
      const exact = (...keys: string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
      if (this.invalidConfiguration)
        throw new PersonalCloudError('configuration')
      if (value.action === 'approve' && exact('action', 'id', 'accepted') && typeof value.id === 'string' && typeof value.accepted === 'boolean') {
        if (!this.approvals.decide(value.id, value.accepted)) {
          send(409, { error: 'The remote request expired or was cancelled. Refresh before continuing.' })
          return true
        }
      }
      else if (value.action === 'callback' && exact('action', 'url') && typeof value.url === 'string' && value.url.length <= 2048) {
        await this.controller.adopt(value.url)
      }
      else if (exact('action') && value.action === 'connect') {
        await this.controller.connect()
      }
      else if (exact('action') && value.action === 'disconnect') {
        await this.controller.disconnect()
      }
      else if (exact('action') && value.action === 'synchronize') {
        await this.controller.synchronize()
      }
      else { throw new PersonalCloudError('response') }
      send(200, this.snapshot())
    }
    catch (error) {
      send(400, { error: error instanceof PersonalCloudError ? error.message : 'The native cloud operation failed. Refresh before continuing.' })
    }
    return true
  }
}
