import type { IntegrationConnectionStatus } from '../src/integrations'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { connectionReviewRevision, matchesConnectionReview, presentConnection } from '../src/integration-connection-review'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

function status(account = 'first'): IntegrationConnectionStatus {
  return { connected: true, accountLabel: account, session: { cacheKey: account }, forms: [{ id: 'token', title: 'Token', submitLabel: 'Connect', fields: [{ id: 'token', label: 'Token', type: 'password', required: true, value: 'must-not-return' }] }] }
}

it('binds reviews to account, grant and form definitions without returning or hashing password defaults', () => {
  const original = status()
  const revision = connectionReviewRevision(original)
  expect(presentConnection(original).forms?.[0]?.fields[0]).not.toHaveProperty('value')
  expect(JSON.stringify(presentConnection(original))).not.toContain('must-not-return')
  const passwordChanged = structuredClone(original)
  passwordChanged.forms![0]!.fields[0]!.value = 'another-secret'
  expect(connectionReviewRevision(passwordChanged)).toBe(revision)
  expect(connectionReviewRevision({ ...original, message: 'Refreshed', session: { ...original.session, expiresAt: '2030-01-01T00:00:00Z' } })).toBe(revision)
  expect(connectionReviewRevision(status('second'))).not.toBe(revision)
  expect(connectionReviewRevision({ ...original, capabilities: { create: true } })).not.toBe(revision)
  const formChanged = structuredClone(original)
  formChanged.forms![0]!.description = 'Changed meaning'
  expect(connectionReviewRevision(formChanged)).not.toBe(revision)
  expect(matchesConnectionReview(original, revision, { method: 'token', token: 'provided', locale: 'en' })).toBe(true)
  for (const input of [{ method: 'disconnect', token: 'provided' }, { method: 'token', token: '' }, { method: 'token', token: 42 }, { method: 'token', token: 'provided', callbackUrl: 'https://example.com' }])
    expect(matchesConnectionReview(original, revision, input)).toBe(false)
})

it('rechecks native connection forms before invoking credentials and preserves discovery, confirmation and scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-connection-review-'))
  let current = status()
  const read = vi.fn(async () => current)
  const update = vi.fn(async () => ({ connected: true }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', integrationProviders: [{ id: 'fixture', apiVersion: '1.0.0', connectionStatus: read, connection: { update } }], integrations: [{ id: 'fixture', provider: { id: 'fixture', requires: '^1.0.0' }, actions: [
    { id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
    { id: 'connect', title: 'Connect', operation: 'connection.update', effect: 'local-write', confirmation: 'always' },
  ], views: [] }] }] })
  const app = await startCraftHubServer({ runtime, port: 0 })
  const post = (path: string, body: unknown) => fetch(`${app.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const project = await runtime.addProject(root)
    await fetch(`${app.url}/api/integrations`)
    expect(read).not.toHaveBeenCalled()
    const prefix = `/api/projects/${project.id}/integrations/fixture/actions/`
    expect(await (await post(`${prefix}status`, {})).json()).toEqual(current)
    const presented = await (await post(`${prefix}status?presentation=workbench-v1`, {})).json()
    expect(presented.connection.forms[0].fields[0]).not.toHaveProperty('value')
    const body = { input: { method: 'token', token: 'provided', locale: 'en' }, reviewedAction: { operation: 'connection.update', effect: 'local-write' }, reviewedConnection: presented.connection.reviewRevision }
    expect((await post(`${prefix}connect?presentation=workbench-v1`, body)).status).toBe(409)
    current = status('second')
    expect((await post(`${prefix}connect?presentation=workbench-v1`, { ...body, confirmed: true })).status).toBe(409)
    expect(update).not.toHaveBeenCalled()
    const refreshed = { ...body, reviewedConnection: connectionReviewRevision(current), confirmed: true }
    expect((await post(`${prefix}connect?presentation=workbench-v1`, { ...refreshed, input: { ...body.input, method: 'missing' } })).status).toBe(409)
    expect((await post(`${prefix}connect?presentation=workbench-v1`, refreshed)).status).toBe(200)
    expect(update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectId: project.id, projectPath: project.path, confirmed: true }), body.input)
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})
