import type { LocalExecutableContext } from '../src/local-executable'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkstationPlugin, workstationTransport } from '../src/index'
import * as localExecutable from '../src/local-executable'

const home = '/Users/local-user'
const base: LocalExecutableContext = {
  platform: 'darwin',
  homeDirectory: home,
  env: { PATH: '/usr/bin:/bin' },
  readDirectory: () => [],
  isExecutable: () => false,
}

const resolveLocalExecutable = localExecutable.resolveLocalExecutable

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workstation GUI executable discovery', () => {
  it('finds a pnpm Workstation CLI and adds the fnm default Node directory with minimal Finder PATH', () => {
    const workstation = `${home}/Library/pnpm/workstation`
    const node = `${home}/Library/Application Support/fnm/aliases/default/bin/node`
    const isExecutable = vi.fn(candidate => [workstation, node].includes(candidate))
    const result = resolveLocalExecutable('workstation', { ...base, isExecutable })
    expect(result.command).toBe(workstation)
    expect(result.env.PATH?.split(':')).toContain(node.slice(0, -'/node'.length))
    const nodeCommand = resolveLocalExecutable('node', { ...base, env: result.env, isExecutable })
    expect(nodeCommand.command).toBe(node)
    expect(result.env.PATH?.startsWith('/usr/bin:/bin:')).toBe(true)
  })

  it('discovers a versioned fnm Node when there is no default alias and uses numeric version ordering', () => {
    const root = `${home}/Library/Application Support/fnm`
    const node = `${root}/node-versions/v24.18.0/installation/bin/node`
    const result = resolveLocalExecutable('node', {
      ...base,
      readDirectory: directory => directory === `${root}/node-versions` ? ['v9.0.0', 'v24.18.0', '../escape', 'v99.0.0/../../escape', 'latest'] : [],
      isExecutable: candidate => candidate === node,
    })
    expect(result.command).toBe(node)
    const directories = result.env.PATH!.split(':')
    expect(directories.indexOf(`${root}/node-versions/v24.18.0/installation/bin`)).toBeLessThan(directories.indexOf(`${root}/node-versions/v9.0.0/installation/bin`))
    expect(directories.some(directory => directory.includes('escape') || directory.includes('/latest/'))).toBe(false)
  })

  it('adds no more than 20 version installations across fnm roots', () => {
    const readDirectory = vi.fn(() => Array.from({ length: 40 }, (_, index) => `v${index + 1}.0.0`))
    const result = resolveLocalExecutable('/trusted/workstation', { ...base, readDirectory, isExecutable: candidate => candidate === '/trusted/workstation' })
    const versions = result.env.PATH!.split(':').filter(directory => directory.includes('/node-versions/'))
    expect(versions).toHaveLength(20)
    expect(versions[0]).toContain('/v40.0.0/')
    expect(versions.at(-1)).toContain('/v21.0.0/')
    expect(readDirectory).toHaveBeenCalledOnce()
  })

  it('preserves absolute host PATH order and ignores relative and empty PATH entries', () => {
    const result = resolveLocalExecutable('workstation', {
      ...base,
      env: { PATH: ':/preferred/bin:.:relative-bin:/preferred/bin:/usr/bin:/bin', KEEP_LOCAL: 'retained' },
      isExecutable: candidate => ['/preferred/bin/workstation', `${home}/Library/pnpm/workstation`].includes(candidate),
    })
    expect(result.command).toBe('/preferred/bin/workstation')
    expect(result.env.PATH!.split(':').slice(0, 3)).toEqual(['/preferred/bin', '/usr/bin', '/bin'])
    expect(result.env.PATH!.split(':')).not.toContain('.')
    expect(result.env.PATH!.split(':')).not.toContain('relative-bin')
    expect(result.env.KEEP_LOCAL).toBe('retained')
  })

  it('honors an absolute PNPM_HOME without rewriting the original environment', () => {
    const env = { PATH: '/usr/bin:/bin', PNPM_HOME: '/custom/pnpm' }
    const result = resolveLocalExecutable('workstation', { ...base, env, isExecutable: candidate => candidate === '/custom/pnpm/workstation' })
    expect(result.command).toBe('/custom/pnpm/workstation')
    expect(result.env.PATH!.split(':')).toContain('/custom/pnpm')
    expect(env.PATH).toBe('/usr/bin:/bin')
    expect(() => resolveLocalExecutable('workstation', { ...base, env: { PATH: '/usr/bin', PNPM_HOME: './custom/pnpm' } })).toThrow('Workstation is unavailable')
  })

  it('supports a configured absolute fnm root and ignores a relative one', () => {
    const result = resolveLocalExecutable('node', {
      ...base,
      env: { PATH: '/usr/bin:/bin', FNM_DIR: '/configured/fnm' },
      isExecutable: candidate => candidate === '/configured/fnm/aliases/default/bin/node',
    })
    expect(result.command).toBe('/configured/fnm/aliases/default/bin/node')
    expect(() => resolveLocalExecutable('node', { ...base, env: { PATH: '/usr/bin:/bin', FNM_DIR: './fnm' }, isExecutable: candidate => candidate === 'fnm/aliases/default/bin/node' })).toThrow('Workstation is unavailable')
  })

  it('keeps an explicit host executable with spaces usable even when fnm is unavailable', () => {
    const command = '/Applications/Local Tools/Workstation CLI'
    const result = resolveLocalExecutable(command, {
      ...base,
      readDirectory: () => { throw new Error('private local directory diagnostic') },
      isExecutable: candidate => candidate === command,
    })
    expect(result.command).toBe(command)
    expect(result.env.PATH).toContain('/usr/bin:/bin')
  })

  it('adds Linux pnpm and local binary directories without macOS-only paths', () => {
    const command = '/home/local-user/.local/share/pnpm/workstation'
    const result = resolveLocalExecutable('workstation', { ...base, platform: 'linux', homeDirectory: '/home/local-user', isExecutable: candidate => candidate === command })
    expect(result.command).toBe(command)
    expect(result.env.PATH).toContain('/home/local-user/.local/bin')
    expect(result.env.PATH).not.toContain('Library/pnpm')
  })

  it('normalizes Windows PATH casing and resolves native executables', () => {
    const result = resolveLocalExecutable('workstation', {
      ...base,
      platform: 'win32',
      homeDirectory: 'C:\\Users\\Local',
      env: { PATH: 'C:\\Ignored', Path: 'C:\\Tools;.\\relative', PNPM_HOME: 'C:\\pnpm' },
      isExecutable: candidate => candidate === 'C:\\pnpm\\workstation.exe',
    })
    expect(result.command).toBe('C:\\pnpm\\workstation.exe')
    expect(result.env.Path).toBe('C:\\Tools;C:\\pnpm')
    expect(result.env.PATH).toBeUndefined()
  })

  it.each(['workstation.cmd', 'C:\\Tools\\workstation.BAT'])('rejects Windows shell shim %s without executing a shell', (command) => {
    const isExecutable = vi.fn(() => true)
    expect(() => resolveLocalExecutable(command, { ...base, platform: 'win32', env: { PATH: 'C:\\Tools' }, isExecutable })).toThrow('Workstation is unavailable')
    expect(isExecutable).not.toHaveBeenCalled()
  })

  it('reports missing or invalid executables without local path diagnostics', () => {
    const error = 'Workstation is unavailable. Configure the versioned local CLI on this host.'
    expect(() => resolveLocalExecutable('/private/secret/absent', base)).toThrow(error)
    expect(() => resolveLocalExecutable('workstation\u0000invalid', base)).toThrow(error)
    expect(() => resolveLocalExecutable('workstation', base)).toThrow(error)
  })
})

