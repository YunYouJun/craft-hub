import type { Buffer } from 'node:buffer'
import type { RunHandle } from './executor'
import type { CapabilityProvider, CraftHubOptions, DistributionConfig } from './extensions'
import type { ApplyGitIntegrationRequest, GitIntegrationPlan, GitIntegrationRequest, GitIntegrationResult } from './git-integration'
import type { IntegrationDiagnostic, ResolvedIntegrationContribution } from './integrations'
import type { CraftHubPlugin, PluginDiagnostic } from './plugins'
import type { Capability, CapabilityDiscoveryDiagnostic, CapabilityDiscoveryResult, CapabilityPins, CapabilityReference, CommandCapability, CommandInputValues, CommandInvocation, CommandPackage, ProjectConfigInitializationMode, ProjectConfigInitializationResult, ProjectOverview, ProjectRecord, ProjectRunSummary, ReleasePlan, RunCleanupOptions, RunCleanupResult, RunOutputEvent, RunRecord } from './types'
import { resolve } from 'node:path'
import process from 'node:process'
import { AgentActionService } from './agent-actions'
import { AgentTaskManager } from './agent-tasks'
import { resolveCommandContributions } from './command-contributions'
import { resolveCommandInvocation, resolvePersistedCommandInvocation } from './command-inputs'
import { applyProjectConfigInitialization, previewProjectConfigInitialization } from './config'
import { DotfilesManager } from './dotfiles-manager'
import { executeCommand } from './executor'
import { builtinCapabilityProvider, communityDistribution } from './extensions'
import { GitIntegration } from './git-integration'
import { IntegrationRegistry } from './integrations'
import { PluginManager } from './marketplace'
import { OwnerScopeService } from './owner-scopes'
import { assertCommandWorkingDirectory } from './path-security'
import { PersonalGitSyncService } from './personal-git-sync'
import { getCraftHubConfigDir, getCraftHubDataDir } from './platform'
import { readProjectOverviewAsset, readProjectReadme } from './project-overview'
import { ProjectRegistry } from './projects'
import { ReleasePlanner } from './release-planner'
import { CraftHubSettingsService } from './settings'
import { CraftHubStore } from './store'
import { TeamGitSyncService } from './team-git-sync'
import { TeamManager } from './teams'
import { UserConfigService } from './user-config'
import { WorkspaceImportService } from './workspace-import'
import { WorkspaceService } from './workspaces'

export class CraftHubRuntime {
  readonly store: CraftHubStore
  readonly projects: ProjectRegistry
  readonly settings: CraftHubSettingsService
  readonly userConfig: UserConfigService
  readonly dotfilesManager: DotfilesManager
  readonly workspaces: WorkspaceService
  readonly workspaceImports: WorkspaceImportService
  readonly personalGitSync: PersonalGitSyncService
  readonly ownerScopes: OwnerScopeService
  readonly teamGitSync: TeamGitSyncService
  readonly teams: TeamManager
  readonly agentTasks: AgentTaskManager
  readonly agentActions: AgentActionService
  readonly pluginManager: PluginManager
  readonly integrationRegistry: IntegrationRegistry
  readonly releasePlanner = new ReleasePlanner()
  readonly gitIntegration = new GitIntegration()
  readonly distribution: DistributionConfig
  private readonly capabilityProviders: Array<{ pluginId?: string, provider: CapabilityProvider }>
  private readonly activeRuns = new Map<string, RunHandle>()
  private readonly capabilityDiscoveryRequests = new Map<string, Promise<CapabilityDiscoveryResult>>()
  private readonly lastRuns = new Map<string, Pick<ProjectRunSummary, 'lastFinishedAt' | 'lastStatus'>>()
  private readonly runListeners = new Set<(summary: ProjectRunSummary) => void>()
  private diagnostics: PluginDiagnostic[] = []

