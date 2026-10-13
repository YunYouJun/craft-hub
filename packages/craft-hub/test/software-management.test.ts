import type { SoftwareCatalogProvider, SoftwareManagementProvider } from '../src/software-catalog'
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { SoftwareCatalogService, softwareInstallationPlanSchema, softwareInstallationRunSchema, SoftwareOperationError } from '../src/software-catalog'

const source = { id: 'fixture', title: 'Fixture', url: 'https://example.com/catalog' }
const title = { en: 'Editor' }
const installation = { kind: 'brew-cask' as const, packageId: 'fixture-editor' }
const createdAt = '2026-10-10T00:00:00.000Z'
const plan = { version: 1 as const, id: 'plan-1', sourceId: source.id, createdAt, prerequisites: [], items: [{ softwareId: 'editor', title, installation, action: 'install' as const }] }
const run = { version: 1 as const, id: 'run-1', sourceId: source.id, planId: plan.id, createdAt, updatedAt: createdAt, state: 'queued' as const, items: [{ softwareId: 'editor', title, state: 'queued' as const, log: '' }] }

function provider(): SoftwareCatalogProvider & { management: SoftwareManagementProvider } {
  return {
    ...source,
    read: vi.fn(async () => ({ version: 1 as const, source, items: [] })),
    management: {
      preview: vi.fn(async () => plan),
      install: vi.fn(async () => run),
      runs: vi.fn(async () => ({ version: 1 as const, runs: [run] })),
      cancel: vi.fn(async () => ({ ...run, state: 'cancelling' as const })),
      open: vi.fn(async () => ({ version: 1 as const, softwareId: 'editor', destination: 'application' as const })),
    },
  }
}

