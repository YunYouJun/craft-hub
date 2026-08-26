import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CapabilityProvider } from './extensions'
import type { Capability, ProjectRecord } from './types'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'

const packageNamePattern = /^@[a-z0-9][a-z0-9._-]*\/(?:craft-hub-plugin-[a-z0-9][a-z0-9._-]*|plugin-[a-z0-9][a-z0-9._-]*)$/
const lifecycleScripts = new Set(['preinstall', 'install', 'postinstall'])

const safeRelativePath = z.string().min(1).refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'Path must stay inside the plugin package')
const commandContributionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
})
const skillContributionSchema = z.object({ path: safeRelativePath })

/** Validation schema for installed Craft Hub plugin manifests. */
export const pluginManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(packageNamePattern, 'Plugin id must follow the scoped Craft Hub package naming convention'),
  displayName: z.string().min(1),
  description: z.string().min(1).optional(),
  craftHub: z.object({ minVersion: z.string().min(1).optional() }).default({}),
  projectFiles: z.array(safeRelativePath).default([]),
  permissions: z.array(z.enum(['commands', 'read-project-files'])).default([]),
  contributes: z.object({
    commands: z.array(commandContributionSchema).default([]),
    skills: z.array(skillContributionSchema).default([]),
    projectTemplates: z.array(z.object({ id: z.string().min(1), path: safeRelativePath })).default([]),
  }),
}).superRefine((manifest, context) => {
  if (manifest.contributes.commands.length && !manifest.permissions.includes('commands'))
    context.addIssue({ code: 'custom', message: 'Command contributions require the commands permission', path: ['permissions'] })
  if (manifest.projectFiles.length && !manifest.permissions.includes('read-project-files'))
    context.addIssue({ code: 'custom', message: 'Project detection requires the read-project-files permission', path: ['permissions'] })
})

/** Validation schema for one catalog plugin entry. */
export const catalogPluginV1Schema = z.object({
  package: z.string().regex(packageNamePattern),
  version: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1).optional(),
  publisher: z.string().min(1),
  integrity: z.string().min(1).optional(),
  permissions: z.array(z.enum(['commands', 'read-project-files'])).default([]),
  categories: z.array(z.string()).default([]),
})

/** Validation schema for a complete plugin catalog. */
export const pluginCatalogV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  plugins: z.array(catalogPluginV1Schema),
})

/** Validated version-one plugin manifest. */
export type PluginManifestV1 = z.infer<typeof pluginManifestV1Schema>
/** Validated version-one catalog entry. */
export type CatalogPluginV1 = z.infer<typeof catalogPluginV1Schema>
/** Validated version-one plugin catalog. */
export type PluginCatalogV1 = z.infer<typeof pluginCatalogV1Schema>

/** Configured marketplace source and its latest catalog state. */
export interface MarketplaceSource {
  id: string
  name: string
  kind: 'builtin' | 'managed' | 'user'
  catalogUrl?: string
  registry?: string
  enabled: boolean
  catalog?: PluginCatalogV1
  lastRefreshedAt?: string
  error?: string
}

/** Persisted metadata for one installed plugin package. */
export interface InstalledPlugin {
  package: string
  version: string
  sourceId: string
  registry?: string
  integrity?: string
  installedAt: string
  enabled: boolean
  packagePath: string
  manifest: PluginManifestV1
  previousVersion?: string
  error?: string
}

/** Request to install one catalog package. */
export interface InstallPluginRequest {
  sourceId: string
  package: string
  version?: string
}

/** Result returned by a plugin package installer. */
export interface InstalledPackage {
  packagePath: string
  integrity?: string
}

/** Adapter seam for installing an immutable plugin package. */
export interface PluginPackageInstaller {
  install: (input: { package: string, version: string, registry?: string, destination: string }) => Promise<InstalledPackage>
}

interface MarketplaceState {
  schemaVersion: 1
  sources: MarketplaceSource[]
  installed: InstalledPlugin[]
}

