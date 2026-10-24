import type { IntegrationFormSelector } from '../src/integration-forms'
import type { ResourcePage } from '../src/resource-pages'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { IntegrationFormService } from '../src/integration-forms'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-form-review-'))
  let account = 'first'
  const page: ResourcePage = { kind: 'resource-page', title: 'Files', input: { resource: 'files' }, forms: [{ id: 'save', title: 'Save document', effect: 'update', input: { operation: 'save', id: 'file' }, fields: [{ id: 'content', label: 'Content', type: 'textarea', required: true }] }] }
  const read = vi.fn(async () => structuredClone(page))
  const write = vi.fn(async () => structuredClone(page))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', integrationProviders: [{
    id: 'fixture',
    apiVersion: '1.0.0',
    resources: { read, update: write, execute: write },
    connectionStatus: async () => ({ connected: true, session: { cacheKey: account } }),
  }], integrations: [{ id: 'fixture-plugin', provider: { id: 'fixture', requires: '^1.0.0' }, actions: [
    { id: 'read', title: 'Read', operation: 'resources.read', effect: 'remote-read', confirmation: 'never' },
    { id: 'save', title: 'Save', operation: 'resources.update', effect: 'local-write', confirmation: 'always' },
    { id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read', confirmation: 'never' },
  ], views: [{ id: 'files', title: 'Files', icon: 'folder', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [
    { id: 'browser', type: 'resource-browser', actionId: 'read' },
    { id: 'form', type: 'action-form', actionId: 'save', input: { operation: 'save' }, fields: [{ id: 'count', label: 'Count', type: 'number', required: true }] },
    { id: 'query', type: 'action-form', actionId: 'read', fields: [{ id: 'query', label: 'Query', type: 'text' }] },
  ] }] }] }] })
  const app = await startCraftHubServer({ runtime, port: 0 })
  const project = await runtime.addProject(root)
  const post = (operation: string, body: unknown, projectId?: string) => fetch(`${app.url}/api${projectId ? `/projects/${projectId}` : ''}/integrations/fixture-plugin/forms/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const prepare = async (selector: IntegrationFormSelector, values: Record<string, string>, projectId?: string) => {
    const response = await post('prepare', { selector, values }, projectId)
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(200)
    return result
  }
  return {
    runtime,
    app,
    project,
    read,
    write,
    page,
    post,
    prepare,
    setAccount: (value: string) => { account = value },
    close: async () => {
      await app.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
const form = { viewId: 'files', blockId: 'form' }
const resource = { viewId: 'files', blockId: 'browser', resource: { input: { resource: 'files' }, formId: 'save' } }

it('keeps discovery and preparation read-only, freezes typed input and consumes confirmed reviews once', async () => {
  const f = await fixture()
  try {
    await fetch(`${f.app.url}/api/integrations`)
    expect(f.read).not.toHaveBeenCalled()
    const plan = await f.prepare(form, { count: '2e2' })
    expect(plan).toMatchObject({ version: 1, requiresConfirmation: true, fields: [{ label: 'operation', value: 'save' }, { label: 'Count', value: '200' }] })
    expect(f.write).not.toHaveBeenCalled()
    expect((await f.post('execute', { planId: plan.planId })).status).toBe(409)
    expect((await f.post('execute', { planId: plan.planId, confirmed: true, input: { count: 300 } })).status).toBe(400)
    const attempts = await Promise.all([f.post('execute', { planId: plan.planId, confirmed: true }), f.post('execute', { planId: plan.planId, confirmed: true })])
    expect(attempts.map(result => result.status).sort()).toEqual([200, 409])
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ confirmed: true }), { operation: 'save', count: 200 })
    const cancelled = await f.prepare(form, { count: '1' })
    expect((await f.post('discard', { planId: cancelled.planId })).status).toBe(200)
    expect((await f.post('execute', { planId: cancelled.planId, confirmed: true })).status).toBe(409)
    const query = await f.prepare({ viewId: 'files', blockId: 'query' }, { query: 'read' })
    expect(query.requiresConfirmation).toBe(false)
    expect(f.read).not.toHaveBeenCalled()
    expect((await f.post('execute', { planId: query.planId })).status).toBe(200)
    expect(f.read).toHaveBeenCalledTimes(1)
  }
  finally { await f.close() }
})

it('rechecks resource definitions and accounts, isolates project scopes and preserves explicit trust', async () => {
  const f = await fixture()
  try {
    const plan = await f.prepare(resource, { content: '\n  document\n' }, f.project.id)
    expect(plan.project).toMatchObject({ id: f.project.id, trust: 'untrusted' })
    expect(f.write).not.toHaveBeenCalled()
    expect((await f.post('execute', { planId: plan.planId, confirmed: true })).status).toBe(409)
    expect((await f.post('execute', { planId: plan.planId, confirmed: true }, f.project.id)).ok).toBe(false)
    expect(f.write).not.toHaveBeenCalled()
    expect((await f.runtime.projects.get(f.project.id)).trust).toBe('untrusted')
    await f.runtime.projects.setTrust(f.project.id, 'trusted')
    const changed = await f.prepare(resource, { content: 'draft' }, f.project.id)
    f.page.forms![0]!.description = 'Changed operation meaning'
    expect((await f.post('execute', { planId: changed.planId, confirmed: true }, f.project.id)).status).toBe(409)
    const account = await f.prepare(resource, { content: 'draft' }, f.project.id)
    f.setAccount('second')
    expect((await f.post('execute', { planId: account.planId, confirmed: true }, f.project.id)).status).toBe(409)
    expect(f.write).not.toHaveBeenCalled()
    const fresh = await f.prepare(resource, { content: '\n  document\n' }, f.project.id)
    const saved = await f.post('execute', { planId: fresh.planId, confirmed: true }, f.project.id)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({ version: 1, kind: 'resources' })
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ projectId: f.project.id, projectPath: f.project.path }), { operation: 'save', id: 'file', content: '\n  document\n' })
    expect(await f.runtime.store.listRuns()).toEqual([])
    expect(await f.runtime.store.listAgentTasks()).toEqual([])
  }
  finally { await f.close() }
})

it('rejects stale selectors, unknown fields and oversized bodies and never replays an unknown write outcome', async () => {
  const f = await fixture()
  try {
    expect((await f.post('prepare', { selector: { ...form, blockId: 'missing' }, values: {} })).status).toBe(409)
    expect((await f.post('prepare', { selector: form, values: { count: '1', unknown: 'value' } })).status).toBe(400)
    expect((await f.post('prepare?override=true', { selector: form, values: { count: '1' } })).status).toBe(400)
    expect((await f.post('prepare', { selector: form, values: { count: '1'.repeat(1_048_576) } })).status).toBe(413)
    const plan = await f.prepare(form, { count: '1' })
    f.write.mockRejectedValueOnce(new Error('Outcome unknown'))
    expect((await f.post('execute', { planId: plan.planId, confirmed: true })).ok).toBe(false)
    expect((await f.post('execute', { planId: plan.planId, confirmed: true })).status).toBe(409)
    expect(f.write).toHaveBeenCalledTimes(1)
  }
  finally { await f.close() }
})

it('expires and clears in-memory reviews without invoking submitted input', async () => {
  const f = await fixture()
  let now = Date.now()
  const invoke = vi.fn((options: Parameters<CraftHubRuntime['invokeIntegrationAction']>[0]) => f.runtime.invokeIntegrationAction(options))
  const service = new IntegrationFormService({ catalog: () => f.runtime.integrationContributions(), project: id => f.runtime.projects.get(id), invoke }, () => now)
  try {
    const plan = await service.prepare('fixture-plugin', undefined, { selector: form, values: { count: '1' } })
    now += 600_001
    await expect(service.execute('fixture-plugin', undefined, { planId: plan.planId, confirmed: true })).rejects.toThrow()
    const cleared = await service.prepare('fixture-plugin', undefined, { selector: form, values: { count: '1' } })
    service.close()
    await expect(service.execute('fixture-plugin', undefined, { planId: cleared.planId, confirmed: true })).rejects.toThrow()
    expect(f.write).not.toHaveBeenCalled()
  }
  finally {
    service.close()
    await f.close()
  }
})
