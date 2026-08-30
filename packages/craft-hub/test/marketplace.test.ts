import type { MarketplaceSource, PluginManifestV1, PluginPackageInstaller } from '../src/marketplace'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogPluginV1Schema, CraftHubRuntime, PluginManager, pluginManifestV1Schema } from '../src/index'

const packageName = '@acme/craft-hub-plugin-hello'
const manifest: PluginManifestV1 = {
  schemaVersion: 1,
  id: packageName,
  displayName: 'Hello tools',
  description: 'Say hello from a declarative plugin.',
  slug: 'hello-tools',
  links: {
    documentation: 'https://docs.example.com/plugins/hello-tools',
    repository: 'https://github.com/acme/hello-tools',
    feedback: 'https://github.com/acme/hello-tools/issues',
  },
  maintainers: [{ handle: 'alice', name: 'Alice' }],
  permissionReasons: {
    'commands': 'Runs the declared hello command.',
    'read-project-files': 'Checks for package.json before contributing commands.',
  },
  localizations: {
    'zh-CN': {
      displayName: '问候工具',
      permissionReasons: {
        'commands': '运行声明的问候命令。',
        'read-project-files': '贡献命令前检查 package.json。',
      },
    },
  },
  craftHub: { minVersion: '0.0.1-alpha.0' },
  projectFiles: ['package.json'],
  permissions: ['commands', 'read-project-files'],
  contributes: {
    commands: [{ id: 'hello', name: 'Plugin hello', command: 'node', args: ['--version'], requiredEnv: [] }],
    commandPresets: [],
    commandTemplates: [],
    skills: [{ path: 'skills/hello/SKILL.md' }],
    projectTemplates: [],
  },
}

function source(): MarketplaceSource {
  return {
    id: 'test',
    name: 'Test catalog',
    kind: 'builtin',
    enabled: true,
    catalog: {
      schemaVersion: 1,
      id: 'test',
      name: 'Test catalog',
      plugins: [{
        package: packageName,
        version: '1.0.0',
        displayName: 'Hello tools',
        description: manifest.description,
        slug: manifest.slug,
        links: manifest.links,
        maintainers: manifest.maintainers,
        permissionReasons: manifest.permissionReasons,
        localizations: manifest.localizations,
        publisher: 'Acme',
        permissions: ['commands', 'read-project-files'],
        categories: ['developer-tools'],
        integrity: 'sha512-dGVzdA==',
        status: 'active',
        requires: '>=0.0.1-alpha.0',
      }],
    },
  }
}

class FixtureInstaller implements PluginPackageInstaller {
  constructor(private readonly packageManifest: PluginManifestV1 = manifest, private readonly integrity = 'sha512-dGVzdA==') {}

  async install(input: { package: string, version: string, destination: string }): Promise<{ packagePath: string, integrity: string }> {
    const packagePath = join(input.destination, 'fixture', input.version)
    await mkdir(join(packagePath, 'skills', 'hello'), { recursive: true })
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({
      name: input.package,
      version: input.version,
      craftHub: this.packageManifest,
    }))
    await writeFile(join(packagePath, 'skills', 'hello', 'SKILL.md'), [
      '---',
      'name: plugin-hello',
      'description: Say hello from a plugin.',
      '---',
      '# Hello',
    ].join('\n'))
    return { packagePath, integrity: this.integrity }
  }
}