  constructor(options: string | CraftHubOptions = {}) {
    const normalizedOptions = typeof options === 'string' ? { dataDir: options } : options
    this.distribution = normalizedOptions.distribution ?? communityDistribution
    const plugins = normalizedOptions.plugins ?? []
    assertUniquePluginIds(plugins)
    this.store = new CraftHubStore(normalizedOptions.dataDir ?? getCraftHubDataDir(process.env, this.distribution.dataDirectoryName ?? this.distribution.name))
    this.pluginManager = new PluginManager(
      this.store.dataDir,
      this.distribution.marketplaceSources,
      normalizedOptions.pluginPackageInstaller,
      undefined,
      undefined,
      this.distribution.marketplaceTrustPolicies,
    )
    this.integrationRegistry = new IntegrationRegistry(plugins.flatMap(plugin => plugin.integrationProviders ?? []))
    this.capabilityProviders = [
      { provider: builtinCapabilityProvider },
      { provider: this.pluginManager.capabilityProvider },
      ...(normalizedOptions.capabilityProviders ?? []).map(provider => ({ provider })),
      ...plugins.flatMap(plugin => (plugin.capabilityProviders ?? []).map(provider => ({ pluginId: plugin.id, provider }))),
    ]
    this.projects = new ProjectRegistry(this.store)
    this.settings = new CraftHubSettingsService(this.store.dataDir)
    this.dotfilesManager = new DotfilesManager(this.store.dataDir)
    const configDir = normalizedOptions.configDir ?? getCraftHubConfigDir(process.env)
    this.userConfig = new UserConfigService(configDir, this.store.dataDir)
    this.workspaces = new WorkspaceService(configDir, this.store.dataDir, this.projects, this.userConfig)
    this.ownerScopes = new OwnerScopeService(configDir, this.store.dataDir, this.userConfig)
    this.teamGitSync = new TeamGitSyncService(this.store.dataDir, this.ownerScopes, this.workspaces)
    this.teams = new TeamManager(this.ownerScopes, this.teamGitSync, this.workspaces)
    this.workspaceImports = new WorkspaceImportService(this.projects, this.workspaces)
    this.personalGitSync = new PersonalGitSyncService(this.store.dataDir, this.settings, this.workspaces)
    this.agentTasks = new AgentTaskManager(this.store, this.projects, normalizedOptions.agentTaskProvider)
    this.agentActions = new AgentActionService(this.agentTasks, this.projects, (projectId, locale) => this.capabilityDiscovery(projectId, locale))
  }

  /** Register a local project path without granting trust. */
  async addProject(path: string): Promise<ProjectRecord> {
    return this.projects.add(resolve(path))
  }

  /** Remove a project registration without deleting its directory. */
  async unregisterProject(projectId: string): Promise<ProjectRecord> {
    return this.projects.remove(projectId)
  }

  /** Preview or create one registered project's optional repository-owned configuration. */
  async initializeProjectConfig(projectId: string, mode: ProjectConfigInitializationMode, expectedRevision?: string): Promise<ProjectConfigInitializationResult> {
    const project = await this.projects.get(projectId)
    const preview = await previewProjectConfigInitialization(project.path, project.name)
    if (mode === 'preview') {
      return {
        ...preview,
        projectId,
        trust: project.trust,
        mode,
        outcome: 'preview',
      }
    }
    if (project.trust !== 'trusted')
      throw new Error(`Project is untrusted: ${project.name}. Trust it before creating ${preview.targetPath}.`)
    if (!expectedRevision)
      throw new Error('expectedRevision is required when applying project config initialization')
    const applied = await applyProjectConfigInitialization(project.path, project.name, expectedRevision)
    return {
      ...applied,
      projectId,
      trust: project.trust,
      mode,
      outcome: applied.created ? 'created' : 'unchanged',
    }
  }

  /** Compute a fresh, side-effect-free Plan for integrating the current local Git branch. */
  async planGitIntegration(projectId: string, request: GitIntegrationRequest = {}): Promise<GitIntegrationPlan> {
    return this.gitIntegration.plan(await this.projects.get(projectId), request)
  }

  /** Recheck and apply a reviewed local Git integration Plan. */
  async applyGitIntegration(projectId: string, request: ApplyGitIntegrationRequest): Promise<GitIntegrationResult> {
    return this.gitIntegration.apply(await this.projects.get(projectId), request)
  }

