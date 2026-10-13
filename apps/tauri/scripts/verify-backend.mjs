import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'craft-hub-tauri-backend-'))
const child = spawn(resolve(appDir, '.prepared/backend/node'), [resolve(appDir, '.prepared/backend/backend.mjs')], {
  env: { ...process.env, CRAFT_HUB_TAURI_TRIAL_DIR: directory },
  shell: false,
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', chunk => process.stderr.write(chunk))
try {
  const ready = await new Promise((resolve, reject) => {
    child.stdout.once('data', (chunk) => {
      try {
        resolve(JSON.parse(chunk.toString()))
      }
      catch (error) { reject(error) }
    })
    child.once('exit', code => reject(new Error(`Backend exited before ready: ${code}`)))
    setTimeout(() => reject(new Error('Backend startup timed out')), 20_000).unref()
  })
  const origin = new URL(ready.url).origin
  assert.equal((await fetch(`${origin}/api/projects`)).status, 403)
  const bootstrap = await fetch(ready.url, { redirect: 'manual' })
  assert.equal(bootstrap.status, 303)
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0]
  const headers = { cookie }
  assert.equal((await fetch(`${origin}/api/health`, { headers })).status, 200)
  assert.equal((await fetch(`${origin}/api/projects`, { headers: { cookie, origin: 'https://example.com' } })).status, 403)
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const call = request(origin, { headers: { cookie, host: 'example.com' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    call.once('error', reject)
    call.end()
  })
  assert.equal(wrongHostStatus, 403)
  for (const [requestHeaders, expected] of [[{}, 403], [{ cookie }, 400]]) {
    const malformedStatus = await new Promise((resolve, reject) => {
      const call = request(origin, { path: 'http://', headers: requestHeaders }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
      call.once('error', reject)
      call.end()
    })
    assert.equal(malformedStatus, expected)
  }
  assert.equal((await fetch(`${origin}/api/health`, { headers })).status, 200)
  assert.match(await (await fetch(`${origin}/overview`, { headers })).text(), /\/__craft_hub_host\/bridge.js/)
  assert.equal((await fetch(ready.url, { redirect: 'manual' })).status, 403)
  // Real clipboard roundtrip demonstrates one constrained native bridge operation.
  const copiedText = 'Craft Hub 中文交接 🐳 isolated backend verification'
  const clipboard = await fetch(`${origin}/__craft_hub_host/copy-text`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-craft-hub-host': '1', origin },
    body: JSON.stringify({ text: copiedText }),
  })
  assert.equal(clipboard.status, 200)
  assert.equal((await promisify(execFile)('/usr/bin/pbpaste', [], { encoding: 'utf8' })).stdout, copiedText)
  child.stdin.end()
  const exitCode = await new Promise(resolve => child.once('exit', resolve))
  assert.equal(exitCode, 0)
  process.stdout.write('Verified bundled Node startup, unauthorized/cross-origin/wrong-host rejection, malformed-target recovery, one-use bootstrap, injected bridge, native clipboard roundtrip and stdin-EOF shutdown.\n')
}
finally {
  child.kill()
}
