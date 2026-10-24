import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { NativeDeviceVault, NativeHostChannel } from '../src/native-host-channel'

function fixture(timeoutMs?: number) {
  const incoming = new PassThrough()
  const outgoing = new PassThrough()
  const channel = new NativeHostChannel(incoming, outgoing, timeoutMs)
  const frames: Array<{ hostBridge: number, id: string, method: string, payload: Record<string, unknown> }> = []
  outgoing.on('data', data => frames.push(JSON.parse(String(data))))
  const reply = (value: unknown, index = frames.length - 1) => incoming.write(`${JSON.stringify({ hostBridge: 1, id: frames[index]!.id, ok: true, value })}\n`)
  return {
    incoming,
    outgoing,
    channel,
    frames,
    reply,
    close: () => {
      channel.close()
      incoming.destroy()
      outgoing.destroy()
    },
  }
}

function identity() {
  const pair = generateKeyPairSync('ed25519')
  return { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}

describe('native private host channel', () => {
  it('correlates fragmented and coalesced replies and ignores duplicate acknowledgements', async () => {
    const f = fixture()
    try {
      const first = f.channel.request('vault.load')
      const second = f.channel.request('vault.load')
      expect(f.frames.map(frame => frame.method)).toEqual(['vault.load', 'vault.load'])
      const line = JSON.stringify({ hostBridge: 1, id: f.frames[1]!.id, ok: true, value: null })
      f.incoming.write(line.slice(0, 9))
      f.incoming.write(`${line.slice(9)}\n${line}\n`)
      await expect(second).resolves.toBeNull()
      f.reply(null, 0)
      await expect(first).resolves.toBeNull()
      expect(f.frames).toHaveLength(2)
    }
    finally { f.close() }
  })

  it('uses the existing vault contract without sending clears for unknown identities or mutating returned values', async () => {
    const f = fixture()
    const vault = new NativeDeviceVault(f.channel)
    try {
      await vault.clear()
      expect(f.frames).toEqual([])
      const load = vault.load()
      f.reply(null)
      await expect(load).resolves.toBeUndefined()
      const value = identity()
      const created = vault.loadOrCreate()
      f.reply(value)
      const returned = await created
      returned.publicKey = 'caller-local-edit'
      const register = vault.register(value, 'fixture-device')
      expect(f.frames.at(-1)?.method).toBe('vault.register')
      f.reply({ ...value, deviceId: 'fixture-device' })
      expect((await register).deviceId).toBe('fixture-device')
      const clear = vault.clear()
      // Stale registration IDs are part of the compare, even when their key pair was unchanged.
      expect((f.frames.at(-1)?.payload.expected as { deviceId?: string }).deviceId).toBe('fixture-device')
      f.reply(null)
      await clear
      const count = f.frames.length
      await vault.clear()
      expect(f.frames).toHaveLength(count)
    }
    finally { f.close() }
  })

  it.each([
    '',
    'not-json-private-fixture',
    'null',
    '[]',
    JSON.stringify({ hostBridge: 2, id: randomUUID(), ok: true, value: null }),
    JSON.stringify({ hostBridge: true, id: randomUUID(), ok: true, value: null }),
    JSON.stringify({ hostBridge: 1, id: 'invalid', ok: true, value: null }),
    JSON.stringify({ hostBridge: 1, id: randomUUID(), ok: true, value: null, extra: 'private-fixture' }),
    JSON.stringify({ hostBridge: 1, id: randomUUID(), ok: false, error: 'secret-provider-error' }),
    'x'.repeat(16 * 1024 + 1),
  ])('retires malformed channels without exposing raw frames (%#)', async (line) => {
    const f = fixture()
    try {
      const result = f.channel.request('vault.load')
      f.incoming.write(`${line}\n`)
      await expect(result).rejects.toMatchObject({ code: 'invalid', message: 'Native secure-storage channel invalid' })
      await expect(f.channel.request('vault.create')).rejects.toMatchObject({ code: 'closed' })
    }
    finally { f.close() }
  })

  it('bounds outstanding requests and retires the generation on timeout without retrying a mutation', async () => {
    vi.useFakeTimers()
    const f = fixture(50)
    try {
      const results = Array.from({ length: 8 }, () => f.channel.request('vault.create').catch(error => error.code))
      await expect(f.channel.request('vault.create')).rejects.toMatchObject({ code: 'busy' })
      await vi.advanceTimersByTimeAsync(50)
      expect(await Promise.all(results)).toEqual(Array.from({ length: 8 }).fill('timeout'))
      f.reply(identity())
      await expect(f.channel.request('vault.load')).rejects.toMatchObject({ code: 'closed' })
      expect(f.frames).toHaveLength(8)
    }
    finally {
      f.close()
      vi.useRealTimers()
    }
  })

  it('settles pending work on pipe closure or write failure without reporting stream error contents', async () => {
    const f = fixture()
    const result = f.channel.request('vault.load')
    f.incoming.end()
    await expect(result).rejects.toMatchObject({ code: 'closed' })
    f.close()
    const input = new PassThrough()
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('private-fixture-write-error'))
      },
    })
    const channel = new NativeHostChannel(input, output)
    await expect(channel.request('vault.load')).rejects.toMatchObject({ message: 'Native secure-storage channel closed' })
    input.destroy()
    output.destroy()
  })

  it('rejects malformed identities without leaking their contents or reusing the channel', async () => {
    const f = fixture()
    const vault = new NativeDeviceVault(f.channel)
    try {
      const invalid = vault.load()
      f.reply({ privateKey: 'private-fixture-invalid', publicKey: 'public-fixture-invalid' })
      await expect(invalid).rejects.toMatchObject({ code: 'invalid', message: 'Native secure-storage channel invalid' })
      await expect(vault.loadOrCreate()).rejects.toMatchObject({ code: 'closed' })
    }
    finally { f.close() }
  })

  it('rejects substituted registration keys and invalid IDs without deleting any identity', async () => {
    const f = fixture()
    const vault = new NativeDeviceVault(f.channel)
    try {
      const value = identity()
      const register = vault.register(value, 'fixture-device')
      f.reply({ ...identity(), deviceId: 'fixture-device' })
      await expect(register).rejects.toMatchObject({ code: 'invalid' })
      const count = f.frames.length
      await expect(vault.register(value, 'bad\r\nheader')).rejects.toMatchObject({ code: 'invalid' })
      await vault.clear()
      expect(f.frames).toHaveLength(count)
    }
    finally { f.close() }
  })
})
