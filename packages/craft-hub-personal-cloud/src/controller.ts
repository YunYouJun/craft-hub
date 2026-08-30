import type { CraftHubRuntime } from 'craft-hub'
import { Buffer } from 'node:buffer'
import { randomBytes, sign } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { CloudBaseBackend } from './cloudbase-backend'
import { requestSigningMessage } from './device-signing'
import { RemoteRequestRunner } from './remote-runner'
import { RuntimeDocumentSource } from './runtime-documents'
import { PersonalCloudService } from './service'

/** Device identity held by a host-provided secure-storage adapter. */
export interface DeviceIdentity {
  deviceId?: string
  privateKey: string
  publicKey: string
}

/** Secure device identity storage required by the personal-cloud module. */
export interface DeviceIdentityVault {
  load: () => Promise<DeviceIdentity | undefined>
  loadOrCreate: () => Promise<DeviceIdentity>
  register: (identity: DeviceIdentity, deviceId: string) => Promise<DeviceIdentity>
  clear: () => Promise<void>
}

/** Host-facing personal-cloud lifecycle state. */
export interface PersonalCloudStatus {
  state: 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error'
  deviceId?: string
  lastSyncAt?: string
  diagnostic?: string
}

/** Host adapters and configuration needed by the personal-cloud controller. */
export interface PersonalCloudControllerOptions {
  endpoint?: string
  webOrigin?: string
  callbackScheme?: 'craft-hub' | 'craft-hub-dev'
  dataDir: string
  platform: NodeJS.Platform
  runtime: CraftHubRuntime
  vault: DeviceIdentityVault
  openExternal: (url: string) => Promise<void>
  approve: (projectName: string, capabilityName: string) => Promise<boolean>
}

/** Own the optional personal-cloud lifecycle behind a small host interface. */
export class PersonalCloudController {
  private current: PersonalCloudStatus
  private identity: DeviceIdentity | undefined
  private pendingChallenge: string | undefined
  private service: PersonalCloudService | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private heartbeatTimer: NodeJS.Timeout | undefined
  private lifecycle = 0

  constructor(private readonly options: PersonalCloudControllerOptions) {
    this.current = options.endpoint && options.webOrigin ? { state: 'disconnected' } : { state: 'disabled' }
  }

  async start(): Promise<void> {
    if (this.current.state === 'disabled')
      return
    try {
      this.identity = await this.options.vault.load()
      if (this.identity?.deviceId)
        this.activate(this.identity)
    }
    catch (error) {
      this.fail(error)
    }
  }

  status(): PersonalCloudStatus {
    return { ...this.current }
  }

  async connect(): Promise<void> {
    this.requireConfigured()
    this.identity = await this.options.vault.loadOrCreate()
    this.pendingChallenge = randomBytes(32).toString('base64url')
    this.current = { state: 'connecting' }
    const url = new URL('/connect', this.options.webOrigin)
    url.searchParams.set('public_key', this.identity.publicKey)
    url.searchParams.set('challenge', this.pendingChallenge)
    url.searchParams.set('callback', `${this.options.callbackScheme ?? 'craft-hub'}://cloud/connect`)
    await this.options.openExternal(url.toString())
  }

