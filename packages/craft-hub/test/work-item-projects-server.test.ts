import type { WorkItemProjectSnapshot } from '../src/work-item-projects'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const ref = { providerId: 'tasks', instanceId: 'personal-tasks', accountId: 'me', containerId: 'inbox', kind: 'task', itemId: '7' }
const headers = { 'content-type': 'application/json' }

it('serves revisioned local bindings, reports conflicts, and leaves project trust and discovery untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-server-'))
  const dataDir = join(root, 'data')
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  const runtime = new CraftHubRuntime({ dataDir, configDir: join(root, 'config') })
  const project = await runtime.projects.add(projectPath)
  const projectsBefore = await readFile(join(dataDir, 'projects.json'), 'utf8')
  const server = await startCraftHubServer({ runtime, port: 0 })
  const endpoint = `${server.url}/api/work-item-projects`
  try {
    const initial = await (await fetch(endpoint)).json() as WorkItemProjectSnapshot
    const request = { revision: initial.revision, target: { type: 'item', ref }, projectId: project.id }
    const updated = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(request) })
    expect(updated.status).toBe(200)
    const snapshot = await updated.json() as WorkItemProjectSnapshot
    expect(snapshot.associations[0]?.resolution).toMatchObject({ status: 'available', project: { id: project.id, trust: 'untrusted' } })
    const stale = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(request) })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ actualRevision: snapshot.revision })
    const unknown = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ ...request, revision: snapshot.revision, projectId: 'unknown' }) })
    expect(unknown.status).toBe(404)
    const removed = await fetch(endpoint, { method: 'DELETE', headers, body: JSON.stringify({ revision: snapshot.revision, target: request.target }) })
    expect(removed.status).toBe(200)
    expect((await removed.json() as WorkItemProjectSnapshot).associations).toEqual([])
    expect(await readFile(join(dataDir, 'projects.json'), 'utf8')).toBe(projectsBefore)
    expect(await runtime.projects.get(project.id)).toMatchObject({ trust: 'untrusted' })
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects cross-site and non-JSON mutations and mismatched origins for reads and writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-origin-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const server = await startCraftHubServer({ runtime, port: 0 })
  const endpoint = `${server.url}/api/work-item-projects`
  try {
    const revision = (await runtime.workItemProjects.snapshot()).revision
    const body = JSON.stringify({ revision, target: { type: 'item', ref }, projectId: null })
    for (const rejected of [
      { 'content-type': 'text/plain' },
      { ...headers, 'sec-fetch-site': 'cross-site' },
      { ...headers, origin: 'https://evil.example' },
    ]) {
      expect((await fetch(endpoint, { method: 'PATCH', headers: rejected, body })).status).toBe(403)
    }
    expect((await fetch(endpoint, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await fetch(endpoint, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await fetch(endpoint, { method: 'PATCH', headers: { ...headers, origin: server.url }, body })).status).toBe(200)
    expect((await fetch(`${endpoint}?projectPath=/tmp`)).status).toBe(400)
    expect((await fetch(endpoint, { method: 'PATCH', headers, body: '{}' })).status).toBe(400)
    expect((await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ revision, target: { type: 'item', ref }, projectId: null, projectPath: '/tmp' }) })).status).toBe(400)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('applies host authorization before association reads and writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-host-access-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const server = await startCraftHubServer({ runtime, port: 0, authorizeRequest: request => request.headers.authorization === 'Bearer authorized' })
  try {
    const endpoint = `${server.url}/api/work-item-projects`
    expect((await fetch(endpoint)).status).toBe(403)
    expect((await fetch(endpoint, { method: 'PATCH', headers, body: '{}' })).status).toBe(403)
    expect((await fetch(endpoint, { headers: { authorization: 'Bearer authorized' } })).status).toBe(200)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects a Host header that addresses another origin even for read-only association access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-rebinding-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    const url = new URL('/api/work-item-projects', server.url)
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const call = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { host: 'evil.example' } }, (response) => {
        response.resume()
        response.on('end', () => resolve(response.statusCode))
      })
      call.on('error', reject)
      call.end()
    })
    expect(status).toBe(403)
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('rejects hosted binding mutations without creating a machine-local association file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-item-projects-hosted-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), hostEnvironment: 'hosted' })
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    const endpoint = `${server.url}/api/work-item-projects`
    for (const method of ['PATCH', 'PUT', 'DELETE'])
      expect((await fetch(endpoint, { method, headers, body: '{}' })).status).toBe(403)
    expect((await fetch(endpoint, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await runtime.workItemProjects.snapshot()).associations).toEqual([])
    await expect(readFile(join(root, 'data', 'work-item-projects.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
