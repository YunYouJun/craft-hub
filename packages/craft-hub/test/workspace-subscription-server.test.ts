import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('serves the complete source lifecycle and rejects cross-origin writes without running commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'subscription-http-'))
  const sourceUrl = 'https://git.example.com/group/repository/tree/main/craft-hub'
  const source = { schemaVersion: 1, id: 'environment', name: 'Environment', workspaces: [{ schemaVersion: 1, id: 'dev', name: 'Development', members: [{ project: 'https://git.example.com/group/project' }] }] }
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), publicWorkspaceRepositories: false, workspaceRepositoryProviders: [{ id: 'example', name: 'Example', accepts: url => url === sourceUrl, read: async () => ({ repository: 'https://git.example.com/group/repository', branch: 'main', directory: 'craft-hub', revision: 'one', files: { 'source.json': JSON.stringify(source) } }) }] })
  const server = await startCraftHubServer({ runtime, port: 0 })
  const request = (path: string, body?: unknown, method = 'POST') => fetch(`${server.url}/api/config-subscriptions${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  try {
    expect((await (await request('', undefined, 'GET')).json()).canConnect).toBe(false)
    expect((await fetch(`${server.url}/api/config-subscriptions`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ url: sourceUrl, name: 'Source' }) })).status).toBe(403)
    const savedResponse = await request('', { url: sourceUrl, name: 'Source' })
    expect(savedResponse.status).toBe(201)
    const saved = await savedResponse.json()
    expect(await runtime.workspaces.list()).toEqual([])
    const preview = await (await request(`/${saved.id}/preview`, {})).json()
    expect((await request(`/${saved.id}/apply`, { expectedRevision: preview.revision, selectedWorkspaceIds: ['missing'] })).status).toBe(400)
    expect((await request(`/${saved.id}/apply`, { expectedRevision: preview.revision, selectedWorkspaceIds: ['dev'] })).status).toBe(200)
    expect((await runtime.workspaces.list())[0]?.name).toBe('Development')
    expect((await request(`/${saved.id}/export`, undefined, 'GET')).status).toBe(200)
    expect((await request(`/${saved.id}/copy`, { workspaceId: 'dev' })).status).toBe(201)
    expect((await request(`/${saved.id}`, {}, 'DELETE')).status).toBe(200)
    expect(await runtime.workspaces.list()).toHaveLength(1)
    expect(await runtime.projects.list()).toEqual([])
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
