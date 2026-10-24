import type { IdentityTransferEnvelope, IdentityTransferRequest, IdentityTransferReview } from '@craft-hub/personal-cloud'
import type { Readable } from 'node:stream'
import type { DeviceVault } from './device-vault.ts'
import { Buffer } from 'node:buffer'
import { join, sep } from 'node:path'
import { IdentityTransferError, personalCloudOrigin, validateIdentityTransferRequest } from '@craft-hub/personal-cloud'
import { acquireProfileLease, canonicalProfilePath } from 'craft-hub'

/** Bounded private input with EOF framing and a deadline; rejected input is never included in errors. */
export async function readIdentityTransferInput(input: Readable): Promise<unknown> {
  const timer = setTimeout(() => input.destroy(new IdentityTransferError()), 10_000)
  let bytes = Buffer.alloc(0)
  try {
    for await (const chunk of input) {
      const next = Buffer.from(chunk)
      if (bytes.length + next.length > 16 * 1024)
        throw new IdentityTransferError()
      bytes = Buffer.concat([bytes, next])
    }
    return JSON.parse(bytes.toString('utf8'))
  }
  catch { throw new IdentityTransferError() }
  finally {
    clearTimeout(timer)
    bytes.fill(0)
  }
}

/** Host adapter: metadata and encrypted envelopes only. No browser IPC or automatic approval surface. */
export interface IdentityTransferSourceOptions {
  vault: DeviceVault
  sourceData: string
  endpoint?: string
  webOrigin?: string
  assertHostsStopped: () => Promise<void>
  confirm: (request: IdentityTransferRequest) => Promise<boolean>
}

/** One source operation; sealing acquires its own exclusive leases and preserves every source file. */
export async function operateIdentityTransferSource(input: unknown, options: IdentityTransferSourceOptions): Promise<IdentityTransferReview | IdentityTransferEnvelope | null> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new IdentityTransferError()
    const message = input as { version?: unknown, action?: unknown, request?: unknown }
    if (message.version !== 1)
      throw new IdentityTransferError()
    if (message.action === 'preview' && Object.keys(message).sort().join(',') === 'action,version')
      return await options.vault.previewTransfer() ?? null
    if (message.action !== 'seal' || Object.keys(message).sort().join(',') !== 'action,request,version'
      || !options.endpoint || !options.webOrigin) {
      throw new IdentityTransferError()
    }
    const request = validateIdentityTransferRequest(message.request)
    const source = await canonicalProfilePath(options.sourceData)
    const target = await canonicalProfilePath(request.targetProfile)
    if (source === sep || target === sep || request.sourceData !== source || request.targetProfile !== target
      || source === target || source.startsWith(target + sep) || target.startsWith(source + sep)
      || personalCloudOrigin(options.endpoint) !== request.endpoint || personalCloudOrigin(options.webOrigin) !== request.webOrigin) {
      throw new IdentityTransferError()
    }
    const lease = await acquireProfileLease([source, request.targetProfile, join(request.targetProfile, 'runtime'), join(request.targetProfile, 'config')], 'migration')
    try {
      await options.assertHostsStopped()
      const preview = await options.vault.previewTransfer()
      if (!preview || preview.sourceRevision !== request.sourceRevision || preview.publicKey !== request.publicKey || preview.deviceId !== request.deviceId)
        throw new IdentityTransferError()
      if (!await options.confirm(request))
        throw new IdentityTransferError()
      await options.assertHostsStopped()
      return await options.vault.sealTransfer(request, { endpoint: options.endpoint, webOrigin: options.webOrigin })
    }
    finally { lease.release() }
  }
  catch { throw new IdentityTransferError() }
}
