import type { DeviceIdentityVault } from '@craft-hub/personal-cloud'
import type { IncomingMessage, ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { PersonalCloudController, requestSigningMessage, verifyDeviceRequest } from '@craft-hub/personal-cloud'
import { CraftHubRuntime } from 'craft-hub'

/** Invoked only by the native isolated-Keychain test. No browser, real cloud or installed profile is used. */
export async function verifyNativeCloudPipeline(vault: DeviceIdentityVault, profile: string): Promise<void> {
  const runtime = new CraftHubRuntime({ dataDir: join(profile, 'runtime'), configDir: join(profile, 'config') })
  await runtime.protectProfile()
  const projectPath = join(profile, 'project')
  await mkdir(projectPath, { recursive: true })
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"' } }))
  const project = await runtime.addProject(projectPath)
  const capability = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
  const workspace = await runtime.workspaces.create('Fixture')
  await runtime.workspaces.addProject(workspace.id, project.id)
  let login: URL | undefined
  let claimed = false
  let rejected = false
  let revoked = false
  let approvals = 0
  let requestFailure = false

  async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = ''
    for await (const chunk of request) {
      body += String(chunk)
      assert.ok(body.length <= 2 * 1024 * 1024)
    }
    const value = JSON.parse(body)
    assert.ok(login)
    const publicKey = login.searchParams.get('public_key')!
    let result: unknown = {}
    if (request.url === '/v1/devices/adopt') {
      assert.equal(value.code, 'fixture-code')
      assert.equal(value.challenge, login.searchParams.get('challenge'))
      const unsigned = JSON.stringify({ code: value.code, challenge: value.challenge, timestamp: value.timestamp, nonce: value.nonce })
      assert.ok(verifyDeviceRequest(value.signature, requestSigningMessage('POST', request.url, value.timestamp, value.nonce, unsigned), publicKey))
      result = { device: { deviceId: 'fixture-device' } }
    }
    else {
      assert.equal(request.headers['x-craft-device'], 'fixture-device')
      assert.ok(verifyDeviceRequest(String(request.headers['x-craft-signature']), requestSigningMessage('POST', request.url!, Number(request.headers['x-craft-timestamp']), String(request.headers['x-craft-nonce']), body), publicKey))
      if (request.url === '/v1/sync')
        result = { documents: [], conflicts: [], accepted: value.documents.map((document: { key: string, revision: string }) => ({ key: document.key, revision: document.revision })) }
      if (request.url === '/v1/device-requests/claim') {
        result = claimed ? [] : [{ requestId: 'fixture-request', claimId: 'fixture-claim', targetDeviceId: 'fixture-device', projectKey: 'project', capabilityId: capability.id, status: 'claimed', expiresAt: new Date(Date.now() + 60_000).toISOString() }]
        claimed = true
      }
      if (request.url === '/v1/device-requests/fixture-request/status') {
        assert.equal(value.status, 'rejected')
        rejected = true
      }
      if (request.url === '/v1/devices/revoke')
        revoked = true
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(result))
  }

  const server = createServer((request, response) => {
    void respond(request, response).catch(() => {
      requestFailure = true
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end('{"error":"Fixture request rejected"}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const loopback = `http://127.0.0.1:${address.port}`
  const controller = new PersonalCloudController({
    endpoint: 'https://api.example.com',
    webOrigin: 'https://cloud.example.com',
    callbackScheme: 'craft-hub-native',
    dataDir: runtime.store.dataDir,
    platform: 'darwin',
    runtime,
    vault,
    // Keep the configured scope identical to the parent vault; redirect only the test transport to its own server.
    fetch: (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.origin, 'https://api.example.com')
      return fetch(new URL(url.pathname, loopback), init)
    },
    openExternal: async (url) => { login = new URL(url) },
    approve: async () => {
      approvals++
      return false
    },
  })
  try {
    await controller.start()
    await controller.connect()
    const identity = await vault.load()
    assert.ok(identity)
    assert.ok(login)
    assert.equal(login.origin, 'https://cloud.example.com')
    const callback = new URL(login.searchParams.get('callback')!)
    callback.searchParams.set('code', 'fixture-code')
    callback.searchParams.set('challenge', login.searchParams.get('challenge')!)
    await controller.adopt(callback.toString())
    assert.equal(controller.status().state, 'connected')
    await controller.synchronize()
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (rejected)
        break
      await delay(5)
    }
    assert.ok(rejected)
    assert.equal(approvals, 0)
    assert.equal((await runtime.runs()).length, 0)
    assert.equal((await runtime.projects.get(project.id)).trust, 'untrusted')
    await controller.disconnect()
    assert.ok(revoked)
    assert.equal(controller.status().state, 'disconnected')
    assert.equal(await vault.load(), undefined)
    assert.equal(requestFailure, false)
    async function inspect(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          await inspect(path)
        }
        else if (entry.isFile()) {
          const text = await readFile(path, 'utf8')
          assert.ok(!text.includes(identity!.privateKey) && !text.includes('BEGIN PRIVATE KEY'))
          assert.notEqual(entry.name, 'personal-cloud-device.json')
        }
      }
    }
    await inspect(profile)
  }
  finally {
    await controller.close()
    await runtime.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}
