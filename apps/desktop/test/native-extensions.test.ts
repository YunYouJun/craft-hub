import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { CraftHubRuntime, HostExtensionManager, startCraftHubServer } from 'craft-hub'
import { afterEach, expect, it } from 'vitest'
import { createNativeExtensionHandler, NativeExtensionControls } from '../src/native-extensions'
import { createSessionGuard } from '../src/sidecar-host'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'craft-hub-native-extension-')))
  roots.push(root)
  const manager = new HostExtensionManager(join(root, 'data'))
  const path = join(root, 'distribution.json')
  const entry = join(root, 'host.mjs')
  const marker = join(root, 'executed')
  const declaration = { schemaVersion: 1, distribution: { id: 'fixture-extension', name: 'Fixture Extension' }, hostPlugins: ['./host.mjs'], desktop: { protocol: 'fixture', artifactName: 'Fixture' } }
  await writeFile(path, JSON.stringify(declaration))
  await writeFile(entry, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default { id: 'fixture-provider' }`)
  let time = 1000
  const controls = new NativeExtensionControls(manager, () => manager.status(), new Set(['builtin']), () => time)
  await manager.load()
  return { root, path, entry, marker, declaration, manager, controls, expire: () => {
    time += 5 * 60_000
  } }
}

it('only loads exact explicitly reviewed registrations after restart and retains source files on removal', async () => {
  const { root, path, entry, marker, manager, controls } = await fixture()
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'runtime'), configDir: join(root, 'config') })
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { inspect: 'node --version' } }))
    const project = await runtime.addProject(root)
    const review = await controls.preview(path)
    expect(review.extension.modules).toEqual([entry])
    await expect(access(manager.path)).rejects.toThrow()
    const installed = await controls.install(review)
    expect(installed.restartRequired).toBe(true)
    await expect(access(marker)).rejects.toThrow()
    await expect(controls.install(review)).rejects.toThrow(/expired/)
    expect((await new HostExtensionManager(join(root, 'data')).load()).plugins.map(item => item.id)).toEqual(['fixture-provider'])
    expect(await readFile(marker, 'utf8')).toBe('executed')
    expect((await runtime.projects.get(project.id))?.trust).toBe('untrusted')
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
    await expect(runtime.run(project.id, command.id)).rejects.toThrow(/untrusted/)
    expect(await runtime.runs()).toEqual([])
    const disabled = await controls.setEnabled(review.extension, false)
    await expect(controls.remove(review.extension)).rejects.toThrow(/changed/)
    await controls.remove(disabled.extensions[0]!)
    expect((await manager.status()).extensions).toEqual([])
    await expect(access(entry)).resolves.toBeUndefined()
    await expect(access(path)).resolves.toBeUndefined()
  }
  finally { await runtime.close() }
})

it('consumes tampered, cancelled, expired and changed reviews without installing or executing code', async () => {
  const { path, declaration, marker, manager, controls, expire } = await fixture()
  const forged = await controls.preview(path)
  await expect(controls.install({ ...forged, extension: { ...forged.extension, modules: ['/unreviewed.mjs'] } })).rejects.toThrow(/changed/)
  await expect(controls.install(forged)).rejects.toThrow(/expired/)
  const cancelled = await controls.preview(path)
  controls.cancel(cancelled.id)
  await expect(controls.install(cancelled)).rejects.toThrow(/expired/)
  const expired = await controls.preview(path)
  expire()
  await expect(controls.install(expired)).rejects.toThrow(/expired/)
  const changed = await controls.preview(path)
  await writeFile(path, JSON.stringify({ ...declaration, distribution: { ...declaration.distribution, name: 'Changed' } }))
  await expect(controls.install(changed)).rejects.toThrow(/changed/)
  expect((await manager.status()).extensions).toEqual([])
  await expect(access(marker)).rejects.toThrow()
})

it('refuses replacements reviewed against old state and bounds simultaneous pending previews', async () => {
  const { path, controls, manager, expire } = await fixture()
  const [first, second] = await Promise.all([controls.preview(path), controls.preview(path)])
  await controls.install(first!)
  await expect(controls.install(second)).rejects.toThrow(/changed/)
  const review = await controls.preview(path)
  expect(review.previous).toEqual(first!.extension)
  await manager.setEnabled(first!.extension.id, false)
  await expect(controls.install(review)).rejects.toThrow(/changed/)
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => controls.preview(path)))
  expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(8)
  expect(results.filter(item => item.status === 'rejected')).toHaveLength(2)
  expire()
  await expect(controls.preview(path)).resolves.toBeDefined()
})

it('can clean up a legacy conflicting external registration without changing a bundled choice', async () => {
  const { path, controls, manager } = await fixture()
  const review = await controls.preview(path)
  const legacy = { ...review.extension, id: 'builtin' }
  await manager.install(legacy)
  await manager.setBundledEnabled('builtin', true)
  await expect(controls.setEnabled(legacy, true)).rejects.toThrow(/shipped/)
  const disabled = await controls.setEnabled(legacy, false)
  await controls.remove(disabled.extensions[0]!)
  expect((await manager.status()).extensions).toEqual([])
  expect(await manager.bundledChoice('builtin')).toBe(true)
})

it('reads only bounded regular declarations and refuses reserved IDs and changed module resolution', async () => {
  const { root, path, entry, declaration, controls, manager, marker } = await fixture()
  await writeFile(path, JSON.stringify({ ...declaration, distribution: { id: 'builtin', name: 'Reserved' } }))
  await expect(controls.preview(path)).rejects.toThrow(/shipped/)
  await writeFile(path, ' '.repeat(1024 * 1024 + 1))
  await expect(controls.preview(path)).rejects.toThrow(/1 MiB/)
  await mkdir(join(root, 'directory'))
  await expect(controls.preview(join(root, 'directory'))).rejects.toThrow(/regular/)
  if (process.platform !== 'win32') {
    const fifo = join(root, 'fifo.json')
    execFileSync('mkfifo', [fifo])
    await expect(controls.preview(fifo)).rejects.toThrow(/regular/)
    const alias = join(root, 'alias.mjs')
    await symlink(entry, alias)
    await writeFile(path, JSON.stringify({ ...declaration, hostPlugins: ['./alias.mjs'] }))
    const review = await controls.preview(path)
    expect(review.extension.modules).toEqual([entry])
    const other = join(root, 'other.mjs')
    await writeFile(other, 'throw new Error("must not execute")')
    await rm(alias)
    await symlink(other, alias)
    await expect(controls.install(review)).rejects.toThrow(/changed/)
  }
  expect((await manager.status()).extensions).toEqual([])
  await expect(access(marker)).rejects.toThrow()
})

it('rejects web credentials and malformed HTTP writes before reading declarations or changing registrations', async () => {
  const { root, path, controls, manager, marker } = await fixture()
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'runtime'), configDir: join(root, 'config') })
  const token = 'b'.repeat(64)
  const secret = 'a'.repeat(64)
  const guard = createSessionGuard(secret, token)
  const server = await startCraftHubServer({ host: '127.0.0.1', port: 0, runtime, authorizeRequest: guard.authorize, handleHostRequest: createNativeExtensionHandler(guard, controls) })
  guard.setOrigin(server.url)
  const headers = { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', 'origin': server.url }
  const url = `${server.url}/api/native-host/external-extensions/`
  try {
    for (const action of ['preview', 'install', 'cancel', 'enable', 'remove']) {
      const credentials: Record<string, string>[] = [{}, { cookie: `craft-hub-host-session=${secret}` }, { authorization: `Bearer ${secret}` }]
      for (const credential of credentials) {
        expect((await fetch(url + action, { method: 'POST', headers: { ...credential, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
      }
    }
    expect((await fetch(`${url}preview?path=unexpected`, { method: 'POST', headers, body: JSON.stringify({ manifestPath: path }) })).status).toBe(400)
    expect((await fetch(`${url}preview`, { method: 'POST', headers, body: JSON.stringify({ manifestPath: path, modules: [] }) })).status).toBe(400)
    expect((await fetch(`${url}preview`, { headers })).status).toBe(405)
    const preview = await fetch(`${url}preview`, { method: 'POST', headers, body: JSON.stringify({ manifestPath: path }) })
    expect(preview.status).toBe(200)
    const review = await preview.json()
    expect((await manager.status()).extensions).toEqual([])
    const installed = await fetch(`${url}install`, { method: 'POST', headers, body: JSON.stringify({ reviewed: review }) })
    expect(installed.status).toBe(200)
    expect((await installed.json()).restartRequired).toBe(true)
    await expect(access(marker)).rejects.toThrow()
  }
  finally { await server.close() }
})
