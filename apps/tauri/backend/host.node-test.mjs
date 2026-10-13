import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createHostRequestHandler, createSessionGuard, externalUrl, runNative } from './host.ts'

const origin = 'http://127.0.0.1:49218'
const secret = 'a'.repeat(64)

function request(path, headers = {}, method = 'GET') {
  return { url: path, method, headers: { host: '127.0.0.1:49218', ...headers } }
}

test('session authorization rejects direct, wrong-host and cross-origin access before any routes', () => {
  const guard = createSessionGuard(secret)
  guard.setOrigin(origin)
  assert.equal(guard.authorize(request('/api/projects')), false)
  assert.equal(guard.authorize(request(`/__craft_hub_host/bootstrap?token=${secret}`)), true)
  assert.equal(guard.authorize(request('/__craft_hub_host/bootstrap?token=bad')), false)
  assert.equal(guard.authorize(request('/api/projects', { cookie: `craft-hub-tauri-trial=${secret}`, host: 'evil.example' })), false)
  assert.equal(guard.authorize(request('/api/projects', { cookie: `craft-hub-tauri-trial=${secret}`, origin: 'https://evil.example' })), false)
  assert.equal(guard.authorize(request('/api/projects', { cookie: `craft-hub-tauri-trial=${secret}`, origin })), true)
})

test('bootstrap rotates from a one-use URL to an HttpOnly SameSite session cookie', () => {
  const guard = createSessionGuard(secret)
  guard.setOrigin(origin)
  let status
  let headers
  guard.bootstrap({ writeHead: (value, valueHeaders) => {
    status = value
    headers = valueHeaders
  }, end() {} })
  assert.equal(status, 303)
  assert.equal(headers.location, '/overview')
  assert.match(headers['set-cookie'], /HttpOnly; SameSite=Strict; Path=\//)
  assert.equal(guard.authorize(request(`/__craft_hub_host/bootstrap?token=${secret}`)), false)
})

test('external opening rejects credentials, scripts, insecure destinations and control characters', () => {
  assert.equal(externalUrl('https://example.com/tools'), 'https://example.com/tools')
  for (const value of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/\n'])
    assert.throws(() => externalUrl(value))
})

test('native execution preserves literal arguments and disables shell interpretation', async () => {
  let options
  let arguments_
  let receivedInput
  const launch = (command, args, value) => {
    assert.equal(command, '/usr/bin/pbcopy')
    options = value
    arguments_ = args
    const child = new EventEmitter()
    child.stdout = new Readable({ read() {} })
    child.stderr = new Readable({ read() {} })
    child.stdin = new EventEmitter()
    child.stdin.end = (input) => {
      receivedInput = input
      queueMicrotask(() => child.emit('close', 0))
    }
    return child
  }
  await runNative('/usr/bin/pbcopy', ['$literal'], '$(literal)', launch)
  assert.equal(options.shell, false)
  assert.deepEqual(arguments_, ['$literal'])
  assert.equal(receivedInput, '$(literal)')
})

test('host actions demand explicit JSON and a same-origin custom header', async () => {
  const handler = createHostRequestHandler({}, () => {
    throw new Error('must not dispatch')
  }, () => {})
  let status
  let body
  const handled = await handler(request('/__craft_hub_host/copy-text', {}, 'POST'), { writeHead: value => status = value, end: value => body = JSON.parse(value) })
  assert.equal(handled, true)
  assert.equal(status, 403)
  assert.match(body.error, /same-origin JSON/)
})

test('tool opening uses the saved runtime entry and rejects arbitrary client payloads', async () => {
  const tool = { id: 'saved', url: 'https://example.com', title: 'Saved', group: 'Tools' }
  let opened
  const handler = createHostRequestHandler({}, () => ({ settings: { get: async () => ({ settings: { 'workbench.home': { tools: [tool] } } }) } }), async (value) => {
    opened = value
    return { destination: 'website', contextTransferred: false }
  })
  const input = Readable.from([JSON.stringify({ toolId: 'saved', url: 'https://evil.example' })])
  Object.assign(input, request('/__craft_hub_host/open-workbench-tool', { 'content-type': 'application/json', 'x-craft-hub-host': '1' }, 'POST'))
  let body
  await handler(input, { writeHead() {}, end: value => body = JSON.parse(value) })
  assert.deepEqual(opened, tool)
  assert.deepEqual(body.value, { destination: 'website', contextTransferred: false })
})

test('clipboard preserves multibyte text split across HTTP chunks', async () => {
  const text = '中文交接 🐳'
  const encoded = Buffer.from(JSON.stringify({ text }))
  const split = encoded.indexOf(Buffer.from('🐳')) + 2
  let copied
  const native = async (_command, _args, input) => {
    copied = input
    return ''
  }
  const handler = createHostRequestHandler({}, () => ({}), () => {}, native)
  const input = Readable.from([encoded.subarray(0, split), encoded.subarray(split)])
  Object.assign(input, request('/__craft_hub_host/copy-text', { 'content-type': 'application/json', 'x-craft-hub-host': '1' }, 'POST'))
  let status
  await handler(input, { writeHead: value => status = value, end() {} })
  assert.equal(status, 200)
  assert.equal(copied, text)
})
