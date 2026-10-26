import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ApplicationMaintenanceService } from '../src/application-maintenance'
import { parseSoftwareConfig } from '../src/software-config'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'application-guidance-')))
  roots.push(root)
  const apps = join(root, 'Applications')
  await mkdir(apps)
  const reveal = vi.fn().mockResolvedValue(undefined)
  const service = new ApplicationMaintenanceService({
    platform: 'darwin',
    roots: [apps],
    reveal,
    manifest: async path => JSON.parse(await readFile(join(path, 'Contents/fixture.json'), 'utf8')),
    catalog: async () => ({ version: 1, sources: [{ id: 'fixture', title: 'Reviewed catalog', items: [{
      id: 'editor',
      title: { en: 'Editor' },
      group: { id: 'tools', title: { en: 'Tools' } },
      url: 'https://example.com',
      installation: { kind: 'manual' },
      status: 'unknown',
      macosBundleId: 'com.example.editor',
      uninstallUrl: 'https://example.com/uninstall',
    }] }] }),
  })
  const application = async (relative: string, bundleId = 'com.example.editor') => {
    const path = join(apps, relative)
    await mkdir(join(path, 'Contents'), { recursive: true })
    await writeFile(join(path, 'Contents/fixture.json'), JSON.stringify({ CFBundleIdentifier: bundleId, CFBundleName: 'Editor' }))
    return path
  }
  return { root, apps, service, reveal, application }
}

it('distinguishes installed copies and does not follow symlinks or descend into app bundles', async () => {
  const f = await fixture()
  const first = await f.application('Editor.app')
  await f.application('Vendor/Editor.app')
  await f.application('Editor.app/Contents/Hidden.app')
  await f.application('Too/Deep/More/Hidden.app')
  await symlink(first, join(f.apps, 'Linked.app'))
  const snapshot = await f.service.snapshot()
  expect(snapshot.applications).toHaveLength(2)
  expect(new Set(snapshot.applications.map(app => app.id)).size).toBe(2)
  expect(snapshot.applications.map(app => app.bundleId)).toEqual(['com.example.editor', 'com.example.editor'])
  expect(f.reveal).not.toHaveBeenCalled()
})

it('attributes documentation and exposes filename candidates without executing them', async () => {
  const f = await fixture()
  const app = await f.application('Vendor/Editor.app')
  await mkdir(join(app, 'Contents/Helpers'), { recursive: true })
  const candidate = join(app, 'Contents/Helpers/uninstall.tool')
  await writeFile(candidate, 'never execute this file')
  await writeFile(join(app, 'Contents/Helpers/reinstall.tool'), '')
  await writeFile(join(f.apps, 'Vendor/Uninstall Editor.tool'), '')
  await writeFile(join(f.apps, 'Uninstall Unrelated.tool'), '')
  await symlink(candidate, join(app, 'Contents/Helpers/uninstaller.tool'))
  const snapshot = await f.service.snapshot()
  const guidance = await f.service.guidance(snapshot.applications[0]!.id)
  expect(guidance.candidates.map(candidate => candidate.verification)).toEqual(['unverified', 'unverified'])
  expect(guidance.candidates.map(candidate => candidate.evidence).sort()).toEqual(['adjacent-to-application', 'inside-application'])
  expect(guidance.documentation).toEqual([{ url: 'https://example.com/uninstall', source: 'Reviewed catalog' }])
  expect(guidance.searchUrl).toContain('q=Editor+macOS+uninstall+official')
  expect(f.reveal).not.toHaveBeenCalled()
  const found = guidance.candidates.find(item => item.path === candidate)!
  await f.service.reveal(guidance.application.id, found.id)
  expect(f.reveal).toHaveBeenCalledExactlyOnceWith(candidate)
  await rm(candidate)
  await expect(f.service.reveal(guidance.application.id, found.id)).rejects.toThrow('no longer available')
  expect(f.reveal).toHaveBeenCalledTimes(1)
  await rm(app, { recursive: true })
  await expect(f.service.guidance(guidance.application.id)).rejects.toThrow('no longer available')
})

it('does not mistake top-level shared uninstallers for an application-specific candidate', async () => {
  const f = await fixture()
  await f.application('Editor.app')
  await writeFile(join(f.apps, 'Uninstall Editor.tool'), '')
  const snapshot = await f.service.snapshot()
  expect((await f.service.guidance(snapshot.applications[0]!.id)).candidates).toEqual([])
  await expect(f.service.guidance('../arbitrary')).rejects.toThrow('Invalid application identifier')
})

it('reports unreadable application manifests and unsupported hosts explicitly', async () => {
  const f = await fixture()
  await mkdir(join(f.apps, 'Broken.app'))
  expect((await f.service.snapshot()).incomplete).toBe(true)
  const unsupported = new ApplicationMaintenanceService({ platform: 'linux', roots: [f.apps] })
  expect(await unsupported.snapshot()).toEqual({ version: 1, supported: false, applications: [], incomplete: false })
  await expect(unsupported.guidance('a'.repeat(64))).rejects.toThrow('requires macOS')
})

it('rejects a stale application identity when another app replaces the same path', async () => {
  const f = await fixture()
  await f.application('Editor.app')
  const original = (await f.service.snapshot()).applications[0]!
  await f.application('Editor.app', 'com.example.replacement')
  await expect(f.service.guidance(original.id)).rejects.toThrow('no longer available')
  expect(f.reveal).not.toHaveBeenCalled()
})

it('reads documentation as portable data and rejects executable or malformed metadata', () => {
  const config = (extra: string) => `export const softwareGroups = [{ id: 'tools', label: { en: 'Tools' }, items: [{ id: 'editor', name: { en: 'Editor' }, url: 'https://example.com', ${extra} }] }]`
  const source = { id: 'fixture', title: 'Fixture' }
  const item = parseSoftwareConfig(config('macosBundleId: \'com.example.editor\', uninstallUrl: \'https://example.com/uninstall\''), source).items[0]!
  expect(item.macosBundleId).toBe('com.example.editor')
  expect(item.uninstallUrl).toBe('https://example.com/uninstall')
  for (const extra of ['macosBundleId: \'com.example.app\\n\'', 'uninstallUrl: \'javascript:run()\'', 'uninstallUrl: resolveURL()'])
    expect(() => parseSoftwareConfig(config(extra), source)).toThrow()
})
