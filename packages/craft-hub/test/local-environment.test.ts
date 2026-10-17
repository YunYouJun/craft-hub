import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectLocalEnvironment } from '../src/local-environment'
import { CraftHubRuntime } from '../src/runtime'
import { startCraftHubServer } from '../src/server'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, realpath: vi.fn(actual.realpath) }
})

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-local-environment-'))
  roots.push(root)
  return root
}

async function executable(directory: string, command: string, content = '#!/bin/sh\nexit 0\n') {
  await mkdir(directory, { recursive: true })
  const path = join(directory, process.platform === 'win32' && !command.includes('.') ? `${command}.exe` : command)
  await writeFile(path, content, { mode: 0o755 })
  return path
}

afterEach(async () => {
  vi.mocked(realpath).mockClear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('local environment inspection', () => {
  it.skipIf(process.platform === 'win32')('uses PATH priority, resolves symlinks and keeps backend Node separate from the detected Node', async () => {
    const root = await fixture()
    const first = join(root, 'first')
    const second = join(root, 'second')
    const actualNode = await executable(second, 'node')
    await mkdir(first)
    await symlink(actualNode, join(first, 'node'))
    const probe = vi.fn().mockResolvedValue('v22.18.0\n')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: `${first}:${second}` }, platform: 'darwin', commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'node')).toMatchObject({ status: 'available', version: '22.18.0', executablePath: join(first, 'node'), resolvedPath: await realpath(actualNode), source: 'path' })
    expect(snapshot.runtime).toMatchObject({ version: process.versions.node, executablePath: process.execPath })
    expect(snapshot.searchDirectories).toEqual([first, second])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it.skipIf(process.platform === 'win32')('finds tools in common locations without executing shell initialization or relative PATH entries', async () => {
    const root = await fixture()
    const command = await executable(root, 'fnm')
    const probe = vi.fn().mockResolvedValue('fnm 1.38.1\n')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: '.::scripts' }, platform: 'darwin', commonDirectories: [root], probeVersion: probe })
    expect(snapshot.searchDirectories).toEqual([root])
    expect(snapshot.tools.find(tool => tool.id === 'fnm')).toMatchObject({ status: 'available', version: '1.38.1', executablePath: command, source: 'common-location' })
    expect(probe.mock.calls[0]?.[1]).toEqual(['--version'])
    expect(probe.mock.calls[0]?.[2]).toMatchObject({ shell: false, cwd: tmpdir(), timeout: 3000, maxBuffer: 16 * 1024 })
  })

  it.skipIf(process.platform === 'win32')('checks npm separately with a fixed version probe and no package download', async () => {
    const root = await fixture()
    const command = await executable(root, 'npm')
    const probe = vi.fn().mockResolvedValue('11.0.0\n')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'npm')).toMatchObject({ status: 'available', version: '11.0.0', executablePath: command })
    expect(probe).toHaveBeenCalledExactlyOnceWith(command, ['--version'], expect.objectContaining({ shell: false }))
  })

  it('reports missing tools without calling any executable or claiming an installed backend is local Node', async () => {
    const probe = vi.fn()
    const snapshot = await inspectLocalEnvironment({ env: { PATH: '' }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools).toHaveLength(7)
    expect(snapshot.tools.filter(tool => tool.id !== 'homebrew').every(tool => tool.status === 'missing')).toBe(true)
    expect(snapshot.tools.find(tool => tool.id === 'node')?.version).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })

  it('isolates tool failures and hides raw output and environment secrets', async () => {
    const root = await fixture()
    await executable(root, 'git')
    await executable(root, 'node')
    const probe = vi.fn(async (command: string) => {
      if (/[/\\]git(?:\.exe)?$/.test(command))
        throw Object.assign(new Error('private-token-in-stderr'), { killed: true, stderr: 'private-token-in-stderr' })
      return 'v24.11.0\n'
    })
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root, SAMPLE_SECRET: 'private-token-in-env' }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'git')).toMatchObject({ status: 'error', message: 'Version check timed out.' })
    expect(snapshot.tools.find(tool => tool.id === 'node')?.status).toBe('available')
    expect(JSON.stringify(snapshot)).not.toContain('private-token')
  })

  it('disables package manager downloads and startup injection for version checks', async () => {
    const root = await fixture()
    await executable(root, 'pnpm')
    const probe = vi.fn().mockResolvedValue('11.21.0\n')
    await inspectLocalEnvironment({ env: { PATH: root, NODE_OPTIONS: '--require unwanted.cjs', NODE_PATH: '/unwanted', BASH_ENV: '/unwanted-bash', ENV: '/unwanted-sh', COREPACK_ENABLE_NETWORK: '1', COREPACK_ENABLE_AUTO_PIN: '1' }, commonDirectories: [], probeVersion: probe })
    expect(probe.mock.calls[0]?.[2].env).toMatchObject({ COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_AUTO_PIN: '0', COREPACK_ENV_FILE: '0', COREPACK_ENABLE_PROJECT_SPEC: '0', HOMEBREW_NO_AUTO_UPDATE: '1', npm_config_manage_package_manager_versions: 'false' })
    expect(probe.mock.calls[0]?.[2].env).not.toHaveProperty('NODE_OPTIONS')
    expect(probe.mock.calls[0]?.[2].env).not.toHaveProperty('NODE_PATH')
    expect(probe.mock.calls[0]?.[2].env).not.toHaveProperty('BASH_ENV')
    expect(probe.mock.calls[0]?.[2].env).not.toHaveProperty('ENV')
  })

  it('does not present unexpected output as a verified version', async () => {
    const root = await fixture()
    await executable(root, 'pnpm')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: async () => 'unexpected sensitive response' })
    expect(snapshot.tools.find(tool => tool.id === 'pnpm')).toMatchObject({ status: 'error', message: 'The tool responded, but its version could not be verified.' })
    expect(JSON.stringify(snapshot)).not.toContain('sensitive response')
  })

  it.each(['0.1.0\n', 'workstation/0.1.0 darwin-arm64 node-v24.18.0\n'])('recognizes Workstation version output %j', async (output) => {
    const root = await fixture()
    await executable(root, 'workstation')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: async () => output })
    expect(snapshot.tools.find(tool => tool.id === 'workstation')).toMatchObject({ status: 'available', version: '0.1.0' })
  })

  it('rejects another CLI identity in a Workstation version response', async () => {
    const root = await fixture()
    await executable(root, 'workstation')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: async () => 'other-cli/0.1.0 darwin-arm64 node-v24.18.0' })
    expect(snapshot.tools.find(tool => tool.id === 'workstation')).toMatchObject({ status: 'error', reason: 'version-unrecognized' })
  })

  it.skipIf(process.platform === 'win32')('reports a non-executable file as a permission problem', async () => {
    const root = await fixture()
    const command = await executable(root, 'node')
    await chmod(command, 0o644)
    const probe = vi.fn()
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'node')?.status).toBe('error')
    expect(probe).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('executes only the fixed version argument and leaves the discovered file intact', async () => {
    const root = await fixture()
    const content = '#!/bin/sh\nif [ "$1" = "--version" ] && [ "$#" = "1" ]; then echo "v22.18.0"; else exit 1; fi\n'
    const command = await executable(root, 'node', content)
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [] })
    expect(snapshot.tools.find(tool => tool.id === 'node')).toMatchObject({ status: 'available', version: '22.18.0' })
    expect(await readFile(command, 'utf8')).toBe(content)
  })

  it.skipIf(process.platform === 'win32')('bounds a hanging executable and does not return its private output', async () => {
    const root = await fixture()
    await executable(root, 'node', '#!/bin/sh\necho private-output\nwhile :; do :; done\n')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], timeoutMs: 100 })
    expect(snapshot.tools.find(tool => tool.id === 'node')).toMatchObject({ status: 'error', message: 'Version check timed out.' })
    expect(JSON.stringify(snapshot)).not.toContain('private-output')
  })

  it('marks Homebrew as unsupported on Windows without a version call', async () => {
    const probe = vi.fn()
    const snapshot = await inspectLocalEnvironment({ env: { Path: '' }, platform: 'win32', commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'homebrew')?.status).toBe('unsupported')
    expect(probe).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'win32')('finds native tools using the case-insensitive Path key and preserves PATH order', async () => {
    const root = await fixture()
    const first = join(root, 'first')
    const second = join(root, 'second')
    const command = await executable(first, 'node')
    await executable(second, 'node')
    const probe = vi.fn().mockResolvedValue('v22.18.0\n')
    const snapshot = await inspectLocalEnvironment({ env: { Path: `${first};${second}` }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'node')).toMatchObject({ status: 'available', executablePath: command, source: 'path' })
    expect(snapshot.searchDirectories).toEqual([first, second])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it.runIf(process.platform === 'win32')('reports a Windows shell shim without executing it or cmd.exe', async () => {
    const root = await fixture()
    const command = await executable(root, 'pnpm.cmd')
    const probe = vi.fn()
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'pnpm')).toMatchObject({ status: 'unsupported', executablePath: command, source: 'path' })
    expect(probe).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('never invokes the Apple Git launcher when developer tools are not configured', async () => {
    const root = await fixture()
    await executable(root, 'git')
    vi.mocked(realpath).mockResolvedValueOnce('/usr/bin/git')
    const probe = vi.fn().mockRejectedValue(new Error('No configured developer tools'))
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, platform: 'darwin', commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'git')?.status).toBe('error')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe.mock.calls[0]?.slice(0, 2)).toEqual(['/usr/bin/xcode-select', ['-p']])
  })

  it.skipIf(process.platform === 'win32')('checks the selected developer Git binary instead of its installer-capable launcher', async () => {
    const root = await fixture()
    await executable(root, 'git')
    const developerDirectory = join(root, 'developer')
    const developerGit = await executable(join(developerDirectory, 'usr', 'bin'), 'git')
    vi.mocked(realpath).mockResolvedValueOnce('/usr/bin/git')
    const probe = vi.fn(async (command: string) => command === '/usr/bin/xcode-select' ? `${developerDirectory}\n` : 'git version 2.50.0\n')
    const snapshot = await inspectLocalEnvironment({ env: { PATH: root }, platform: 'darwin', commonDirectories: [], probeVersion: probe })
    expect(snapshot.tools.find(tool => tool.id === 'git')).toMatchObject({ status: 'available', version: '2.50.0' })
    expect(probe.mock.calls.map(call => call[0])).toEqual(['/usr/bin/xcode-select', developerGit])
  })
})

