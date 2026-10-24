import type { IdentityTransferRequest } from '@craft-hub/personal-cloud'
import type { ProfileIdentityContext } from 'craft-hub'
import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'
import { IdentityTransferError } from '@craft-hub/personal-cloud'
import { afterEach, expect, it, vi } from 'vitest'
import { openIdentityRecipient } from '../src/identity-recipient-client.ts'

const launch = vi.hoisted(() => vi.fn())
vi.mock('../src/identity-launcher.ts', () => ({ identityLauncher: () => ({ launch }) }))
const encode = (value: unknown): Buffer => Buffer.from(JSON.stringify(value))
const peerReview = { application: '/fixture/Candidate.app', executable: '/fixture/Candidate.app/Contents/MacOS/Candidate', sourceApplication: '/fixture/Source.app', team: 'ABCDE12345', sourceCodeHash: 'a'.repeat(40), recipientCodeHash: 'b'.repeat(40) }
const paths = { sourceData: '/fixture/source', sourceConfig: '/fixture/config', target: '/fixture/target' }
const endpoint = 'https://api.example.com'
const webOrigin = 'https://cloud.example.com'
const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString()
const context: ProfileIdentityContext = {
  transaction: '/fixture/.target.migration-7f7ecdf1-b4ea-4f46-b47a-b84aa313c85f',
  paths,
  identity: { id: 'a'.repeat(64), sourceRevision: 'b'.repeat(64), publicKey, endpoint, webOrigin },
}
function request(): IdentityTransferRequest {
  return {
    version: 1,
    sourceData: paths.sourceData,
    targetProfile: paths.target,
    sourceRevision: context.identity.sourceRevision,
    publicKey,
    endpoint,
    webOrigin,
    recipientKey: generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
    challenge: 'c'.repeat(64),
    expiresAt: Date.now() + 60_000,
  }
}
function fixture() {
  const inbox = [encode({ version: 1, kind: 'identity-recipient-ready' })]
  const sent: Array<{ version: number, id: number, operation: string, [key: string]: unknown }> = []
  const peer = {
    validate: vi.fn(),
    assertHostsStopped: vi.fn(),
    status: vi.fn((): number | null => null),
    read: vi.fn(() => inbox.shift() ?? null),
    write: vi.fn((frame: Buffer) => {
      const message = JSON.parse(frame.toString('utf8')) as typeof sent[number]
      sent.push(message)
      inbox.push(encode({ version: 1, id: message.id, value: message.operation === 'resume' ? { ready: true } : { done: true } }))
      return frame.length
    }),
    end: vi.fn(),
    close: vi.fn(),
  }
  launch.mockReturnValue(peer)
  return { peer, inbox, sent }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('accepts only the native-owned request, serializes complete frames and retires without a transaction decision', async () => {
  const { peer, inbox, sent } = fixture()
  const recipient = await openIdentityRecipient(peerReview)
  const expected = request()
  peer.write.mockImplementation((frame) => {
    const message = JSON.parse(frame.toString()) as typeof sent[number]
    sent.push(message)
    inbox.push(encode({ version: 1, id: message.id, value: message.operation === 'prepare' ? { request: expected } : message.operation === 'inspect' ? { state: 'staged' } : { done: true } }))
    return frame.length
  })
  await expect(recipient.prepare(paths, endpoint, webOrigin)).resolves.toEqual(expected)
  await expect(recipient.inspect(context)).resolves.toBe('staged')
  const envelope = { version: 1 as const, challenge: expected.challenge, senderKey: expected.recipientKey, sealed: 'fixture ciphertext' }
  await recipient.stage(context, envelope)
  await recipient.activate(context)
  await recipient.finish(context)
  await recipient.rollback(context)
  expect(sent.map(({ id, operation }) => [id, operation])).toEqual([[1, 'prepare'], [2, 'inspect'], [3, 'stage'], [4, 'activate'], [5, 'finish'], [6, 'rollback']])
  expect(sent[2]).toEqual({ version: 1, id: 3, operation: 'stage', context, envelope })
  expect(peer.validate).toHaveBeenCalledTimes(6)
  expect(launch).toHaveBeenCalledWith(peerReview.application, peerReview.sourceCodeHash, peerReview.recipientCodeHash)
  recipient.close()
  recipient.close()
  expect(peer.close).toHaveBeenCalledOnce()
  await expect(recipient.finish(context)).rejects.toThrow(IdentityTransferError)
  expect(sent).toHaveLength(6)
})

it.each([
  encode({ version: true, kind: 'identity-recipient-ready' }),
  encode({ version: 1, kind: 'identity-recipient-ready', recipientKey: 'untrusted' }),
  encode({ version: 1, kind: 'identity-recipient-channel-ready' }),
  Buffer.alloc(0),
  Buffer.from([0xFF]),
  Buffer.alloc(65_537),
  Buffer.from('secret-invalid-json'),
])('rejects malformed startup frame %# without exposing provider data', async (bad) => {
  const { peer, inbox } = fixture()
  inbox.splice(0, inbox.length, Buffer.from(bad))
  await expect(openIdentityRecipient(peerReview)).rejects.toThrow(new IdentityTransferError().message)
  expect(peer.close).toHaveBeenCalledOnce()
  expect(peer.write).not.toHaveBeenCalled()
})

it.each([
  { version: 1, id: 0, value: { ready: true } },
  { version: 1, id: 2, value: { ready: true } },
  { version: true, id: 1, value: { ready: true } },
  { version: 1, id: 1, value: { ready: 1 } },
  { version: 1, id: 1, value: { ready: true, key: 'untrusted' } },
  { version: 1, id: 1, value: { ready: true }, extra: 'untrusted' },
])('retires on a malformed or uncorrelated acknowledgement %#', async (response) => {
  const { peer, inbox } = fixture()
  const recipient = await openIdentityRecipient(peerReview)
  peer.write.mockImplementation((frame) => {
    inbox.push(encode(response))
    return frame.length
  })
  await expect(recipient.resume(context)).rejects.toThrow(IdentityTransferError)
  expect(peer.close).toHaveBeenCalledOnce()
})

it.each(['sourceData', 'targetProfile', 'endpoint', 'webOrigin', 'expiresAt', 'recipientKey'])('rejects a prepared request outside its reviewed %s', async (field) => {
  const { peer, inbox } = fixture()
  const recipient = await openIdentityRecipient(peerReview)
  const value = { ...request(), [field]: field === 'expiresAt' ? Date.now() - 1 : field === 'sourceData' || field === 'targetProfile' ? '/different' : 'https://different.example.com' }
  peer.write.mockImplementation((frame) => {
    inbox.push(encode({ version: 1, id: 1, value: { request: value } }))
    return frame.length
  })
  await expect(recipient.prepare(paths, endpoint, webOrigin)).rejects.toThrow(IdentityTransferError)
  expect(peer.close).toHaveBeenCalledOnce()
})

it('recovers through resume and inspect without generating another key', async () => {
  const { peer, inbox, sent } = fixture()
  const recipient = await openIdentityRecipient(peerReview)
  await recipient.resume(context)
  peer.write.mockImplementation((frame) => {
    const message = JSON.parse(frame.toString()) as typeof sent[number]
    sent.push(message)
    inbox.push(encode({ version: 1, id: message.id, value: { state: 'activated' } }))
    return frame.length
  })
  await expect(recipient.inspect(context)).resolves.toBe('activated')
  expect(sent.map(value => value.operation)).toEqual(['resume', 'inspect'])
  recipient.close()
})

it('closes immediately on abort and never guesses rollback after a lost stage acknowledgement', async () => {
  const { peer, sent } = fixture()
  const abort = new AbortController()
  const recipient = await openIdentityRecipient(peerReview, abort.signal)
  peer.write.mockImplementation((frame) => {
    sent.push(JSON.parse(frame.toString()))
    return frame.length
  })
  const pending = expect(recipient.stage(context, { version: 1, challenge: 'x', senderKey: 'y', sealed: 'z' })).rejects.toThrow(IdentityTransferError)
  abort.abort()
  expect(peer.close).toHaveBeenCalledOnce()
  await pending
  expect(sent.map(value => value.operation)).toEqual(['stage'])
  launch.mockClear()
  await expect(openIdentityRecipient(peerReview, abort.signal)).rejects.toThrow(IdentityTransferError)
  expect(launch).not.toHaveBeenCalled()
})

it('rejects concurrent operations, short writes, exited peers, and oversized frames', async () => {
  for (const failure of ['concurrent', 'partial', 'exited', 'oversized']) {
    const { peer } = fixture()
    const recipient = await openIdentityRecipient(peerReview)
    peer.write.mockImplementation(frame => failure === 'partial' ? 1 : frame.length)
    if (failure === 'exited')
      peer.status.mockReturnValue(1)
    const pending = expect(recipient.resume(failure === 'oversized' ? { ...context, transaction: 'z'.repeat(65_536) } : context)).rejects.toThrow(IdentityTransferError)
    if (failure === 'concurrent')
      await expect(recipient.finish(context)).rejects.toThrow(IdentityTransferError)
    await pending
    expect(peer.close).toHaveBeenCalledOnce()
    expect(peer.write).toHaveBeenCalledTimes(failure === 'oversized' ? 0 : 1)
  }
})

it('bounds startup, response waiting and request count', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  let f = fixture()
  f.inbox.length = 0
  const startup = expect(openIdentityRecipient(peerReview)).rejects.toThrow(IdentityTransferError)
  await vi.advanceTimersByTimeAsync(10_000)
  await startup
  expect(f.peer.close).toHaveBeenCalledOnce()
  f = fixture()
  let recipient = await openIdentityRecipient(peerReview)
  f.peer.write.mockImplementation(frame => frame.length)
  const stalled = expect(recipient.finish(context)).rejects.toThrow(IdentityTransferError)
  await vi.advanceTimersByTimeAsync(120_000)
  await stalled
  expect(f.peer.close).toHaveBeenCalledOnce()
  f = fixture()
  recipient = await openIdentityRecipient(peerReview)
  for (let index = 0; index < 64; ++index)
    await recipient.finish(context)
  await expect(recipient.finish(context)).rejects.toThrow(IdentityTransferError)
  expect(f.sent).toHaveLength(64)
  expect(f.peer.close).toHaveBeenCalledOnce()
})

it('does not expose native validation errors or send after identity validation fails', async () => {
  const { peer } = fixture()
  const recipient = await openIdentityRecipient(peerReview)
  peer.validate.mockImplementation(() => {
    throw new Error('provider secret')
  })
  await expect(recipient.finish(context)).rejects.toThrow(new IdentityTransferError().message)
  expect(peer.write).not.toHaveBeenCalled()
  expect(peer.close).toHaveBeenCalledOnce()
})
