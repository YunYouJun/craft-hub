import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PluginCommandContributions } from './command-contributions'
import type { CapabilityProvider } from './extensions'
import type { InstalledIntegrationContribution } from './integrations'
import type { MarketplaceSourceVerification, MarketplaceTrustPolicy } from './marketplace-trust'
import type { InstalledNavigationPanel } from './navigation-contributions'
import type { InstalledSkillContribution } from './skill-activation'
import type { Capability, ProjectReadme, ProjectRecord } from './types'
import type { InstalledPluginWorkbench } from './workbench-contributions'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { access, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import pacote from 'pacote'
import { gt, maxSatisfying, satisfies, valid, validRange } from 'semver'
import { z } from 'zod'
import { commandPresetContributionSchema, commandTemplateContributionSchema, packageLinkContributionSchema, packageQuickActionContributionSchema, packageToolGroupContributionSchema } from './command-contributions'
import { integrationContributionSchema } from './integrations'
import { MarketplaceCatalogTrust } from './marketplace-trust'
import { localizeNavigationPanel, navigationPanelContributionSchema } from './navigation-contributions'
import { readPackageDocument, readPackageDocumentAsset } from './project-overview'
import { skillActivationConditionSchema } from './skill-activation'
import { craftHubVersion } from './version'
import { localizeWorkbench, workbenchContributionSchema } from './workbench-contributions'

const packageNamePattern = /^@[a-z0-9][a-z0-9._-]*\/(?:craft-hub-plugin-[a-z0-9][a-z0-9._-]*|plugin-[a-z0-9][a-z0-9._-]*)$/
const lifecycleScripts = new Set(['preinstall', 'install', 'postinstall'])
const catalogResponseLimit = 1024 * 1024
const catalogRedirectLimit = 5
const catalogTimeoutMs = 10_000
const pluginDocumentTimeoutMs = 15_000

const safeRelativePath = z.string().min(1).refine(value => !isAbsolute(value) && !value.split(/[\\/]/).includes('..'), 'Path must stay inside the plugin package')
const secureHttpsUrlSchema = z.string().min(1).refine(isSecureHttpsUrl, 'URL must use HTTPS and must not contain credentials')
const pluginPermissionSchema = z.enum(['command-presets', 'commands', 'read-project-files', 'read-user-settings', 'remote-read', 'remote-write'])
const permissionReasonsSchema = z.record(z.string(), z.string().min(1))
const pluginLinksV1Schema = z.object({
  documentation: secureHttpsUrlSchema.optional(),
  repository: secureHttpsUrlSchema.optional(),
  feedback: secureHttpsUrlSchema.optional(),
  homepage: secureHttpsUrlSchema.optional(),
})
const pluginMaintainerV1Schema = z.object({
  handle: z.string().regex(/^[a-z][\w.-]*$/i).optional(),
  name: z.string().min(1).optional(),
  url: secureHttpsUrlSchema.optional(),
}).refine(maintainer => maintainer.handle || maintainer.url, 'Maintainer must declare a handle or HTTPS profile URL')
const pluginLocalizationV1Schema = z.object({
  displayName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  permissionReasons: permissionReasonsSchema.optional(),
})
const marketplaceMetadataShape = {
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  links: pluginLinksV1Schema.optional(),
  icon: z.union([secureHttpsUrlSchema, safeRelativePath]).optional(),
  maintainers: z.array(pluginMaintainerV1Schema).optional(),
  permissionReasons: permissionReasonsSchema.optional(),
  localizations: z.record(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/), pluginLocalizationV1Schema).optional(),
}
const commandContributionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  requiredEnv: z.array(z.string()).default([]),
})
const skillContributionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/).optional(),
  path: safeRelativePath,
  activation: skillActivationConditionSchema.optional(),
}).transform(skill => ({
  ...skill,
  // Schema v1 originally identified skills by path. Preserve those manifests
  // with an order-independent ID that is stable across reloads and upgrades.
  id: skill.id ?? createHash('sha256').update(skill.path).digest('hex').slice(0, 12),
}))
const pluginDependencyV1Schema = z.object({
  package: z.string().regex(packageNamePattern),
  version: z.string().refine(value => validRange(value) !== null, 'Plugin dependency must use a valid SemVer range'),
})