  async adopt(callbackUrl: string): Promise<void> {
    this.requireConfigured()
    if (!this.identity || !this.pendingChallenge)
      throw new Error('No personal cloud connection is pending')
    const { challenge, code } = parseCloudConnectCallback(callbackUrl, this.pendingChallenge)
    const timestamp = Date.now()
    const nonce = randomBytes(32).toString('base64url')
    const unsigned = JSON.stringify({ code, challenge, timestamp, nonce })
    const signature = sign(null, Buffer.from(requestSigningMessage('POST', '/v1/devices/adopt', timestamp, nonce, unsigned)), this.identity.privateKey).toString('base64url')
    const response = await fetch(new URL('/v1/devices/adopt', this.options.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, challenge, timestamp, nonce, signature, name: hostname(), platform: this.options.platform }),
    })
    const payload = await response.json() as { device?: { deviceId?: string }, error?: string }
    if (!response.ok || !payload.device?.deviceId)
      throw new Error(payload.error ?? 'Device registration failed')
    this.identity = await this.options.vault.register(this.identity, payload.device.deviceId)
    this.pendingChallenge = undefined
    this.activate(this.identity)
  }

  async synchronize(): Promise<void> {
    if (!this.service)
      throw new Error('Personal cloud is not connected')
    try {
      await this.service.synchronize()
      this.current = { ...this.current, state: 'connected', lastSyncAt: new Date().toISOString(), diagnostic: undefined }
    }
    catch (error) {
      this.fail(error, true)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.stopTimers()
    let revokeError: unknown
    if (this.identity?.deviceId && this.options.endpoint) {
      const backend = new CloudBaseBackend({ endpoint: this.options.endpoint, deviceId: this.identity.deviceId, privateKey: this.identity.privateKey })
      try {
        await backend.revokeDevice?.()
      }
      catch (error) {
        revokeError = error
      }
    }
    await this.options.vault.clear()
    this.identity = undefined
    this.service = undefined
    this.current = { state: this.options.endpoint && this.options.webOrigin ? 'disconnected' : 'disabled' }
    if (revokeError)
      throw new Error(`Local device was disconnected, but cloud revocation failed: ${revokeError instanceof Error ? revokeError.message : String(revokeError)}`)
  }

  close(): void {
    this.stopTimers()
  }

  private activate(identity: DeviceIdentity): void {
    if (!identity.deviceId || !this.options.endpoint)
      return
    const backend = new CloudBaseBackend({ endpoint: this.options.endpoint, deviceId: identity.deviceId, privateKey: identity.privateKey })
    const revisions = new JsonRevisionStore(join(this.options.dataDir, 'personal-cloud-revisions.json'))
    const runner = new RemoteRequestRunner(this.options.runtime, backend, async (_request, projectName, capabilityName) => this.options.approve(projectName, capabilityName))
    this.service = new PersonalCloudService(backend, new RuntimeDocumentSource(this.options.runtime, revisions), runner)
    this.current = { state: 'connected', deviceId: identity.deviceId }
    this.stopTimers()
    const lifecycle = this.lifecycle
    this.schedulePoll(lifecycle, 0, 0)
    this.scheduleHeartbeat(lifecycle, 0, 0)
  }

  private async heartbeatAndSync(): Promise<void> {
    if (!this.service)
      return
    await this.service.heartbeat()
    await this.synchronize()
  }

  private stopTimers(): void {
    this.lifecycle++
    if (this.pollTimer)
      clearTimeout(this.pollTimer)
    if (this.heartbeatTimer)
      clearTimeout(this.heartbeatTimer)
    this.pollTimer = undefined
    this.heartbeatTimer = undefined
  }

  private schedulePoll(lifecycle: number, attempt: number, delay: number): void {
    this.pollTimer = setTimeout(async () => {
      if (lifecycle !== this.lifecycle || !this.service)
        return
      try {
        await this.service.poll()
        this.schedulePoll(lifecycle, 0, 5_000)
      }
      catch (error) {
        this.fail(error, true)
        this.schedulePoll(lifecycle, attempt + 1, retryDelay(5_000, attempt, 60_000))
      }
    }, delay)
    this.pollTimer.unref()
  }

  private scheduleHeartbeat(lifecycle: number, attempt: number, delay: number): void {
    this.heartbeatTimer = setTimeout(async () => {
      if (lifecycle !== this.lifecycle || !this.service)
        return
      try {
        await this.heartbeatAndSync()
        this.scheduleHeartbeat(lifecycle, 0, 60_000)
      }
      catch (error) {
        this.fail(error, true)
        this.scheduleHeartbeat(lifecycle, attempt + 1, retryDelay(60_000, attempt, 300_000))
      }
    }, delay)
    this.heartbeatTimer.unref()
  }

  private requireConfigured(): void {
    if (!this.options.endpoint || !this.options.webOrigin)
      throw new Error('Personal cloud endpoint and Web origin are not configured')
  }

  private fail(error: unknown, keepConnected = false): void {
    this.current = {
      ...this.current,
      state: keepConnected && this.identity?.deviceId ? 'connected' : 'error',
      diagnostic: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Validate a one-time desktop connection callback. */
export function parseCloudConnectCallback(callbackUrl: string, pendingChallenge: string): { challenge: string, code: string } {
  const url = new URL(callbackUrl)
  if ((url.protocol !== 'craft-hub:' && url.protocol !== 'craft-hub-dev:') || url.hostname !== 'cloud' || url.pathname !== '/connect')
    throw new Error('Unexpected personal cloud callback')
  const code = url.searchParams.get('code')
  const challenge = url.searchParams.get('challenge')
  if (!code || challenge !== pendingChallenge)
    throw new Error('Personal cloud callback challenge does not match')
  return { challenge, code }
}

function retryDelay(base: number, attempt: number, maximum: number): number {
  const capped = Math.min(maximum, base * 2 ** Math.min(attempt, 8))
  return Math.round(capped * (0.8 + Math.random() * 0.4))
}

class JsonRevisionStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.read())[key]
  }

  async set(key: string, revision: string): Promise<void> {
    const revisions = await this.read()
    revisions[key] = revision
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    await writeFile(temporary, `${JSON.stringify(revisions, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }

  private async read(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Personal cloud revision state is invalid')
      return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {}
      throw error
    }
  }
}
