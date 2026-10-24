import type { DeviceIdentity, DeviceIdentityVault } from '@craft-hub/personal-cloud'
import type { Readable, Writable } from 'node:stream'
import { Buffer } from 'node:buffer'
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto'

const maximumFrameBytes = 16 * 1024
const maximumPending = 8
const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type VaultMethod = 'vault.load' | 'vault.create' | 'vault.register' | 'vault.clear'
interface Pending { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }

/** Fixed messages only: neither pipe contents nor provider errors may enter diagnostics. */
export class NativeHostChannelError extends Error {
  readonly code: 'closed' | 'invalid' | 'timeout' | 'busy' | 'rejected'

  constructor(code: 'closed' | 'invalid' | 'timeout' | 'busy' | 'rejected') {
    super(`Native secure-storage channel ${code}`)
    this.code = code
  }
}

/**
 * Private child-to-parent RPC. This owns no HTTP endpoint and never writes to a log or profile file.
 * Issue requests only after the v1 connection handshake has been written; stdout thereafter contains frames only.
 */
export class NativeHostChannel {
  private readonly pending = new Map<string, Pending>()
  private readonly input: Readable
  private readonly output: Writable
  private readonly timeoutMs: number
  private buffer = Buffer.alloc(0)
  private closed = false

  constructor(input: Readable, output: Writable, timeoutMs = 30_000) {
    this.input = input
    this.output = output
    this.timeoutMs = timeoutMs
    input.on('data', this.receive)
    input.once('end', this.ended)
    input.once('error', this.ended)
    output.once('error', this.ended)
    output.once('close', this.ended)
  }

  request(method: VaultMethod, payload: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed)
      return Promise.reject(new NativeHostChannelError('closed'))
    if (this.pending.size >= maximumPending)
      return Promise.reject(new NativeHostChannelError('busy'))
    const id = randomUUID()
    const frame = Buffer.from(`${JSON.stringify({ hostBridge: 1, id, method, payload })}\n`)
    if (frame.length > maximumFrameBytes + 1)
      return Promise.reject(new NativeHostChannelError('invalid'))
    return new Promise((resolve, reject) => {
      // A timed-out mutation has an unknown outcome. Retire this channel; never retry on a later host generation.
      const timer = setTimeout(() => this.close('timeout'), this.timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      this.output.write(frame, (error) => {
        if (error)
          this.close()
      })
    })
  }

  close(code: 'closed' | 'invalid' | 'timeout' = 'closed'): void {
    if (this.closed)
      return
    this.closed = true
    this.input.off('data', this.receive)
    this.input.off('end', this.ended)
    // Keep error listeners for the lifetime of these private streams: a failed write callback can precede
    // the stream's error event. Removing the listener here would turn a handled pipe failure into a crash.
    this.output.off('close', this.ended)
    this.buffer = Buffer.alloc(0)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new NativeHostChannelError(code))
    }
    this.pending.clear()
  }

  private readonly ended = (): void => this.close()

  private readonly receive = (chunk: Buffer | string): void => {
    if (this.closed)
      return
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    let offset = 0
    while (offset < bytes.length && !this.closed) {
      const newline = bytes.indexOf(10, offset)
      const end = newline < 0 ? bytes.length : newline
      if (this.buffer.length + end - offset > maximumFrameBytes) {
        this.close('invalid')
        return
      }
      this.buffer = Buffer.concat([this.buffer, bytes.subarray(offset, end)])
      if (newline < 0)
        return
      const frame = this.buffer
      this.buffer = Buffer.alloc(0)
      offset = newline + 1
      try {
        const value: unknown = JSON.parse(frame.toString('utf8'))
        if (!record(value) || value.hostBridge !== 1 || typeof value.id !== 'string' || !identifier.test(value.id)
          || typeof value.ok !== 'boolean' || !exactKeys(value, value.ok ? ['hostBridge', 'id', 'ok', 'value'] : ['hostBridge', 'id', 'ok', 'error'])
          || (!value.ok && !['unavailable', 'invalidIdentity', 'identityChanged', 'unconfigured'].includes(String(value.error)))) {
          this.close('invalid')
          return
        }
        const pending = this.pending.get(value.id)
        if (!pending)
          continue // A duplicate acknowledgement never repeats the operation or changes a newer request.
        this.pending.delete(value.id)
        clearTimeout(pending.timer)
        if (value.ok)
          pending.resolve(value.value)
        else
          pending.reject(new NativeHostChannelError('rejected'))
      }
      catch {
        this.close('invalid')
      }
    }
  }
}

/** Existing personal-cloud vault contract backed exclusively by the native parent's Keychain. */
export class NativeDeviceVault implements DeviceIdentityVault {
  private readonly channel: NativeHostChannel
  private current: DeviceIdentity | undefined

  constructor(channel: NativeHostChannel) {
    this.channel = channel
  }

  async load(): Promise<DeviceIdentity | undefined> {
    const value = await this.channel.request('vault.load')
    this.current = value === null ? undefined : this.receivedIdentity(value)
    return this.current && { ...this.current }
  }

  async loadOrCreate(): Promise<DeviceIdentity> {
    this.current = this.receivedIdentity(await this.channel.request('vault.create'))
    return { ...this.current }
  }

  async register(identity: DeviceIdentity, deviceId: string): Promise<DeviceIdentity> {
    const expected = decodeIdentity(identity)
    if (!validDeviceID(deviceId))
      throw new NativeHostChannelError('invalid')
    const registered = this.receivedIdentity(await this.channel.request('vault.register', { expected, deviceId }))
    if (registered.privateKey !== expected.privateKey || registered.publicKey !== expected.publicKey || registered.deviceId !== deviceId) {
      this.channel.close('invalid')
      throw new NativeHostChannelError('invalid')
    }
    this.current = registered
    return { ...registered }
  }

  async clear(): Promise<void> {
    // Never discover and delete an identity this adapter did not load or create.
    if (!this.current)
      return
    const value = await this.channel.request('vault.clear', { expected: this.current })
    if (value !== null) {
      this.channel.close('invalid')
      throw new NativeHostChannelError('invalid')
    }
    this.current = undefined
  }

  private receivedIdentity(value: unknown): DeviceIdentity {
    try {
      return decodeIdentity(value)
    }
    catch {
      this.channel.close('invalid')
      throw new NativeHostChannelError('invalid')
    }
  }
}

function decodeIdentity(value: unknown): DeviceIdentity {
  try {
    if (!record(value) || !exactKeys(value, value.deviceId === undefined ? ['privateKey', 'publicKey'] : ['deviceId', 'privateKey', 'publicKey'])
      || typeof value.privateKey !== 'string' || value.privateKey.length > 1024 || typeof value.publicKey !== 'string' || value.publicKey.length > 1024
      || (value.deviceId !== undefined && !validDeviceID(value.deviceId))) {
      throw new Error('Invalid native device identity')
    }
    const privateKey = createPrivateKey(value.privateKey)
    const publicKey = createPublicKey(value.publicKey)
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519'
      || createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }) !== value.publicKey) {
      throw new Error('Invalid native device identity')
    }
    return { ...(value.deviceId ? { deviceId: value.deviceId as string } : {}), privateKey: value.privateKey, publicKey: value.publicKey }
  }
  catch {
    throw new NativeHostChannelError('invalid')
  }
}

function validDeviceID(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.-]{1,128}$/.test(value)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
