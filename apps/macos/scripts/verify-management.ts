import type { InstalledPlugin, WorkbenchDiagnosticSnapshot } from 'craft-hub'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { verifyPackagedCodexActivity } from './verify-codex-activity.ts'

interface PluginOverview { version: number, installed: InstalledPlugin[] }

// Exercise the exact packaged APIs consumed by Swift, using only disposable local plugin files and profiles.
assert.equal(process.platform, 'darwin', 'This verifier requires macOS')
const app = resolve(process.argv[2] ?? fileURLToPath(new URL('../build/Craft Hub Prototype.app', import.meta.url)))
const sidecar = join(app, 'Contents/Resources/app/apps/desktop/dist/sidecar.mjs')
await access(sidecar)
const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-management-')))
const home = join(root, 'home')
const plugin = join(root, 'plugin')
const project = join(root, 'project')
const packageName = '@example/craft-hub-plugin-native-fixture'
const encoded = encodeURIComponent(packageName)
const env = { HOME: home, CRAFT_HUB_SIDECAR_DIR: join(root, 'profile'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8' }
let child: ReturnType<typeof spawn> | undefined
async function pluginFile(version: string) {
  await writeFile(join(plugin, 'package.json'), JSON.stringify({
    name: packageName,
    version,
    craftHub: {
      schemaVersion: 1,
      id: packageName,
      displayName: 'Native management fixture',
      description: 'A disposable declarative plugin for native management verification.',
      permissions: ['commands'],
      contributes: { commands: [{ id: 'inspect', name: 'Inspect fixture', command: 'node', args: ['--version'], requiredEnv: [] }] },
    },
  }))
}
try {
  await Promise.all([home, plugin, project].map(path => mkdir(path)))
  await pluginFile('1.0.0')
  await writeFile(join(plugin, 'README.md'), '# Native fixture\nLocal read-only documentation.\n')
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'native-management-project', scripts: { inspect: 'node --version' } }))
  child = spawn(process.execPath, [sidecar], { cwd: home, env, detached: true, stdio: ['pipe', 'pipe', 'ignore'], shell: false })
  const running = child
  const handshake = await new Promise<{ version: number, url: string, nativeApiToken: string }>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => finish(new Error('Sidecar handshake timed out')), 20000)
    function finish(error?: Error) {
      clearTimeout(timer)
      running.removeListener('error', fail)
      running.removeListener('exit', fail)
      running.stdout!.removeListener('data', receive)
      if (error)
        reject(error)
    }
    function fail() {
      finish(new Error('Sidecar exited before its handshake'))
    }
    function receive(chunk: string) {
      output += chunk
      if (output.length > 16384) {
        finish(new Error('Oversized sidecar handshake'))
        return
      }
      const newline = output.indexOf('\n')
      if (newline < 0)
        return
      finish()
      try {
        resolve(JSON.parse(output.slice(0, newline)))
      }
      catch { reject(new Error('Invalid sidecar handshake')) }
    }
    running.once('error', fail)
    running.once('exit', fail)
    running.stdout!.setEncoding('utf8')
    running.stdout!.on('data', receive)
  })
  assert.equal(handshake.version, 1)
  const origin = new URL(handshake.url).origin
  const headers = { origin, 'authorization': `Bearer ${handshake.nativeApiToken}`, 'content-type': 'application/json' }
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, origin), { headers, method, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000) })
    assert(response.ok, `${method} ${path}: ${response.status}`)
    return await response.json() as T
  }
  assert.equal((await fetch(new URL('/api/native-host/extensions', origin))).status, 403)
  const bootstrap = await fetch(handshake.url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = bootstrap.headers.getSetCookie()[0]?.split(';')[0]
  assert(cookie, 'Bootstrap did not create a web session')
  assert.equal((await fetch(new URL('/api/native-host/extensions', origin), { headers: { cookie, origin } })).status, 403)
  const registered = await request<{ id: string, trust: string }>('/api/projects', 'POST', { path: project })
  assert.equal(registered.trust, 'untrusted')
  const discovery = await request<{ capabilities: { id: string }[] }>(`/api/projects/${registered.id}/capability-discovery`)
  const capability = discovery.capabilities[0]!
  const pinsPath = `/api/projects/${registered.id}/pins`
  const stream = await fetch(new URL('/api/events', origin), { headers, signal: AbortSignal.timeout(10000) })
  assert.equal(stream.status, 200)
  const reader = stream.body!.getReader()
  try {
    assert.deepEqual(await request(pinsPath), { projectId: registered.id, capabilityIds: [] })
    const pins = { projectId: registered.id, capabilityIds: [capability.id] }
    assert.deepEqual(await request(pinsPath, 'PUT', { capabilityIds: pins.capabilityIds }), pins)
    assert.deepEqual(await request(pinsPath), pins)
    let frames = ''
    const decoder = new TextDecoder()
    while (!frames.includes('event: project-change\n')) {
      const { done, value } = await reader.read()
      assert(!done, 'Event stream closed before the pin invalidation')
      frames += decoder.decode(value, { stream: true })
      assert(frames.length <= 64 * 1024, 'Oversized event stream')
    }
    while (!frames.slice(frames.indexOf('event: project-change\n')).includes('\n\n')) {
      const { done, value } = await reader.read()
      assert(!done, 'Incomplete pin invalidation')
      frames += decoder.decode(value, { stream: true })
      assert(frames.length <= 64 * 1024, 'Oversized event stream')
    }
    const frame = frames.split('\n\n').find(frame => frame.startsWith('event: project-change\n'))!
    assert.deepEqual(JSON.parse(frame.split('\ndata: ')[1]!), { projectId: registered.id, scopes: ['capabilities'] })
    await request(pinsPath, 'PUT', { capabilityIds: [] })
    assert.deepEqual(await request(pinsPath), { projectId: registered.id, capabilityIds: [] })
  }
  finally {
    await reader.cancel()
  }
  const before = await request<PluginOverview>('/api/marketplace/overview')
  assert.equal(before.version, 1)
  assert.deepEqual(before.installed, [])
  const linked = await request<InstalledPlugin>('/api/plugins/local', 'POST', { path: plugin })
  assert.equal(linked.package, packageName)
  assert.equal(linked.origin, 'local')
  const document = await request<{ document: { content: string } }>(`/api/plugins/document?${new URLSearchParams({ sourceId: 'local', package: packageName, version: '1.0.0' })}`)
  assert(document.document.content.includes('Local read-only documentation.'))
  assert.equal((await request<InstalledPlugin>(`/api/plugins/${encoded}/enabled`, 'PUT', { enabled: false })).enabled, false)
  assert.equal((await request<InstalledPlugin>(`/api/plugins/${encoded}/enabled`, 'PUT', { enabled: true })).enabled, true)
  await writeFile(join(plugin, 'package.json'), '{ invalid fixture')
  const broken = await request<PluginOverview>('/api/marketplace/overview')
  assert(broken.installed.find(item => item.package === packageName)?.error)
  const diagnostics = await request<WorkbenchDiagnosticSnapshot>('/api/diagnostics')
  const issue = diagnostics.diagnostics.find(item => item.kind === 'marketplace-plugin' && item.target?.package === packageName)
  assert(issue, 'Broken local plugin was missing from diagnostics')
  assert.equal(issue.target?.type, 'marketplace')
  assert.equal(issue.target?.sourceId, 'local')
  await pluginFile('1.0.1')
  assert.equal((await request<InstalledPlugin>(`/api/plugins/local/${encoded}/refresh`, 'POST', {})).version, '1.0.1')
  const repaired = await request<WorkbenchDiagnosticSnapshot>('/api/diagnostics')
  assert(!repaired.diagnostics.some(item => item.kind === 'marketplace-plugin' && item.target?.package === packageName))
  await request(`/api/plugins/local/${encoded}`, 'DELETE', { deleteData: false })
  assert.deepEqual((await request<PluginOverview>('/api/marketplace/overview')).installed, [])
  assert((await readFile(join(plugin, 'package.json'), 'utf8')).includes('1.0.1'))
  assert.deepEqual(await request('/api/runs'), [])
  const projects = await request<{ projects: { id: string, trust: string }[] }>('/api/projects')
  assert.equal(projects.projects.find(item => item.id === registered.id)?.trust, 'untrusted')
  await verifyPackagedCodexActivity(origin, cookie, headers, home)
  assert.deepEqual(await request('/api/runs'), [])
  const exited = once(running, 'exit', { signal: AbortSignal.timeout(10000) })
  running.stdin!.end()
  const [code] = await exited
  assert.equal(code, 0)
  await assert.rejects(access(join(root, 'profile/runtime/codex-hook-endpoint')), { code: 'ENOENT' })
  console.log(JSON.stringify({ plugin: 'link, README, enable, disable, repair and unlink passed', diagnostics: 'broken plugin target and repair verified', palettePins: 'read, pin, persisted read, capability invalidation and unpin passed', codexActivity: 'native review, cancel, dual-host hooks, real bridge events, SSE, disable and receiver cleanup passed', sourceFiles: 'preserved', nativeAuthorization: 'anonymous and browser cookies rejected', trust: 'untrusted', runs: 0, sidecarExit: code }))
}
finally {
  if (child?.exitCode === null && child.signalCode === null && child.pid) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) })
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch { /* Only this fixture's owned process group is eligible for cleanup. */ }
    await exited.catch(() => {})
  }
  await rm(root, { recursive: true, force: true })
}
