import type { ConfigurationManagementPage } from '../src/configuration-management'
import type { SoftwareCatalogSnapshot } from '../src/software-catalog'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'
import { setupProfileSchema, SetupProfileService } from '../src/setup-profile'

let root: string
const selection = { sourceId: 'fixture', softwareId: 'editor' }
const configuration = { integrationId: 'configuration', itemId: 'file:.zshrc' }
function catalog(status: 'detected' | 'not-detected' | 'unknown' = 'detected'): SoftwareCatalogSnapshot {
  return { version: 1, sources: [{ id: 'fixture', title: 'Fixture', canManage: true, items: [{ id: 'editor', title: { en: 'Editor' }, group: { id: 'tools', title: { en: 'Tools' } }, url: 'https://example.com/editor', installation: { kind: 'brew-cask', packageId: 'example-editor' }, status, canInstall: true }] }] }
}
function page(status = 'synced', content = 'export EDITOR=vi\n'): ConfigurationManagementPage {
  return { configuration: true, items: [{ id: configuration.itemId, title: 'Shell configuration', kind: 'terminal', owner: 'user', origin: 'public', localPath: '/machine-specific/home/.zshrc', sourcePath: '/machine-specific/source/zshrc', local: content, source: content, status, revision: 'machine-revision', fields: [], manager: 'workstation', scope: 'global' }] }
}
function service(directory = 'a', software = async () => catalog(), configurationPage = async () => page()) {
  return new SetupProfileService(join(root, directory), software, async () => [{ integrationId: configuration.integrationId, href: '/integrations/configuration/environment', page: await configurationPage() }])
}
async function saved() {
  const source = service()
  return source.save({ operation: 'save', revision: (await source.snapshot()).revision, name: 'Development Mac', software: [selection], configurations: [configuration] })
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'craft-hub-setup-profile-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('portable environment profiles', () => {
  it('saves explicit intent, survives restart, and imports on an independent target without copying machine state', async () => {
    const first = await saved()
    const document = JSON.parse(JSON.stringify(first.profile))
    expect(first.profile?.software).toHaveLength(1)
    expect(first.profile?.configurations).toHaveLength(1)
    const contents = await readFile(join(root, 'a/setup-profile.v1.json'), 'utf8')
    for (const forbidden of ['machine-specific', 'EDITOR=vi', 'machine-revision', 'localPath', 'sourcePath', 'trust', 'detected'])
      expect(contents).not.toContain(forbidden)
    if (process.platform !== 'win32')
      expect((await stat(join(root, 'a/setup-profile.v1.json'))).mode & 0o777).toBe(0o600)
    expect(await service().snapshot()).toEqual(first)

    let softwareStatus: 'detected' | 'not-detected' | 'unknown' = 'not-detected'
    let configurationStatus = 'first-adoption'
    const target = service('b', async () => catalog(softwareStatus), async () => page(configurationStatus))
    await target.import(document, (await target.snapshot()).revision)
    expect(await target.review()).toMatchObject({ software: [{ state: 'missing', canInstall: true }], configurations: [{ state: 'review' }] })
    // Existing provider workflows own installation and application; only fresh observations establish readiness.
    softwareStatus = 'detected'
    expect(await target.review()).toMatchObject({ software: [{ state: 'ready' }], configurations: [{ state: 'review' }] })
    configurationStatus = 'synced'
    expect(await target.review()).toMatchObject({ software: [{ state: 'ready' }], configurations: [{ state: 'ready' }] })
    softwareStatus = 'unknown'
    expect(await target.review()).toMatchObject({ software: [{ state: 'unknown', canInstall: false }] })
  })

  it('requires existing managed sources and synchronized configuration before capturing a profile', async () => {
    for (const state of ['local-modified', 'first-adoption', 'conflict', 'read-only', 'unmanaged', 'error']) {
      const source = service(state, async () => catalog(), async () => page(state))
      await expect(source.save({ operation: 'save', revision: (await source.snapshot()).revision, name: 'Mac', software: [], configurations: [configuration] })).rejects.toMatchObject({ status: 409 })
    }
    const source = service()
    await expect(source.save({ operation: 'save', revision: (await source.snapshot()).revision, name: 'Mac', software: [{ ...selection, softwareId: 'unknown' }], configurations: [] })).rejects.toMatchObject({ status: 409 })
    await expect(source.save({ operation: 'save', revision: (await source.snapshot()).revision, name: 'Mac', software: [selection, selection], configurations: [] })).rejects.toThrow('Duplicate')
  })

  it('never installs changed software or treats changed, missing or failed configuration sources as ready', async () => {
    const { profile } = await saved()
    const changed = catalog('not-detected')
    changed.sources[0].items[0].installation.packageId = 'different-package'
    const target = service('changed', async () => changed, async () => page('synced', 'different source'))
    await target.import(profile, (await target.snapshot()).revision)
    expect(await target.review()).toMatchObject({ software: [{ state: 'changed', canInstall: false }], configurations: [{ state: 'changed' }] })
    const missing = new SetupProfileService(join(root, 'missing'), async () => ({ version: 1, sources: [] }), async () => [{ integrationId: configuration.integrationId, href: '/integrations/configuration/environment' }])
    await missing.import(profile, (await missing.snapshot()).revision)
    expect(await missing.inventory()).toMatchObject({ unavailableIntegrations: ['configuration'] })
    expect(await missing.review()).toMatchObject({ software: [{ state: 'unavailable' }], configurations: [{ state: 'unavailable' }] })
  })

  it('rejects machine fields, commands, credentials, duplicate identifiers and unknown profile versions', async () => {
    const { profile } = await saved()
    for (const invalid of [
      { ...profile, version: 2 },
      { ...profile, trust: 'trusted' },
      { ...profile, software: [], configurations: [] },
      { ...profile, software: [{ ...profile!.software[0], command: 'sh', args: ['-c', 'arbitrary'] }] },
      { ...profile, software: [{ ...profile!.software[0], url: 'https://user:password@example.com/' }] },
      { ...profile, configurations: [{ ...profile!.configurations[0], localPath: '/another/home' }] },
      { ...profile, configurations: [{ ...profile!.configurations[0], itemId: '/absolute/path' }] },
      { ...profile, configurations: [profile!.configurations[0], profile!.configurations[0]] },
    ]) expect(setupProfileSchema.safeParse(invalid).success).toBe(false)
  })

  it('rejects stale writers across service instances and preserves corrupt persisted state', async () => {
    const first = await saved()
    const a = service()
    const b = service()
    const results = await Promise.allSettled([a.import({ ...first.profile, name: 'A' }, first.revision), b.import({ ...first.profile, name: 'B' }, first.revision)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    await expect(a.import(first.profile, first.revision)).rejects.toMatchObject({ status: 409 })
    await writeFile(join(root, 'a/setup-profile.v1.json'), '{invalid')
    await expect(a.snapshot()).rejects.toMatchObject({ status: 409 })
    await expect(a.import(first.profile, first.revision)).rejects.toMatchObject({ status: 409 })
    expect(await readFile(join(root, 'a/setup-profile.v1.json'), 'utf8')).toBe('{invalid')
  })

  it('can save after a writer exits without releasing its lock', async () => {
    const initial = await saved()
    execFileSync(process.execPath, ['--input-type=module', '-e', 'import { DatabaseSync } from "node:sqlite"; const database = new DatabaseSync(process.argv[1]); database.exec("BEGIN IMMEDIATE"); process.exit(0)', join(root, 'a/setup-profile.v1.json.lock.sqlite')])
    const next = await service().import({ ...initial.profile, name: 'After interrupted writer' }, initial.revision)
    expect(next.profile?.name).toBe('After interrupted writer')
  })

  it('rejects oversized UTF-8 documents before replacing a readable saved profile', async () => {
    const initial = await saved()
    const oversized = { ...initial.profile, configurations: [], software: Array.from({ length: 50 }, (_, index) => ({
      ...initial.profile!.software[0],
      softwareId: `item-${index}`,
      sourceId: '界'.repeat(256),
      title: { en: '界'.repeat(256), zh: '界'.repeat(256) },
      url: `https://example.com/${'a'.repeat(2000)}`,
      installation: { kind: 'brew-cask', packageId: '界'.repeat(256) },
    })) }
    expect(setupProfileSchema.safeParse(oversized).success).toBe(true)
    await expect(service().import(oversized, initial.revision)).rejects.toMatchObject({ status: 400 })
    expect(await service().snapshot()).toEqual(initial)
  })

  it('discovers global configuration through declared read actions while isolating failed sources', async () => {
    const read = vi.fn(async () => page())
    const update = vi.fn(async () => page())
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'integration'), configDir: join(root, 'integration-config'), plugins: [{
      id: 'configuration-fixture',
      integrationProviders: [{ id: 'configuration-provider', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }), configurationManagement: { read, update, execute: update } }],
      integrations: [{
        id: 'configuration',
        provider: { id: 'configuration-provider', requires: '^1.0.0' },
        actions: [{ id: 'inspect', title: 'Inspect', operation: 'configuration.read', effect: 'local-read', confirmation: 'never' }, { id: 'update', title: 'Update', operation: 'configuration.update', effect: 'local-write', confirmation: 'always' }],
        views: [{ id: 'environment', title: 'Configuration', icon: 'builtin:settings', placement: 'primary-sidebar', scope: 'global-and-project', blocks: [{ id: 'configuration', type: 'configuration-manager', actionId: 'inspect' }] }],
      }],
    }] })
    const app = await startCraftHubServer({ runtime, port: 0 })
    try {
      const project = await runtime.addProject(root)
      const inventory = await runtime.setupProfile.inventory()
      expect(inventory.configurations).toHaveLength(1)
      expect(JSON.stringify(inventory)).not.toContain('machine-specific')
      expect(JSON.stringify(inventory)).not.toContain('EDITOR=vi')
      expect(update).not.toHaveBeenCalled()
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      vi.mocked(read).mockRejectedValueOnce(new Error('Private provider diagnostic'))
      const failed = await runtime.setupProfile.inventory()
      expect(failed.configurations).toEqual([])
      expect(failed.unavailableIntegrations).toEqual(['configuration'])
    }
    finally { await app.close() }
  })

  it('enforces local same-origin JSON APIs and leaves provider execution and project trust untouched', async () => {
    const read = vi.fn(async () => ({ version: 1 as const, source: { id: 'fixture', title: 'Fixture' }, items: catalog().sources[0].items }))
    const local = new CraftHubRuntime({ dataDir: join(root, 'local'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', softwareCatalogProviders: [{ id: 'fixture', title: 'Fixture', url: 'https://example.com/catalog', read }] }] })
    const hosted = new CraftHubRuntime({ dataDir: join(root, 'hosted'), configDir: join(root, 'hosted-config'), hostEnvironment: 'hosted' })
    const servers = await Promise.all([local, hosted].map(runtime => startCraftHubServer({ runtime, port: 0 })))
    const post = (body: unknown, headers = {}, server = 0) => fetch(`${servers[server].url}/api/setup-profile`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    try {
      const project = await local.addProject(root)
      const initial = await local.setupProfile.snapshot()
      expect((await post({ operation: 'save', revision: initial.revision, name: 'Mac', software: [selection], configurations: [] })).status).toBe(200)
      expect((await local.projects.get(project.id)).trust).toBe('untrusted')
      for (const headers of [{ origin: 'https://unrelated.example.com' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }])
        expect((await post({ operation: 'review' }, headers)).status).toBe(403)
      expect((await post({ operation: 'install', confirmed: true })).status).toBe(400)
      expect((await fetch(`${servers[0].url}/api/setup-profile?run=true`)).status).toBe(400)
      expect((await fetch(`${servers[1].url}/api/setup-profile`)).status).toBe(403)
      expect((await post({ operation: 'inventory' }, {}, 1)).status).toBe(403)
      await expect(hosted.setupProfile.import((await local.setupProfile.snapshot()).profile, initial.revision)).rejects.toMatchObject({ status: 403 })
    }
    finally { await Promise.all(servers.map(server => server.close())) }
  })
})
