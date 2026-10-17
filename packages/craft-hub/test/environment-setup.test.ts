import type { LocalEnvironmentSnapshot, LocalEnvironmentToolId } from '../src/local-environment'
import type { SetupProfile } from '../src/setup-profile'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurationOperations, softwareOperations, unavailableSupport } from '../../craft-hub-plugin-workstation/src/host-support'
import { workstationSetupProvider } from '../../craft-hub-plugin-workstation/src/setup-guide'
import { EnvironmentSetupService } from '../src/environment-setup'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

const profile: SetupProfile = {
  version: 1,
  platform: 'darwin',
  name: 'Development Mac',
  software: [{ sourceId: 'workstation', softwareId: 'editor', title: { en: 'Editor' }, url: 'https://example.com/editor', installation: { kind: 'brew-cask', packageId: 'editor' } }],
  configurations: [{ integrationId: 'workstation', itemId: 'mcp:example', title: 'Example', origin: 'private', kind: 'mcp', sourceDigest: 'a'.repeat(64) }],
}
const home = '/Users/Example\'s Mac/$literal'
function environment(available: LocalEnvironmentToolId[] = [], arch = 'arm64', platform = 'darwin'): LocalEnvironmentSnapshot {
  const versions = { git: '2.51.0', homebrew: '5.0.0', node: '24.11.0', npm: '11.0.0', pnpm: '11.21.0', fnm: '1.38.1', workstation: '0.1.0' }
  return {
    schemaVersion: 1,
    checkedAt: '2026-10-16T00:00:00.000Z',
    host: { platform, arch, osRelease: '25.0.0' },
    runtime: { version: '26.0.0', executablePath: '/bundled/node', arch },
    searchDirectories: [],
    tools: (Object.keys(versions) as LocalEnvironmentToolId[]).map(id => ({ id, name: id, status: available.includes(id) ? 'available' : 'missing', ...(available.includes(id) ? { version: versions[id], executablePath: id === 'homebrew' ? '/opt/homebrew/bin/brew' : `/tools/${id}` } : {}) })),
  }
}
function connected() {
  return { configuration: { state: 'available' as const, operations: Object.fromEntries(configurationOperations.map(key => [key, { supported: true }])) }, software: { state: 'available' as const, operations: Object.fromEntries(softwareOperations.map(key => [key, { supported: true }])) }, doctor: true, repositoryValidation: true }
}
const saved = async () => ({ version: 1 as const, revision: 'b'.repeat(64), profile })
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('target Mac prerequisite guidance', () => {
  it('opens without Homebrew, system Node or Workstation and gates later stages on fresh observations', async () => {
    let observed = environment()
    const negotiate = vi.fn(async () => unavailableSupport(new Error('Private diagnostic')))
    const transport = vi.fn(async () => ({ version: 1, items: [] }))
    const adapter = workstationSetupProvider(negotiate, transport, { homeDirectory: home, sourceExists: () => false })
    const guide = new EnvironmentSetupService(async () => observed, saved, [adapter])
    const first = await guide.snapshot()
    expect(first.prerequisitesReady).toBe(false)
    expect(first.steps.map(step => [step.id, step.state])).toEqual([
      ['developer-tools', 'action-required'],
      ['homebrew', 'blocked'],
      ['workstation.node', 'blocked'],
      ['workstation.cli', 'blocked'],
      ['workstation.sources', 'blocked'],
    ])
    expect(transport).not.toHaveBeenCalled()
    observed = environment(['git', 'homebrew'])
    expect((await guide.snapshot()).steps.find(step => step.id === 'workstation.node')?.state).toBe('action-required')
    observed = environment(['git', 'homebrew', 'node'])
    expect((await guide.snapshot()).steps.find(step => step.id === 'workstation.node')?.state).toBe('action-required')
    observed = environment(['git', 'homebrew', 'node', 'npm'])
    const next = await guide.snapshot()
    expect(next.steps.find(step => step.id === 'workstation.node')?.state).toBe('ready')
    expect(next.steps.find(step => step.id === 'workstation.cli')?.state).toBe('action-required')
    expect(next.prerequisitesReady).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('generates literal, failure-gated source-build commands and never overwrites an existing launcher', async () => {
    const adapter = workstationSetupProvider(async () => unavailableSupport(new Error('Unavailable fixture')), async () => ({}), { homeDirectory: home, sourceExists: () => false })
    const steps = await adapter.read({ environment: environment(['git', 'homebrew', 'node', 'npm']), profile })
    const copies = steps.flatMap(step => step.actions.filter(action => action.kind === 'copy'))
    for (const action of copies) execFileSync('/bin/sh', ['-n'], { input: action.text })
    const build = copies.find(action => action.text.includes('git clone'))!.text
    expect(build).toContain(' &&\n')
    expect(build).toContain('npm exec --yes --package=pnpm@11.21.0')
    expect(build).toContain('Example\'\\\'\'s Mac/$literal')
    expect(copies.find(action => action.text.includes('ln -s'))!.text).not.toContain('ln -sf')
    expect(copies.some(action => /npm (?:install|i) -g/.test(action.text))).toBe(false)
    const existing = workstationSetupProvider(async () => unavailableSupport(new Error('Unavailable fixture')), async () => ({}), { homeDirectory: home, sourceExists: () => true })
    expect(JSON.stringify(await existing.read({ environment: environment(), profile }))).not.toContain('git clone')
  })

  it.skipIf(process.platform === 'win32')('uses an app-managed engine without build prerequisites and connects sources independently', async () => {
    const adapter = workstationSetupProvider(async () => connected(), async () => ({ version: 1, items: [] }), {
      homeDirectory: home,
      managed: true,
      sourceExists: () => false,
      invocation: { command: '/Applications/Example App', args: ['/Applications/Example App/cli.js'], environment: { ELECTRON_RUN_AS_NODE: '1', DOTFILES_REPO_ROOT: `${home}/configs` } },
    })
    const guide = new EnvironmentSetupService(async () => environment(['git', 'homebrew']), saved, [adapter])
    const value = await guide.snapshot()
    expect(value.steps.find(step => step.id === 'workstation.node')).toMatchObject({ state: 'not-required', actions: [] })
    expect(value.steps.find(step => step.id === 'workstation.cli')).toMatchObject({ state: 'ready' })
    expect(value.steps.find(step => step.id === 'workstation.sources')?.state).toBe('action-required')
    expect(JSON.stringify(value)).not.toContain('npm exec')
    const command = value.steps.flatMap(step => step.actions).find(action => action.kind === 'copy' && action.text.includes('private connect'))
    expect(command?.kind).toBe('copy')
    if (command?.kind === 'copy') {
      execFileSync('/bin/sh', ['-n'], { input: command.text })
      expect(command.text).toContain('\'ELECTRON_RUN_AS_NODE=1\'')
      expect(command.text).toContain('private connect --yes')
    }
  })

  it('checks source entries independently of CLI availability and leaves actual recovery to reviewed provider operations', async () => {
    const transport = vi.fn(async (): Promise<Record<string, unknown>> => ({ version: 1, items: [] }))
    const adapter = workstationSetupProvider(async () => connected(), transport, { homeDirectory: home, command: '/tools/workstation' })
    const guide = new EnvironmentSetupService(async () => environment(['git', 'homebrew']), saved, [adapter])
    const first = await guide.snapshot()
    expect(first.steps.find(step => step.id === 'workstation.cli')?.state).toBe('ready')
    expect(first.steps.find(step => step.id === 'workstation.node')?.state).toBe('not-required')
    expect(first.steps.find(step => step.id === 'workstation.sources')?.state).toBe('action-required')
    expect(first.prerequisitesReady).toBe(false)
    expect(JSON.stringify(first)).toContain('\'/tools/workstation\' private connect --yes')
    transport.mockResolvedValue({ version: 1, items: [{ id: 'mcp:example', origin: 'private', owner: 'user', scope: 'global', sourcePath: '/private/config.toml', source: '(redacted)', status: 'first-adoption' }] })
    const second = await guide.snapshot()
    expect(second.prerequisitesReady).toBe(true)
    expect(transport.mock.calls).toEqual([[{ operation: 'inspect' }], [{ operation: 'inspect' }]])
    transport.mockRejectedValueOnce(new Error('sensitive diagnostic'))
    const failed = await guide.snapshot()
    expect(failed.prerequisitesReady).toBe(false)
    expect(failed.steps.find(step => step.id === 'workstation.sources')?.state).toBe('unknown')
    expect(JSON.stringify(failed)).not.toContain('sensitive diagnostic')
  })

  it('preserves unknown checks, negotiates management support and respects Mac architecture', async () => {
    const older = connected()
    older.configuration.operations.apply.supported = false
    const adapter = workstationSetupProvider(async () => older, async () => ({}))
    const guide = new EnvironmentSetupService(async () => environment(['git', 'homebrew', 'node', 'npm', 'workstation'], 'x64'), saved, [adapter])
    const snapshot = await guide.snapshot()
    expect(snapshot.steps.find(step => step.id === 'workstation.cli')?.state).toBe('action-required')
    expect(JSON.stringify(snapshot)).toContain('/usr/local/bin/brew shellenv')
    const other = new EnvironmentSetupService(async () => environment([], 'arm64', 'linux'), saved, [adapter])
    expect((await other.snapshot()).steps.map(step => step.id)).toEqual(['platform'])
  })

  it('isolates invalid or failed guidance without accepting execution actions or exposing errors', async () => {
    const failing = { id: 'fixture', read: vi.fn(async () => {
      throw new Error('private failure')
    }) }
    const guide = new EnvironmentSetupService(async () => environment(['git', 'homebrew']), saved, [failing])
    expect(await guide.snapshot()).toMatchObject({ prerequisitesReady: false, steps: [{ state: 'ready' }, { state: 'ready' }, { id: 'fixture.unavailable', state: 'unknown' }] })
    const noPlugin = new EnvironmentSetupService(async () => environment(['git', 'homebrew']), saved)
    expect((await noPlugin.snapshot()).steps.at(-1)?.id).toBe('management-plugin')
    const hosted = new EnvironmentSetupService(vi.fn(), saved, [failing], false)
    await expect(hosted.snapshot()).rejects.toMatchObject({ status: 403 })
  })

  it('exposes only a same-origin local read route and preserves project trust and profile persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-prerequisites-'))
    roots.push(root)
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    vi.spyOn(runtime, 'localEnvironmentSnapshot').mockResolvedValue(environment())
    const hosted = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'hosted'), configDir: join(root, 'hosted-config') })
    const servers = await Promise.all([runtime, hosted].map(runtime => startCraftHubServer({ runtime, port: 0 })))
    try {
      const project = await runtime.addProject(root)
      const url = `${servers[0].url}/api/environment/setup`
      expect((await fetch(url)).status).toBe(200)
      expect((await fetch(`${url}?command=install`)).status).toBe(400)
      expect((await fetch(url, { headers: { origin: 'https://unrelated.example.com' } })).status).toBe(403)
      expect((await fetch(url, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
      expect((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"command":"arbitrary"}' })).status).toBe(405)
      expect((await fetch(`${servers[1].url}/api/environment/setup`)).status).toBe(403)
      expect((await runtime.projects.get(project.id)).trust).toBe('untrusted')
      await expect(readFile(join(root, 'data/setup-profile.v1.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally { await Promise.all(servers.map(server => server.close())) }
  })
})
