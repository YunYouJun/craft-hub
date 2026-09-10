import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn }))

async function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  const messages: Array<{ id?: number, method: string }> = []
  child.stdin.on('data', (chunk) => {
    const message = JSON.parse(chunk.toString())
    messages.push(message)
    if (message.method === 'initialize')
      child.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
  })
  mock.spawn.mockReturnValue(child)
  const { openCodexReader } = await import('../src/client')
  const reader = await openCodexReader('/trusted/codex', 100)
  return { reader, child, messages }
}

afterEach(() => vi.clearAllMocks())

describe('bounded Codex read transport', () => {
  it('handles split JSON lines, skips notifications, and shuts down', async () => {
    const { reader, child, messages } = await fixture()
    const result = reader.read('config/read', {})
    child.stdout.write('{"method":"notification"}\n{"id":2,"res')
    child.stdout.write('ult":{"config":{}}}\n')
    await expect(result).resolves.toEqual({ config: {} })
    expect(messages.map(message => message.method)).toEqual(['initialize', 'initialized', 'config/read'])
    expect(mock.spawn.mock.calls[0]?.[2].shell).toBe(false)
    reader.close()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('does not pass server errors or sensitive diagnostics to the caller', async () => {
    const { reader, child } = await fixture()
    const result = reader.read('config/read', {})
    child.stdout.write('{"id":2,"error":{"message":"secret-token"}}\n')
    await expect(result).rejects.toThrow('Codex rejected')
    reader.close()
  })

  it('bounds hung requests and closes the subprocess', async () => {
    const { reader, child } = await fixture()
    await expect(reader.read('plugin/list', {})).rejects.toThrow('timed out')
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
