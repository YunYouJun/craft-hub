import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface LocalSigningIdentity { hash: string, name: string }

/** Read valid macOS application identities without exporting certificates or private keys. */
export function parseLocalSigningIdentities(output: string): LocalSigningIdentity[] {
  return [...output.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"\s*$/gm)]
    .map(([, hash, name]) => ({ hash, name }))
    .filter(identity => /^(?:Apple Development|Mac Developer|Developer ID Application):/.test(identity.name))
}

/** Pin the local build identity so rebuilds retain keychain trust; never silently replace a pinned signer. */
export async function resolveLocalSigningIdentity(options: {
  identities: LocalSigningIdentity[]
  statePath: string
  requestedIdentity?: string
}): Promise<LocalSigningIdentity | undefined> {
  let saved: LocalSigningIdentity | undefined
  try {
    const value = JSON.parse(await readFile(options.statePath, 'utf8')) as LocalSigningIdentity
    if (!/^[A-F0-9]{40}$/.test(value.hash) || typeof value.name !== 'string')
      throw new Error('Invalid signing identity')
    saved = value
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(`Could not read local signing identity at ${options.statePath}. Restore it before rebuilding.`)
  }

  const requested = options.requestedIdentity?.trim() || saved?.hash
  let selected: LocalSigningIdentity | undefined
  if (requested) {
    const matches = options.identities.filter(identity => identity.hash === requested.toUpperCase() || identity.name === requested)
    if (matches.length !== 1)
      throw new Error('The selected local signing identity is unavailable or ambiguous. Restore its certificate and private key, or explicitly choose MACOS_LOCAL_SIGNING_IDENTITY. Refusing to change keychain identity silently.')
    selected = matches[0]
  }
  else {
    const distribution = options.identities.filter(identity => identity.name.startsWith('Developer ID Application:'))
    const candidates = distribution.length ? distribution : options.identities
    if (candidates.length > 1)
      throw new Error('Multiple local signing identities are available. Select a certificate fingerprint with MACOS_LOCAL_SIGNING_IDENTITY for this application.')
    selected = candidates[0]
  }
  if (selected && selected.hash !== saved?.hash) {
    await mkdir(dirname(options.statePath), { recursive: true, mode: 0o700 })
    const temporary = `${options.statePath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(selected, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, options.statePath)
  }
  return selected
}