describe('lazy Workstation transport lookup', () => {
  it('does not resolve or reject a missing CLI until a host operation is requested', async () => {
    const lookup = vi.spyOn(localExecutable, 'resolveLocalExecutable').mockImplementation(() => {
      throw new Error('Workstation is unavailable. Configure the versioned local CLI on this host.')
    })
    const plugin = createWorkstationPlugin()
    expect(lookup).not.toHaveBeenCalled()
    await expect(plugin.softwareCatalogProviders![0].read()).rejects.toThrow('Workstation is unavailable')
    expect(lookup).toHaveBeenCalledOnce()
  })

  it('refreshes command and Node-shim PATH on each call while retaining trusted host arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'craft-hub-workstation-path-'))
    const script = join(directory, 'fixture.cjs')
    const lookup = vi.spyOn(localExecutable, 'resolveLocalExecutable')
    lookup.mockReturnValueOnce({ command: process.execPath, env: { ...process.env, PATH: '/fresh-one' } })
      .mockReturnValueOnce({ command: process.execPath, env: { ...process.env, PATH: '/fresh-two' } })
    try {
      await writeFile(script, 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write(JSON.stringify({ ok: true, result: { version: 1, argv: process.argv.slice(2), path: process.env.PATH } })))')
      const transport = workstationTransport('/trusted/host/command', [script, '--local-profile'], 'software-json')
      expect(lookup).not.toHaveBeenCalled()
      expect(await transport({ operation: 'catalog', command: '/browser/must-not-select' })).toMatchObject({ argv: ['--local-profile', 'software-json'], path: '/fresh-one' })
      expect(await transport({ operation: 'runs' })).toMatchObject({ argv: ['--local-profile', 'software-json'], path: '/fresh-two' })
      expect(lookup.mock.calls).toEqual([['/trusted/host/command'], ['/trusted/host/command']])
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})
