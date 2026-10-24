import type { HostExtensionStatus } from 'craft-hub'
import type { NativeExtensionReview } from '../../desktop/src/native-extensions'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Exercise trusted external registration through the exact packaged native routes and real process restarts.
assert.equal(process.platform, 'darwin')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const sidecar = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
await access(sidecar)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-host-extension-acceptance-')))
const home = join(root, 'home')
const profile = join(root, 'profile')
const project = join(root, 'project')
const declaration = join(root, 'distribution.json')
const modulePath = join(root, 'host.mjs')
const marker = join(root, 'loaded')
const prefix = '/api/native-host/external-extensions/'
let child: ReturnType<typeof spawn> | undefined
let origin = ''
let headers: Record<string, string> = {}
let bootstrapURL = ''

async function start(): Promise<void> {
  child = spawn(process.execPath, [sidecar], {
    cwd: home,
    env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CRAFT_HUB_SIDECAR_DIR: profile },
    shell: false,
    detached: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const running = child
  const handshake = await new Promise<{ version: number, url: string, nativeApiToken: string }>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(fail, 20000)
    function clear() {
      clearTimeout(timer)
      running.off('error', fail)
      running.off('exit', fail)
      running.stdout!.off('data', receive)
    }
    function fail() {
      clear()
      reject(new Error('Packaged host extension fixture did not start'))
    }
    function receive(chunk: string) {
      output += chunk
      if (output.length > 16384)
        return fail()
      const newline = output.indexOf('\n')
      if (newline < 0)
        return
      clear()
      try {
        resolve(JSON.parse(output.slice(0, newline)))
      }
      catch { reject(new Error('Invalid fixture handshake')) }
    }
    running.once('error', fail)
    running.once('exit', fail)
    running.stdout!.setEncoding('utf8')
    running.stdout!.on('data', receive)
  })
  assert.equal(handshake.version, 1)
  bootstrapURL = handshake.url
  origin = new URL(handshake.url).origin
  headers = { origin, 'authorization': `Bearer ${handshake.nativeApiToken}`, 'content-type': 'application/json' }
}
async function raw(path: string, body?: unknown): Promise<Response> {
  return fetch(new URL(path, origin), { headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) })
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await raw(path, body)
  assert(response.ok, `${path}: ${response.status}`)
  return await response.json() as T
}
async function stop(): Promise<void> {
  assert(child)
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) })
  child.stdin!.end()
  assert.equal((await exited)[0], 0)
  child = undefined
}

try {
  await Promise.all([home, project].map(path => mkdir(path)))
  await writeFile(declaration, JSON.stringify({ schemaVersion: 1, distribution: { id: 'native-external-fixture', name: 'Native External Fixture' }, desktop: { protocol: 'fixture', artifactName: 'Fixture' }, hostPlugins: ['./host.mjs'] }))
  await writeFile(modulePath, `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(marker)}, 'loaded\\n'); export default { id: 'native-external-fixture' }`)
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'native-extension-project', scripts: { inspect: 'node --version' } }))
  await start()
  const bootstrap = await fetch(bootstrapURL, { redirect: 'manual' })
  const cookie = bootstrap.headers.getSetCookie()[0]?.split(';')[0]
  assert(cookie)
  for (const action of ['preview', 'install', 'enable', 'remove', 'cancel']) {
    assert.equal((await fetch(new URL(prefix + action, origin), { headers: { cookie, origin, 'content-type': 'application/json' }, method: 'POST', body: '{}' })).status, 403)
  }
  const added = await request<{ id: string, trust: string }>('/api/projects', { path: project })
  assert.equal(added.trust, 'untrusted')
  const cancelled = await request<NativeExtensionReview>(`${prefix}preview`, { manifestPath: declaration })
  await request(`${prefix}cancel`, { id: cancelled.id })
  assert.equal((await raw(`${prefix}install`, { reviewed: cancelled })).status, 400)
  const review = await request<NativeExtensionReview>(`${prefix}preview`, { manifestPath: declaration })
  assert.deepEqual(review.extension.modules, [modulePath])
  assert.deepEqual((await request<HostExtensionStatus>('/api/native-host/extensions')).extensions, [])
  const installed = await request<HostExtensionStatus>(`${prefix}install`, { reviewed: review })
  assert.equal(installed.restartRequired, true)
  await assert.rejects(access(marker))
  await stop()

  await start()
  assert.equal(await readFile(marker, 'utf8'), 'loaded\n')
  const running = await request<HostExtensionStatus>('/api/native-host/extensions')
  assert.equal(running.restartRequired, false)
  assert.deepEqual(running.diagnostics, [])
  const disabled = await request<HostExtensionStatus>(`${prefix}enable`, { expected: running.extensions[0], enabled: false })
  assert.equal(disabled.restartRequired, true)
  assert.equal(disabled.extensions[0]?.enabled, false)
  assert.equal((await raw(`${prefix}remove`, { expected: running.extensions[0] })).status, 409)
  await stop()

  await start()
  assert.equal(await readFile(marker, 'utf8'), 'loaded\n')
  const enabled = await request<HostExtensionStatus>(`${prefix}enable`, { expected: disabled.extensions[0], enabled: true })
  const removed = await request<HostExtensionStatus>(`${prefix}remove`, { expected: enabled.extensions[0] })
  assert.deepEqual(removed.extensions, [])
  await stop()

  await start()
  assert.equal(await readFile(marker, 'utf8'), 'loaded\n')
  assert.deepEqual((await request<HostExtensionStatus>('/api/native-host/extensions')).extensions, [])
  assert.deepEqual(await request('/api/runs'), [])
  const projects = await request<{ projects: { id: string, trust: string }[] }>('/api/projects')
  assert.equal(projects.projects.find(item => item.id === added.id)?.trust, 'untrusted')
  await Promise.all([modulePath, declaration].map(path => access(path)))
  await stop()
  console.log(JSON.stringify({ externalExtensions: 'preview, cancel, reviewed install, restart load, disable, enable and remove passed', staleRegistration: 'rejected', browserCookies: 'rejected', sourceFiles: 'retained', trust: 'untrusted', runs: 0, restarts: 3 }))
}
finally {
  if (child?.exitCode === null && child.signalCode === null && child.pid) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) })
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch { /* Clean only the fixture's owned process group. */ }
    await exited.catch(() => {})
  }
  await rm(root, { recursive: true, force: true })
}