  /** Discover the current capabilities for one registered project. */
  async capabilities(projectId: string): Promise<Capability[]> {
    return (await this.capabilityDiscovery(projectId)).capabilities
  }

  /** Resolve installed marketplace integration declarations against trusted host providers. */
  async integrationContributions(): Promise<{ integrations: ResolvedIntegrationContribution[], diagnostics: IntegrationDiagnostic[] }> {
    return this.integrationRegistry.resolve(await this.pluginManager.integrationContributions())
  }

  /** Discover capabilities and non-fatal diagnostics for one registered project. */
  async capabilityDiscovery(projectId: string, requestedLocale?: 'en' | 'zh-CN'): Promise<CapabilityDiscoveryResult> {
    const locale = requestedLocale ?? (await this.settings.get()).settings['workbench.locale']
    const key = `${projectId}:${locale}`
    const pending = this.capabilityDiscoveryRequests.get(key)
    if (pending)
      return pending
    const request = this.discoverCapabilities(projectId, locale)
    this.capabilityDiscoveryRequests.set(key, request)
    try {
      return await request
    }
    finally {
      if (this.capabilityDiscoveryRequests.get(key) === request)
        this.capabilityDiscoveryRequests.delete(key)
    }
  }

  private async discoverCapabilities(projectId: string, locale: 'en' | 'zh-CN'): Promise<CapabilityDiscoveryResult> {
    const [project, extensionSettings] = await Promise.all([
      this.projects.get(projectId),
      this.settings.extensionValues(),
    ])
    this.diagnostics = []
    const capabilities: Capability[] = []
    const diagnostics: CapabilityDiscoveryDiagnostic[] = []
    const packages = new Map<string, CommandPackage>()
    const ids = new Set<string>()
    for (const entry of this.capabilityProviders) {
      try {
        const result = await entry.provider.discover({ locale, project })
        const discovered = Array.isArray(result) ? result : result.capabilities
        await validateCapabilities(discovered, ids, project.path)
        if (!Array.isArray(result)) {
          diagnostics.push(...result.diagnostics)
          for (const commandPackage of result.packages ?? [])
            packages.set(commandPackage.relativePath, commandPackage)
        }
        for (const capability of discovered) {
          ids.add(capability.id)
          capabilities.push(capability)
        }
      }
      catch (error) {
        if (!entry.pluginId)
          throw error
        this.diagnostics.push({
          pluginId: entry.pluginId,
          phase: 'discover',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const commandContributions = await resolveCommandContributions({
      projectPath: project.path,
      locale,
      capabilities,
      packages: [...packages.values()],
      plugins: await this.pluginManager.commandContributions(),
      userSettings: extensionSettings,
    })
    diagnostics.push(...commandContributions.diagnostics)
    const resolvedIds = new Set<string>()
    await validateCapabilities(commandContributions.capabilities, resolvedIds, project.path)
    return { capabilities: commandContributions.capabilities, diagnostics, packages: commandContributions.packages }
  }

  /** Resolve one contextual project or package overview and its bounded README. */
  async projectOverview(projectId: string, packagePath = '.', requestedLocale?: 'en' | 'zh-CN'): Promise<ProjectOverview> {
    const [project, discovery] = await Promise.all([
      this.projects.get(projectId),
      this.capabilityDiscovery(projectId, requestedLocale),
    ])
    const commandPackage = discovery.packages?.find(item => item.relativePath === packagePath)
    if (!commandPackage)
      throw new Error(`Unknown package: ${packagePath}`)
    return {
      projectId,
      package: commandPackage,
      readme: await readProjectReadme(project.path, commandPackage),
    }
  }

  /** Read one bounded raster asset contained by a registered project. */
  async projectOverviewAsset(projectId: string, projectRelativePath: string): Promise<{ content: Buffer, contentType: string } | undefined> {
    const project = await this.projects.get(projectId)
    return readProjectOverviewAsset(project.path, projectRelativePath)
  }

  /** Return the current capability ids represented by this project's machine-local pin order. */
  async capabilityPins(projectId: string): Promise<CapabilityPins> {
    const capabilities = await this.capabilities(projectId)
    const references = await this.store.getCapabilityPins(projectId)
    const capabilityIds: string[] = []
    for (const reference of references) {
      const exact = capabilities.find(capability => capability.id === reference.id)
      const semanticMatches = capabilities.filter(capability => sameCapability(reference, capability))
      const capability = exact ?? (semanticMatches.length === 1 ? semanticMatches[0] : undefined)
      if (capability && !capabilityIds.includes(capability.id))
        capabilityIds.push(capability.id)
    }
    return { projectId, capabilityIds }
  }

  /** Replace one project's machine-local pin order after validating every capability id. */
  async updateCapabilityPins(projectId: string, capabilityIds: string[]): Promise<CapabilityPins> {
    if (new Set(capabilityIds).size !== capabilityIds.length)
      throw new Error('Pinned capability ids must be unique')
    const capabilities = await this.capabilities(projectId)
    const references = capabilityIds.map((capabilityId) => {
      const capability = capabilities.find(item => item.id === capabilityId)
      if (!capability)
        throw new Error(`Unknown capability: ${capabilityId}`)
      return capabilityReference(capability)
    })
    await this.store.saveCapabilityPins(projectId, references)
    return { projectId, capabilityIds }
  }

  /** Diagnostics from the most recent plugin discovery pass. */
  getPluginDiagnostics(): readonly PluginDiagnostic[] {
    return this.diagnostics
  }

  /** Resolve and validate one command invocation without executing it. */
  async previewCommand(projectId: string, capabilityId: string, inputs: CommandInputValues = {}): Promise<CommandInvocation> {
    const capability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability)
      throw new Error(`Unknown capability: ${capabilityId}`)
    if (capability.kind !== 'command')
      throw new Error('Skills are inspected or handed to an agent; they are not shell commands')
    if (capability.availability?.available === false)
      throw new Error(capability.availability.diagnostic ?? `Command is unavailable: ${capability.invocation.command}`)
    return resolveCommandInvocation(capability, inputs)
  }

  /** Compute a fresh release preflight without mutating the repository. */
  async releasePlan(projectId: string, capabilityId: string, inputs: CommandInputValues = {}): Promise<ReleasePlan> {
    const project = await this.projects.get(projectId)
    const capability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability || capability.kind !== 'command')
      throw new Error(`Unknown command capability: ${capabilityId}`)
    return this.releasePlanner.plan(project, capability, inputs)
  }

  /** Execute a discovered command capability after rechecking project trust and resolving inputs. */
  async run(projectId: string, capabilityId: string, onOutput?: (event: RunOutputEvent) => void, inputs: CommandInputValues = {}): Promise<RunHandle> {
    const project = await this.projects.get(projectId)
    const capability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability)
      throw new Error(`Unknown capability: ${capabilityId}`)
    if (capability.kind !== 'command')
      throw new Error('Skills are inspected or handed to an agent; they are not shell commands')
    if (capability.availability?.available === false)
      throw new Error(capability.availability.diagnostic ?? `Command is unavailable: ${capability.invocation.command}`)
    if (capability.operation?.kind === 'release') {
      const plan = await this.releasePlanner.plan(project, capability, inputs)
      if (plan.blockers.length)
        throw new Error(`Release preflight failed: ${plan.blockers.join(' ')}`)
    }
    const invocation = resolveCommandInvocation(capability, inputs)
    const persistedInvocation = resolvePersistedCommandInvocation(capability, inputs)
    const handle = await executeCommand(this.store, project, { ...capability, invocation } as CommandCapability, onOutput, persistedInvocation)
    this.activeRuns.set(handle.run.id, handle)
    this.emitRunSummary(projectId)
    void handle.completion.then((run) => {
      this.activeRuns.delete(handle.run.id)
      if (run.status !== 'running')
        this.lastRuns.set(projectId, { lastStatus: run.status, lastFinishedAt: run.finishedAt })
      this.emitRunSummary(projectId)
    })
    return handle
  }

  /** Current per-project execution summaries for UI and API consumers. */
  projectRunSummaries(): ProjectRunSummary[] {
    const projectIds = new Set([
      ...[...this.activeRuns.values()].map(handle => handle.run.projectId),
      ...this.lastRuns.keys(),
    ])
    return [...projectIds].map(projectId => this.projectRunSummary(projectId))
  }

  /** List persisted run records. */
  async runs(): Promise<RunRecord[]> {
    return this.store.listRuns()
  }

  /** Set whether a persisted run is exempt from automatic retention. */
  async pinRun(runId: string, pinned: boolean): Promise<RunRecord> {
    return this.store.setRunPinned(runId, pinned)
  }

  /** Delete unpinned persisted runs matching the requested retention policy. */
  async cleanupRuns(options: RunCleanupOptions): Promise<RunCleanupResult> {
    return this.store.cleanupRuns(options)
  }

  /** Subscribe to execution summary changes. */
  onRunsChanged(listener: (summary: ProjectRunSummary) => void): () => void {
    this.runListeners.add(listener)
    return () => this.runListeners.delete(listener)
  }

  /** Send terminal input to an active run. */
  writeRun(runId: string, data: string): void {
    this.getActiveRun(runId).write(data)
  }

  /** Resize the pseudo-terminal attached to an active run. */
  resizeRun(runId: string, columns: number, rows: number): void {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1)
      throw new Error('Terminal dimensions must be positive integers')
    this.getActiveRun(runId).resize(columns, rows)
  }