/** Install npm packages without invoking package lifecycle scripts. */
export class NpmPluginPackageInstaller implements PluginPackageInstaller {
  async install(input: { package: string, version: string, registry?: string, destination: string }): Promise<InstalledPackage> {
    const staging = join(input.destination, '.staging', randomUUID())
    await mkdir(staging, { recursive: true })
    const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--package-lock=true', '--prefix', staging]
    if (input.registry)
      args.push('--registry', input.registry)
    args.push(`${input.package}@${input.version}`)
    try {
      await runProcess(spawn('npm', args, { shell: false, stdio: 'pipe' }))
      const packagePath = join(staging, 'node_modules', ...input.package.split('/'))
      const packageJson = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as Record<string, unknown>
      assertNoRuntimeInstallSurface(packageJson)
      const lock = JSON.parse(await readFile(join(staging, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { integrity?: string }> }
      const integrity = lock.packages?.[`node_modules/${input.package}`]?.integrity
      const target = join(input.destination, 'packages', encodeURIComponent(input.package), input.version)
      await mkdir(join(target, '..'), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await rename(packagePath, target)
      return { packagePath: target, integrity }
    }
    finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}

/** User-level marketplace and declarative plugin lifecycle manager. */
export class PluginManager {
  readonly capabilityProvider: CapabilityProvider
  private readonly statePath: string
  private initialized = false
  private operationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private state: MarketplaceState

  constructor(
    readonly dataDir: string,
    builtinSources: MarketplaceSource[] = [],
    private readonly installer: PluginPackageInstaller = new NpmPluginPackageInstaller(),
  ) {
    this.statePath = join(dataDir, 'plugins.json')
    this.state = { schemaVersion: 1, sources: normalizeSources(builtinSources), installed: [] }
    this.capabilityProvider = { id: 'marketplace', discover: context => this.discover(context.project) }
  }

  async initialize(): Promise<void> {
    if (this.initialized)
      return
    try {
      const persisted = JSON.parse(await readFile(this.statePath, 'utf8')) as MarketplaceState
      this.state = {
        schemaVersion: 1,
        sources: mergeManagedSources(this.state.sources, persisted.sources ?? []),
        installed: Array.isArray(persisted.installed) ? persisted.installed : [],
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    this.initialized = true
  }

  async listSources(): Promise<MarketplaceSource[]> {
    await this.initialize()
    return structuredClone(this.state.sources)
  }

  async listInstalled(): Promise<InstalledPlugin[]> {
    await this.initialize()
    return structuredClone(this.state.installed)
  }

  /** Subscribe to installed-plugin or marketplace-source changes. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async catalog(): Promise<Array<CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }>> {
    await this.initialize()
    return this.state.sources.flatMap(source => source.enabled && source.catalog
      ? source.catalog.plugins.map(plugin => ({ ...plugin, sourceId: source.id, sourceName: source.name, sourceKind: source.kind }))
      : [])
  }

  async addSource(input: { name: string, catalogUrl: string, registry?: string }): Promise<MarketplaceSource> {
    const url = new URL(input.catalogUrl)
    if (url.protocol !== 'https:')
      throw new Error('User marketplace sources must use HTTPS')
    await this.initialize()
    const source: MarketplaceSource = {
      id: `user:${createHash('sha256').update(url.href).digest('hex').slice(0, 16)}`,
      name: input.name,
      kind: 'user',
      catalogUrl: url.href,
      registry: input.registry,
      enabled: true,
    }
    if (this.state.sources.some(item => item.id === source.id))
      throw new Error(`Marketplace source already exists: ${url.href}`)
    await this.mutate(() => {
      this.state.sources.push(source)
    })
    return structuredClone(source)
  }

  async removeSource(id: string): Promise<void> {
    await this.initialize()
    const source = this.requireSource(id)
    if (source.kind !== 'user')
      throw new Error('Builtin and managed marketplace sources cannot be removed')
    if (this.state.installed.some(plugin => plugin.sourceId === id))
      throw new Error('Uninstall plugins from this source before removing it')
    await this.mutate(() => {
      this.state.sources = this.state.sources.filter(item => item.id !== id)
    })
  }

  async refreshSource(id: string): Promise<MarketplaceSource> {
    await this.initialize()
    const source = this.requireSource(id)
    if (!source.catalogUrl)
      return structuredClone(source)
    try {
      const response = await fetch(source.catalogUrl, { headers: { accept: 'application/json' } })
      if (!response.ok)
        throw new Error(`Catalog request failed: ${response.status}`)
      const catalog = pluginCatalogV1Schema.parse(await response.json())
      await this.mutate(() => Object.assign(source, { catalog, lastRefreshedAt: new Date().toISOString(), error: undefined }))
    }
    catch (error) {
      await this.mutate(() => {
        source.error = error instanceof Error ? error.message : String(error)
      })
    }
    return structuredClone(source)
  }

  async install(request: InstallPluginRequest): Promise<InstalledPlugin> {
    await this.initialize()
    const source = this.requireSource(request.sourceId)
    const catalogEntry = source.catalog?.plugins.find(item => item.package === request.package && (!request.version || item.version === request.version))
    if (!catalogEntry)
      throw new Error(`Plugin is not listed by marketplace source: ${request.package}`)
    const candidateRoot = join(this.dataDir, 'plugins', '.candidates', randomUUID())
    try {
      const installedPackage = await this.installer.install({
        package: catalogEntry.package,
        version: catalogEntry.version,
        registry: source.registry,
        destination: candidateRoot,
      })
      if (catalogEntry.integrity && installedPackage.integrity !== catalogEntry.integrity)
        throw new Error(`Integrity mismatch for ${catalogEntry.package}@${catalogEntry.version}`)
      const manifest = await readPackageManifest(installedPackage.packagePath, catalogEntry.package, catalogEntry.version)
      if (!sameStringSet(manifest.permissions, catalogEntry.permissions))
        throw new Error(`Catalog permissions do not match the package manifest for ${catalogEntry.package}`)
      const target = packageVersionPath(this.dataDir, catalogEntry.package, catalogEntry.version)
      await mkdir(join(target, '..'), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await rename(installedPackage.packagePath, target)
      const previous = this.state.installed.find(item => item.package === catalogEntry.package)
      const installed: InstalledPlugin = {
        package: catalogEntry.package,
        version: catalogEntry.version,
        sourceId: source.id,
        registry: source.registry,
        integrity: installedPackage.integrity,
        installedAt: new Date().toISOString(),
        enabled: true,
        packagePath: target,
        manifest,
        previousVersion: previous && previous.version !== catalogEntry.version ? previous.version : previous?.previousVersion,
      }
      await this.mutate(() => {
        this.state.installed = [...this.state.installed.filter(item => item.package !== installed.package), installed]
      })
      return structuredClone(installed)
    }
    finally {
      await rm(candidateRoot, { recursive: true, force: true })
    }
  }

  async setEnabled(packageName: string, enabled: boolean): Promise<InstalledPlugin> {
    await this.initialize()
    const plugin = this.requireInstalled(packageName)
    await this.mutate(() => {
      plugin.enabled = enabled
    })
    return structuredClone(plugin)
  }

  async rollback(packageName: string): Promise<InstalledPlugin> {
    await this.initialize()
    const plugin = this.requireInstalled(packageName)
    if (!plugin.previousVersion)
      throw new Error(`No rollback version is available for ${packageName}`)
    const previousPath = packageVersionPath(this.dataDir, packageName, plugin.previousVersion)
    const manifest = await readPackageManifest(previousPath, packageName, plugin.previousVersion)
    const currentVersion = plugin.version
    await this.mutate(() => {
      Object.assign(plugin, {
        version: plugin.previousVersion,
        previousVersion: currentVersion,
        packagePath: previousPath,
        manifest,
        integrity: undefined,
        error: undefined,
      })
    })
    return structuredClone(plugin)
  }

  async remove(packageName: string, deleteData = false): Promise<void> {
    await this.initialize()
    const plugin = this.requireInstalled(packageName)
    await this.mutate(() => {
      this.state.installed = this.state.installed.filter(item => item.package !== packageName)
    })
    await rm(join(this.dataDir, 'plugins', 'packages', encodeURIComponent(packageName)), { recursive: true, force: true })
    if (deleteData)
      await rm(join(this.dataDir, 'plugin-data', encodeURIComponent(packageName)), { recursive: true, force: true })
    void plugin
  }

  private async discover(project: Readonly<ProjectRecord>): Promise<Capability[]> {
    await this.initialize()
    const snapshot = this.state.installed.filter(plugin => plugin.enabled && !plugin.error)
    const capabilities: Capability[] = []
    for (const plugin of snapshot) {
      if (!(await matchesProject(plugin.manifest, project.path)))
        continue
      const source = `plugin:${plugin.package}@${plugin.version}`
      for (const command of plugin.manifest.contributes.commands) {
        capabilities.push({
          id: `plugin:${plugin.package}:command:${command.id}`,
          kind: 'command',
          name: command.name,
          description: command.description,
          source,
          invocation: { command: command.command, args: command.args, cwd: project.path, requiredEnv: command.requiredEnv },
        })
      }
      for (const skill of plugin.manifest.contributes.skills) {
        const path = safePackagePath(plugin.packagePath, skill.path)
        const content = await readFile(path, 'utf8')
        capabilities.push({
          id: `plugin:${plugin.package}:skill:${createHash('sha256').update(skill.path).digest('hex').slice(0, 12)}`,
          kind: 'skill',
          name: skillName(content, skill.path),
          source,
          path,
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
        })
      }
    }
    return capabilities
  }

  private requireSource(id: string): MarketplaceSource {
    const source = this.state.sources.find(item => item.id === id)
    if (!source)
      throw new Error(`Unknown marketplace source: ${id}`)
    return source
  }

  private requireInstalled(packageName: string): InstalledPlugin {
    const plugin = this.state.installed.find(item => item.package === packageName)
    if (!plugin)
      throw new Error(`Plugin is not installed: ${packageName}`)
    return plugin
  }

  private async mutate(operation: () => void): Promise<void> {
    const next = this.operationTail.then(async () => {
      operation()
      await mkdir(this.dataDir, { recursive: true })
      const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, this.statePath)
      for (const listener of this.listeners)
        listener()
    })
    this.operationTail = next.catch(() => {})
    return next
  }
}

function packageVersionPath(dataDir: string, packageName: string, version: string): string {
  return join(dataDir, 'plugins', 'packages', encodeURIComponent(packageName), version)
}

async function readPackageManifest(packagePath: string, expectedName: string, expectedVersion: string): Promise<PluginManifestV1> {
  const packageJson = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as Record<string, unknown>
  if (packageJson.name !== expectedName || packageJson.version !== expectedVersion)
    throw new Error(`Installed package identity does not match ${expectedName}@${expectedVersion}`)
  assertNoRuntimeInstallSurface(packageJson)
  const manifest = pluginManifestV1Schema.parse(packageJson.craftHub)
  if (manifest.id !== expectedName)
    throw new Error(`Plugin manifest id must equal its npm package name: ${expectedName}`)
  for (const skill of manifest.contributes.skills)
    await access(safePackagePath(packagePath, skill.path))
  for (const template of manifest.contributes.projectTemplates)
    await access(safePackagePath(packagePath, template.path))
  return manifest
}

function assertNoRuntimeInstallSurface(packageJson: Record<string, unknown>): void {
  for (const field of ['dependencies', 'optionalDependencies'] as const) {
    const dependencies = packageJson[field]
    if (dependencies && typeof dependencies === 'object' && Object.keys(dependencies).length)
      throw new Error(`Craft Hub declarative plugins cannot declare ${field}`)
  }
  const scripts = packageJson.scripts
  if (scripts && typeof scripts === 'object' && Object.keys(scripts).some(script => lifecycleScripts.has(script)))
    throw new Error('Craft Hub declarative plugins cannot declare npm lifecycle scripts')
}

function normalizeSources(sources: MarketplaceSource[]): MarketplaceSource[] {
  return sources.map((source) => {
    const normalized = { ...source, catalog: source.catalog ? pluginCatalogV1Schema.parse(source.catalog) : undefined }
    if (normalized.catalog && normalized.catalog.id !== normalized.id)
      throw new Error(`Catalog id must match source id: ${normalized.id}`)
    return normalized
  })
}

function mergeManagedSources(configured: MarketplaceSource[], persisted: MarketplaceSource[]): MarketplaceSource[] {
  const configuredIds = new Set(configured.map(source => source.id))
  return [...configured, ...persisted.filter(source => source.kind === 'user' && !configuredIds.has(source.id))]
}

async function matchesProject(manifest: PluginManifestV1, projectPath: string): Promise<boolean> {
  for (const file of manifest.projectFiles) {
    try {
      await access(safePackagePath(projectPath, file))
    }
    catch {
      return false
    }
  }
  return true
}

function safePackagePath(root: string, path: string): string {
  const resolved = resolve(root, path)
  const relativePath = relative(root, resolved)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error(`Path escapes its root: ${path}`)
  return resolved
}

function skillName(content: string, path: string): string {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() === '---') {
    const boundary = lines.indexOf('---', 1)
    const nameLine = lines.slice(1, boundary < 0 ? 1 : boundary).find(line => line.trimStart().startsWith('name:'))
    const name = nameLine?.slice(nameLine.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '')
    if (name)
      return name
  }
  return path.split(/[\\/]/).at(-2) || path
}

function sameStringSet(left: string[], right: string[]): boolean {
  const sortedRight = [...right].sort()
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index])
}

function runProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(stderr.trim() || `npm exited with code ${code}`)))
  })
}