describe('plugin marketplace contracts', () => {
  it('requires scoped ecosystem package names and declared permissions', () => {
    expect(() => pluginManifestV1Schema.parse({ ...manifest, id: 'hello-plugin' })).toThrow(/naming convention/)
    expect(() => pluginManifestV1Schema.parse({ ...manifest, permissions: ['read-project-files'] })).toThrow(/commands permission/)
    expect(pluginManifestV1Schema.parse(manifest).id).toBe(packageName)
  })

  it('preserves showcase metadata and validates status, links, and permission reasons', () => {
    const entry = source().catalog!.plugins[0]!
    expect(catalogPluginV1Schema.parse(entry)).toMatchObject({
      slug: 'hello-tools',
      links: { documentation: 'https://docs.example.com/plugins/hello-tools' },
      maintainers: [{ handle: 'alice', name: 'Alice' }],
    })
    expect(() => catalogPluginV1Schema.parse({ ...entry, status: 'deprecated', statusReason: undefined })).toThrow(/explain their status/)
    expect(() => catalogPluginV1Schema.parse({ ...entry, links: { documentation: 'http://docs.example.com' } })).toThrow(/HTTPS/)
    expect(() => catalogPluginV1Schema.parse({ ...entry, permissionReasons: { commands: 'Required', unknown: 'No' } })).toThrow(/undeclared permission/)
    expect(() => catalogPluginV1Schema.parse({ ...entry, version: 'latest' })).toThrow(/exact SemVer/)
  })

  it('rejects installation when the current Craft Hub version is outside the catalog range', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-version-'))
    const incompatibleSource = source()
    incompatibleSource.catalog!.plugins[0]!.requires = '>=1.0.0'
    const manager = new PluginManager(dataDir, [incompatibleSource], new FixtureInstaller(), fetch, '0.0.1-alpha.2')
    await expect(manager.install({ sourceId: 'test', package: packageName })).rejects.toThrow(/requires Craft Hub >=1.0.0/)
  })

  it('persists installs and hot-activates declarative capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-'))
    const projectPath = join(root, 'project')
    const dataDir = join(root, 'data')
    await mkdir(projectPath)
    await writeFile(join(projectPath, 'package.json'), '{}')
    const runtime = new CraftHubRuntime({
      dataDir,
      distribution: { id: 'test', name: 'Test', marketplaceSources: [source()] },
      pluginPackageInstaller: new FixtureInstaller(),
    })
    const project = await runtime.addProject(projectPath)

    expect((await runtime.capabilities(project.id)).some(item => item.name === 'Plugin hello')).toBe(false)
    await runtime.pluginManager.install({ sourceId: 'test', package: packageName })

    expect(await runtime.capabilities(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'command', name: 'Plugin hello', source: `plugin:${packageName}@1.0.0` }),
      expect.objectContaining({ kind: 'skill', name: 'plugin-hello', source: `plugin:${packageName}@1.0.0` }),
    ]))
    await runtime.pluginManager.setEnabled(packageName, false)
    expect((await runtime.capabilities(project.id)).some(item => item.source.startsWith('plugin:'))).toBe(false)

    const reloaded = new PluginManager(dataDir, [source()], new FixtureInstaller())
    expect(await reloaded.listInstalled()).toEqual([
      expect.objectContaining({ package: packageName, enabled: false, version: '1.0.0' }),
    ])
    expect(JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8'))).toMatchObject({ schemaVersion: 1 })
  })

  it('does not switch state when package integrity differs from the catalog', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-integrity-'))
    const manager = new PluginManager(dataDir, [source()], new FixtureInstaller(manifest, 'sha512-d3Jvbmc='))
    await expect(manager.install({ sourceId: 'test', package: packageName })).rejects.toThrow(/Integrity mismatch/)
    await expect(manager.listInstalled()).resolves.toEqual([])
  })

  it('retains the previous version and can hot-rollback', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-rollback-'))
    const rollbackSource = source()
    rollbackSource.catalog!.plugins.push({ ...rollbackSource.catalog!.plugins[0]!, version: '2.0.0' })
    const manager = new PluginManager(dataDir, [rollbackSource], new FixtureInstaller())
    await manager.install({ sourceId: 'test', package: packageName, version: '1.0.0' })
    await manager.install({ sourceId: 'test', package: packageName, version: '2.0.0' })
    await expect(manager.rollback(packageName)).resolves.toMatchObject({ version: '1.0.0', previousVersion: '2.0.0' })
  })

  it('only permits removing user-managed HTTPS sources', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-source-'))
    const fetcher = async () => new Response(JSON.stringify(source().catalog), { headers: { 'content-type': 'application/json' } })
    const manager = new PluginManager(dataDir, [source()], new FixtureInstaller(), fetcher as typeof fetch)
    await expect(manager.addSource({ name: 'Local', catalogUrl: 'http://market.example/catalog.json' })).rejects.toThrow(/HTTPS/)
    const added = await manager.addSource({ name: 'Private', catalogUrl: 'https://market.example/catalog.json' })
    await manager.removeSource(added.id)
    await expect(manager.removeSource('test')).rejects.toThrow(/cannot be removed/)
  })
})
