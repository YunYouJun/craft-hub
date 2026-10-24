import type { IdentityTransferRequest } from '@craft-hub/personal-cloud'
import type { ProfileIdentityContext, ProfileIdentityParticipant } from '../../../../packages/craft-hub/src/profile-migration.ts'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { applyIdentityProfileMigration, previewIdentityProfileRecovery, previewProfileMigration, ProfileIdentityRecoveryError, recoverIdentityProfileMigration, rollbackIdentityProfileMigration } from '../../../../packages/craft-hub/src/profile-migration.ts'
import { DeviceVault } from '../../src/device-vault.ts'

// Real coordinator and production recipient frames, with a test-only OS cipher and isolated native Keychain.
async function main(): Promise<void> {
  const root = await realpath(process.argv[2]!)
  const paths = { sourceData: join(root, 'source'), sourceConfig: join(root, 'portable'), target: join(root, 'target') }
  await Promise.all([paths.sourceData, paths.sourceConfig, join(paths.target, 'runtime')].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  await writeFile(join(paths.sourceData, 'projects.json'), JSON.stringify([{ id: 'fixture', path: join(root, 'project'), trust: 'untrusted', name: 'Fixture', addedAt: '2026-01-01T00:00:00Z' }]))
  await writeFile(join(paths.target, 'runtime/projects.json'), '[]')
  let secret = ''
  const ciphertext = randomBytes(64)
  const source = new DeviceVault(paths.sourceData, {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'fixture',
    encryptString(value) {
      secret = value
      return ciphertext
    },
    decryptString(value) {
      assert(value.equals(ciphertext))
      return secret
    },
  }, 'darwin')
  await source.register(await source.loadOrCreate(), 'fixture-device')
  const original = await readFile(join(paths.sourceData, 'personal-cloud-device.json'))
  const lines = createInterface({ input: process.stdin })
  const input = lines[Symbol.asyncIterator]()
  async function receive(): Promise<unknown> {
    const line = await input.next()
    assert(!line.done && line.value.length <= 32768)
    return JSON.parse(line.value)
  }
  process.stdout.write('ready\n')
  let sequence = 0
  async function ready(): Promise<void> {
    assert.deepEqual(await receive(), { version: 1, kind: 'identity-recipient-ready' })
    sequence = 0
  }
  async function call(operation: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++sequence
    process.stdout.write(`${JSON.stringify({ version: 1, id, operation, ...extra })}\n`)
    const result = await receive() as { version: number, id: number, value: Record<string, unknown> }
    assert.equal(result.version, 1)
    assert.equal(result.id, id)
    return result.value
  }
  await ready()
  const request = (await call('prepare', { paths, endpoint: 'https://api.example.com', webOrigin: 'https://cloud.example.com' })).request as IdentityTransferRequest
  async function rpc(operation: string, context: ProfileIdentityContext, envelope?: string): Promise<{ ok?: string, state?: Awaited<ReturnType<ProfileIdentityParticipant['inspect']>> }> {
    const value = await call(operation, { context, ...(envelope ? { envelope: JSON.parse(envelope) } : {}) })
    return { ok: value.done ? 'yes' : undefined, state: value.state as Awaited<ReturnType<ProfileIdentityParticipant['inspect']>> }
  }
  const participant: ProfileIdentityParticipant = {
    async inspect(context) {
      const state = (await rpc('inspect', context)).state
      assert(state)
      return state
    },
    async stage(context) {
      const envelope = await source.sealTransfer(request, { endpoint: request.endpoint, webOrigin: request.webOrigin })
      assert((await rpc('stage', context, JSON.stringify(envelope))).ok)
    },
    async activate(context) { assert((await rpc('activate', context)).ok) },
    async finish(context) { assert((await rpc('finish', context)).ok) },
    async rollback(context) { assert((await rpc('rollback', context)).ok) },
  }
  const identity = { id: request.challenge, sourceRevision: request.sourceRevision, publicKey: request.publicKey, deviceId: request.deviceId, endpoint: request.endpoint, webOrigin: request.webOrigin }
  const preview = await previewProfileMigration(paths)
  const interrupted = await applyIdentityProfileMigration(paths, preview.revision, identity, participant, async () => {}, async (phase) => {
    if (phase === 'commit-decided')
      throw new Error('Coordinator interruption fixture')
  }).catch(error => error)
  assert(interrupted instanceof ProfileIdentityRecoveryError)
  const review = await previewIdentityProfileRecovery(interrupted.transaction)
  // Test harness retires the old engine; this control message is never accepted by the production recipient.
  process.stdout.write(`${JSON.stringify({ testControl: 'reopen' })}\n`)
  await ready()
  assert.equal((await call('resume', { context: { transaction: review.transaction, paths: review.paths, identity: review.identity } })).ready, true)
  const completed = await recoverIdentityProfileMigration(review.transaction, participant, async () => {})
  assert.equal(completed.phase, 'complete')
  const projects = JSON.parse(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8'))
  assert.equal(projects[0].trust, 'untrusted')
  await writeFile(join(paths.target, 'runtime/settings.json'), '{"laterEdit":true}')
  const rollback = await previewIdentityProfileRecovery(review.transaction)
  assert.equal((await rollbackIdentityProfileMigration(review.transaction, rollback.revision, participant, async () => {})).phase, 'rolled-back')
  assert.equal(await readFile(join(paths.target, 'runtime/projects.json'), 'utf8'), '[]')
  assert((await readFile(join(paths.sourceData, 'personal-cloud-device.json'))).equals(original))
  assert.equal((await readFile(join(review.transaction, 'journal.json'), 'utf8')).includes(secret), false)
  assert.equal((await call('close')).closed, true)
  process.stdout.write(`${JSON.stringify({ testControl: 'done' })}\n`)
  lines.close()
}
void main().catch(() => {
  process.stderr.write('Identity profile migration fixture failed\n')
  process.exitCode = 1
})
