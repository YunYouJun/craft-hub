import type { MarketplaceSource, PluginManifestV1, PluginPackageInstaller } from '../src/marketplace'
import type { MarketplaceTrustPolicy } from '../src/marketplace-trust'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { catalogPluginV1Schema, CraftHubRuntime, PacotePluginPackageInstaller, PluginManager, pluginManifestV1Schema } from '../src/index'
import { resolveNpmInvocation } from '../src/marketplace'

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
  includesPlugins: [],
  requiresPlugins: [],
  projectFiles: ['package.json'],
  permissions: ['commands', 'read-project-files'],
  contributes: {
    commands: [{ id: 'hello', name: 'Plugin hello', command: 'node', args: ['--version'], requiredEnv: [] }],
    commandPresets: [],
    commandTemplates: [],
    packageQuickActions: [],
    packageLinks: [],
    packageToolGroups: [],
    skills: [{ path: 'skills/hello/SKILL.md' }],
    projectTemplates: [],
    integrations: [],
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
        includesPlugins: [],
        requiresPlugins: [],
      }],
    },
  }
}

class FixtureInstaller implements PluginPackageInstaller {
  readonly installs: string[] = []
  readonly inputs: Array<{ package: string, version: string, integrity?: string }> = []

  constructor(private readonly packageManifest: PluginManifestV1 | Record<string, PluginManifestV1> = manifest, private readonly integrity = 'sha512-dGVzdA==') {}

  async install(input: { package: string, version: string, integrity?: string, destination: string }): Promise<{ packagePath: string, integrity: string }> {
    this.installs.push(input.package)
    this.inputs.push(input)
    const packageManifest = 'schemaVersion' in this.packageManifest
      ? this.packageManifest
      : this.packageManifest[input.package]
    if (!packageManifest)
      throw new Error(`Missing fixture manifest: ${input.package}`)
    const packagePath = join(input.destination, 'fixture', input.version)
    await mkdir(join(packagePath, 'skills', 'hello'), { recursive: true })
    await writeFile(join(packagePath, 'package.json'), JSON.stringify({
      name: input.package,
      version: input.version,
      craftHub: packageManifest,
    }))
    await writeFile(join(packagePath, 'skills', 'hello', 'SKILL.md'), [
      '---',
      'name: plugin-hello',
      'description: Say hello from a plugin.',
      '---',
      '# Hello',
    ].join('\n'))
    await mkdir(join(packagePath, 'docs'), { recursive: true })
    await writeFile(join(packagePath, 'README.md'), '# Fixture plugin\n\n[Guide](docs/guide.md)')
    await writeFile(join(packagePath, 'docs', 'guide.md'), '# Guide')
    await writeFile(join(packagePath, 'docs', 'preview.png'), Buffer.from([137, 80, 78, 71]))
    return { packagePath, integrity: this.integrity }
  }
}

async function writeLocalPlugin(packagePath: string, version: string, displayName: string): Promise<void> {
  const localManifest: PluginManifestV1 = {
    ...manifest,
    displayName,
    contributes: {
      ...manifest.contributes,
      commands: [{ id: 'hello', name: `${displayName} command`, command: 'node', args: ['--version'], requiredEnv: [] }],
      skills: [],
    },
  }
  await mkdir(packagePath, { recursive: true })
  await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: packageName, version, craftHub: localManifest }))
}

