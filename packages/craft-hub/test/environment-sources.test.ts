import type { EnvironmentSourceProvider } from '../src/environment-sources'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gitAuthentication } from '../../craft-hub-plugin-workstation/src/git-authentication'
import { sourceProcess, workstationSourceProvider } from '../../craft-hub-plugin-workstation/src/source-connection'
import { environmentSourceCommandSchema, EnvironmentSourceError, EnvironmentSourceService } from '../src/environment-sources'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const repository = 'https://example.com/owner/config.git'
const roots: string[] = []
const services: EnvironmentSourceService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
function create(provider: EnvironmentSourceProvider) {
  const service = new EnvironmentSourceService([provider])
  services.push(service)
  return service
}
const connect = { operation: 'connect' as const, providerId: 'workstation', kind: 'private' as const, repository }

describe('configuration source connection sessions', () => {
  it('holds authentication only for one attempt and publishes verified progress without credentials or raw errors', async () => {
    const attempts = vi.fn(async (_input, context) => {
      if (!context.credentials)
        throw new EnvironmentSourceError(503, 'authentication-required')
      expect(context.credentials.token).toBe('fixture-secret')
      context.phase('validating')
      return { localPath: '/managed/fixture' }
    })
    const service = create({ id: 'workstation', name: 'Workstation', kinds: ['private'], connect: attempts })
    expect(attempts).not.toHaveBeenCalled()
    service.command(connect)
    await vi.waitFor(() => expect(service.snapshot().connections[0].state).toBe('authentication-required'))
    const id = service.snapshot().connections[0].id
    expect(() => service.command(connect)).toThrow('Finish or cancel')
    service.command({ operation: 'authenticate', id, credentials: { username: 'fixture', token: 'fixture-secret' } })
    await vi.waitFor(() => expect(service.snapshot().connections[0].state).toBe('connected'))
    expect(JSON.stringify(service.snapshot())).not.toContain('fixture-secret')
    expect(() => service.command({ operation: 'authenticate', id, credentials: { username: 'fixture', token: 'fixture-secret' } })).toThrow('no longer pending')
  })

  it('cancels background connection and rejects host-only paths, commands and credential-bearing URLs', async () => {
    const provider: EnvironmentSourceProvider = { id: 'workstation', name: 'Workstation', kinds: ['private'], connect: async (_input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private failure')), { once: true })) }
    const service = create(provider)
    const first = service.command(connect).connections[0]
    service.command({ operation: 'cancel', id: first.id })
    expect(service.snapshot().connections[0].state).toBe('cancelled')
    for (const value of [{ ...connect, command: 'git' }, { ...connect, target: '/outside' }, { ...connect, repository: 'file:///tmp/source' }, { ...connect, repository: 'https://user:secret@example.com/repo' }, { ...connect, repository: 'https://example.com/repo?token=secret' }])
      expect(environmentSourceCommandSchema.safeParse(value).success).toBe(false)
    expect(() => new EnvironmentSourceService([provider], false).snapshot()).toThrow('local workbench')
  })

  it('enforces same-origin local JSON requests and leaves project trust and configuration files untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-source-route-'))
    roots.push(root)
    const provider = { id: 'workstation', name: 'Workstation', kinds: ['private' as const], connect: vi.fn(async () => {
      throw new Error('secret process output')
    }) }
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), plugins: [{ id: 'fixture', environmentSourceProviders: [provider] }] })
    const hosted = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted'), configDir: join(root, 'hosted-config') })
    const servers = await Promise.all([runtime, hosted].map(runtime => startCraftHubServer({ runtime, port: 0 })))
    try {
      const project = await runtime.addProject(root)
      const url = `${servers[0].url}/api/environment/sources`
      expect((await fetch(url)).status).toBe(200)
      expect(provider.connect).not.toHaveBeenCalled()
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'https://other.example' }, body: JSON.stringify(connect) })).status).toBe(403)
      expect((await fetch(`${url}?command=clone`)).status).toBe(400)
      expect((await fetch(`${servers[1].url}/api/environment/sources`)).status).toBe(403)
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...connect, command: 'arbitrary' }) })).status).toBe(400)
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(connect) })
      expect(response.status).toBe(200)
      await vi.waitFor(() => expect(runtime.environmentSources.snapshot().connections[0].state).toBe('failed'))
      expect(JSON.stringify(runtime.environmentSources.snapshot())).not.toContain('secret process output')
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      await expect(readFile(join(root, '.codex/config.toml'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally { await Promise.all(servers.map(server => server.close())) }
  })
})

