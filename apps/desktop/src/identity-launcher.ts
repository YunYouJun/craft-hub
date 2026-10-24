import type { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Owned child and authenticated complete Mach frames. Authentication does not grant consent to seal an identity. */
export interface IdentityRecipientProcess {
  validate: () => void
  /** Verify the owned pair and refuse other known host processes; never stop an unrelated process. */
  assertHostsStopped: () => void
  /** Poll one authenticated frame; null means no frame yet, including while the channel handshake progresses. */
  read: () => Buffer | null
  /** Send one complete frame after authenticated ready, or throw and retire the child. */
  write: (frame: Buffer) => number
  end: () => void
  close: () => void
  status: () => number | null
}

/** Load only the signed application's fixed macOS addon. No path, PID, team or ad hoc policy is supplied by a caller. */
export function identityLauncher(): { launch: (application: string, sourceCodeHash: string, recipientCodeHash: string) => IdentityRecipientProcess } {
  if (process.platform !== 'darwin')
    throw new Error('Identity recipient launch is unavailable')
  const path = fileURLToPath(new URL('../identity-launcher/launcher.node', import.meta.url)).replace(/\.asar(?=\/)/, '.asar.unpacked')
  const addon: unknown = createRequire(import.meta.url)(path)
  if (!addon || typeof addon !== 'object' || !('launch' in addon) || typeof addon.launch !== 'function')
    throw new Error('Identity recipient launch is unavailable')
  return addon as { launch: (application: string, sourceCodeHash: string, recipientCodeHash: string) => IdentityRecipientProcess }
}
