import type { ChildProcess } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { HostExtensionManager } from '../src/host-extensions'
import { CraftHubRuntime } from '../src/runtime'

const roots: string[] = []
const children: ChildProcess[] = []
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null)
      return
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
    })
  }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'craft-local-host-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const configDir = join(root, 'config')
  const projectPath = join(root, 'project')
  const pluginPath = join(root, 'plugin')
  await Promise.all([mkdir(projectPath), mkdir(pluginPath)])
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { hello: 'node --version' } }))
  const marker = join(root, 'host-loaded')
  const modulePath = join(root, 'host.mjs')
  await writeFile(modulePath, `
    import { writeFileSync } from 'node:fs'
    writeFileSync(${JSON.stringify(marker)}, 'loaded')
    export default {
      id: 'acme',
      integrationProviders: [{ id: 'example', apiVersion: '1.0.0', connectionStatus: async () => ({ connected: true }) }],
    }
  `)
  const manager = new HostExtensionManager(dataDir)
  const extension = manager.prepare({ id: 'acme', name: 'Acme', manifestPath: join(root, 'distribution.json'), modules: ['./host.mjs'] })
  await manager.install(extension)
  await writeFile(join(pluginPath, 'package.json'), JSON.stringify({
    name: '@acme/craft-hub-plugin-example',
    version: '1.0.0',
    craftHub: {
      schemaVersion: 1,
      id: '@acme/craft-hub-plugin-example',
      displayName: 'Example',
      permissions: ['remote-read'],
      contributes: {
        integrations: [{
          id: 'example',
          provider: { id: 'example', requires: '^1.0.0' },
          actions: [{ id: 'status', title: 'Status', operation: 'connection.status', effect: 'remote-read' }],
          views: [],
        }],
      },
    },
  }))
  const runtime = new CraftHubRuntime({ dataDir, configDir })
  await runtime.pluginManager.linkLocal(pluginPath)
  const project = await runtime.addProject(projectPath)
  return { root, dataDir, configDir, projectPath, marker, modulePath, manager, project }
}

async function start(f: Awaited<ReturnType<typeof fixture>>, args: string[]): Promise<string> {
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cliPath, ...args], {
    cwd: f.root,
    env: { ...process.env, CRAFT_HUB_DATA_DIR: f.dataDir, CRAFT_HUB_CONFIG_DIR: f.configDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`CLI did not start: ${output}`)), 10_000)
    child.stderr?.on('data', chunk => output += String(chunk))
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
      const url = output.match(/Craft Hub is ready at (http:\/\/\S+)/)?.[1]
      if (url) {
        clearTimeout(timeout)
        resolve(url)
      }
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`CLI exited with ${code}: ${output}`))
    })
  })
}

describe('local workbench host startup', () => {
  it.each(['ui', 'app'])('restores installed providers through %s without changing project trust', async (command) => {
    const f = await fixture()
    const args = command === 'ui' ? ['ui', '--port', '0'] : ['app', f.projectPath, '--no-open']
    const url = await start(f, args)
    const diagnostics = await fetch(new URL('/api/diagnostics', url)).then(response => response.json())
    expect(diagnostics.summary).toEqual({ errors: 0, warnings: 0 })
    const health = await fetch(new URL('/api/health', url)).then(response => response.json())
    expect(health.distribution).toMatchObject({ id: 'community', name: 'Craft Hub' })
    const integrations = await fetch(new URL('/api/integrations', url)).then(response => response.json())
    expect(integrations.integrations).toEqual([expect.objectContaining({ id: 'example', providerVersion: '1.0.0' })])
    const status = await fetch(new URL('/api/integrations/example/actions/status', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmed: true }),
    }).then(response => response.json())
    expect(status).toMatchObject({ connected: true })
    await expect(access(f.marker)).resolves.toBeUndefined()
    const catalog = await fetch(new URL('/api/projects', url)).then(response => response.json())
    expect(catalog.projects).toEqual([expect.objectContaining({ id: f.project.id, trust: 'untrusted' })])
    const discovery = await fetch(new URL(`/api/projects/${f.project.id}/capability-discovery`, url)).then(response => response.json())
    const commandCapability = discovery.capabilities.find((item: { kind: string }) => item.kind === 'command')
    expect(commandCapability).toBeDefined()
    const execution = await fetch(new URL(`/api/projects/${f.project.id}/run`, url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capabilityId: commandCapability.id }),
    }).then(response => response.json())
    expect(execution.error).toMatch(/untrusted/)
  })

  it('does not load the same saved module twice when explicitly selected', async () => {
    const f = await fixture()
    const before = await readFile(f.manager.path, 'utf8')
    const url = await start(f, ['ui', '--port', '0', '--host-plugin', './host.mjs'])
    const diagnostics = await fetch(new URL('/api/diagnostics', url)).then(response => response.json())
    expect(diagnostics.diagnostics).toEqual([])
    expect(await readFile(f.manager.path, 'utf8')).toBe(before)
  })

  it.each(['disabled', 'removed', 'missing'])('preserves diagnostics for an unavailable %s extension', async (state) => {
    const f = await fixture()
    if (state === 'disabled')
      await f.manager.setEnabled('acme', false)
    else if (state === 'removed')
      await f.manager.remove('acme')
    else
      await rm(f.modulePath)
    const url = await start(f, ['ui', '--port', '0'])
    const diagnostics = await fetch(new URL('/api/diagnostics', url)).then(response => response.json())
    expect(diagnostics.diagnostics).toContainEqual(expect.objectContaining({
      kind: 'integration',
      message: 'Integration provider is not available: example',
    }))
    expect(diagnostics.diagnostics.filter((item: { kind: string }) => item.kind === 'host-plugin')).toHaveLength(state === 'missing' ? 1 : 0)
    await expect(access(f.marker)).rejects.toThrow()
  })

  it('keeps CLI help and capability discovery free of saved host imports', async () => {
    const f = await fixture()
    for (const args of [['--help'], ['list', f.project.id]]) {
      const result = await execFileAsync(process.execPath, ['--import', import.meta.resolve('tsx'), cliPath, ...args], {
        cwd: f.root,
        env: { ...process.env, CRAFT_HUB_DATA_DIR: f.dataDir, CRAFT_HUB_CONFIG_DIR: f.configDir },
      })
      expect(result.stdout).toContain(args[0] === '--help' ? 'Usage:' : 'hello')
    }
    await expect(access(f.marker)).rejects.toThrow()
  })
})
