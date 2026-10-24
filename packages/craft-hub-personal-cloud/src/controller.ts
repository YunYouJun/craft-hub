import type { CraftHubRuntime } from 'craft-hub'
import type { RemoteCommandReview } from './remote-runner'
import { Buffer } from 'node:buffer'
import { randomBytes, sign } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { hasCloudURLControl, PersonalCloudError, personalCloudJSON, personalCloudOrigin } from './cloud-http'
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
  busy?: boolean
}

/** Host adapters and configuration needed by the personal-cloud controller. */
export interface PersonalCloudControllerOptions {
  endpoint?: string
  webOrigin?: string
  callbackScheme?: string
  dataDir: string
  platform: NodeJS.Platform
  runtime: CraftHubRuntime
  vault: DeviceIdentityVault
  openExternal: (url: string) => Promise<void>
  approve: (projectName: string, capabilityName: string, review: RemoteCommandReview, signal: AbortSignal) => Promise<boolean>
  fetch?: typeof globalThis.fetch
}

/** Own the optional personal-cloud lifecycle behind a small host interface. */
export class PersonalCloudController {
  private current: PersonalCloudStatus
  private readonly configuration?: { endpoint: string, webOrigin: string, callbackScheme: string }
  private identity: DeviceIdentity | undefined
  private identityLoaded = false
  private pendingChallenge: { value: string, expiresAt: number } | undefined
  private pendingTimer: NodeJS.Timeout | undefined
  private service: PersonalCloudService | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private heartbeatTimer: NodeJS.Timeout | undefined
  private lifecycle = 0
  private session = new AbortController()
  private closed = false
  private closing: Promise<void> | undefined
  private accountOperation: Promise<void> | undefined
  private disconnectOperation: Promise<void> | undefined
  private syncOperation: { lifecycle: number, promise: Promise<void> } | undefined

  constructor(private readonly options: PersonalCloudControllerOptions) {
    if (!options.endpoint && !options.webOrigin) {
      this.current = { state: 'disabled' }
      return
    }
    try {
      this.configuration = {
        endpoint: personalCloudOrigin(options.endpoint ?? ''),
        webOrigin: personalCloudOrigin(options.webOrigin ?? ''),
        callbackScheme: callbackScheme(options.callbackScheme ?? 'craft-hub'),
      }
      this.current = { state: 'disconnected' }
    }
    catch { this.current = { state: 'error', diagnostic: new PersonalCloudError('configuration').message } }
  }

  async start(): Promise<void> {
    if (!this.configuration || this.closed)
      return
    const lifecycle = this.lifecycle
    try {
      await this.operate(async () => {
        const identity = await this.storage(() => this.options.vault.load())
        if (!this.closed) {
          this.identity = identity
          this.identityLoaded = true
        }
        this.assertCurrent(lifecycle)
        if (identity?.deviceId)
          this.activate(identity)
      })
    }
    catch (error) {
      if (lifecycle === this.lifecycle && !this.closed)
        this.fail(error)
    }
  }

  status(): PersonalCloudStatus {
    return { ...this.current, busy: !!this.accountOperation || !!this.disconnectOperation }
  }