  /** Stop an active run and wait for its final record. */
  async cancelRun(runId: string): Promise<RunRecord> {
    const handle = this.getActiveRun(runId)
    handle.cancel()
    return handle.completion
  }

  /** Stop every active run during application shutdown. */
  async cancelAllRuns(): Promise<void> {
    const handles = [...this.activeRuns.values()]
    for (const handle of handles)
      handle.cancel()
    await Promise.allSettled(handles.map(handle => handle.completion))
  }

  /** Cancel active agent tasks and commands during host shutdown. */
  async close(): Promise<void> {
    await this.agentTasks.cancelAll()
    await this.cancelAllRuns()
    await this.userConfig.close()
  }

  private getActiveRun(runId: string): RunHandle {
    const handle = this.activeRuns.get(runId)
    if (!handle)
      throw new Error(`Unknown active run: ${runId}`)
    return handle
  }

  private projectRunSummary(projectId: string): ProjectRunSummary {
    return {
      projectId,
      running: [...this.activeRuns.values()].filter(handle => handle.run.projectId === projectId).length,
      ...this.lastRuns.get(projectId),
    }
  }

  private emitRunSummary(projectId: string): void {
    const summary = this.projectRunSummary(projectId)
    for (const listener of this.runListeners)
      listener(summary)
  }
}

