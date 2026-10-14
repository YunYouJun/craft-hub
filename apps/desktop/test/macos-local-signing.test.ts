import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { parseLocalSigningIdentities, resolveLocalSigningIdentity } from '../../../scripts/macos-local-signing.ts'

const developer = { hash: 'A'.repeat(40), name: 'Apple Development: Example (TEAM)' }
const distribution = { hash: 'B'.repeat(40), name: 'Developer ID Application: Example (TEAM)' }
let directory: string
let statePath: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'craft-hub-signing-'))
  statePath = join(directory, 'identity.json')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

it('excludes mobile distribution identities and invalid identities from local selection', () => {
  expect(parseLocalSigningIdentities(`  1) ${developer.hash} "${developer.name}"\n  2) ${distribution.hash} "Apple Distribution: Example (TEAM)"\n  3) ${'C'.repeat(40)} "Mac Developer: Expired" (CSSMERR_TP_CERT_EXPIRED)\n     2 valid identities found`)).toEqual([developer])
})

it('pins the first signing identity and retains it when new certificates are installed', async () => {
  expect(await resolveLocalSigningIdentity({ identities: [developer], statePath })).toEqual(developer)
  expect(JSON.parse(await readFile(statePath, 'utf8'))).toEqual(developer)
  expect(await resolveLocalSigningIdentity({ identities: [distribution, developer], statePath })).toEqual(developer)
  await expect(resolveLocalSigningIdentity({ identities: [distribution], statePath })).rejects.toThrow('Refusing to change keychain identity')
})

it('requires an explicit choice for ambiguous signers and permits an explicit certificate rotation', async () => {
  const another = { ...developer, hash: 'C'.repeat(40) }
  await expect(resolveLocalSigningIdentity({ identities: [developer, another], statePath })).rejects.toThrow('Multiple local signing')
  await resolveLocalSigningIdentity({ identities: [developer], statePath })
  expect(await resolveLocalSigningIdentity({ identities: [distribution], statePath, requestedIdentity: distribution.hash })).toEqual(distribution)
})

it('allows ad hoc builds only before an identity has been selected, and fails closed on invalid state', async () => {
  expect(await resolveLocalSigningIdentity({ identities: [], statePath })).toBeUndefined()
  await writeFile(statePath, '{}')
  await expect(resolveLocalSigningIdentity({ identities: [developer], statePath })).rejects.toThrow('Could not read local signing identity')
})
