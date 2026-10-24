import type { IncomingMessage } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('emits catalog invalidations only after persisted mutations and preserves discovery and trust gates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-catalog-events-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { hello: 'node -e "console.log(1)"' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const changed = vi.fn()
  const stop = runtime.projects.onChanged(changed)
  try {
    const project = await runtime.addProject(root)
    expect(project.trust).toBe('untrusted')
    expect(changed).toHaveBeenCalledTimes(1)
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
    await runtime.addProject(root)
    await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')
    expect(changed).toHaveBeenCalledTimes(1)
    await runtime.projects.setTrust(project.id, 'trusted')
    expect((await runtime.projects.get(project.id)).trust).toBe('trusted')
    expect(changed).toHaveBeenCalledTimes(2)
    await runtime.projects.reorder([project.id])
    expect(changed).toHaveBeenCalledTimes(3)
    await expect(runtime.projects.reorder(['unknown'])).rejects.toThrow('every registered project')
    expect(changed).toHaveBeenCalledTimes(3)
    await runtime.unregisterProject(project.id)
    expect(await runtime.projects.list()).toEqual([])
    expect(changed).toHaveBeenCalledTimes(4)
    stop()
    await runtime.addProject(root)
    expect(changed).toHaveBeenCalledTimes(4)
  }
  finally {
    stop()
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('delivers catalog changes to other HTTP clients and closes the stream on shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-catalog-stream-'))
  await writeFile(join(root, 'package.json'), '{}')
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const app = await startCraftHubServer({ port: 0, runtime })
  const connected = Promise.withResolvers<IncomingMessage>()
  const seen: string[] = []
  const request = get(`${app.url}/api/events`, response => connected.resolve(response))
  request.on('error', connected.reject)
  const response = await connected.promise
  response.setEncoding('utf8')
  response.on('data', chunk => seen.push(String(chunk)))
  try {
    const registered = await fetch(`${app.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: root }),
    })
    expect(registered.status).toBe(201)
    const project = await registered.json() as { id: string, trust: string }
    expect(project.trust).toBe('untrusted')
    await vi.waitFor(() => expect(seen.join('').match(/event: project-catalog-change/g)).toHaveLength(1))
    expect((await fetch(`${app.url}/api/projects/${project.id}`, { method: 'DELETE' })).status).toBe(200)
    await vi.waitFor(() => expect(seen.join('').match(/event: project-catalog-change/g)).toHaveLength(2))
    const ended = new Promise<void>(resolve => response.once('end', resolve))
    await app.close()
    await ended
  }
  finally {
    request.destroy()
    response.destroy()
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('invalidates capability views after pin writes while reads and rejected writes preserve trust and execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-pin-stream-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { inspect: 'node --version' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const project = await runtime.addProject(root)
  const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
  const app = await startCraftHubServer({ port: 0, runtime })
  const connected = Promise.withResolvers<IncomingMessage>()
  const seen: string[] = []
  const request = get(`${app.url}/api/events`, response => connected.resolve(response))
  request.on('error', connected.reject)
  const response = await connected.promise
  response.setEncoding('utf8')
  response.on('data', chunk => seen.push(String(chunk)))
  const endpoint = `${app.url}/api/projects/${project.id}/pins`
  const put = (capabilityIds: string[]) => fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capabilityIds }),
  })
  const changes = () => seen.join('').split('\n\n').filter(frame => frame.startsWith('event: project-change\n')).map(frame => JSON.parse(frame.split('\ndata: ')[1]!))
  try {
    await expect(fetch(endpoint).then(result => result.json())).resolves.toEqual({ projectId: project.id, capabilityIds: [] })
    expect((await put([command.id])).status).toBe(200)
    await vi.waitFor(() => expect(changes()).toEqual([{ projectId: project.id, scopes: ['capabilities'] }]))
    await expect(runtime.capabilityPins(project.id)).resolves.toEqual({ projectId: project.id, capabilityIds: [command.id] })
    expect((await put(['missing-capability'])).ok).toBe(false)
    expect((await put([command.id, command.id])).ok).toBe(false)
    await expect(runtime.capabilityPins(project.id)).resolves.toEqual({ projectId: project.id, capabilityIds: [command.id] })
    expect((await put([])).status).toBe(200)
    await vi.waitFor(() => expect(changes()).toHaveLength(2))
    expect(changes()).toEqual(Array.from({ length: 2 }, () => ({ projectId: project.id, scopes: ['capabilities'] })))
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
  }
  finally {
    request.destroy()
    response.destroy()
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