function capabilityReference(capability: Capability): CapabilityReference {
  return {
    id: capability.id,
    kind: capability.kind,
    name: capability.name,
    source: capability.source,
    packageRelativePath: capability.kind === 'command' ? capability.package?.relativePath : undefined,
  }
}

function sameCapability(reference: CapabilityReference, capability: Capability): boolean {
  return reference.kind === capability.kind
    && reference.name === capability.name
    && reference.source === capability.source
    && (reference.packageRelativePath === undefined
      || capability.kind !== 'command'
      || reference.packageRelativePath === capability.package?.relativePath)
}

function assertUniquePluginIds(plugins: CraftHubPlugin[]): void {
  const ids = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.id)
      throw new Error('Craft Hub plugins require a non-empty id')
    if (ids.has(plugin.id))
      throw new Error(`Duplicate plugin id: ${plugin.id}`)
    ids.add(plugin.id)
  }
}

async function validateCapabilities(capabilities: Capability[], existingIds: Set<string>, projectPath: string): Promise<void> {
  const providerIds = new Set<string>()
  for (const capability of capabilities) {
    if (existingIds.has(capability.id) || providerIds.has(capability.id))
      throw new Error(`Duplicate capability id: ${capability.id}`)
    providerIds.add(capability.id)
    if (capability.kind === 'command')
      await assertCommandWorkingDirectory(projectPath, capability.invocation.cwd)
  }
}

/** Create a configured Craft Hub runtime for a community or downstream distribution. */
export function createCraftHub(options: CraftHubOptions = {}): CraftHubRuntime {
  return new CraftHubRuntime(options)
}
