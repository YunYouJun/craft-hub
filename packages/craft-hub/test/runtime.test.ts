import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CraftHubRuntime, createCraftHub, defineCapabilityProvider, defineCraftHubPlugin, discoverCapabilities, loadCraftHubPlugins } from '../src/index'

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    packageManager: 'npm@11.0.0',
    scripts: { hello: 'node -e "console.log(\'hello\')"', hidden: 'node -e "console.log(\'hidden\')"' },
  }))
  await mkdir(join(root, '.craft-hub'), { recursive: true })
  await writeFile(join(root, '.craft-hub', 'project.yaml'), [
    'version: 1',
    'project:',
    '  name: Test Project',
    'capabilities:',
    '  hidden:',
    '    - package.json:hidden',
  ].join('\n'))
  await mkdir(join(root, '.agents', 'skills', 'release'), { recursive: true })
  await writeFile(join(root, '.agents', 'skills', 'release', 'SKILL.md'), [
    '---',
    'name: release',
    'description: Prepare a safe release.',
    '---',
    '# Release',
  ].join('\n'))
  return root
}

async function downstreamFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-downstream-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { check: 'node --version' } }))
  await mkdir(join(root, '.craft-hub'), { recursive: true })
  await writeFile(join(root, '.craft-hub', 'project.yaml'), [
    'project:',
    '  name: Downstream Project',
    'workflow:',
    '  defaultAgent: internal-agent',
  ].join('\n'))
  return root
}

describe('capability discovery', () => {
  it('discovers package scripts and project skills', async () => {
    const root = await fixture()
    const capabilities = await discoverCapabilities(root)
    expect(capabilities.map(item => [item.kind, item.name])).toEqual([
      ['command', 'hello'],
      ['skill', 'release'],
    ])
  })
})

describe('trusted execution', () => {
  it('blocks untrusted projects and captures output after trust', async () => {
    const root = await fixture()
    const runtime = new CraftHubRuntime(join(root, '.data'))
    const project = await runtime.addProject(root)
    expect(project.name).toBe('Test Project')
    const command = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!

    await expect(runtime.run(project.id, command.id)).rejects.toThrow('untrusted')

    await runtime.projects.setTrust(project.id, 'trusted')
    const handle = await runtime.run(project.id, command.id)
    const run = await handle.completion
    expect(run.status).toBe('completed')
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('hello')
  })
})

describe('downstream distributions', () => {
  it('reads known metadata from a versionless downstream config superset', async () => {
    const root = await downstreamFixture()
    const runtime = createCraftHub({ dataDir: join(root, '.data') })

    await expect(runtime.addProject(root)).resolves.toMatchObject({ name: 'Downstream Project' })
  })

  it('combines built-in discovery with validated provider capabilities', async () => {
    const root = await fixture()
    const runtime = createCraftHub({
      dataDir: join(root, '.distribution-data'),
      distribution: { id: 'test', name: 'Craft Hub Test' },
      capabilityProviders: [defineCapabilityProvider({
        id: 'test-provider',
        async discover({ project }) {
          return [{
            id: 'test:inspect',
            kind: 'command',
            name: 'inspect-test-project',
            source: 'package.json',
            invocation: { command: 'node', args: ['--version'], cwd: project.path, requiredEnv: [] },
          }]
        },
      })],
    })
    const project = await runtime.addProject(root)
    expect(runtime.distribution.name).toBe('Craft Hub Test')
    expect((await runtime.capabilities(project.id)).map(item => item.name)).toContain('inspect-test-project')
  })

  it('isolates a broken plugin while keeping healthy capabilities available', async () => {
    const root = await fixture()
    const runtime = createCraftHub({
      dataDir: join(root, '.plugin-data'),
      plugins: [defineCraftHubPlugin({
        id: 'broken-plugin',
        capabilityProviders: [{
          id: 'broken-provider',
          async discover() {
            throw new Error('plugin unavailable')
          },
        }],
      })],
    })
    const project = await runtime.addProject(root)

    expect((await runtime.capabilities(project.id)).map(item => item.name)).toContain('hello')
    expect(runtime.getPluginDiagnostics()).toEqual([{
      pluginId: 'broken-plugin',
      phase: 'discover',
      message: 'plugin unavailable',
    }])
  })

  it('loads trusted installed modules and reports invalid plugins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-plugins-'))
    await writeFile(join(root, 'valid.mjs'), `export default { id: 'local-plugin', capabilityProviders: [] }`)
    await writeFile(join(root, 'invalid.mjs'), `export default { capabilityProviders: [] }`)

    const result = await loadCraftHubPlugins(['./valid.mjs', './invalid.mjs'], { baseDir: root })

    expect(result.plugins.map(plugin => plugin.id)).toEqual(['local-plugin'])
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.pluginId).toBe('./invalid.mjs')
  })
})
