import type { CloudDocument, PersonalCloudBackend, RemoteRequest, RemoteRequestUpdate, SyncExchange } from './types'
import { randomBytes } from 'node:crypto'
import { signDeviceRequest } from './device-signing'

export interface CloudBaseBackendOptions {
  endpoint: string
  deviceId: string
  privateKey: string
  fetch?: typeof globalThis.fetch
}

/** HTTP adapter that signs every desktop request without exposing credentials to callers. */
export class CloudBaseBackend implements PersonalCloudBackend {
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: CloudBaseBackendOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  synchronize(documents: CloudDocument[]): Promise<SyncExchange> {
    return this.request('/v1/sync', { documents })
  }

  claimRequests(): Promise<RemoteRequest[]> {
    return this.request('/v1/device-requests/claim', {})
  }

  async updateRequest(update: RemoteRequestUpdate): Promise<void> {
    await this.request(`/v1/device-requests/${encodeURIComponent(update.requestId)}/status`, update)
  }

  async heartbeat(): Promise<void> {
    await this.request('/v1/devices/heartbeat', {})
  }

  async revokeDevice(): Promise<void> {
    await this.request('/v1/devices/revoke', {})
  }

  private async request<T>(pathname: string, input: unknown): Promise<T> {
    const body = JSON.stringify(input)
    const timestamp = Date.now()
    const headers = signDeviceRequest({
      deviceId: this.options.deviceId,
      nonce: randomBytes(32).toString('base64url'),
      timestamp,
    }, 'POST', pathname, body, this.options.privateKey)
    const response = await this.fetch(new URL(pathname, this.options.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
    const payload = await response.json() as T & { error?: string }
    if (!response.ok)
      throw new Error(payload.error ?? `Personal cloud request failed: ${response.status}`)
    return payload
  }
}
