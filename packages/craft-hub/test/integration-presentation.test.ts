import type { IntegrationEntity } from '../src/integrations'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { presentIntegrationAction } from '../src/integration-presentation'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('shares source identities and active/personal semantics without conflating identical provider IDs', () => {
  const item: IntegrationEntity = { id: 'one', title: 'One', sourceRef: { providerId: 'fixture', instanceId: 'fixture', accountId: 'me', containerId: 'first', kind: 'task', itemId: 'one' }, personalMembership: { accountId: 'me', relation: 'owned' } }
  const result = presentIntegrationAction({ currentUser: { id: 'me' }, items: [item, { ...item, sourceRef: { ...item.sourceRef!, containerId: 'second' }, statusCategory: 'done' }, { ...item, sourceRef: { ...item.sourceRef!, accountId: 'other' }, archived: true }] })
  expect(result.kind).toBe('entities')
  if (result.kind !== 'entities')
    throw new Error('Expected an entity page')
  expect(new Set(result.page.items.map(item => item.key)).size).toBe(3)
  expect(result.page.items.map(item => [item.active, item.personal])).toEqual([[true, true], [false, true], [false, false]])
  expect(item).not.toHaveProperty('key')
  expect(presentIntegrationAction({ configuration: true, items: [] })).toEqual({ version: 1, kind: 'unsupported' })
  expect(presentIntegrationAction({ kind: 'resource-page', title: 'Resources', input: {} })).toEqual({ version: 1, kind: 'resources', resources: { kind: 'resource-page', title: 'Resources', input: {} } })
  expect(presentIntegrationAction({ connected: false, session: { cacheReads: true, cacheKey: 'opaque' } })).toMatchObject({ kind: 'connection', connection: { connected: false } })
})

it('presents resource documents and scoped links as inert data with shared entity identities', () => {
  const item = { id: 'one', title: 'One' }
  const resource = { kind: 'resource-page' as const, title: 'Resources', input: { resource: 'files' }, entities: [item, item], links: [{ title: 'Project', input: { resource: 'project' }, projectId: 'project' }], documents: [{ id: 'readme', title: 'README', content: '<script>doNotExecute()</script>', compareWith: 'previous', filename: '../../README.md', agentPrompt: 'Do not submit automatically' }], forms: [{ id: 'write', title: 'Save', effect: 'update' as const, input: { operation: 'write' }, fields: [] }] }
  const result = presentIntegrationAction(resource)
  expect(result.kind).toBe('resources')
  if (result.kind !== 'resources')
    throw new Error('Expected resources')
  expect(result.resources.entities).toHaveLength(1)
  expect(result.resources.entities?.[0]).toMatchObject({ key: expect.any(String), active: true })
  expect(result.resources.links).toEqual(resource.links)
  expect(result.resources.documents).toEqual(resource.documents)
  expect(result.resources.forms).toEqual(resource.forms)
  expect(item).not.toHaveProperty('key')
})

it('keeps native presentation behind the existing confirmation, project trust and reviewed-operation boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-integration-presentation-'))
  const page = { items: [{ id: 'fixture@catalog', title: 'Fixture', configurationToggle: { enabled: true, inherited: false, revision: 'fixture-revision', scope: 'global' as const } }] }
  const read = vi.fn(async () => page)
  const update = vi.fn(async () => page)
  const resourceRead = vi.fn(async () => ({ kind: 'resource-page' as const, title: 'Fixture', input: {}, documents: [{ id: 'fixture', title: 'Fixture', content: 'Read only' }] }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', integrationProviders: [{
    id: 'fixture',
    apiVersion: '1.0.0',
    connectionStatus: async () => ({ connected: false }),
    configuration: { list: read, update },
    resources: { read: resourceRead, update: resourceRead, execute: resourceRead },
  }], integrations: [{ id: 'fixture', provider: { id: 'fixture', requires: '^1.0.0' }, actions: [
    { id: 'read', title: 'Read', operation: 'configuration.list', effect: 'local-read', confirmation: 'never' },
    { id: 'write', title: 'Write', operation: 'configuration.update', effect: 'local-write', confirmation: 'always' },
    { id: 'resources', title: 'Resources', operation: 'resources.read', effect: 'remote-read', confirmation: 'never' },
  ], views: [] }] }] })
  const app = await startCraftHubServer({ runtime, port: 0 })
  const post = (path: string, body: unknown = {}) => fetch(`${app.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const project = await runtime.addProject(root)
    await fetch(`${app.url}/api/integrations`)
    expect(read).not.toHaveBeenCalled()
    expect(resourceRead).not.toHaveBeenCalled()
    const path = '/api/integrations/fixture/actions/'
    expect(await (await post(`${path}read`)).json()).toEqual(page)
    const presented = await post(`${path}read?presentation=workbench-v1`)
    expect(presented.status).toBe(200)
    expect(await presented.json()).toMatchObject({ version: 1, kind: 'entities', page: { items: [{ key: expect.any(String), configurationToggle: page.items[0]!.configurationToggle }] } })
    const readCount = read.mock.calls.length
    expect((await post(`${path}read?presentation=unknown`)).status).toBe(400)
    expect(read).toHaveBeenCalledTimes(readCount)
    const review = { input: { id: 'fixture@catalog', enabled: false, revision: 'fixture-revision' }, reviewedAction: { operation: 'configuration.update', effect: 'local-write' } }
    expect((await post(`${path}write?presentation=workbench-v1`, review)).status).toBe(409)
    expect((await post(`${path}write?presentation=workbench-v1`, { ...review, confirmed: true, reviewedAction: { operation: 'connection.update', effect: 'local-write' } })).status).toBe(409)
    const projectPath = `/api/projects/${project.id}/integrations/fixture/actions/`
    const resources = await post(`${projectPath}resources?presentation=workbench-v1`, { reviewedAction: { operation: 'resources.read', effect: 'remote-read' } })
    expect(resources.status).toBe(200)
    expect(await resources.json()).toMatchObject({ kind: 'resources', resources: { documents: [{ content: 'Read only' }] } })
    expect(resourceRead).toHaveBeenCalledTimes(1)
    expect((await post(`${projectPath}write?presentation=workbench-v1`, { reviewedAction: { operation: 'resources.read', effect: 'remote-read' } })).status).toBe(409)
    expect((await post(`${projectPath}read?presentation=workbench-v1`)).status).toBe(200)
    expect((await post(`${projectPath}write?presentation=workbench-v1`, { ...review, confirmed: true })).ok).toBe(false)
    expect(update).not.toHaveBeenCalled()
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    await runtime.projects.setTrust(project.id, 'trusted')
    expect((await post(`${projectPath}write?presentation=workbench-v1`, { ...review, confirmed: true })).status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