  async connect(): Promise<void> {
    const configuration = this.requireConfigured()
    this.requireIdle()
    const pendingSync = this.syncOperation?.promise
    this.stopSession()
    const lifecycle = this.lifecycle
    this.current = { state: 'connecting' }
    return this.operate(async () => {
      await Promise.allSettled([pendingSync])
      this.assertCurrent(lifecycle)
      const identity = await this.storage(() => this.options.vault.loadOrCreate())
      // A concurrent disconnect waits for this operation before clearing the identity it actually created.
      if (!this.closed) {
        this.identity = identity
        this.identityLoaded = true
      }
      this.assertCurrent(lifecycle)
      if (identity.deviceId) {
        this.activate(identity)
        return
      }
      this.pendingChallenge = { value: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 10 * 60_000 }
      this.pendingTimer = setTimeout(() => {
        if (lifecycle === this.lifecycle && !this.closed && this.pendingChallenge) {
          this.clearPendingChallenge()
          this.current = { state: 'error', diagnostic: new PersonalCloudError('callback').message }
        }
      }, 10 * 60_000)
      this.pendingTimer.unref()
      const url = new URL('/connect', configuration.webOrigin)
      url.searchParams.set('public_key', identity.publicKey)
      url.searchParams.set('challenge', this.pendingChallenge.value)
      url.searchParams.set('callback', `${configuration.callbackScheme}://cloud/connect`)
      await this.options.openExternal(url.toString())
      this.assertCurrent(lifecycle)
    }).catch((error) => {
      if (lifecycle === this.lifecycle && !this.closed) {
        this.clearPendingChallenge()
        this.fail(error)
      }
      throw safeError(error)
    })
  }

