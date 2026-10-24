import type { IdentityTransferEnvelope, IdentityTransferRequest } from '@craft-hub/personal-cloud'
import type { ProfileIdentityContext, ProfileMigrationPaths } from 'craft-hub'
import type { IdentityRecipientProcess } from './identity-launcher.ts'
import type { IdentityRecipientPreflight } from './identity-transfer-recipient.ts'
import { Buffer } from 'node:buffer'
import { IdentityTransferError, validateIdentityTransferRequest } from '@craft-hub/personal-cloud'
import { identityLauncher } from './identity-launcher.ts'

/** Source-owned native session. Durable transaction decisions remain in the shared profile coordinator. */
export interface IdentityRecipientClient {
  assertHostsStopped: () => void
  prepare: (paths: ProfileMigrationPaths, endpoint: string, webOrigin: string) => Promise<IdentityTransferRequest>
  resume: (context: ProfileIdentityContext) => Promise<void>
  inspect: (context: ProfileIdentityContext) => Promise<'empty' | 'staged' | 'activated' | 'active'>
  stage: (context: ProfileIdentityContext, envelope: IdentityTransferEnvelope) => Promise<void>
  activate: (context: ProfileIdentityContext) => Promise<void>
  finish: (context: ProfileIdentityContext) => Promise<void>
  rollback: (context: ProfileIdentityContext) => Promise<void>
  /** Retire ephemeral state only; never infer rollback from cancellation, EOF or a lost acknowledgement. */
  close: () => void
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new IdentityTransferError()
  }
  return value as Record<string, unknown>
}
function acknowledgement(value: unknown, key: string): void {
  if (object(value, [key])[key] !== true)
    throw new IdentityTransferError()
}

// No exported constructor or caller-provided transport/key. Tests mock the fixed launcher module; the packaged
// factory always obtains its owned child and verified frames from the signed native addon.
class Recipient implements IdentityRecipientClient {
  #sequence = 0
  #busy = false
  #closed = false
  #onAbort = (): void => this.close()
  private process: IdentityRecipientProcess
  private signal?: AbortSignal
  constructor(process: IdentityRecipientProcess, signal?: AbortSignal) {
    this.process = process
    this.signal = signal
    signal?.addEventListener('abort', this.#onAbort, { once: true })
    if (signal?.aborted)
      this.close()
  }

  async ready(): Promise<void> {
    try {
      const value = object(await this.#receive(10_000), ['version', 'kind'])
      if (value.version !== 1 || value.kind !== 'identity-recipient-ready')
        throw new IdentityTransferError()
    }
    catch {
      this.close()
      throw new IdentityTransferError()
    }
  }

  assertHostsStopped(): void {
    try {
      if (this.#closed || this.signal?.aborted)
        throw new IdentityTransferError()
      this.process.assertHostsStopped()
    }
    catch {
      this.close()
      throw new IdentityTransferError()
    }
  }

  async #receive(timeout: number): Promise<unknown> {
    const deadline = performance.now() + timeout
    while (!this.#closed && !this.signal?.aborted && performance.now() < deadline) {
      if (this.process.status() !== null)
        throw new IdentityTransferError()
      const frame = this.process.read()
      if (frame !== null) {
        try {
          if (!Buffer.isBuffer(frame) || frame.length === 0 || frame.length > 65_536)
            throw new IdentityTransferError()
          return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame))
        }
        finally { frame.fill(0) }
      }
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
    throw new IdentityTransferError()
  }

  async #request<T>(operation: string, fields: Record<string, unknown>, decode: (value: unknown) => T): Promise<T> {
    if (this.#busy || this.#closed || this.signal?.aborted || this.#sequence >= 64) {
      this.close()
      throw new IdentityTransferError()
    }
    this.#busy = true
    let frame: Buffer | undefined
    try {
      const id = ++this.#sequence
      frame = Buffer.from(JSON.stringify({ version: 1, id, operation, ...fields }))
      if (frame.length > 65_536)
        throw new IdentityTransferError()
      this.process.validate()
      if (this.process.write(frame) !== frame.length)
        throw new IdentityTransferError()
      const reply = object(await this.#receive(120_000), ['version', 'id', 'value'])
      if (reply.version !== 1 || reply.id !== id || this.#closed || this.signal?.aborted)
        throw new IdentityTransferError()
      return decode(reply.value)
    }
    catch {
      this.close()
      throw new IdentityTransferError()
    }
    finally {
      frame?.fill(0)
      this.#busy = false
    }
  }

  prepare(paths: ProfileMigrationPaths, endpoint: string, webOrigin: string): Promise<IdentityTransferRequest> {
    const roots = { ...paths }
    return this.#request('prepare', { paths: roots, endpoint, webOrigin }, (value) => {
      const request = validateIdentityTransferRequest(object(value, ['request']).request)
      if (request.sourceData !== roots.sourceData || request.targetProfile !== roots.target
        || request.endpoint !== endpoint || request.webOrigin !== webOrigin) {
        throw new IdentityTransferError()
      }
      return request
    })
  }

  resume(context: ProfileIdentityContext): Promise<void> {
    return this.#request('resume', { context }, value => acknowledgement(value, 'ready'))
  }

  inspect(context: ProfileIdentityContext): Promise<'empty' | 'staged' | 'activated' | 'active'> {
    return this.#request('inspect', { context }, (value) => {
      const state = object(value, ['state']).state
      if (state !== 'empty' && state !== 'staged' && state !== 'activated' && state !== 'active')
        throw new IdentityTransferError()
      return state
    })
  }

  stage(context: ProfileIdentityContext, envelope: IdentityTransferEnvelope): Promise<void> {
    return this.#request('stage', { context, envelope }, value => acknowledgement(value, 'done'))
  }

  activate(context: ProfileIdentityContext): Promise<void> {
    return this.#request('activate', { context }, value => acknowledgement(value, 'done'))
  }

  finish(context: ProfileIdentityContext): Promise<void> {
    return this.#request('finish', { context }, value => acknowledgement(value, 'done'))
  }

  rollback(context: ProfileIdentityContext): Promise<void> {
    return this.#request('rollback', { context }, value => acknowledgement(value, 'done'))
  }

  close(): void {
    if (this.#closed)
      return
    this.#closed = true
    this.signal?.removeEventListener('abort', this.#onAbort)
    try {
      this.process.close()
    }
    catch {
      // Retirement must not expose a native/provider error or mask an uncertain transaction outcome.
    }
  }
}

/** Open a mutually authenticated maintenance session. This grants no migration approval and never loads a vault. */
export async function openIdentityRecipient(peer: IdentityRecipientPreflight, signal?: AbortSignal): Promise<IdentityRecipientClient> {
  let recipient: Recipient | undefined
  try {
    if (signal?.aborted)
      throw new IdentityTransferError()
    recipient = new Recipient(identityLauncher().launch(peer.application, peer.sourceCodeHash, peer.recipientCodeHash), signal)
    await recipient.ready()
    return recipient
  }
  catch {
    recipient?.close()
    throw new IdentityTransferError()
  }
}