/** Validation schema for installed Craft Hub plugin manifests. */
export const pluginManifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(packageNamePattern, 'Plugin id must follow the scoped Craft Hub package naming convention'),
  displayName: z.string().min(1),
  description: z.string().min(1).optional(),
  ...marketplaceMetadataShape,
  craftHub: z.object({
    minVersion: z.string().refine(value => valid(value) !== null, 'Craft Hub minimum version must be valid SemVer').optional(),
  }).default({}),
  includesPlugins: z.array(pluginDependencyV1Schema).default([]),
  requiresPlugins: z.array(pluginDependencyV1Schema).default([]),
  projectFiles: z.array(safeRelativePath).default([]),
  permissions: z.array(pluginPermissionSchema).default([]),
  contributes: z.object({
    commands: z.array(commandContributionSchema).default([]),
    commandPresets: z.array(commandPresetContributionSchema).default([]),
    commandTemplates: z.array(commandTemplateContributionSchema).default([]),
    packageQuickActions: z.array(packageQuickActionContributionSchema).default([]),
    packageLinks: z.array(packageLinkContributionSchema).default([]),
    packageToolGroups: z.array(packageToolGroupContributionSchema).default([]),
    navigationPanels: z.array(navigationPanelContributionSchema).default([]),
    workbenches: z.array(workbenchContributionSchema).default([]),
    skills: z.array(skillContributionSchema).default([]),
    projectTemplates: z.array(z.object({ id: z.string().min(1), path: safeRelativePath })).default([]),
    integrations: z.array(integrationContributionSchema).default([]),
  }),
}).superRefine((manifest, context) => {
  const navigationPanelIds = new Set<string>()
  for (const [index, panel] of manifest.contributes.navigationPanels.entries()) {
    if (navigationPanelIds.has(panel.id))
      context.addIssue({ code: 'custom', message: `Navigation panel id must be unique: ${panel.id}`, path: ['contributes', 'navigationPanels', index, 'id'] })
    navigationPanelIds.add(panel.id)
  }
  const relatedPluginIds = new Set([
    manifest.id,
    ...manifest.includesPlugins.map(plugin => plugin.package),
    ...manifest.requiresPlugins.map(plugin => plugin.package),
  ])
  const workbenchIds = new Set<string>()
  for (const [workbenchIndex, workbench] of manifest.contributes.workbenches.entries()) {
    if (workbenchIds.has(workbench.id))
      context.addIssue({ code: 'custom', message: `Workbench id must be unique: ${workbench.id}`, path: ['contributes', 'workbenches', workbenchIndex, 'id'] })
    workbenchIds.add(workbench.id)
    for (const [viewIndex, view] of workbench.views.entries()) {
      if (!relatedPluginIds.has(view.plugin)) {
        context.addIssue({
          code: 'custom',
          message: `Workbench view must reference this plugin or one of its included or required plugins: ${view.plugin}`,
          path: ['contributes', 'workbenches', workbenchIndex, 'views', viewIndex, 'plugin'],
        })
        continue
      }
      if (view.plugin !== manifest.id)
        continue
      const targetExists = view.type === 'integration'
        ? manifest.contributes.integrations.some(integration => integration.id === view.integration && integration.views.some(candidate => candidate.id === view.view))
        : manifest.contributes.navigationPanels.some(panel => panel.id === view.panel)
      if (!targetExists) {
        context.addIssue({
          code: 'custom',
          message: `Workbench references an unknown local ${view.type} view`,
          path: ['contributes', 'workbenches', workbenchIndex, 'views', viewIndex],
        })
      }
    }
  }
  const skillIds = new Set<string>()
  for (const [index, skill] of manifest.contributes.skills.entries()) {
    if (skillIds.has(skill.id))
      context.addIssue({ code: 'custom', message: `Skill contribution id must be unique: ${skill.id}`, path: ['contributes', 'skills', index, 'id'] })
    skillIds.add(skill.id)
  }
  validatePluginDependencies(manifest.id, manifest.includesPlugins, 'includesPlugins', context)
  validatePluginDependencies(manifest.id, manifest.requiresPlugins, 'requiresPlugins', context)
  validateDistinctPluginRelations(manifest.includesPlugins, manifest.requiresPlugins, context)
  if (manifest.contributes.commands.length && !manifest.permissions.includes('commands'))
    context.addIssue({ code: 'custom', message: 'Command contributions require the commands permission', path: ['permissions'] })
  if ((manifest.contributes.commandPresets.length || manifest.contributes.commandTemplates.length) && !manifest.permissions.includes('command-presets'))
    context.addIssue({ code: 'custom', message: 'Command presets and templates require the command-presets permission', path: ['permissions'] })
  if (manifest.contributes.commandPresets.some(preset => Object.values(preset.optionSources).some(source => source.type === 'user-setting')) && !manifest.permissions.includes('read-user-settings'))
    context.addIssue({ code: 'custom', message: 'User-setting option sources require the read-user-settings permission', path: ['permissions'] })
  if (manifest.contributes.commandPresets.some(preset => Object.values(preset.optionSources).some(source => source.type === 'package-json-array')) && !manifest.permissions.includes('read-project-files'))
    context.addIssue({ code: 'custom', message: 'Package JSON option sources require the read-project-files permission', path: ['permissions'] })
  if ((manifest.contributes.packageQuickActions.length || manifest.contributes.packageLinks.length || manifest.contributes.packageToolGroups.length) && !manifest.permissions.includes('read-project-files'))
    context.addIssue({ code: 'custom', message: 'Package quick actions, links, and tool groups require the read-project-files permission', path: ['permissions'] })
  const toolGroupIds = new Set(manifest.contributes.packageToolGroups.map(group => group.id))
  for (const [index, template] of manifest.contributes.commandTemplates.entries()) {
    if (template.toolGroup && !toolGroupIds.has(template.toolGroup))
      context.addIssue({ code: 'custom', message: `Command template references unknown tool group: ${template.toolGroup}`, path: ['contributes', 'commandTemplates', index, 'toolGroup'] })
  }
  for (const [index, link] of manifest.contributes.packageLinks.entries()) {
    if (link.toolGroup && !toolGroupIds.has(link.toolGroup))
      context.addIssue({ code: 'custom', message: `Package link references unknown tool group: ${link.toolGroup}`, path: ['contributes', 'packageLinks', index, 'toolGroup'] })
  }
  if (manifest.projectFiles.length && !manifest.permissions.includes('read-project-files'))
    context.addIssue({ code: 'custom', message: 'Project detection requires the read-project-files permission', path: ['permissions'] })
  if (manifest.contributes.skills.some(skill => skill.activation) && !manifest.permissions.includes('read-project-files'))
    context.addIssue({ code: 'custom', message: 'Skill activation requires the read-project-files permission', path: ['permissions'] })
  for (const [index, integration] of manifest.contributes.integrations.entries()) {
    if (integration.actions.some(action => action.effect === 'remote-read') && !manifest.permissions.includes('remote-read'))
      context.addIssue({ code: 'custom', message: 'Remote read integration actions require the remote-read permission', path: ['contributes', 'integrations', index] })
    if (integration.actions.some(action => action.effect === 'remote-write') && !manifest.permissions.includes('remote-write'))
      context.addIssue({ code: 'custom', message: 'Remote write integration actions require the remote-write permission', path: ['contributes', 'integrations', index] })
  }
  for (const issue of permissionMetadataIssues(manifest))
    context.addIssue({ code: 'custom', ...issue })
})