describe('plugin marketplace contracts', () => {
  it('previews and caches exact-version plugin documents without installing the plugin', async () => {
    const installer = new FixtureInstaller()
    const manager = new PluginManager(await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-document-')), [source()], installer)

    await expect(manager.pluginDocument({ sourceId: 'test', package: packageName, version: '1.0.0' })).resolves.toMatchObject({
      package: packageName,
      version: '1.0.0',
      document: { status: 'found', path: 'README.md', content: expect.stringContaining('Fixture plugin') },
    })
    await expect(manager.pluginDocument({ sourceId: 'test', package: packageName, version: '1.0.0', path: 'docs/guide.md' })).resolves.toMatchObject({
      document: { status: 'found', path: 'docs/guide.md', content: '# Guide' },
    })
    await expect(manager.pluginDocumentAsset({ sourceId: 'test', package: packageName, version: '1.0.0', path: 'docs/preview.png' })).resolves.toMatchObject({ contentType: 'image/png' })
    await expect(manager.listInstalled()).resolves.toEqual([])
    expect(installer.installs).toEqual([packageName])
  })

  it('extracts an integrity-pinned registry package without invoking npm', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'craft-hub-pacote-installer-'))
    const integrity = 'sha512-dGVzdA=='
    const extract = vi.fn(async (_spec: string, packagePath: string) => {
      await mkdir(packagePath, { recursive: true })
      await writeFile(join(packagePath, 'package.json'), JSON.stringify({ name: packageName, version: '1.0.0' }))
      return { from: `${packageName}@1.0.0`, resolved: 'https://registry.example/package.tgz', integrity }
    })
    const installer = new PacotePluginPackageInstaller(extract)

    const installed = await installer.install({
      package: packageName,
      version: '1.0.0',
      registry: 'https://registry.example/',
      integrity,
      destination,
    })

    expect(extract).toHaveBeenCalledWith(`${packageName}@1.0.0`, expect.any(String), expect.objectContaining({
      allowDirectory: 'none',
      allowFile: 'none',
      allowGit: 'none',
      allowRegistry: 'all',
      allowRemote: 'none',
      integrity,
      registry: 'https://registry.example/',
    }))
    expect(installed).toEqual({
      packagePath: join(destination, 'packages', encodeURIComponent(packageName), '1.0.0'),
      integrity,
    })
  })

  it('locates npm outside the restricted PATH inherited by a desktop app', () => {
    const desktopEnv = { HOME: process.env.HOME, PATH: '/usr/bin:/bin' }
    expect(spawnSync('npm', ['--version'], { env: desktopEnv }).error).toMatchObject({ code: 'ENOENT' })

    const invocation = resolveNpmInvocation(desktopEnv)
    const result = spawnSync(invocation.command, [...invocation.args, '--version'], { env: desktopEnv, encoding: 'utf8' })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('resolves package-relative catalog icons against their managed source', async () => {
    const remoteSource = source()
    remoteSource.kind = 'managed'
    remoteSource.catalogUrl = 'https://market.example/.well-known/craft-hub/plugins/v1/catalog.json'
    remoteSource.catalog!.plugins[0]!.icon = 'assets/hello-tools.svg'
    const manager = new PluginManager(await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-icons-')), [remoteSource], new FixtureInstaller())

    await expect(manager.catalog()).resolves.toEqual([
      expect.objectContaining({
        icon: 'https://market.example/.well-known/craft-hub/plugins/v1/assets/hello-tools.svg',
        package: packageName,
      }),
    ])
  })

  it('requires scoped ecosystem package names and declared permissions', () => {
    expect(() => pluginManifestV1Schema.parse({ ...manifest, id: 'hello-plugin' })).toThrow(/naming convention/)
    expect(() => pluginManifestV1Schema.parse({ ...manifest, permissions: ['read-project-files'] })).toThrow(/commands permission/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        integrations: [{
          id: 'example',
          provider: { id: 'example', requires: '^1.0.0' },
          actions: [{ id: 'search', title: 'Search', operation: 'work-items.search', effect: 'remote-read', confirmation: 'never' }],
          views: [],
        }],
      },
    })).toThrow(/remote-read permission/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      permissions: ['commands'],
      contributes: {
        ...manifest.contributes,
        packageQuickActions: [{
          id: 'widget-actions',
          package: { allFiles: ['widget.config.ts'] },
          capabilities: ['widget-assistant'],
        }],
      },
    })).toThrow(/read-project-files permission/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      permissions: ['commands'],
      contributes: {
        ...manifest.contributes,
        packageLinks: [{
          id: 'widget-console',
          title: 'Widget console',
          package: { allFiles: ['widget.config.ts'] },
          urlTemplate: 'https://widgets.example.com/console/{value}',
          value: { files: ['widget.config.ts'], key: 'appId' },
        }],
      },
    })).toThrow(/read-project-files permission/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        packageLinks: [{
          id: 'widget-console',
          title: 'Widget console',
          package: { allFiles: ['widget.config.ts'] },
          urlTemplate: 'http://widgets.example.com/console/{value}',
          value: { files: ['widget.config.ts'], key: 'appId' },
        }],
      },
    })).toThrow(/credential-free HTTPS/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      contributes: {
        ...manifest.contributes,
        commandPresets: [{
          id: 'deploy-inputs',
          commands: ['deploy'],
          package: { allFiles: ['package.json'] },
          inputs: { account: { type: 'select', flag: '--account', options: ['default'] } },
          optionSources: { account: { type: 'user-setting', key: 'extensions.example.accounts' } },
        }],
      },
    })).toThrow(/read-user-settings permission/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      permissions: ['commands', 'command-presets'],
      contributes: {
        ...manifest.contributes,
        commandPresets: [{
          id: 'deploy-inputs',
          commands: ['deploy'],
          package: { allFiles: ['package.json'] },
          inputs: { entry: { type: 'select', flag: '--entry', options: ['default'] } },
          optionSources: { entry: { type: 'package-json-array', files: ['app.json'], path: ['pages'] } },
        }],
      },
    })).toThrow(/read-project-files permission/)
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

  it('validates plugin dependency declarations', () => {
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      requiresPlugins: [{ package: packageName, version: '^1.0.0' }],
    })).toThrow(/reference itself/)
    expect(() => catalogPluginV1Schema.parse({
      ...source().catalog!.plugins[0]!,
      includesPlugins: [
        { package: '@acme/craft-hub-plugin-dependency', version: '^1.0.0' },
        { package: '@acme/craft-hub-plugin-dependency', version: '^2.0.0' },
      ],
    })).toThrow(/more than once/)
    expect(() => pluginManifestV1Schema.parse({
      ...manifest,
      includesPlugins: [{ package: '@acme/craft-hub-plugin-dependency', version: '^1.0.0' }],
      requiresPlugins: [{ package: '@acme/craft-hub-plugin-dependency', version: '^1.0.0' }],
    })).toThrow(/both included and required/)
  })

  it('plans and installs an extension pack dependency-first with one request', async () => {
    const dependencyPackage = '@acme/craft-hub-plugin-dependency'
    const suitePackage = '@acme/craft-hub-plugin-suite'
    const dependencyManifest = pluginManifestV1Schema.parse({
      schemaVersion: 1,
      id: dependencyPackage,
      displayName: 'Dependency',
      permissions: ['remote-read'],
      permissionReasons: { 'remote-read': 'Reads dependency data.' },
      contributes: { commands: [], commandPresets: [], commandTemplates: [], skills: [], projectTemplates: [], integrations: [] },
    })
    const suiteManifest = pluginManifestV1Schema.parse({
      schemaVersion: 1,
      id: suitePackage,
      displayName: 'Suite',
      includesPlugins: [{ package: dependencyPackage, version: '^1.0.0' }],
      contributes: { commands: [], commandPresets: [], commandTemplates: [], skills: [], projectTemplates: [], integrations: [] },
    })
    const bundleSource: MarketplaceSource = {
      id: 'bundle',
      name: 'Bundle catalog',
      kind: 'managed',
      enabled: true,
      catalog: {
        schemaVersion: 1,
        id: 'bundle',
        name: 'Bundle catalog',
        plugins: [
          catalogPluginV1Schema.parse({
            package: dependencyPackage,
            version: '1.2.0',
            displayName: 'Dependency',
            publisher: 'Acme',
            integrity: 'sha512-dGVzdA==',
            permissions: dependencyManifest.permissions,
            permissionReasons: dependencyManifest.permissionReasons,
          }),
          catalogPluginV1Schema.parse({
            package: suitePackage,
            version: '1.0.0',
            displayName: 'Suite',
            publisher: 'Acme',
            integrity: 'sha512-dGVzdA==',
            includesPlugins: suiteManifest.includesPlugins,
          }),
        ],
      },
    }
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-bundle-'))
    const installer = new FixtureInstaller({
      [dependencyPackage]: dependencyManifest,
      [suitePackage]: suiteManifest,
    })
    const manager = new PluginManager(dataDir, [bundleSource], installer)

    await expect(manager.planInstall({ sourceId: 'bundle', package: suitePackage })).resolves.toEqual({
      sourceId: 'bundle',
      rootPackage: suitePackage,
      permissions: ['remote-read'],
      items: [
        expect.objectContaining({ package: dependencyPackage, version: '1.2.0', action: 'install', root: false }),
        expect.objectContaining({ package: suitePackage, version: '1.0.0', action: 'install', root: true }),
      ],
    })
    await manager.install({ sourceId: 'bundle', package: suitePackage })

    expect(installer.installs).toEqual([dependencyPackage, suitePackage])
    expect(installer.inputs.every(input => input.integrity === 'sha512-dGVzdA==')).toBe(true)
    await expect(manager.listInstalled()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ package: dependencyPackage, enabled: true }),
      expect.objectContaining({ package: suitePackage, enabled: true }),
    ]))

    await manager.setEnabled(dependencyPackage, false)
    await expect(manager.planInstall({ sourceId: 'bundle', package: suitePackage })).resolves.toMatchObject({
      items: [
        { package: dependencyPackage, action: 'enable' },
        { package: suitePackage, action: 'none' },
      ],
    })
    await manager.install({ sourceId: 'bundle', package: suitePackage })
    expect(installer.installs).toEqual([dependencyPackage, suitePackage])
    await expect(manager.listInstalled()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ package: dependencyPackage, enabled: true }),
    ]))

    await manager.remove(suitePackage)
    await expect(manager.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: dependencyPackage, enabled: true }),
    ])
  })

  it('rejects dependency cycles before downloading packages', async () => {
    const firstPackage = '@acme/craft-hub-plugin-first'
    const secondPackage = '@acme/craft-hub-plugin-second'
    const cycleSource: MarketplaceSource = {
      id: 'cycle',
      name: 'Cycle catalog',
      kind: 'managed',
      enabled: true,
      catalog: {
        schemaVersion: 1,
        id: 'cycle',
        name: 'Cycle catalog',
        plugins: [
          catalogPluginV1Schema.parse({
            package: firstPackage,
            version: '1.0.0',
            displayName: 'First',
            publisher: 'Acme',
            integrity: 'sha512-dGVzdA==',
            requiresPlugins: [{ package: secondPackage, version: '^1.0.0' }],
          }),
          catalogPluginV1Schema.parse({
            package: secondPackage,
            version: '1.0.0',
            displayName: 'Second',
            publisher: 'Acme',
            integrity: 'sha512-dGVzdA==',
            requiresPlugins: [{ package: firstPackage, version: '^1.0.0' }],
          }),
        ],
      },
    }
    const installer = new FixtureInstaller()
    const manager = new PluginManager(await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-cycle-')), [cycleSource], installer)

    await expect(manager.planInstall({ sourceId: 'cycle', package: firstPackage })).rejects.toThrow(/dependency cycle/)
    expect(installer.installs).toEqual([])
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

  it('loads persistent local plugins as an override and restores the marketplace version when unlinked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-local-plugin-'))
    const dataDir = join(root, 'data')
    const localPath = join(root, 'local-plugin')
    await writeLocalPlugin(localPath, '2.0.0', 'Local hello')
    const manager = new PluginManager(dataDir, [source()], new FixtureInstaller())
    await manager.install({ sourceId: 'test', package: packageName })

    await expect(manager.linkLocal(localPath)).resolves.toMatchObject({
      package: packageName,
      version: '2.0.0',
      sourceId: 'local',
      origin: 'local',
    })
    await expect(manager.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: packageName, version: '2.0.0', origin: 'local' }),
    ])
    await manager.setEnabled(packageName, false)
    await expect(manager.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: packageName, version: '2.0.0', origin: 'local', enabled: false }),
    ])
    await manager.setEnabled(packageName, true)

    const reloaded = new PluginManager(dataDir, [source()], new FixtureInstaller())
    await expect(reloaded.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: packageName, version: '2.0.0', origin: 'local' }),
    ])
    await writeLocalPlugin(localPath, '2.1.0', 'Refreshed local hello')
    await expect(reloaded.refreshLocal(packageName)).resolves.toMatchObject({
      version: '2.1.0',
      manifest: { displayName: 'Refreshed local hello' },
    })

    await reloaded.unlinkLocal(packageName)
    await expect(reloaded.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: packageName, version: '1.0.0', sourceId: 'test' }),
    ])
  })

  it('keeps a broken linked plugin visible but inactive until its local manifest is repaired', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-local-plugin-error-'))
    const localPath = join(root, 'local-plugin')
    const manager = new PluginManager(join(root, 'data'))
    await writeLocalPlugin(localPath, '2.0.0', 'Local hello')
    await manager.linkLocal(localPath)
    await writeFile(join(localPath, 'package.json'), '{ invalid')

    await expect(manager.listInstalled()).resolves.toEqual([
      expect.objectContaining({ package: packageName, origin: 'local', error: expect.any(String) }),
    ])
    await expect(manager.commandContributions()).resolves.toEqual([])

    await writeLocalPlugin(localPath, '2.0.1', 'Repaired local hello')
    const repaired = await manager.refreshLocal(packageName)
    expect(repaired).toMatchObject({ version: '2.0.1' })
    expect(repaired.error).toBeUndefined()
  })

  it('migrates persisted plugin manifest defaults before resolving command presets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-migration-'))
    const projectPath = join(root, 'project')
    const dataDir = join(root, 'data')
    await mkdir(projectPath)
    await mkdir(dataDir)
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { deploy: 'widget deploy' } }))

    const normalizedManifest = pluginManifestV1Schema.parse({
      schemaVersion: 1,
      id: packageName,
      displayName: 'Legacy deploy tools',
      permissions: ['command-presets'],
      contributes: {
        commands: [],
        commandPresets: [{
          id: 'deploy-inputs',
          commands: ['deploy'],
          package: { allFiles: ['package.json'] },
          inputs: { environment: { type: 'select', flag: '--env', options: ['test', 'production'] } },
        }],
        commandTemplates: [],
        skills: [],
        projectTemplates: [],
      },
    })
    const legacyManifest = structuredClone(normalizedManifest)
    Reflect.deleteProperty(legacyManifest.contributes.commandPresets[0]!, 'optionSources')
    Reflect.deleteProperty(legacyManifest.contributes, 'packageQuickActions')
    Reflect.deleteProperty(legacyManifest.contributes, 'packageLinks')
    Reflect.deleteProperty(legacyManifest.contributes, 'packageToolGroups')
    Reflect.deleteProperty(legacyManifest.contributes, 'integrations')
    await writeFile(join(dataDir, 'plugins.json'), `${JSON.stringify({
      schemaVersion: 1,
      sources: [],
      installed: [{
        package: packageName,
        version: '1.0.0',
        sourceId: 'test',
        installedAt: '2026-01-01T00:00:00.000Z',
        enabled: true,
        packagePath: join(dataDir, 'plugins', 'packages', encodeURIComponent(packageName), '1.0.0'),
        manifest: legacyManifest,
      }],
    }, null, 2)}\n`)

    const runtime = new CraftHubRuntime({
      dataDir,
      distribution: { id: 'test', name: 'Test', marketplaceSources: [source()] },
    })
    const project = await runtime.addProject(projectPath)

    await expect(runtime.capabilityDiscovery(project.id)).resolves.toMatchObject({
      capabilities: [expect.objectContaining({
        name: 'deploy',
        inputs: [expect.objectContaining({ id: 'environment', options: [{ value: 'test' }, { value: 'production' }] })],
      })],
    })
    await expect(runtime.pluginManager.listInstalled()).resolves.toEqual([
      expect.objectContaining({
        manifest: expect.objectContaining({
          contributes: expect.objectContaining({
            commandPresets: [expect.objectContaining({ optionSources: {} })],
            integrations: [],
            packageLinks: [],
            packageToolGroups: [],
            packageQuickActions: [],
          }),
        }),
      }),
    ])
    expect(JSON.parse(await readFile(join(dataDir, 'plugins.json'), 'utf8')))
      .toMatchObject({ installed: [{ manifest: { contributes: { commandPresets: [{ optionSources: {} }] } } }] })
    await runtime.close()
  })

  it('quarantines incompatible persisted manifests and repairs them by reinstalling', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-incompatible-state-'))
    await writeFile(join(dataDir, 'plugins.json'), `${JSON.stringify({
      schemaVersion: 1,
      sources: [],
      installed: [{
        package: packageName,
        version: '1.0.0',
        sourceId: 'test',
        installedAt: '2026-01-01T00:00:00.000Z',
        enabled: true,
        packagePath: join(dataDir, 'plugins', 'packages', encodeURIComponent(packageName), '1.0.0'),
        manifest: { schemaVersion: 1, id: packageName },
      }],
    }, null, 2)}\n`)
    const manager = new PluginManager(dataDir, [source()], new FixtureInstaller())

    await expect(manager.listInstalled()).resolves.toEqual([
      expect.objectContaining({ enabled: false, error: expect.stringContaining('manifest is incompatible') }),
    ])
    await expect(manager.planInstall({ sourceId: 'test', package: packageName })).resolves.toMatchObject({
      items: [{ package: packageName, action: 'install' }],
    })
    const repaired = await manager.install({ sourceId: 'test', package: packageName })
    expect(repaired).toMatchObject({
      enabled: true,
      manifest: { id: packageName },
    })
    expect(repaired).not.toHaveProperty('error')
  })

  it('returns active declarative integrations without executing their package', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-integrations-'))
    const integrationManifest = pluginManifestV1Schema.parse({
      ...manifest,
      permissions: [...manifest.permissions, 'remote-read'],
      permissionReasons: { ...manifest.permissionReasons, 'remote-read': 'Reads remote work items.' },
      contributes: {
        ...manifest.contributes,
        integrations: [{
          id: 'example',
          provider: { id: 'example', requires: '^1.0.0' },
          actions: [{ id: 'search', title: 'Search', operation: 'work-items.search', effect: 'remote-read', confirmation: 'never' }],
          views: [],
        }],
      },
    })
    const integrationSource = source()
    Object.assign(integrationSource.catalog!.plugins[0]!, {
      permissions: integrationManifest.permissions,
      permissionReasons: integrationManifest.permissionReasons,
    })
    const manager = new PluginManager(dataDir, [integrationSource], new FixtureInstaller(integrationManifest))

    await manager.install({ sourceId: 'test', package: packageName })
    await expect(manager.integrationContributions()).resolves.toEqual([
      expect.objectContaining({ id: 'example', pluginId: packageName, provider: { id: 'example', requires: '^1.0.0' } }),
    ])
    await manager.setEnabled(packageName, false)
    await expect(manager.integrationContributions()).resolves.toEqual([])
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

  it('plans and applies safe plugin updates while preserving rollback', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-update-'))
    const updateSource = source()
    updateSource.catalog!.plugins.push({ ...updateSource.catalog!.plugins[0]!, version: '1.1.0' })
    const manager = new PluginManager(dataDir, [updateSource], new FixtureInstaller())
    await manager.install({ sourceId: 'test', package: packageName, version: '1.0.0' })

    await expect(manager.planUpdates()).resolves.toEqual([{
      package: packageName,
      sourceId: 'test',
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      automatic: true,
    }])
    await expect(manager.updateAll()).resolves.toMatchObject({
      failures: [],
      skipped: [],
      updated: [{ package: packageName, version: '1.1.0', previousVersion: '1.0.0' }],
    })
  })

  it('does not automatically approve plugin permission expansion', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-update-permissions-'))
    const updateSource = source()
    updateSource.catalog!.plugins.push({
      ...updateSource.catalog!.plugins[0]!,
      version: '1.1.0',
      permissions: [...updateSource.catalog!.plugins[0]!.permissions, 'remote-read'],
      permissionReasons: {
        ...updateSource.catalog!.plugins[0]!.permissionReasons,
        'remote-read': 'Reads remote data.',
      },
    })
    const manager = new PluginManager(dataDir, [updateSource], new FixtureInstaller())
    await manager.install({ sourceId: 'test', package: packageName, version: '1.0.0' })

    await expect(manager.planUpdates()).resolves.toEqual([{
      package: packageName,
      sourceId: 'test',
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      automatic: false,
    }])
    await expect(manager.updateAll()).resolves.toMatchObject({
      failures: [],
      skipped: [{ package: packageName, targetVersion: '1.1.0' }],
      updated: [],
    })
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

  it('verifies a user-imported Catalog against a host-provisioned trust policy', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-trusted-source-'))
    const catalogUrl = 'https://market.example/catalog.json'
    const catalogBytes = Buffer.from(JSON.stringify(source().catalog))
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const policy: MarketplaceTrustPolicy = {
      id: 'market-2026',
      organization: 'Example Enterprise',
      catalogUrl,
      algorithm: 'ed25519',
      publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    }
    const catalogSignature = sign(null, catalogBytes, privateKey).toString('base64url')
    const fetcher = async (input: string | URL | Request) => String(input).endsWith('.sig')
      ? new Response(JSON.stringify({ schemaVersion: 1, keyId: policy.id, signature: catalogSignature }), { headers: { 'content-type': 'application/json' } })
      : new Response(catalogBytes, { headers: { 'content-type': 'application/json' } })
    const manager = new PluginManager(dataDir, [], new FixtureInstaller(), fetcher as typeof fetch, undefined, [policy])

    await expect(manager.previewSource({ catalogUrl })).resolves.toMatchObject({
      verification: { policyId: policy.id, organization: policy.organization },
    })
    const added = await manager.addSource({ name: 'Imported catalog', catalogUrl })
    expect(added).toMatchObject({
      kind: 'user',
      verification: { policyId: policy.id, organization: policy.organization },
    })
    const trustedReload = new PluginManager(dataDir, [], new FixtureInstaller(), fetcher as typeof fetch, undefined, [policy])
    await expect(trustedReload.listSources()).resolves.toEqual([expect.objectContaining({ verification: expect.objectContaining({ policyId: policy.id }) })])
    const revokedReload = new PluginManager(dataDir, [], new FixtureInstaller(), fetcher as typeof fetch)
    await expect(revokedReload.listSources()).resolves.toEqual([expect.not.objectContaining({ verification: expect.anything() })])
    await expect(revokedReload.removeSource(added.id)).resolves.toBeUndefined()
  })

  it('fails closed when a URL-pinned trusted Catalog is unsigned or tampered with', async () => {
    const catalogUrl = 'https://market.example/catalog.json'
    const { publicKey } = generateKeyPairSync('ed25519')
    const policy: MarketplaceTrustPolicy = {
      id: 'market-2026',
      organization: 'Example Enterprise',
      catalogUrl,
      algorithm: 'ed25519',
      publicKeySpki: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    }
    const unsignedFetcher = async (input: string | URL | Request) => String(input).endsWith('.sig')
      ? new Response('Not found', { status: 404 })
      : new Response(JSON.stringify(source().catalog), { headers: { 'content-type': 'application/json' } })
    const manager = new PluginManager(await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-unsigned-source-')), [], new FixtureInstaller(), unsignedFetcher as typeof fetch, undefined, [policy])

    await expect(manager.previewSource({ catalogUrl })).rejects.toThrow(/signature request failed: 404/)

    const tamperedFetcher = async (input: string | URL | Request) => String(input).endsWith('.sig')
      ? new Response(JSON.stringify({ schemaVersion: 1, keyId: policy.id, signature: Buffer.alloc(64).toString('base64url') }), { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify(source().catalog), { headers: { 'content-type': 'application/json' } })
    const tamperedManager = new PluginManager(await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-tampered-source-')), [], new FixtureInstaller(), tamperedFetcher as typeof fetch, undefined, [policy])
    await expect(tamperedManager.previewSource({ catalogUrl })).rejects.toThrow(/signature is invalid/)
  })

  it('lets a distribution-managed source replace a previously imported user source for the same Catalog', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-marketplace-managed-source-'))
    const catalogUrl = 'https://market.example/catalog.json'
    const fetcher = async () => new Response(JSON.stringify(source().catalog), { headers: { 'content-type': 'application/json' } })
    const userManager = new PluginManager(dataDir, [], new FixtureInstaller(), fetcher as typeof fetch)
    await userManager.addSource({ name: 'Imported catalog', catalogUrl })

    const managedSource: MarketplaceSource = {
      ...source(),
      kind: 'managed',
      catalogUrl,
    }
    const managedManager = new PluginManager(dataDir, [managedSource], new FixtureInstaller(), fetcher as typeof fetch)

    await expect(managedManager.listSources()).resolves.toEqual([managedSource])
  })
})
