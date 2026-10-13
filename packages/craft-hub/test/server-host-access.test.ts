import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('guards every route before host adapters, discovery and trust changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-access-'))
  const staticDir = join(root, 'web')
  const projectDir = join(root, 'project')
  await mkdir(staticDir)
  await mkdir(projectDir)
  await writeFile(join(staticDir, 'index.html'), '<main>Private workbench</main>')
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'node --version' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const project = await runtime.addProject(projectDir)
  const handleHostRequest = vi.fn((_request: IncomingMessage, response: ServerResponse) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('Host adapter')
    return true
  })
  const app = await startCraftHubServer({
    port: 0,
    runtime,
    staticDir,
    authorizeRequest: request => request.headers.authorization === 'Bearer test-host-session',
    handleHostRequest,
  })
  try {
    for (const [path, method] of [
      ['/', 'GET'],
      ['/api/health', 'GET'],
      ['/api/projects', 'GET'],
      ['/api/events', 'GET'],
      ['/api/agent-connection', 'GET'],
      [`/api/projects/${project.id}/trust`, 'POST'],
      ['/host/clipboard', 'POST'],
    ]) {
      const response = await fetch(`${app.url}${path}`, { method })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Host access denied' })
    }
    expect(handleHostRequest).not.toHaveBeenCalled()
    expect((await runtime.projects.get(project.id))?.trust).toBe('untrusted')
    const response = await fetch(`${app.url}/host/clipboard`, { method: 'POST', headers: { authorization: 'Bearer test-host-session' } })
    expect(await response.text()).toBe('Host adapter')
    expect(handleHostRequest).toHaveBeenCalledOnce()
  }
  finally {
    await app.close()
  }
})

it('keeps project trust required for authenticated runtime mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-trust-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const projectDir = join(root, 'project')
  await mkdir(projectDir)
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({ scripts: { build: 'node --version' } }))
  const project = await runtime.addProject(projectDir)
  const app = await startCraftHubServer({
    port: 0,
    runtime,
    authorizeRequest: request => request.headers.authorization === 'Bearer test-host-session',
    handleHostRequest: async () => false,
  })
  const headers = { 'authorization': 'Bearer test-host-session', 'content-type': 'application/json' }
  try {
    const catalog = await fetch(`${app.url}/api/projects`, { headers })
    expect(catalog.status).toBe(200)
    expect(JSON.stringify(await catalog.json())).toContain(project.id)
    const appearance = `${app.url}/api/projects/${project.id}`
    const update = () => fetch(appearance, { method: 'PATCH', headers, body: JSON.stringify({ icon: 'emoji:🔒' }) })
    expect((await update()).status).toBe(403)
    expect((await fetch(`${appearance}/trust`, { method: 'POST', headers })).status).toBe(200)
    expect((await update()).status).toBe(200)
    expect((await runtime.projects.get(project.id))?.trust).toBe('trusted')
  }
  finally {
    await app.close()
  }
})

it('contains malformed HTTP request targets before routing without terminating the host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-host-malformed-'))
  const app = await startCraftHubServer({
    port: 0,
    runtime: new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') }),
    authorizeRequest: request => request.headers.authorization === 'Bearer test-host-session',
  })
  const address = new URL(app.url)
  const malformedRequest = (authenticated: boolean) => new Promise<string>((resolve, reject) => {
    const socket = connect(Number(address.port), address.hostname, () => {
      socket.write(`GET http:// HTTP/1.1\r\nHost: ${address.host}\r\n${authenticated ? 'Authorization: Bearer test-host-session\r\n' : ''}Connection: close\r\n\r\n`)
    })
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => received += chunk)
    socket.once('error', reject)
    socket.once('end', () => resolve(received))
    socket.setTimeout(2000, () => socket.destroy(new Error('HTTP response timed out')))
  })
  try {
    expect(await malformedRequest(false)).toMatch(/^HTTP\/1\.1 403 /)
    expect(await malformedRequest(true)).toMatch(/^HTTP\/1\.1 400 /)
    const health = await fetch(`${app.url}/api/health`, { headers: { authorization: 'Bearer test-host-session' } })
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ status: 'ok' })
  }
  finally {
    await app.close()
  }
})