describe('workstation source adapter and transient Git authentication', () => {
  it('cancels a real background process without returning subprocess diagnostics', async () => {
    const controller = new AbortController()
    const pending = sourceProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeDefined()
  })

  it.runIf(process.platform === 'win32')('reports source connection as unavailable on Windows before running Git', async () => {
    const run = vi.fn(async () => '')
    const adapter = workstationSourceProvider({ homeDirectory: tmpdir(), sourceDataDirectory: tmpdir() }, run, vi.fn())
    await expect(adapter.connect({ kind: 'public', repository }, { signal: new AbortController().signal, phase: vi.fn() })).rejects.toMatchObject({ code: 'unavailable' })
    expect(run).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('answers real askpass only for the requested HTTPS host and removes helpers without writing credentials', async () => {
    const auth = await gitAuthentication(repository, { username: 'fixture-user', token: 'fixture-token' })
    const helper = auth.environment.GIT_ASKPASS!
    try {
      const run = promisify(execFile)
      expect((await run(helper, ['Username for \'https://example.com\':'], { env: { ...process.env, ...auth.environment } })).stdout.trim()).toBe('fixture-user')
      expect((await run(helper, ['Password for \'https://fixture-user@example.com\':'], { env: { ...process.env, ...auth.environment } })).stdout.trim()).toBe('fixture-token')
      await expect(run(helper, ['Password for \'https://different.example\':'], { env: { ...process.env, ...auth.environment } })).rejects.toThrow()
      for (const name of ['askpass', 'client.cjs']) expect(await readFile(join(dirname(helper), name), 'utf8')).not.toContain('fixture-token')
      expect(JSON.stringify(auth.environment)).not.toContain('fixture-token')
    }
    finally { await auth.close() }
    await expect(readFile(helper)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('connects public files separately and rejects a conflicting checkout without fetching or overwriting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-public-source-'))
    roots.push(root)
    const target = join(root, 'public')
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'clone')
        await mkdir(args.at(-1)!, { recursive: true })
      if (args.includes('rev-parse'))
        return target
      if (args.includes('remote'))
        return 'https://different.example/source.git'
      return ''
    })
    const inspect = vi.fn(async () => ({ items: [{ origin: 'public', source: 'public source', status: 'first-adoption' }] }))
    const adapter = workstationSourceProvider({ homeDirectory: root, sourceDirectory: target, sourceDataDirectory: root }, run, inspect)
    const context = { signal: new AbortController().signal, phase: vi.fn() }
    expect((await adapter.connect({ kind: 'public', repository }, context)).localPath).toBe(await realpath(target))
    await writeFile(join(target, 'kept'), 'local work')
    await expect(adapter.connect({ kind: 'public', repository }, context)).rejects.toMatchObject({ code: 'destination-conflict' })
    expect(await readFile(join(target, 'kept'), 'utf8')).toBe('local work')
    expect(run.mock.calls.some(([, args]) => args.includes('pull') || args.includes('connect'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('validates in staging and binds only with the owning tool, preserving previous source on validation failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-source-adapter-'))
    roots.push(root)
    const home = join(root, 'home')
    const binding = join(home, '.config/workstation/private.json')
    await mkdir(dirname(binding), { recursive: true })
    await writeFile(binding, 'previous binding')
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === 'git' && args[0] === 'clone') {
        const path = args.at(-1)!
        await mkdir(join(path, 'config'), { recursive: true })
        await writeFile(join(path, 'config/sync-manifest.json'), '{}')
      }
      else if (args.includes('connect')) {
        await writeFile(binding, 'new binding')
      }
      return ''
    })
    const inspect = vi.fn(async () => ({ items: [{ id: 'manifest', status: 'error' }] }))
    const adapter = workstationSourceProvider({ homeDirectory: home, sourceDataDirectory: root, command: '/trusted/workstation' }, run, inspect)
    const context = { signal: new AbortController().signal, phase: vi.fn() }
    await expect(adapter.connect({ kind: 'private', repository }, context)).rejects.toMatchObject({ code: 'invalid-source' })
    expect(await readFile(binding, 'utf8')).toBe('previous binding')
    expect(await readdir(join(root, 'environment-sources/workstation'))).toEqual([])
    inspect.mockResolvedValue({ items: [] })
    await adapter.connect({ kind: 'private', repository }, context)
    expect(await readFile(binding, 'utf8')).toBe('new binding')
    const calls = run.mock.calls.filter(([, args]) => args.includes('connect'))
    expect(calls).toHaveLength(1)
    expect(calls[0][1]).toEqual(expect.arrayContaining(['private', 'connect', '--repo', repository, '--target-dir', '--yes']))
  })
})