/** Validation schema for one catalog plugin entry. */
export const catalogPluginV1Schema = z.object({
  package: z.string().regex(packageNamePattern),
  version: z.string().refine(value => valid(value) !== null, 'Plugin version must be exact SemVer'),
  displayName: z.string().min(1),
  description: z.string().min(1).optional(),
  ...marketplaceMetadataShape,
  publisher: z.string().min(1),
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/, 'Catalog integrity must be an SHA-512 SRI value'),
  permissions: z.array(pluginPermissionSchema).default([]),
  categories: z.array(z.string()).default([]),
  status: z.enum(['active', 'deprecated', 'blocked']).default('active'),
  statusReason: z.string().min(1).optional(),
  replacement: z.string().regex(packageNamePattern).optional(),
  requires: z.string().refine(value => validRange(value) !== null, 'Craft Hub requirement must be a valid SemVer range').optional(),
  includesPlugins: z.array(pluginDependencyV1Schema).default([]),
  requiresPlugins: z.array(pluginDependencyV1Schema).default([]),
}).superRefine((plugin, context) => {
  validatePluginDependencies(plugin.package, plugin.includesPlugins, 'includesPlugins', context)
  validatePluginDependencies(plugin.package, plugin.requiresPlugins, 'requiresPlugins', context)
  validateDistinctPluginRelations(plugin.includesPlugins, plugin.requiresPlugins, context)
  for (const issue of permissionMetadataIssues(plugin))
    context.addIssue({ code: 'custom', ...issue })
  if (plugin.status !== 'active' && !plugin.statusReason)
    context.addIssue({ code: 'custom', message: `${plugin.status} plugins must explain their status`, path: ['statusReason'] })
  if (plugin.replacement === plugin.package)
    context.addIssue({ code: 'custom', message: 'Replacement plugin must use a different package name', path: ['replacement'] })
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
/** One same-source dependency declared by a Craft Hub plugin. */
export type PluginDependencyV1 = z.infer<typeof pluginDependencyV1Schema>
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
  verification?: MarketplaceSourceVerification
  error?: string
}

/** Validated source metadata shown before a user explicitly imports it. */
export interface MarketplaceSourcePreview {
  name: string
  catalogUrl: string
  finalCatalogUrl: string
  registry?: string
  catalog: PluginCatalogV1
  verification?: MarketplaceSourceVerification
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
  origin?: 'marketplace' | 'local'
  previousVersion?: string
  error?: string
}

/** A plugin loaded directly from a local package directory. */
export interface LocalPlugin extends InstalledPlugin {
  sourceId: 'local'
  origin: 'local'
  linkedAt: string
}

/** A marketplace installation or a local package currently managed by Craft Hub. */
export type ManagedPlugin = InstalledPlugin | LocalPlugin

/** Safely rendered source document for one exact plugin package version. */
export interface PluginDocumentPreview {
  package: string
  version: string
  sourceId: string
  origin: 'marketplace' | 'local'
  manifest: PluginManifestV1
  document: ProjectReadme
}

/** Request to install one catalog package. */
export interface InstallPluginRequest {
  sourceId: string
  package: string
  version?: string
}

/** One dependency-first action shown before a plugin bundle is installed. */
export interface PluginInstallPlanItem {
  package: string
  version: string
  displayName: string
  sourceId: string
  permissions: PluginManifestV1['permissions']
  action: 'install' | 'enable' | 'none'
  root: boolean
}

/** Complete, deterministic installation plan for a root plugin and its dependencies. */
export interface PluginInstallPlan {
  sourceId: string
  rootPackage: string
  items: PluginInstallPlanItem[]
  permissions: PluginManifestV1['permissions']
}

/** One newer Catalog version available for an installed plugin. */
export interface PluginUpdatePlanItem {
  package: string
  sourceId: string
  currentVersion: string
  targetVersion: string
  /** Whether the update keeps the existing installed dependency and permission boundary. */
  automatic: boolean
}

/** Result of checking and applying safe plugin updates. */
export interface PluginUpdateResult {
  updated: InstalledPlugin[]
  skipped: PluginUpdatePlanItem[]
  failures: Array<PluginUpdatePlanItem & { error: string }>
}

/** Result returned by a plugin package installer. */
export interface InstalledPackage {
  packagePath: string
  integrity?: string
}

/** Adapter seam for installing an immutable plugin package. */
export interface PluginPackageInstaller {
  install: (input: { package: string, version: string, registry?: string, integrity?: string, destination: string, signal?: AbortSignal }) => Promise<InstalledPackage>
}

interface MarketplaceState {
  schemaVersion: 1
  sources: MarketplaceSource[]
  installed: InstalledPlugin[]
  linked: LocalPlugin[]
}

interface RestrictedPacoteOptions {
  _isRoot: true
  allowDirectory: 'none'
  allowFile: 'none'
  allowGit: 'none'
  allowRegistry: 'all'
  allowRemote: 'none'
  integrity: string
  registry?: string
  signal?: AbortSignal
}

interface PacoteExtractResult {
  integrity: string | { toString: () => string }
}

type PacoteExtract = (spec: string, destination: string, options: RestrictedPacoteOptions) => Promise<PacoteExtractResult>

/** Fetch and extract an integrity-pinned registry package without requiring an external package manager. */
export class PacotePluginPackageInstaller implements PluginPackageInstaller {
  constructor(private readonly extract: PacoteExtract = pacote.extract as PacoteExtract) {}

  async install(input: { package: string, version: string, registry?: string, integrity?: string, destination: string, signal?: AbortSignal }): Promise<InstalledPackage> {
    if (!input.integrity)
      throw new Error(`Catalog integrity is required for ${input.package}@${input.version}`)
    const staging = join(input.destination, '.staging', randomUUID())
    const packagePath = join(staging, 'package')
    await mkdir(packagePath, { recursive: true })
    try {
      const result = await this.extract(`${input.package}@${input.version}`, packagePath, {
        _isRoot: true,
        allowDirectory: 'none',
        allowFile: 'none',
        allowGit: 'none',
        allowRegistry: 'all',
        allowRemote: 'none',
        integrity: input.integrity,
        registry: input.registry,
        signal: input.signal,
      })
      const packageJson = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as Record<string, unknown>
      assertNoRuntimeInstallSurface(packageJson)
      const target = join(input.destination, 'packages', encodeURIComponent(input.package), input.version)
      await mkdir(join(target, '..'), { recursive: true })
      await rm(target, { recursive: true, force: true })
      await rename(packagePath, target)
      return { packagePath: target, integrity: String(result.integrity) }
    }
    finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
}

/** Install npm packages without invoking package lifecycle scripts. */
export class NpmPluginPackageInstaller implements PluginPackageInstaller {
  async install(input: { package: string, version: string, registry?: string, integrity?: string, destination: string, signal?: AbortSignal }): Promise<InstalledPackage> {
    const staging = join(input.destination, '.staging', randomUUID())
    await mkdir(staging, { recursive: true })
    const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev', '--package-lock=true', '--prefix', staging]
    if (input.registry)
      args.push('--registry', input.registry)
    args.push(`${input.package}@${input.version}`)
    try {
      const npm = resolveNpmInvocation()
      await runProcess(spawn(npm.command, [...npm.args, ...args], { shell: false, signal: input.signal, stdio: 'pipe' }))
      const packagePath = join(staging, 'node_modules', ...input.package.split('/'))
      const packageJson = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as Record<string, unknown>
      assertNoRuntimeInstallSurface(packageJson)
      const lock = JSON.parse(await readFile(join(staging, 'package-lock.json'), 'utf8')) as { packages?: Record<string, { integrity?: string }> }
      const lockKey = Object.keys(lock.packages ?? {}).find((key) => {
        const portableKey = key.replaceAll('\\', '/')
        return portableKey === `node_modules/${input.package}` || portableKey.endsWith(`/node_modules/${input.package}`)
      })
      const integrity = lockKey ? lock.packages?.[lockKey]?.integrity : undefined
      if (!integrity)
        throw new Error(`npm did not record package integrity for ${input.package}@${input.version}`)
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

export interface NpmInvocation {
  command: string
  args: string[]
}

/** Resolve npm through common Node installations even when a desktop host inherits a restricted PATH. */
export function resolveNpmInvocation(env: NodeJS.ProcessEnv = process.env): NpmInvocation {
  const home = env.HOME ?? env.USERPROFILE
  const executableName = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const npmCandidates = [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory, executableName)),
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), executableName),
    home ? join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin', executableName) : undefined,
    home ? join(home, '.volta', 'bin', executableName) : undefined,
    home ? join(home, '.nvm', 'current', 'bin', executableName) : undefined,
    home ? join(home, '.asdf', 'shims', executableName) : undefined,
    process.platform === 'darwin' ? '/opt/homebrew/bin/npm' : undefined,
    process.platform === 'win32' ? undefined : '/usr/local/bin/npm',
    env.npm_execpath,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const npmCandidate of npmCandidates) {
    if (!existsSync(npmCandidate))
      continue
    const npmCli = realpathSync(npmCandidate)
    if (!npmCli.endsWith('npm-cli.js'))
      continue
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    const nodeCandidates = [join(dirname(npmCandidate), nodeName), process.execPath]
    const node = nodeCandidates.find(candidate => existsSync(candidate) && /^node(?:\.exe)?$/i.test(candidate.split(/[\\/]/).at(-1) ?? ''))
    if (node)
      return { command: node, args: [npmCli] }
  }

  throw new Error('Cannot locate npm. Install Node.js with npm included, then restart Craft Hub.')
}

/** User-level marketplace and declarative plugin lifecycle manager. */
export class PluginManager {
  readonly capabilityProvider: CapabilityProvider
  private readonly statePath: string
  private readonly catalogTrust: MarketplaceCatalogTrust
  private initialized = false
  private operationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private readonly documentPackageRequests = new Map<string, Promise<{ packagePath: string, manifest: PluginManifestV1 }>>()
  private shadowedUserSources: MarketplaceSource[] = []
  private state: MarketplaceState

  constructor(
    readonly dataDir: string,
    builtinSources: MarketplaceSource[] = [],
    private readonly installer: PluginPackageInstaller = new PacotePluginPackageInstaller(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly applicationVersion = craftHubVersion,
    trustPolicies: MarketplaceTrustPolicy[] = [],
  ) {
    this.statePath = join(dataDir, 'plugins.json')
    this.catalogTrust = new MarketplaceCatalogTrust(trustPolicies, fetcher)
    this.state = {
      schemaVersion: 1,
      sources: normalizeSources(builtinSources).map(source => this.catalogTrust.retains(source.catalogUrl, source.verification)
        ? source
        : withoutVerification(source)),
      installed: [],
      linked: [],
    }
    this.capabilityProvider = { id: 'marketplace', discover: context => this.discover(context.project) }
  }

  async initialize(): Promise<void> {
    if (this.initialized)
      return
    let migrated = false
    try {
      const persisted = JSON.parse(await readFile(this.statePath, 'utf8')) as MarketplaceState
      const persistedSources = persisted.sources ?? []
      const sources = mergeManagedSources(this.state.sources, persistedSources)
      const activeSourceIds = new Set(sources.map(source => source.id))
      this.shadowedUserSources = persistedSources.filter(source => source.kind === 'user' && !activeSourceIds.has(source.id))
      const installed = Array.isArray(persisted.installed)
        ? persisted.installed.map((plugin) => {
            const result = pluginManifestV1Schema.safeParse(plugin.manifest)
            if (result.success) {
              const normalized = { ...plugin, manifest: result.data }
              if (plugin.error !== undefined) {
                migrated = true
                delete normalized.error
              }
              if (JSON.stringify(result.data) !== JSON.stringify(plugin.manifest))
                migrated = true
              return normalized
            }
            migrated = true
            const issue = result.error.issues[0]
            const location = issue?.path.length ? ` at ${issue.path.join('.')}` : ''
            return {
              ...plugin,
              enabled: false,
              error: `Installed plugin manifest is incompatible${location}: ${issue?.message ?? 'validation failed'}. Reinstall the plugin to repair it.`,
            }
          })
        : []
      const linked = Array.isArray(persisted.linked)
        ? persisted.linked.filter(plugin => plugin && typeof plugin === 'object').map(plugin => ({ ...plugin, sourceId: 'local' as const, origin: 'local' as const }))
        : []
      this.state = {
        schemaVersion: 1,
        sources: sources.map(source => this.catalogTrust.retains(source.catalogUrl, source.verification)
          ? source
          : withoutVerification(source)),
        installed,
        linked,
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    this.initialized = true
    if (migrated)
      await this.persistState()
  }

  async listSources(): Promise<MarketplaceSource[]> {
    await this.initialize()
    return structuredClone(this.state.sources)
  }

  async listInstalled(): Promise<ManagedPlugin[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return structuredClone(this.activePluginSnapshot())
  }

  /** Load a declarative plugin directly from a local package directory. */
  async linkLocal(packagePath: string): Promise<LocalPlugin> {
    await this.initialize()
    const linked = await this.readLocalPlugin(packagePath)
    const existing = this.state.linked.find(plugin => plugin.package === linked.package || plugin.packagePath === linked.packagePath)
    if (existing) {
      linked.linkedAt = existing.linkedAt
      linked.installedAt = existing.installedAt
      linked.enabled = existing.enabled
    }
    await this.mutate(() => {
      this.state.linked = [...this.state.linked.filter(plugin => plugin.package !== linked.package && plugin.packagePath !== linked.packagePath), linked]
    })
    return structuredClone(linked)
  }

  /** Re-read one linked plugin from disk so manifest edits take effect immediately. */
  async refreshLocal(packageName: string): Promise<LocalPlugin> {
    await this.initialize()
    const linked = this.requireLocal(packageName)
    await this.refreshLocalPlugins(packageName, true)
    return structuredClone(this.requireLocal(linked.package))
  }

  /** Stop loading a local plugin. A same-name marketplace installation becomes active again. */
  async unlinkLocal(packageName: string): Promise<void> {
    await this.initialize()
    this.requireLocal(packageName)
    await this.mutate(() => {
      this.state.linked = this.state.linked.filter(plugin => plugin.package !== packageName)
    })
  }

  /** Subscribe to installed-plugin or marketplace-source changes. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async catalog(): Promise<Array<CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }>> {
    await this.initialize()
    return this.state.sources.flatMap(source => source.enabled && source.catalog
      ? source.catalog.plugins.map((plugin) => {
          const icon = resolveCatalogIcon(plugin.icon, source.catalogUrl)
          return {
            ...plugin,
            ...(icon ? { icon } : {}),
            sourceId: source.id,
            sourceName: source.name,
            sourceKind: source.kind,
          }
        })
      : [])
  }

  /** Read a bounded Markdown document from one exact marketplace or local plugin package. */
  async pluginDocument(request: { sourceId: string, package: string, version?: string, path?: string }): Promise<PluginDocumentPreview> {
    const resolved = await this.resolvePluginDocumentPackage(request)
    return {
      package: request.package,
      version: resolved.version,
      sourceId: request.sourceId,
      origin: request.sourceId === 'local' ? 'local' : 'marketplace',
      manifest: structuredClone(resolved.manifest),
      document: await readPackageDocument(resolved.packagePath, request.path),
    }
  }

  /** Read a bounded raster asset from one exact marketplace or local plugin package. */
  async pluginDocumentAsset(request: { sourceId: string, package: string, version?: string, path: string }): Promise<{ content: Buffer, contentType: string } | undefined> {
    const resolved = await this.resolvePluginDocumentPackage(request)
    return readPackageDocumentAsset(resolved.packagePath, request.path)
  }

  async addSource(input: { name: string, catalogUrl: string, registry?: string }): Promise<MarketplaceSource> {
    const preview = await this.previewSource(input)
    await this.initialize()
    const source: MarketplaceSource = {
      id: `user:${createHash('sha256').update(preview.catalogUrl).digest('hex').slice(0, 16)}`,
      name: preview.name,
      kind: 'user',
      catalogUrl: preview.catalogUrl,
      registry: preview.registry,
      enabled: true,
      catalog: preview.catalog,
      verification: preview.verification,
      lastRefreshedAt: new Date().toISOString(),
    }
    if (this.state.sources.some(item => item.id === source.id))
      throw new Error(`Marketplace source already exists: ${preview.catalogUrl}`)
    await this.mutate(() => {
      this.state.sources.push(source)
      this.shadowedUserSources = this.shadowedUserSources.filter(item => item.id !== source.id)
    })
    return structuredClone(source)
  }

  /** Fetch and validate a marketplace source without changing persisted state. */
  async previewSource(input: { name?: string, catalogUrl: string, registry?: string }): Promise<MarketplaceSourcePreview> {
    const catalogUrl = secureHttpsUrl(input.catalogUrl, 'Marketplace catalog')
    const registry = input.registry ? secureHttpsUrl(input.registry, 'Plugin registry').href : undefined
    const { catalog, finalUrl, verification } = await fetchCatalog(this.fetcher, catalogUrl, this.catalogTrust)
    return {
      name: input.name?.trim() || catalog.name,
      catalogUrl: catalogUrl.href,
      finalCatalogUrl: finalUrl,
      registry,
      catalog,
      verification,
    }
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
      this.shadowedUserSources = this.shadowedUserSources.filter(item => item.id !== id)
    })
  }

  async refreshSource(id: string): Promise<MarketplaceSource> {
    await this.initialize()
    const source = this.requireSource(id)
    if (!source.catalogUrl)
      return structuredClone(source)
    try {
      const { catalog, verification } = await fetchCatalog(this.fetcher, secureHttpsUrl(source.catalogUrl, 'Marketplace catalog'), this.catalogTrust)
      await this.mutate(() => Object.assign(source, { catalog, verification, lastRefreshedAt: new Date().toISOString(), error: undefined }))
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
    const plan = await this.planInstall(request)
    const source = this.requireSource(request.sourceId)
    const candidateRoot = join(this.dataDir, 'plugins', '.candidates', randomUUID())
    try {
      const prepared = new Map<string, { entry: CatalogPluginV1, installedPackage: InstalledPackage, manifest: PluginManifestV1 }>()
      for (const item of plan.items) {
        if (item.action !== 'install')
          continue
        const entry = this.requireCatalogEntry(source, item.package, item.version)
        const installedPackage = await this.installer.install({
          package: entry.package,
          version: entry.version,
          registry: source.registry,
          integrity: entry.integrity,
          destination: join(candidateRoot, encodeURIComponent(entry.package), entry.version),
        })
        const manifest = await this.validateInstalledPackage(entry, installedPackage)
        prepared.set(entry.package, { entry, installedPackage, manifest })
      }

      const nextInstalled = new Map(this.state.installed.map(plugin => [plugin.package, structuredClone(plugin)]))
      for (const item of plan.items) {
        const previous = nextInstalled.get(item.package)
        if (item.action === 'enable') {
          if (previous)
            previous.enabled = true
          continue
        }
        if (item.action !== 'install')
          continue
        const candidate = prepared.get(item.package)!
        const target = packageVersionPath(this.dataDir, item.package, item.version)
        await mkdir(join(target, '..'), { recursive: true })
        await rm(target, { recursive: true, force: true })
        await rename(candidate.installedPackage.packagePath, target)
        nextInstalled.set(item.package, {
          package: item.package,
          version: item.version,
          sourceId: source.id,
          registry: source.registry,
          integrity: candidate.installedPackage.integrity,
          installedAt: new Date().toISOString(),
          enabled: true,
          packagePath: target,
          manifest: candidate.manifest,
          previousVersion: previous && previous.version !== item.version ? previous.version : previous?.previousVersion,
        })
      }

      await this.mutate(() => {
        this.state.installed = [...nextInstalled.values()]
      })
      return structuredClone(this.requireInstalled(request.package))
    }
    finally {
      await rm(candidateRoot, { recursive: true, force: true })
    }
  }

  /** Resolve a root plugin and all same-source plugin dependencies without changing state. */
  async planInstall(request: InstallPluginRequest): Promise<PluginInstallPlan> {
    await this.initialize()
    const source = this.requireSource(request.sourceId)
    const ordered: CatalogPluginV1[] = []
    const selected = new Map<string, CatalogPluginV1>()
    const visiting: string[] = []

    const visit = (packageName: string, range?: string, exactVersion?: string): void => {
      const cycleIndex = visiting.indexOf(packageName)
      if (cycleIndex >= 0)
        throw new Error(`Plugin dependency cycle: ${[...visiting.slice(cycleIndex), packageName].join(' -> ')}`)
      const existingSelection = selected.get(packageName)
      if (existingSelection) {
        if ((exactVersion && existingSelection.version !== exactVersion) || (range && !satisfies(existingSelection.version, range, { includePrerelease: true })))
          throw new Error(`Plugin dependency constraints conflict for ${packageName}`)
        return
      }

      const entry = this.selectCatalogEntry(source, packageName, range, exactVersion)
      this.assertCatalogEntryInstallable(entry)
      selected.set(packageName, entry)
      visiting.push(packageName)
      for (const dependency of [...entry.requiresPlugins, ...entry.includesPlugins])
        visit(dependency.package, dependency.version)
      visiting.pop()
      ordered.push(entry)
    }

    visit(request.package, undefined, request.version)
    const items = ordered.map((entry): PluginInstallPlanItem => {
      const installed = this.state.installed.find(plugin => plugin.package === entry.package)
      const action = installed?.sourceId === source.id && installed.version === entry.version
        ? installed.error ? 'install' : installed.enabled ? 'none' : 'enable'
        : 'install'
      return {
        package: entry.package,
        version: entry.version,
        displayName: entry.displayName,
        sourceId: source.id,
        permissions: structuredClone(entry.permissions),
        action,
        root: entry.package === request.package,
      }
    })
    return {
      sourceId: source.id,
      rootPackage: request.package,
      items,
      permissions: [...new Set(items.flatMap(item => item.permissions))],
    }
  }

  /** Find the newest compatible Catalog version for every enabled installed plugin. */
  async planUpdates(): Promise<PluginUpdatePlanItem[]> {
    await this.initialize()
    const updates: PluginUpdatePlanItem[] = []
    for (const installed of this.state.installed) {
      if (!installed.enabled || installed.error)
        continue
      const source = this.state.sources.find(item => item.id === installed.sourceId && item.enabled)
      if (!source)
        continue
      const targetVersion = maxSatisfying(
        (source.catalog?.plugins ?? [])
          .filter(entry => entry.package === installed.package && entry.status === 'active' && gt(entry.version, installed.version))
          .filter(entry => !entry.requires || satisfies(this.applicationVersion, entry.requires, { includePrerelease: true }))
          .map(entry => entry.version),
        '*',
        { includePrerelease: true },
      )
      if (!targetVersion)
        continue
      const plan = await this.planInstall({ sourceId: source.id, package: installed.package, version: targetVersion })
      const automatic = plan.items.every((item) => {
        const current = this.state.installed.find(plugin => plugin.package === item.package)
        return current?.sourceId === source.id && sameStringSet(current.manifest.permissions, item.permissions)
      })
      updates.push({
        package: installed.package,
        sourceId: source.id,
        currentVersion: installed.version,
        targetVersion,
        automatic,
      })
    }
    return updates
  }

  /** Refresh installed plugins' sources and apply updates that need no new permission approval. */
  async updateAll(options: { refreshSources?: boolean } = {}): Promise<PluginUpdateResult> {
    await this.initialize()
    if (options.refreshSources) {
      const sourceIds = new Set(this.state.installed.map(plugin => plugin.sourceId))
      await Promise.all([...sourceIds].map(async (sourceId) => {
        const source = this.state.sources.find(item => item.id === sourceId)
        if (source?.enabled && source.catalogUrl)
          await this.refreshSource(sourceId)
      }))
    }
    const plan = await this.planUpdates()
    const result: PluginUpdateResult = { updated: [], skipped: [], failures: [] }
    for (const update of plan) {
      if (!update.automatic) {
        result.skipped.push(update)
        continue
      }
      try {
        result.updated.push(await this.install({
          sourceId: update.sourceId,
          package: update.package,
          version: update.targetVersion,
        }))
      }
      catch (error) {
        result.failures.push({ ...update, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  async setEnabled(packageName: string, enabled: boolean): Promise<ManagedPlugin> {
    await this.initialize()
    const plugin = this.state.linked.find(item => item.package === packageName) ?? this.requireInstalled(packageName)
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

  /** Return active declarative command contributions without executing plugin code. */
  async commandContributions(): Promise<PluginCommandContributions[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return this.activePluginSnapshot()
      .filter(plugin => this.pluginActive(plugin))
      .filter(plugin => plugin.manifest.contributes.commandPresets.length || plugin.manifest.contributes.commandTemplates.length || plugin.manifest.contributes.packageQuickActions.length || plugin.manifest.contributes.packageLinks.length || plugin.manifest.contributes.packageToolGroups.length)
      .map(plugin => ({
        pluginId: plugin.package,
        source: `plugin:${plugin.package}@${plugin.version}`,
        presets: structuredClone(plugin.manifest.contributes.commandPresets),
        templates: structuredClone(plugin.manifest.contributes.commandTemplates),
        packageQuickActions: structuredClone(plugin.manifest.contributes.packageQuickActions),
        packageLinks: structuredClone(plugin.manifest.contributes.packageLinks),
        packageToolGroups: structuredClone(plugin.manifest.contributes.packageToolGroups),
      }))
  }

  /** Return active data-only Skill declarations for project-level activation. */
  async skillContributions(): Promise<InstalledSkillContribution[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return this.activePluginSnapshot()
      .filter(plugin => this.pluginActive(plugin))
      .flatMap(plugin => plugin.manifest.contributes.skills.map(skill => ({
        pluginId: plugin.package,
        version: plugin.version,
        source: `plugin:${plugin.package}@${plugin.version}`,
        packagePath: plugin.packagePath,
        projectFiles: [...plugin.manifest.projectFiles],
        skill: structuredClone(skill),
      })))
  }

  /** Return active declarative integrations without executing plugin code. */
  async integrationContributions(): Promise<InstalledIntegrationContribution[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return this.activePluginSnapshot()
      .filter(plugin => this.pluginActive(plugin))
      .flatMap(plugin => plugin.manifest.contributes.integrations.map(integration => ({
        ...structuredClone(integration),
        pluginId: plugin.package,
        source: `plugin:${plugin.package}@${plugin.version}`,
      })))
  }

  /** Return localized, project-independent navigation panels from active declarative plugins. */
  async navigationPanels(locale: string): Promise<InstalledNavigationPanel[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return this.activePluginSnapshot()
      .filter(plugin => this.pluginActive(plugin))
      .flatMap(plugin => plugin.manifest.contributes.navigationPanels.map(panel => ({
        ...localizeNavigationPanel(panel, locale),
        pluginId: plugin.package,
        pluginName: plugin.manifest.localizations?.[locale]?.displayName ?? plugin.manifest.displayName,
        pluginVersion: plugin.version,
      })))
  }

  /** Return localized product workbenches contributed by active declarative plugins. */
  async workbenches(locale: string): Promise<InstalledPluginWorkbench[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    return this.activePluginSnapshot()
      .filter(plugin => this.pluginActive(plugin))
      .flatMap(plugin => plugin.manifest.contributes.workbenches.map(workbench => ({
        ...localizeWorkbench(workbench, locale),
        pluginId: plugin.package,
        pluginName: plugin.manifest.localizations?.[locale]?.displayName ?? plugin.manifest.displayName,
        pluginVersion: plugin.version,
      })))
      .sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.title.localeCompare(right.title))
  }

  private async discover(project: Readonly<ProjectRecord>): Promise<Capability[]> {
    await this.initialize()
    await this.refreshLocalPlugins()
    const snapshot = this.activePluginSnapshot().filter(plugin => this.pluginActive(plugin))
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
    }
    return capabilities
  }

  private pluginActive(plugin: ManagedPlugin): boolean {
    if (!plugin.enabled || plugin.error)
      return false
    if (plugin.origin === 'local')
      return true
    const source = this.state.sources.find(item => item.id === plugin.sourceId)
    const catalogEntry = source?.catalog?.plugins.find(item => item.package === plugin.package && item.version === plugin.version)
    return catalogEntry?.status !== 'blocked'
      && (!catalogEntry?.requires || satisfies(this.applicationVersion, catalogEntry.requires, { includePrerelease: true }))
  }

  private async resolvePluginDocumentPackage(request: { sourceId: string, package: string, version?: string }): Promise<{ packagePath: string, version: string, manifest: PluginManifestV1 }> {
    await this.initialize()
    if (request.sourceId === 'local') {
      await this.refreshLocalPlugins(request.package)
      const plugin = this.requireLocal(request.package)
      if (request.version && plugin.version !== request.version)
        throw new Error(`Local plugin version is no longer available: ${request.package}@${request.version}`)
      return { packagePath: plugin.packagePath, version: plugin.version, manifest: plugin.manifest }
    }

    const source = this.requireSource(request.sourceId)
    const entry = this.selectCatalogEntry(source, request.package, undefined, request.version)
    const installed = this.state.installed.find(plugin => plugin.package === entry.package && plugin.sourceId === source.id && plugin.version === entry.version)
    if (installed)
      return { packagePath: installed.packagePath, version: installed.version, manifest: installed.manifest }
    this.assertCatalogEntryInstallable(entry)

    const cacheKey = createHash('sha256').update(`${source.id}\0${entry.package}\0${entry.version}\0${entry.integrity}`).digest('hex')
    const cachedPath = join(this.dataDir, 'plugins', '.document-cache', cacheKey, 'package')
    try {
      await access(join(cachedPath, 'package.json'))
      const manifest = await this.validateInstalledPackage(entry, { packagePath: cachedPath, integrity: entry.integrity })
      return { packagePath: cachedPath, version: entry.version, manifest }
    }
    catch {
      // A missing or invalid cache entry is replaced from the integrity-pinned package.
    }

    let pending = this.documentPackageRequests.get(cacheKey)
    if (!pending) {
      pending = this.cachePluginDocumentPackage(source, entry, cachedPath)
      this.documentPackageRequests.set(cacheKey, pending)
    }
    try {
      return { ...await pending, version: entry.version }
    }
    finally {
      if (this.documentPackageRequests.get(cacheKey) === pending)
        this.documentPackageRequests.delete(cacheKey)
    }
  }

  private async cachePluginDocumentPackage(source: MarketplaceSource, entry: CatalogPluginV1, cachedPath: string): Promise<{ packagePath: string, manifest: PluginManifestV1 }> {
    const staging = join(this.dataDir, 'plugins', '.document-cache', '.staging', randomUUID())
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(new Error(`Plugin README download exceeded ${pluginDocumentTimeoutMs}ms`)), pluginDocumentTimeoutMs)
    try {
      const installedPackage = await this.installer.install({
        package: entry.package,
        version: entry.version,
        registry: source.registry,
        integrity: entry.integrity,
        destination: staging,
        signal: abortController.signal,
      })
      const manifest = await this.validateInstalledPackage(entry, installedPackage)
      await mkdir(dirname(cachedPath), { recursive: true })
      await rm(cachedPath, { recursive: true, force: true })
      await rename(installedPackage.packagePath, cachedPath)
      return { packagePath: cachedPath, manifest }
    }
    finally {
      clearTimeout(timeout)
      await rm(staging, { recursive: true, force: true })
    }
  }

  private requireSource(id: string): MarketplaceSource {
    const source = this.state.sources.find(item => item.id === id)
    if (!source)
      throw new Error(`Unknown marketplace source: ${id}`)
    return source
  }

  private selectCatalogEntry(source: MarketplaceSource, packageName: string, range?: string, exactVersion?: string): CatalogPluginV1 {
    const candidates = source.catalog?.plugins.filter(item => item.package === packageName) ?? []
    const installed = this.state.installed.find(plugin => plugin.package === packageName && plugin.sourceId === source.id)
    const preferredInstalled = installed && candidates.find(item => item.version === installed.version)
    if (!exactVersion && preferredInstalled && (!range || satisfies(preferredInstalled.version, range, { includePrerelease: true })))
      return preferredInstalled
    const version = exactVersion ?? maxSatisfying(candidates.map(item => item.version), range ?? '*', { includePrerelease: true })
    if (!version) {
      throw new Error(range
        ? `Plugin dependency is not listed by marketplace source: ${packageName}@${range}`
        : `Plugin is not listed by marketplace source: ${packageName}`)
    }
    return this.requireCatalogEntry(source, packageName, version)
  }

  private requireCatalogEntry(source: MarketplaceSource, packageName: string, version: string): CatalogPluginV1 {
    const entry = source.catalog?.plugins.find(item => item.package === packageName && item.version === version)
    if (!entry)
      throw new Error(`Plugin is not listed by marketplace source: ${packageName}@${version}`)
    return entry
  }

  private assertCatalogEntryInstallable(entry: CatalogPluginV1): void {
    if (entry.status === 'blocked')
      throw new Error(`Plugin is blocked by marketplace source: ${entry.package}`)
    if (entry.requires && !satisfies(this.applicationVersion, entry.requires, { includePrerelease: true }))
      throw new Error(`${entry.package}@${entry.version} requires Craft Hub ${entry.requires}; current version is ${this.applicationVersion}`)
  }

  private async validateInstalledPackage(entry: CatalogPluginV1, installedPackage: InstalledPackage): Promise<PluginManifestV1> {
    if (entry.integrity && installedPackage.integrity !== entry.integrity)
      throw new Error(`Integrity mismatch for ${entry.package}@${entry.version}`)
    const manifest = await readPackageManifest(installedPackage.packagePath, entry.package, entry.version)
    if (!sameStringSet(manifest.permissions, entry.permissions))
      throw new Error(`Catalog permissions do not match the package manifest for ${entry.package}`)
    if (!sameStringRecord(manifest.permissionReasons ?? {}, entry.permissionReasons ?? {}))
      throw new Error(`Catalog permission reasons do not match the package manifest for ${entry.package}`)
    if (!samePluginDependencies(manifest.requiresPlugins, entry.requiresPlugins))
      throw new Error(`Catalog plugin dependencies do not match the package manifest for ${entry.package}`)
    if (!samePluginDependencies(manifest.includesPlugins, entry.includesPlugins))
      throw new Error(`Catalog included plugins do not match the package manifest for ${entry.package}`)
    if (manifest.craftHub.minVersion && !satisfies(this.applicationVersion, `>=${manifest.craftHub.minVersion}`, { includePrerelease: true }))
      throw new Error(`${entry.package}@${entry.version} requires Craft Hub >=${manifest.craftHub.minVersion}; current version is ${this.applicationVersion}`)
    if (entry.requires && manifest.craftHub.minVersion && !satisfies(manifest.craftHub.minVersion, entry.requires, { includePrerelease: true }))
      throw new Error(`Catalog requirement does not include the package minimum Craft Hub version for ${entry.package}`)
    return manifest
  }

  private requireInstalled(packageName: string): InstalledPlugin {
    const plugin = this.state.installed.find(item => item.package === packageName)
    if (!plugin)
      throw new Error(`Plugin is not installed: ${packageName}`)
    return plugin
  }

  private requireLocal(packageName: string): LocalPlugin {
    const plugin = this.state.linked.find(item => item.package === packageName)
    if (!plugin)
      throw new Error(`Local plugin is not linked: ${packageName}`)
    return plugin
  }

  private activePluginSnapshot(): ManagedPlugin[] {
    const plugins = new Map<string, ManagedPlugin>(this.state.installed.map(plugin => [plugin.package, plugin]))
    for (const plugin of this.state.linked)
      plugins.set(plugin.package, plugin)
    return [...plugins.values()]
  }

  private async readLocalPlugin(packagePath: string): Promise<LocalPlugin> {
    const resolvedPath = await realpath(resolve(packagePath))
    if (!(await stat(resolvedPath)).isDirectory())
      throw new Error(`Local plugin path must be a directory: ${resolvedPath}`)
    const packageJson = JSON.parse(await readFile(join(resolvedPath, 'package.json'), 'utf8')) as Record<string, unknown>
    if (typeof packageJson.name !== 'string' || !packageNamePattern.test(packageJson.name))
      throw new Error('Local plugin package name must follow the scoped Craft Hub plugin naming convention')
    if (typeof packageJson.version !== 'string' || valid(packageJson.version) === null)
      throw new Error('Local plugin package version must be valid SemVer')
    const manifest = await readPackageManifest(resolvedPath, packageJson.name, packageJson.version)
    this.assertLocalManifestCompatible(packageJson.name, packageJson.version, manifest)
    const linkedAt = new Date().toISOString()
    return {
      package: packageJson.name,
      version: packageJson.version,
      sourceId: 'local',
      origin: 'local',
      linkedAt,
      installedAt: linkedAt,
      enabled: true,
      packagePath: resolvedPath,
      manifest,
    }
  }

  private assertLocalManifestCompatible(packageName: string, version: string, manifest: PluginManifestV1): void {
    if (manifest.craftHub.minVersion && !satisfies(this.applicationVersion, `>=${manifest.craftHub.minVersion}`, { includePrerelease: true }))
      throw new Error(`${packageName}@${version} requires Craft Hub >=${manifest.craftHub.minVersion}; current version is ${this.applicationVersion}`)
  }

  private async refreshLocalPlugins(packageName?: string, forcePersist = false): Promise<void> {
    const targets = packageName ? [this.requireLocal(packageName)] : this.state.linked
    if (!targets.length)
      return
    let changed = forcePersist
    for (const linked of targets) {
      try {
        const refreshed = await this.readLocalPlugin(linked.packagePath)
        if (refreshed.package !== linked.package)
          throw new Error(`Local plugin package identity changed from ${linked.package} to ${refreshed.package}`)
        const next = {
          ...refreshed,
          linkedAt: linked.linkedAt,
          installedAt: linked.installedAt,
          enabled: linked.enabled,
        }
        if (linked.error) {
          delete linked.error
          changed = true
        }
        if (JSON.stringify(next) !== JSON.stringify(linked)) {
          Object.assign(linked, next)
          changed = true
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (linked.error !== message) {
          linked.error = message
          changed = true
        }
      }
    }
    if (changed)
      await this.mutate(() => {})
  }

  private async mutate(operation: () => void): Promise<void> {
    const next = this.operationTail.then(async () => {
      operation()
      await this.persistState()
      for (const listener of this.listeners)
        listener()
    })
    this.operationTail = next.catch(() => {})
    return next
  }

  private async persistState(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`
    const activeSourceIds = new Set(this.state.sources.map(source => source.id))
    const state = {
      ...this.state,
      sources: [
        ...this.state.sources,
        ...this.shadowedUserSources.filter(source => !activeSourceIds.has(source.id)),
      ],
    }
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.statePath)
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

function isSecureHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}

function resolveCatalogIcon(icon: string | undefined, catalogUrl: string | undefined): string | undefined {
  if (!icon || isSecureHttpsUrl(icon) || !catalogUrl)
    return icon
  return new URL(icon, catalogUrl).href
}

function permissionMetadataIssues(plugin: {
  permissions: string[]
  permissionReasons?: Record<string, string>
  localizations?: Record<string, { permissionReasons?: Record<string, string> }>
}): Array<{ message: string, path: Array<string | number> }> {
  const declared = new Set(plugin.permissions)
  const issues: Array<{ message: string, path: Array<string | number> }> = []
  for (const permission of Object.keys(plugin.permissionReasons ?? {})) {
    if (!declared.has(permission))
      issues.push({ message: `Permission reason references undeclared permission: ${permission}`, path: ['permissionReasons', permission] })
  }
  for (const [locale, localization] of Object.entries(plugin.localizations ?? {})) {
    for (const permission of Object.keys(localization.permissionReasons ?? {})) {
      if (!declared.has(permission))
        issues.push({ message: `Localized permission reason references undeclared permission: ${permission}`, path: ['localizations', locale, 'permissionReasons', permission] })
    }
  }
  return issues
}

function validatePluginDependencies(packageName: string, dependencies: PluginDependencyV1[], field: 'includesPlugins' | 'requiresPlugins', context: z.RefinementCtx): void {
  const seen = new Set<string>()
  for (const [index, dependency] of dependencies.entries()) {
    if (dependency.package === packageName)
      context.addIssue({ code: 'custom', message: 'Plugin cannot reference itself', path: [field, index, 'package'] })
    if (seen.has(dependency.package))
      context.addIssue({ code: 'custom', message: `Plugin relation is declared more than once: ${dependency.package}`, path: [field, index, 'package'] })
    seen.add(dependency.package)
  }
}

function validateDistinctPluginRelations(included: PluginDependencyV1[], required: PluginDependencyV1[], context: z.RefinementCtx): void {
  const requiredPackages = new Set(required.map(dependency => dependency.package))
  for (const [index, dependency] of included.entries()) {
    if (requiredPackages.has(dependency.package))
      context.addIssue({ code: 'custom', message: `Plugin cannot be both included and required: ${dependency.package}`, path: ['includesPlugins', index, 'package'] })
  }
}

function secureHttpsUrl(value: string, label: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:')
    throw new Error(`${label} must use HTTPS`)
  if (url.username || url.password)
    throw new Error(`${label} must not contain credentials`)
  return url
}

async function fetchCatalog(fetcher: typeof fetch, initialUrl: URL, catalogTrust: MarketplaceCatalogTrust): Promise<{ catalog: PluginCatalogV1, finalUrl: string, verification?: MarketplaceSourceVerification }> {
  let url = initialUrl
  for (let redirect = 0; redirect <= catalogRedirectLimit; redirect++) {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(catalogTimeoutMs),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location)
        throw new Error(`Catalog redirect is missing a location: ${response.status}`)
      if (redirect === catalogRedirectLimit)
        throw new Error('Catalog redirected too many times')
      url = secureHttpsUrl(new URL(location, url).href, 'Marketplace catalog redirect')
      continue
    }
    if (!response.ok)
      throw new Error(`Catalog request failed: ${response.status}`)
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('application/json') && !contentType.includes('+json'))
      throw new Error('Catalog response must use a JSON content type')
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > catalogResponseLimit)
      throw new Error('Catalog response is too large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > catalogResponseLimit)
      throw new Error('Catalog response is too large')
    const verification = await catalogTrust.verify(initialUrl.href, bytes, response.headers)
    const document = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return { catalog: pluginCatalogV1Schema.parse(document), finalUrl: url.href, verification }
  }
  throw new Error('Catalog redirected too many times')
}

function mergeManagedSources(configured: MarketplaceSource[], persisted: MarketplaceSource[]): MarketplaceSource[] {
  const configuredIds = new Set(configured.map(source => source.id))
  const configuredCatalogUrls = new Set(configured.flatMap(source => source.catalogUrl ? [source.catalogUrl] : []))
  return [
    ...configured,
    ...persisted.filter(source => source.kind === 'user'
      && !configuredIds.has(source.id)
      && (!source.catalogUrl || !configuredCatalogUrls.has(source.catalogUrl))),
  ]
}

function withoutVerification(source: MarketplaceSource): MarketplaceSource {
  const { verification: _verification, ...unverified } = source
  return unverified
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

function sameStringSet(left: string[], right: string[]): boolean {
  const sortedRight = [...right].sort()
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index])
}

function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function samePluginDependencies(left: PluginDependencyV1[], right: PluginDependencyV1[]): boolean {
  const normalize = (dependencies: PluginDependencyV1[]): Array<[string, string]> => [...dependencies]
    .sort((leftDependency, rightDependency) => leftDependency.package.localeCompare(rightDependency.package))
    .map(dependency => [dependency.package, dependency.version])
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
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