  async adopt(callbackUrl: string): Promise<void> {
    const configuration = this.requireConfigured()
    this.requireIdle()
    const identity = this.identity
    const pending = this.pendingChallenge
    if (!identity || !pending || pending.expiresAt <= Date.now())
      throw new PersonalCloudError('callback')
    const { challenge, code } = parseCloudConnectCallback(callbackUrl, pending.value, [configuration.callbackScheme])
    this.clearPendingChallenge()
    const lifecycle = this.lifecycle
    return this.operate(async () => {
      const timestamp = Date.now()
      const nonce = randomBytes(32).toString('base64url')
      const unsigned = JSON.stringify({ code, challenge, timestamp, nonce })
      const signature = sign(null, Buffer.from(requestSigningMessage('POST', '/v1/devices/adopt', timestamp, nonce, unsigned)), identity.privateKey).toString('base64url')
      const payload = await personalCloudJSON<{ device?: { deviceId?: string } }>(new URL('/v1/devices/adopt', configuration.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, challenge, timestamp, nonce, signature, name: hostname(), platform: this.options.platform }),
      }, this.options.fetch, this.session.signal)
      this.assertCurrent(lifecycle)
      if (!payload || typeof payload.device?.deviceId !== 'string' || !/^[\w.-]{1,128}$/.test(payload.device.deviceId))
        throw new PersonalCloudError('response')
      const registered = await this.storage(() => this.options.vault.register(identity, payload.device!.deviceId!))
      if (!this.closed) {
        this.identity = registered
        this.identityLoaded = true
      }
      this.assertCurrent(lifecycle)
      this.clearPendingChallenge()
      this.activate(registered)
    }).catch((error) => {
      if (lifecycle === this.lifecycle && !this.closed) {
        // An adoption response can be lost after registration. Never replay a one-time callback automatically.
        this.clearPendingChallenge()
        this.fail(error)
      }
      throw safeError(error)
    })
  }

  synchronize(): Promise<void> {
    const service = this.service
    if (!service || this.closed || this.disconnectOperation)
      return Promise.reject(new PersonalCloudError('cancelled'))
    const lifecycle = this.lifecycle
    if (this.syncOperation?.lifecycle === lifecycle)
      return this.syncOperation.promise
    const promise = (async () => {
      try {
        await service.synchronize()
        this.assertCurrent(lifecycle)
        this.current = { ...this.current, state: 'connected', lastSyncAt: new Date().toISOString(), diagnostic: undefined }
      }
      catch (error) {
        if (lifecycle === this.lifecycle && !this.closed)
          this.fail(error, true)
        throw safeError(error)
      }
      finally {
        if (this.syncOperation?.lifecycle === lifecycle)
          this.syncOperation = undefined
      }
    })()
    this.syncOperation = { lifecycle, promise }
    return promise
  }

  async disconnect(): Promise<void> {
    if (this.disconnectOperation)
      return this.disconnectOperation
    if (this.current.state === 'disabled')
      return Promise.resolve()
    const configuration = this.requireConfigured()
    const pending = this.accountOperation
    const sync = this.syncOperation?.promise
    this.stopSession()
    const lifecycle = this.lifecycle
    this.current = { state: 'disconnected' }
    const operation = (async () => {
      await Promise.allSettled([pending, sync])
      this.assertCurrent(lifecycle)
      // An unread/failed vault is not an empty vault. Refresh it before reporting a successful disconnect.
      if (!this.identityLoaded) {
        const identity = await this.storage(() => this.options.vault.load())
        if (!this.closed) {
          this.identity = identity
          this.identityLoaded = true
        }
        this.assertCurrent(lifecycle)
      }
      let revokeFailed = false
      if (this.identity?.deviceId) {
        const backend = new CloudBaseBackend({ endpoint: configuration.endpoint, deviceId: this.identity.deviceId, privateKey: this.identity.privateKey, fetch: this.options.fetch, signal: this.session.signal })
        try {
          await backend.revokeDevice()
        }
        catch { revokeFailed = true }
      }
      this.assertCurrent(lifecycle)
      await this.storage(() => this.options.vault.clear())
      this.identity = undefined
      this.assertCurrent(lifecycle)
      this.current = { state: 'disconnected' }
      if (revokeFailed)
        throw new PersonalCloudError('revocation')
    })().catch((error) => {
      if (lifecycle === this.lifecycle && !this.closed)
        this.current = { state: safeError(error).code === 'revocation' ? 'disconnected' : 'error', deviceId: this.identity?.deviceId, diagnostic: safeError(error).message }
      throw safeError(error)
    }).finally(() => {
      if (this.disconnectOperation === operation)
        this.disconnectOperation = undefined
    })
    this.disconnectOperation = operation
    return operation
  }

  /** Stop new work immediately and drain account/sync writes before the host releases its profile. */
  close(): Promise<void> {
    if (this.closing)
      return this.closing
    this.closed = true
    this.stopSession()
    this.identity = undefined
    this.closing = Promise.allSettled([this.accountOperation, this.disconnectOperation, this.syncOperation?.promise]).then(() => {})
    return this.closing
  }

  private activate(identity: DeviceIdentity): void {
    const configuration = this.requireConfigured()
    if (!identity.deviceId)
      throw new PersonalCloudError('response')
    const signal = this.session.signal
    const backend = new CloudBaseBackend({ endpoint: configuration.endpoint, deviceId: identity.deviceId, privateKey: identity.privateKey, fetch: this.options.fetch, signal })
    const revisions = new JsonRevisionStore(join(this.options.dataDir, 'personal-cloud-revisions.json'))
    const runner = new RemoteRequestRunner(this.options.runtime, backend, async (_request, projectName, capabilityName, review, approvalSignal) => this.options.approve(projectName, capabilityName, review, approvalSignal), { signal, deviceId: identity.deviceId })
    this.service = new PersonalCloudService(backend, new RuntimeDocumentSource(this.options.runtime, revisions), runner, signal)
    this.current = { state: 'connected', deviceId: identity.deviceId }
    this.schedulePoll(this.lifecycle, 0, 0)
    this.scheduleHeartbeat(this.lifecycle, 0, 0)
  }

  private stopSession(): void {
    this.lifecycle++
    this.session.abort()
    this.session = new AbortController()
    if (this.pollTimer)
      clearTimeout(this.pollTimer)
    if (this.heartbeatTimer)
      clearTimeout(this.heartbeatTimer)
    this.pollTimer = undefined
    this.heartbeatTimer = undefined
    this.clearPendingChallenge()
    this.service = undefined
  }

  private clearPendingChallenge(): void {
    this.pendingChallenge = undefined
    if (this.pendingTimer)
      clearTimeout(this.pendingTimer)
    this.pendingTimer = undefined
  }

  private schedulePoll(lifecycle: number, attempt: number, delay: number): void {
    this.pollTimer = setTimeout(async () => {
      if (lifecycle !== this.lifecycle || !this.service || this.closed)
        return
      try {
        await this.service.poll()
        if (lifecycle === this.lifecycle && !this.closed)
          this.schedulePoll(lifecycle, 0, 5_000)
      }
      catch (error) {
        if (lifecycle === this.lifecycle && !this.closed) {
          this.fail(error, true)
          this.schedulePoll(lifecycle, attempt + 1, retryDelay(5_000, attempt, 60_000))
        }
      }
    }, delay)
    this.pollTimer.unref()
  }

  private scheduleHeartbeat(lifecycle: number, attempt: number, delay: number): void {
    this.heartbeatTimer = setTimeout(async () => {
      if (lifecycle !== this.lifecycle || !this.service || this.closed)
        return
      try {
        await this.service.heartbeat()
        this.assertCurrent(lifecycle)
        await this.synchronize()
        if (lifecycle === this.lifecycle && !this.closed)
          this.scheduleHeartbeat(lifecycle, 0, 60_000)
      }
      catch (error) {
        if (lifecycle === this.lifecycle && !this.closed) {
          this.fail(error, true)
          this.scheduleHeartbeat(lifecycle, attempt + 1, retryDelay(60_000, attempt, 300_000))
        }
      }
    }, delay)
    this.heartbeatTimer.unref()
  }

  private requireConfigured(): { endpoint: string, webOrigin: string, callbackScheme: string } {
    if (this.closed)
      throw new PersonalCloudError('cancelled')
    if (!this.configuration)
      throw new PersonalCloudError('configuration')
    return this.configuration
  }

  private requireIdle(): void {
    if (this.accountOperation || this.disconnectOperation)
      throw new PersonalCloudError('busy')
  }

  private operate(action: () => Promise<void>): Promise<void> {
    this.requireIdle()
    const operation = action().finally(() => {
      if (this.accountOperation === operation)
        this.accountOperation = undefined
    })
    this.accountOperation = operation
    return operation
  }

  private assertCurrent(lifecycle: number): void {
    if (this.closed || lifecycle !== this.lifecycle || this.session.signal.aborted)
      throw new PersonalCloudError('cancelled')
  }

  private async storage<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    }
    catch { throw new PersonalCloudError('storage') }
  }

  private fail(error: unknown, keepConnected = false): void {
    this.current = {
      ...this.current,
      state: keepConnected && this.identity?.deviceId ? 'connected' : 'error',
      diagnostic: safeError(error).message,
    }
  }
}

