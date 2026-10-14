import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

it('requires same-origin JSON, does not run during discovery, and leaves projects untrusted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'work-assistant-server-'))
  const generate = vi.fn().mockResolvedValue(JSON.stringify({ summary: 'Review', items: [{ key: 'one', reason: 'Due', nextStep: 'Review' }] }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), workAssistantProvider: { id: 'test', generate } })
  const project = await runtime.projects.add(root)
  const server = await startCraftHubServer({ runtime, port: 0 })
  try {
    expect((await (await fetch(`${server.url}/api/work-assistant`)).json()).available).toBe(true)
    expect(generate).not.toHaveBeenCalled()
    const body = JSON.stringify({ candidates: [{ key: 'one', title: 'Review', source: 'Tasks', reasons: ['Due'] }], localNow: '2026-10-13T10:00', locale: 'en', coverage: 'partial' })
    const endpoint = `${server.url}/api/work-assistant/focus`
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'https://example.com' }, body })).status).toBe(403)
    expect(generate).not.toHaveBeenCalled()
    expect((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': server.url }, body })).status).toBe(200)
    expect(generate).toHaveBeenCalledOnce()
    expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
    expect(await runtime.store.listRuns()).toEqual([])
    expect(await runtime.store.listAgentTasks()).toEqual([])
  }
  finally {
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})
