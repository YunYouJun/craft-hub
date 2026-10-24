import type { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { join } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { requestSigningMessage, verifyDeviceRequest } from '@craft-hub/personal-cloud'

// This test-only prelude exchanges public configuration before connecting the production private pipe protocol.
async function main(): Promise<void> {
  let publicKey = ''
  let revoked = false
  let synchronized = false
  let invalid = false
  const server = createServer((request, response) => {
    void (async () => {
      let body = ''
      for await (const chunk of request) {
        body += String(chunk)
        assert(body.length < 2 * 1024 * 1024)
      }
      assert.equal(request.headers['x-craft-device'], 'packaged-fixture')
      assert(verifyDeviceRequest(String(request.headers['x-craft-signature']), requestSigningMessage('POST', request.url!, Number(request.headers['x-craft-timestamp']), String(request.headers['x-craft-nonce']), body), publicKey))
      let result: unknown = {}
      if (request.url === '/v1/sync') {
        synchronized = true
        result = { documents: [], conflicts: [], accepted: JSON.parse(body).documents.map((document: { key: string, revision: string }) => ({ key: document.key, revision: document.revision })) }
      }
      if (request.url === '/v1/device-requests/claim')
        result = []
      if (request.url === '/v1/devices/revoke')
        revoked = true
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(result))
    })().catch(() => {
      invalid = true
      response.writeHead(400)
      response.end('{}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  process.stdout.write(`${JSON.stringify({ fixtureOrigin: origin })}\n`)
  const prelude = await new Promise<string>((resolve, reject) => {
    let value = ''
    function receive(chunk: Buffer): void {
      value += chunk.toString('utf8')
      if (value.length > 4096)
        reject(new Error('Invalid fixture prelude'))
      if (!value.endsWith('\n'))
        return
      process.stdin.off('data', receive)
      process.stdin.pause()
      resolve(value)
    }
    process.stdin.on('data', receive)
  })
  publicKey = (JSON.parse(prelude) as { publicKey: string }).publicKey
  assert(publicKey.startsWith('-----BEGIN PUBLIC KEY-----'))
  const child = spawn(process.execPath, [process.env.CRAFT_HUB_TEST_CLOUD_SIDECAR!], {
    cwd: process.env.HOME,
    env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin', CRAFT_HUB_SIDECAR_DIR: join(process.env.HOME!, 'profile'), CRAFT_HUB_NATIVE_HOST_CHANNEL: '1', CRAFT_HUB_CLOUD_ENDPOINT: origin, CRAFT_HUB_CLOUD_ORIGIN: origin },
    stdio: ['pipe', 'pipe', 'ignore'],
    shell: false,
  })
  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout, { end: false })
  try {
    const handshake = await new Promise<{ url: string, nativeApiToken: string }>((resolve, reject) => {
      let text = ''
      function receive(chunk: Buffer): void {
        text += chunk.toString('utf8')
        const newline = text.indexOf('\n')
        if (newline < 0)
          return
        child.stdout.off('data', receive)
        try {
          resolve(JSON.parse(text.slice(0, newline)))
        }
        catch { reject(new Error('Invalid fixture handshake')) }
      }
      child.once('error', reject)
      child.stdout.on('data', receive)
    })
    const nativeOrigin = new URL(handshake.url).origin
    const headers = { 'origin': nativeOrigin, 'authorization': `Bearer ${handshake.nativeApiToken}`, 'content-type': 'application/json' }
    async function cloud(action?: string): Promise<{ status: { state: string, busy?: boolean } }> {
      const response = await fetch(`${nativeOrigin}/api/native-host/cloud`, { headers, method: action ? 'POST' : 'GET', body: action ? JSON.stringify({ action }) : undefined, signal: AbortSignal.timeout(10000) })
      assert.equal(response.status, 200)
      return await response.json() as { status: { state: string, busy?: boolean } }
    }
    const deadline = Date.now() + 10000
    let connected = false
    while (Date.now() < deadline) {
      const value = await cloud()
      if (value.status.state === 'connected' && !value.status.busy) {
        connected = true
        break
      }
      await delay(10)
    }
    assert(connected)
    assert.equal((await cloud('synchronize')).status.state, 'connected')
    assert.equal((await cloud('disconnect')).status.state, 'disconnected')
    assert(synchronized && revoked && !invalid)
    const exit = once(child, 'exit', { signal: AbortSignal.timeout(10000) })
    process.stdin.unpipe(child.stdin)
    process.stdin.pause()
    child.stdin.end()
    assert.equal((await exit)[0], 0)
  }
  catch { process.exitCode = 1 }
  finally {
    process.stdin.unpipe(child.stdin)
    process.stdin.pause()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

void main().catch(() => process.exit(1))