function safeError(error: unknown): PersonalCloudError {
  return error instanceof PersonalCloudError ? error : new PersonalCloudError('network')
}

/** Validate a one-time desktop connection callback. */
export function parseCloudConnectCallback(callbackUrl: string, pendingChallenge: string, acceptedSchemes = ['craft-hub', 'craft-hub-dev']): { challenge: string, code: string } {
  let url: URL
  try {
    url = new URL(callbackUrl)
  }
  catch { throw new PersonalCloudError('callback') }
  if (callbackUrl.length > 4096 || hasCloudURLControl(callbackUrl)
    || !callbackUrl.startsWith(`${url.protocol}//cloud/connect?`) || callbackUrl.includes('#')
    || !acceptedSchemes.map(callbackScheme).includes(url.protocol.slice(0, -1)) || url.hostname !== 'cloud' || url.pathname !== '/connect'
    || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].some(key => !['code', 'challenge'].includes(key))
    || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('challenge').length !== 1) {
    throw new PersonalCloudError('callback')
  }
  const code = url.searchParams.get('code')
  const challenge = url.searchParams.get('challenge')
  if (!code || code.length > 1024 || hasCloudURLControl(code) || challenge !== pendingChallenge)
    throw new PersonalCloudError('callback')
  return { challenge, code }
}

function callbackScheme(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*$/.test(value))
    throw new Error('Personal cloud callback scheme is invalid')
  return value
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