describe('environment endpoint', () => {
  it('serves a local snapshot without registering or trusting a project and rejects command parameters', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const project = await runtime.projects.add(root)
    const snapshot = await inspectLocalEnvironment({ env: { PATH: '' }, commonDirectories: [] })
    const inspect = vi.spyOn(runtime, 'localEnvironmentSnapshot').mockResolvedValue(snapshot)
    const server = await startCraftHubServer({ runtime, port: 0 })
    try {
      const response = await fetch(`${server.url}/api/environment`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(snapshot)
      expect(await runtime.projects.list()).toEqual([project])
      expect(project.trust).toBe('untrusted')
      expect(await runtime.store.listRuns()).toEqual([])
      expect((await fetch(`${server.url}/api/environment?command=install&path=.`)).status).toBe(400)
      expect(inspect).toHaveBeenCalledTimes(1)
    }
    finally { await server.close() }
  })

  it('refuses hosted inspection before any probe runs', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime({ hostEnvironment: 'hosted', dataDir: join(root, 'data'), configDir: join(root, 'config') })
    const inspect = vi.spyOn(runtime, 'localEnvironmentSnapshot')
    const server = await startCraftHubServer({ runtime, port: 0 })
    try {
      const response = await fetch(`${server.url}/api/environment`)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: 'LOCAL_ENVIRONMENT_UNAVAILABLE' })
      expect(inspect).not.toHaveBeenCalled()
      await expect(runtime.localEnvironmentSnapshot()).rejects.toThrow('hosted workbench')
    }
    finally { await server.close() }
  })
})