describe('local software management', () => {
  it('bounds plans and progress without accepting browser executable recipes', () => {
    expect(softwareInstallationPlanSchema.parse(plan)).toEqual(plan)
    expect(softwareInstallationRunSchema.parse(run)).toEqual(run)
    expect(softwareInstallationPlanSchema.safeParse({ ...plan, items: [...plan.items, ...plan.items] }).success).toBe(false)
    expect(softwareInstallationPlanSchema.safeParse({ ...plan, command: 'arbitrary' }).success).toBe(false)
    expect(softwareInstallationRunSchema.safeParse({ ...run, items: [{ ...run.items[0], log: 'x'.repeat(16385) }] }).success).toBe(false)
  })

  it('validates optional per-file download progress while accepting older adapters', async () => {
    const observation = { ...run, state: 'running' as const, items: [{ ...run.items[0], state: 'running' as const, progress: { phase: 'downloading' as const, percent: 42, resource: 'Cask editor' } }] }
    const adapter = provider()
    vi.mocked(adapter.management.runs).mockResolvedValue({ version: 1, runs: [observation] })
    expect(await new SoftwareCatalogService([adapter]).runs(source.id)).toEqual({ version: 1, runs: [observation] })
    expect(softwareInstallationRunSchema.parse(run)).toEqual(run)
    for (const progress of [
      { phase: 'downloading', percent: -1 },
      { phase: 'downloading', percent: 101 },
      { phase: 'downloading', percent: Number.NaN },
      { phase: 'downloading', percent: Infinity },
      { phase: 'downloading', resource: 'x'.repeat(257) },
      { phase: 'installing', percent: 100 },
      { phase: 'preparing', command: 'arbitrary' },
      { phase: 'unknown' },
    ]) {
      expect(softwareInstallationRunSchema.safeParse({ ...observation, items: [{ ...observation.items[0], progress }] }).success).toBe(false)
    }
    expect(softwareInstallationRunSchema.safeParse({ ...observation, items: [{ ...observation.items[0], progress: { phase: 'downloading' } }] }).success).toBe(true)
  })

  it('requires review confirmation and validates identifiers before invoking adapters', async () => {
    const adapter = provider()
    const service = new SoftwareCatalogService([adapter])
    await expect(service.install(source.id, plan.id, false)).rejects.toThrow('confirm')
    await expect(service.preview(source.id, ['editor', 'editor'])).rejects.toThrow('unique')
    await expect(service.preview(source.id, [])).rejects.toThrow()
    await expect(service.preview('unknown-source', ['editor'])).rejects.toMatchObject({ status: 404 })
    expect(adapter.management.install).not.toHaveBeenCalled()
    expect(adapter.management.preview).not.toHaveBeenCalled()
    expect(await service.preview(source.id, ['editor'])).toEqual(plan)
    expect(await service.install(source.id, plan.id, true)).toEqual(run)
    expect(await service.runs(source.id)).toEqual({ version: 1, runs: [run] })
    expect(await service.cancel(source.id, run.id)).toMatchObject({ id: run.id, state: 'cancelling' })
    expect(await service.open(source.id, 'editor')).toMatchObject({ softwareId: 'editor', destination: 'application' })
    expect(adapter.management.install).toHaveBeenCalledExactlyOnceWith(plan.id, true)
    expect(await service.snapshot()).toEqual({ version: 1, sources: [{ ...source, items: [], canManage: true }] })
  })

  it('rejects mismatched results and hides external diagnostics while preserving controlled conflicts', async () => {
    const adapter = provider()
    const service = new SoftwareCatalogService([adapter])
    vi.mocked(adapter.management.preview).mockResolvedValueOnce({ ...plan, sourceId: 'other' }).mockResolvedValueOnce({ ...plan, items: [{ ...plan.items[0], softwareId: 'other' }] })
    await expect(service.preview(source.id, ['editor'])).rejects.toMatchObject({ status: 503 })
    await expect(service.preview(source.id, ['editor'])).rejects.toMatchObject({ status: 503 })
    vi.mocked(adapter.management.install).mockResolvedValueOnce({ ...run, planId: 'different' }).mockRejectedValueOnce(new Error('secret diagnostic'))
    await expect(service.install(source.id, plan.id, true)).rejects.toMatchObject({ status: 503 })
    await expect(service.install(source.id, plan.id, true)).rejects.toThrow('Refresh its history')
    vi.mocked(adapter.management.runs).mockResolvedValueOnce({ version: 1, runs: [{ ...run, sourceId: 'other' }] })
    await expect(service.runs(source.id)).rejects.toMatchObject({ status: 503 })
    vi.mocked(adapter.management.cancel).mockResolvedValueOnce({ ...run, id: 'different' })
    await expect(service.cancel(source.id, run.id)).rejects.toMatchObject({ status: 503 })
    vi.mocked(adapter.management.open).mockResolvedValueOnce({ version: 1, softwareId: 'other', destination: 'application' })
    await expect(service.open(source.id, 'editor')).rejects.toMatchObject({ status: 503 })
    vi.mocked(adapter.management.preview).mockRejectedValueOnce(new SoftwareOperationError(409, 'Review a new plan'))
    await expect(service.preview(source.id, ['editor'])).rejects.toMatchObject({ status: 409, message: 'Review a new plan' })
  })

  it('keeps software operations local, confirmed and independent of project execution trust', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-software-management-'))
    const adapter = provider()
    const plugin = { id: 'software-fixture', softwareCatalogProviders: [adapter] }
    const local = new CraftHubRuntime({ dataDir: join(root, 'local'), configDir: join(root, 'config-local'), plugins: [plugin] })
    const hosted = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted'), configDir: join(root, 'config-hosted'), plugins: [plugin] })
    const apps = await Promise.all([local, hosted].map(runtime => startCraftHubServer({ runtime, port: 0 })))
    const post = (path: string, body: unknown, extraHeaders: Record<string, string> = {}, host = 0) => fetch(`${apps[host].url}/api/software/${source.id}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) })
    try {
      const project = await local.addProject(root)
      expect((await post('plan', { softwareIds: ['editor'] })).status).toBe(200)
      expect((await post('install', { planId: plan.id, confirmed: false })).status).toBe(400)
      expect(adapter.management.install).not.toHaveBeenCalled()
      expect((await post('install', { planId: plan.id, confirmed: true })).status).toBe(200)
      expect((await fetch(`${apps[0].url}/api/software/${source.id}/runs`)).status).toBe(200)
      expect((await post(`runs/${run.id}/cancel`, {})).status).toBe(200)
      expect((await post('open', { softwareId: 'editor' })).status).toBe(200)
      expect((await local.projects.get(project.id)).trust).toBe('untrusted')
      for (const [path, body] of [
        ['plan?operation=install', { softwareIds: ['editor'] }],
        ['plan', { softwareIds: ['editor'], command: 'arbitrary' }],
        ['install', { planId: plan.id, confirmed: true, packageId: 'different-package' }],
        ['open', { softwareId: 'editor', path: '/Applications/other.app' }],
        [`runs/${run.id}/cancel`, { command: 'arbitrary' }],
      ] as const) expect((await post(path, body)).status).toBe(400)
      const rejectedHeaders: Record<string, string>[] = [
        { origin: 'https://unrelated.example.com' },
        { 'sec-fetch-site': 'cross-site' },
        { 'content-type': 'text/plain' },
      ]
      for (const headers of rejectedHeaders)
        expect((await post('install', { planId: plan.id, confirmed: true }, headers)).status, JSON.stringify(headers)).toBe(403)
      const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(`${apps[0].url}/api/software/${source.id}/install`, { method: 'POST', headers: { 'host': 'unrelated.example.com', 'content-type': 'application/json' } }, (response) => {
          response.resume()
          response.once('end', () => resolve(response.statusCode))
        })
        request.once('error', reject)
        request.end(JSON.stringify({ planId: plan.id, confirmed: true }))
      })
      expect(reboundStatus).toBe(403)
      for (const [path, body] of [
        ['plan', { softwareIds: ['editor'] }],
        ['install', { planId: plan.id, confirmed: true }],
        ['open', { softwareId: 'editor' }],
        [`runs/${run.id}/cancel`, {}],
      ] as const) expect((await post(path, body, {}, 1)).status).toBe(403)
      expect((await fetch(`${apps[1].url}/api/software/${source.id}/runs`)).status).toBe(403)
      for (const operation of [
        () => hosted.softwareInstallationPlan(source.id, ['editor']),
        () => hosted.installSoftware(source.id, plan.id, true),
        () => hosted.softwareInstallationRuns(source.id),
        () => hosted.cancelSoftwareInstallation(source.id, run.id),
        () => hosted.openSoftwareApplication(source.id, 'editor'),
      ]) await expect(operation()).rejects.toMatchObject({ status: 403 })
      expect(adapter.management.install).toHaveBeenCalledOnce()
      expect(adapter.management.preview).toHaveBeenCalledOnce()
      expect(adapter.management.cancel).toHaveBeenCalledOnce()
      expect(adapter.management.open).toHaveBeenCalledOnce()
    }
    finally {
      await Promise.all(apps.map(app => app.close()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
