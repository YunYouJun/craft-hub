import type { Buffer } from 'node:buffer'
import type { AccountProvider } from './accounts'
import type { CommandRunGuard } from './command-run-guard'
import type { HostDiagnosticProvider, WorkbenchDiagnosticSnapshot } from './diagnostics'
import type { RunHandle } from './executor'
import type { CapabilityProvider, CraftHubOptions, DistributionConfig } from './extensions'
import type { ApplyGitIntegrationRequest, GitIntegrationPlan, GitIntegrationRequest, GitIntegrationResult } from './git-integration'
import type { HostEnvironment } from './host-environment'
import type { InstalledIntegrationContribution, IntegrationActionResult, IntegrationDiagnostic, ResolvedIntegrationContribution } from './integrations'
import type { LocalEnvironmentSnapshot } from './local-environment'
import type { CraftHubPlugin, PluginDiagnostic } from './plugins'
import type { ProfileLease } from './profile-lease'
import type { SoftwareApplicationOpen, SoftwareCatalogSnapshot, SoftwareFavoritesSnapshot, SoftwareInstallationPlan, SoftwareInstallationRun, SoftwareInstallationRuns } from './software-catalog'
import type { Capability, CapabilityDiscoveryDiagnostic, CapabilityDiscoveryResult, CapabilityPins, CapabilityReference, CommandCapability, CommandInputValues, CommandInvocation, CommandPackage, LocalSkillActivationSettings, ProjectConfigInitializationMode, ProjectConfigInitializationResult, ProjectOverview, ProjectRecord, ProjectRunSummary, ProjectSkillsState, ReleasePlan, RunCleanupOptions, RunCleanupResult, RunOutputEvent, RunRecord } from './types'
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { AccountSyncService } from './account-sync'
import { AgentActionService } from './agent-actions'
import { AgentTaskManager } from './agent-tasks'
import { ApplicationMaintenanceService } from './application-maintenance'
import { bundledSoftwareCatalog } from './bundled-software-catalog'
import { resolveCommandContributions } from './command-contributions'
import { resolveCommandInvocation, resolvePersistedCommandInvocation } from './command-inputs'
import { CommandReviewService } from './command-review'
import { assertCommandRunGuardActive, assertCommandRunGuardMatches } from './command-run-guard'
import { applyProjectConfigInitialization, loadProjectConfig, previewProjectConfigInitialization } from './config'
import { presentConfigurationManagement } from './configuration-management'
import { collectWorkbenchDiagnostics, readHostDiagnosticProviders } from './diagnostics'
import { DotfilesManager } from './dotfiles-manager'
import { EnvironmentSetupService } from './environment-setup'
import { EnvironmentSourceService } from './environment-sources'
import { executeCommand } from './executor'
import { builtinCapabilityProvider, communityDistribution } from './extensions'
import { GitIntegration } from './git-integration'
import { describeHostEnvironment } from './host-environment'
import { matchesConnectionReview } from './integration-connection-review'
import { IntegrationFormService } from './integration-forms'
import { integrationFiltersSchema, IntegrationLocalState } from './integration-local-state'
import { IntegrationConfirmationRequiredError, integrationContributionSchema, IntegrationRegistry, IntegrationReviewChangedError, integrationReviewedActionSchema } from './integrations'
import { inspectLocalEnvironment } from './local-environment'
import { PluginManager } from './marketplace'
import { OwnerScopeService } from './owner-scopes'
import { assertCommandWorkingDirectory } from './path-security'
import { PersonalConfigRepository } from './personal-config-repository'
import { PersonalGitSyncService } from './personal-git-sync'
import { createSoftwareFavorite, findSoftwareFavorite, personalWorkbenchHomeSchema } from './personal-workbench'
import { getCraftHubConfigDir, getCraftHubDataDir } from './platform'
import { acquireProfileLease } from './profile-lease'
import { readProjectOverviewAsset, readProjectReadme } from './project-overview'
import { ProjectRegistry } from './projects'
import { ReleasePlanner } from './release-planner'
import { CraftHubSettingsService, SettingsConflictError } from './settings'
import { SetupProfileService } from './setup-profile'
import { localSkillActivationSettingsSchema, resolveSkillActivations } from './skill-activation'
import { SoftwareCatalogService, softwareFavoriteRequestSchema, SoftwareOperationError } from './software-catalog'
import { softwareFavoritesSnapshot } from './software-favorites'
import { SoftwareSourceService } from './software-sources'
import { CraftHubStore } from './store'
import { TeamGitSyncService } from './team-git-sync'
import { TeamManager } from './teams'
import { UserConfigService } from './user-config'
import { WorkAssistant } from './work-assistant'
import { WorkItemProjectService } from './work-item-projects'
import { WorkspaceCatalogService } from './workspace-catalog'
import { WorkspaceImportService } from './workspace-import'
import { publicWorkspaceRepositoryProvider } from './workspace-repository'
import { WorkspaceSubscriptionService } from './workspace-subscriptions'
import { WorkspaceService } from './workspaces'

export class CraftHubRuntime {
  /** Command reviews retain immutable declarations and inputs until explicit one-use confirmation. */
  readonly commandReviews = new CommandReviewService({
    project: id => this.projects.get(id),
    capabilities: id => this.capabilities(id),
    trust: (id, expectedPath, assertActive) => this.projects.setTrust(id, 'trusted', expectedPath, assertActive),
  })

  /** Host-local read-only application discovery; does not require an installation plugin. */
  readonly applicationMaintenance = new ApplicationMaintenanceService({ catalog: () => this.softwareCatalogSnapshot({ localDiscovery: false }) })
  /** One-use native form reviews share the runtime's declaration, project and invocation boundaries. */
  readonly integrationForms = new IntegrationFormService({
    catalog: () => this.integrationContributions(),
    project: id => this.projects.get(id),
    invoke: options => this.invokeIntegrationAction(options),
  })

  private get integrationLocalState(): IntegrationLocalState {
    return this.localIntegrationState ??= new IntegrationLocalState(this.store.dataDir)
  }

  private localIntegrationState?: IntegrationLocalState
  readonly hostEnvironment: HostEnvironment
  readonly accountProvider?: AccountProvider
  readonly store: CraftHubStore
  readonly projects: ProjectRegistry
  readonly workAssistant: WorkAssistant
  readonly workItemProjects: WorkItemProjectService
  readonly settings: CraftHubSettingsService
  readonly userConfig: UserConfigService
  readonly personalConfigRepository: PersonalConfigRepository
  readonly dotfilesManager: DotfilesManager
  readonly workspaces: WorkspaceService
  readonly workspaceSubscriptions: WorkspaceSubscriptionService
  readonly workspaceCatalog: WorkspaceCatalogService
  private readonly softwareCatalog: SoftwareCatalogService
  readonly softwareSources: SoftwareSourceService
  readonly setupProfile: SetupProfileService
  readonly environmentSetup: EnvironmentSetupService
  readonly environmentSources: EnvironmentSourceService
  readonly workspaceImports: WorkspaceImportService
  readonly personalGitSync: PersonalGitSyncService
  readonly accountSync: AccountSyncService
  readonly ownerScopes: OwnerScopeService
  readonly teamGitSync: TeamGitSyncService
  readonly teams: TeamManager
  readonly agentTasks: AgentTaskManager
  readonly agentActions: AgentActionService
  readonly pluginManager: PluginManager
  readonly integrationRegistry: IntegrationRegistry
  private readonly hostIntegrations: InstalledIntegrationContribution[]
  readonly releasePlanner = new ReleasePlanner()
  readonly gitIntegration = new GitIntegration()
  readonly distribution: DistributionConfig
  private readonly capabilityProviders: Array<{ pluginId?: string, provider: CapabilityProvider }>
  private readonly hostPluginDiagnostics: readonly PluginDiagnostic[]
  private readonly diagnosticProviders: Array<{ pluginId: string, provider: HostDiagnosticProvider }>
  private readonly activeRuns = new Map<string, RunHandle>()
  private readonly capabilityDiscoveryRequests = new Map<string, Promise<CapabilityDiscoveryResult>>()
  private readonly lastRuns = new Map<string, Pick<ProjectRunSummary, 'lastFinishedAt' | 'lastStatus'>>()
  private readonly runListeners = new Set<(summary: ProjectRunSummary) => void>()
  private readonly integrationListeners = new Set<(integrationId: string) => void>()
  private diagnostics: PluginDiagnostic[] = []
  private environmentInspection?: Promise<LocalEnvironmentSnapshot>
  private profileLease?: Promise<ProfileLease>

  constructor(options: string | CraftHubOptions = {}) {
    const normalizedOptions = typeof options === 'string' ? { dataDir: options } : options
    if (normalizedOptions.profileLease)
      this.profileLease = Promise.resolve(normalizedOptions.profileLease)
    this.hostEnvironment = describeHostEnvironment(normalizedOptions.hostEnvironment)
    this.distribution = normalizedOptions.distribution ?? communityDistribution
    const plugins = normalizedOptions.plugins ?? []
    assertUniquePluginIds(plugins)
    this.softwareCatalog = new SoftwareCatalogService(plugins.flatMap(plugin => plugin.softwareCatalogProviders ?? []), [bundledSoftwareCatalog])
    this.workspaceCatalog = new WorkspaceCatalogService(this.distribution.workspaceMarkets, [...(normalizedOptions.workspaceCatalogProviders ?? []), ...plugins.flatMap(plugin => plugin.workspaceCatalogProviders ?? [])])
    const accounts = plugins.flatMap(plugin => plugin.accountProvider ? [plugin.accountProvider] : [])
    if (accounts.length > 1)
      throw new Error('Only one host account provider can be configured')
    this.accountProvider = accounts[0]
    this.hostPluginDiagnostics = structuredClone(normalizedOptions.pluginDiagnostics ?? [])
    this.store = new CraftHubStore(normalizedOptions.dataDir ?? getCraftHubDataDir(process.env, this.distribution.dataDirectoryName ?? this.distribution.name))
    this.softwareSources = new SoftwareSourceService(this.store.dataDir, this.hostEnvironment.kind === 'local')
    this.setupProfile = new SetupProfileService(this.store.dataDir, () => this.softwareCatalogSnapshot(), async () => {
      const { integrations } = await this.integrationContributions()
      return Promise.all(integrations.flatMap((integration) => {
        const view = integration.views.find(view => view.scope !== 'project' && view.blocks.some(block => block.type === 'configuration-manager'))
        const block = view?.blocks.find(block => block.type === 'configuration-manager')
        const action = block && 'actionId' in block ? integration.actions.find(action => action.id === block.actionId && action.operation === 'configuration.read' && action.effect === 'local-read') : undefined
        if (!view || !action)
          return []
        const source = { integrationId: integration.id, href: `/integrations/${encodeURIComponent(integration.id)}/${encodeURIComponent(view.id)}` }
        return [(async () => {
          try {
            const result = await this.invokeIntegrationAction({ integrationId: integration.id, actionId: action.id })
            return { ...source, ...('configuration' in result && result.configuration === true && Array.isArray(result.items) ? { page: result } : {}) }
          }
          catch { return source }
        })()]
      }))
    }, this.hostEnvironment.kind === 'local')
    this.environmentSetup = new EnvironmentSetupService(() => this.localEnvironmentSnapshot(), () => this.setupProfile.snapshot(), plugins.flatMap(plugin => plugin.environmentSetupProviders ?? []), this.hostEnvironment.kind === 'local')
    this.environmentSources = new EnvironmentSourceService(plugins.flatMap(plugin => plugin.environmentSourceProviders ?? []), this.hostEnvironment.kind === 'local')
    this.pluginManager = new PluginManager(
      this.store.dataDir,
      this.distribution.marketplaceSources,
      normalizedOptions.pluginPackageInstaller,
      undefined,
      undefined,
      this.distribution.marketplaceTrustPolicies,
    )
    this.hostIntegrations = plugins.flatMap(plugin => (plugin.integrations ?? []).map(contribution => ({
      ...integrationContributionSchema.parse(contribution),
      pluginId: plugin.id,
      source: `host:${plugin.id}`,
    })))
    this.integrationRegistry = new IntegrationRegistry(plugins.flatMap(plugin => plugin.integrationProviders ?? []))
    this.diagnosticProviders = plugins.flatMap(plugin => (plugin.diagnosticProviders ?? []).map(provider => ({ pluginId: plugin.id, provider })))
    this.capabilityProviders = [
      { provider: builtinCapabilityProvider },
      { provider: this.pluginManager.capabilityProvider },
      ...(normalizedOptions.capabilityProviders ?? []).map(provider => ({ provider })),
      ...plugins.flatMap(plugin => (plugin.capabilityProviders ?? []).map(provider => ({ pluginId: plugin.id, provider }))),
    ]
    this.projects = new ProjectRegistry(this.store)
    this.workItemProjects = new WorkItemProjectService(this.store.dataDir, () => this.store.listProjects())
    this.settings = new CraftHubSettingsService(this.store.dataDir)
    this.personalConfigRepository = new PersonalConfigRepository(this.store.dataDir)
    this.dotfilesManager = new DotfilesManager(this.store.dataDir, this.personalConfigRepository)
    const configDir = normalizedOptions.configDir ?? getCraftHubConfigDir(process.env)
    this.userConfig = new UserConfigService(configDir, this.store.dataDir)
    this.ownerScopes = new OwnerScopeService(configDir, this.store.dataDir, this.userConfig)
    this.workspaces = new WorkspaceService(configDir, this.store.dataDir, this.projects, this.userConfig, () => this.workspaceSubscriptions.projectedWorkspaces())
    this.workspaceSubscriptions = new WorkspaceSubscriptionService(this.store.dataDir, this.workspaces, [
      ...(normalizedOptions.workspaceRepositoryProviders ?? []),
      ...plugins.flatMap(plugin => plugin.workspaceRepositoryProviders ?? []),
      ...(normalizedOptions.publicWorkspaceRepositories === false ? [] : [publicWorkspaceRepositoryProvider]),
    ], this.ownerScopes)
    this.teamGitSync = new TeamGitSyncService(this.store.dataDir, this.ownerScopes, this.workspaces)
    this.accountSync = new AccountSyncService(this, this.accountProvider?.sync)
    this.teams = new TeamManager(this.ownerScopes, this.teamGitSync, this.workspaces)
    this.workspaceImports = new WorkspaceImportService(this.projects, this.workspaces)
    this.personalGitSync = new PersonalGitSyncService(this.store.dataDir, this.settings, this.workspaces, this.personalConfigRepository)
    this.workAssistant = new WorkAssistant(this.hostEnvironment.kind === 'local' ? normalizedOptions.workAssistantProvider : undefined)
    this.agentTasks = new AgentTaskManager(this.store, this.projects, normalizedOptions.agentTaskProvider)
    this.agentActions = new AgentActionService(this.agentTasks, this.projects, (projectId, locale) => this.capabilityDiscovery(projectId, locale))
  }

  private configurationQueue: Promise<unknown> = Promise.resolve()

  /** Serialize account synchronization with configuration API mutations in this runtime. */
  withConfiguration<T>(action: () => Promise<T>): Promise<T> {
    const next = this.configurationQueue.catch(() => {}).then(action)
    this.configurationQueue = next
    return next
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
    return this.integrationRegistry.resolve([...this.hostIntegrations, ...await this.pluginManager.integrationContributions()])
  }

  /** Collect current host, extension, and configuration failures for client presentation. */
  async diagnosticSnapshot(): Promise<WorkbenchDiagnosticSnapshot> {
    await Promise.allSettled([this.ownerScopes.list(), this.workspaces.list()])
    const [projects, settings, userConfig, plugins, marketplaceSources, integrations, providers] = await Promise.all([
      this.projects.snapshot(),
      this.settings.get(),
      this.userConfig.status(),
      this.pluginManager.listInstalled(),
      this.pluginManager.listSources(),
      this.integrationContributions(),
      readHostDiagnosticProviders(this.diagnosticProviders, this.hostEnvironment.kind === 'local'),
    ])
    return collectWorkbenchDiagnostics({
      hostPlugins: this.getPluginDiagnostics(),
      integrations: integrations.diagnostics,
      marketplaceSources,
      plugins,
      projects,
      settings,
      userConfig,
      providers,
    })
  }

  /** Inspect fixed tools on a local API host, sharing only concurrent requests. */
  async localEnvironmentSnapshot(): Promise<LocalEnvironmentSnapshot> {
    if (this.hostEnvironment.kind !== 'local')
      throw new Error('Local environment inspection is unavailable on a hosted workbench')
    this.environmentInspection ??= inspectLocalEnvironment().finally(() => {
      this.environmentInspection = undefined
    })
    return this.environmentInspection
  }

  /** Browse cached metadata; optionally overlay read-only plugin discovery on local hosts. */
  async softwareCatalogSnapshot({ localDiscovery = true }: { localDiscovery?: boolean } = {}): Promise<SoftwareCatalogSnapshot> {
    const catalog = await this.softwareCatalog.snapshot({ localDiscovery: localDiscovery && this.hostEnvironment.kind === 'local', repositories: await this.softwareSources.catalogs() })
    return { ...catalog, favorites: softwareFavoritesSnapshot(catalog, await this.settings.get()) }
  }

  /** Change favorites while preserving all other home settings, with the caller's inspected revision. */
  async updateSoftwareFavorite(request: unknown): Promise<SoftwareFavoritesSnapshot> {
    this.assertLocalSoftwareManagement()
    const input = softwareFavoriteRequestSchema.parse(request)
    const current = await this.settings.get()
    if (input.revision !== current.revision)
      throw new SettingsConflictError(input.revision, current.revision)
    const catalog = await this.softwareCatalogSnapshot({ localDiscovery: input.action === 'add' })
    const home = current.settings['workbench.home']
    let tools = home.tools
    if (input.action === 'add') {
      const item = catalog.sources.find(source => source.id === input.sourceId)?.items.find(item => item.id === input.softwareId)
      if (!item)
        throw new SoftwareOperationError(404, 'Software is no longer in the catalog. Reload before saving a favorite.')
      if (!findSoftwareFavorite(tools, item))
        tools = [...tools, createSoftwareFavorite(item, input.locale, `software:${randomUUID()}`)]
    }
    else if (input.action === 'replace') {
      tools = input.tools
    }
    else {
      tools = tools.filter(tool => tool.id !== input.toolId)
    }
    const next = personalWorkbenchHomeSchema.parse({ ...home, tools })
    const saved = await this.settings.update({ 'workbench.home': next }, input.revision)
    return softwareFavoritesSnapshot(catalog, saved)
  }

  /** Review selected host software without changing project trust or installing packages. */
  async softwareInstallationPlan(sourceId: string, softwareIds: string[]): Promise<SoftwareInstallationPlan> {
    this.assertLocalSoftwareManagement()
    return this.softwareCatalog.preview(sourceId, softwareIds)
  }

  /** Install an explicitly reviewed adapter plan on this local machine. */
  async installSoftware(sourceId: string, planId: string, confirmed: boolean): Promise<SoftwareInstallationRun> {
    this.assertLocalSoftwareManagement()
    return this.softwareCatalog.install(sourceId, planId, confirmed)
  }

  /** Recover recent adapter-owned software progress after a client refresh. */
  async softwareInstallationRuns(sourceId: string): Promise<SoftwareInstallationRuns> {
    this.assertLocalSoftwareManagement()
    return this.softwareCatalog.runs(sourceId)
  }

  /** Stop active and pending work through the software worker owner. */
  async cancelSoftwareInstallation(sourceId: string, runId: string): Promise<SoftwareInstallationRun> {
    this.assertLocalSoftwareManagement()
    return this.softwareCatalog.cancel(sourceId, runId)
  }

  /** Request a detected application launch through its trusted catalog identifier. */
  async openSoftwareApplication(sourceId: string, softwareId: string): Promise<SoftwareApplicationOpen> {
    this.assertLocalSoftwareManagement()
    return this.softwareCatalog.open(sourceId, softwareId)
  }

  private assertLocalSoftwareManagement(): void {
    if (this.hostEnvironment.kind !== 'local')
      throw new SoftwareOperationError(403, 'Local software management is unavailable on a hosted workbench')
  }

  /** Invoke one enabled declarative integration through a trusted host adapter. */
  /** Observe attempted integration writes after they settle; reads and denied confirmations do not emit. */
  onIntegrationsChanged(listener: (integrationId: string) => void): () => void {
    this.integrationListeners.add(listener)
    return () => this.integrationListeners.delete(listener)
  }

  async invokeIntegrationAction(options: {
    integrationId: string
    callbackUrl?: string
    actionId: string
    projectId?: string
    input?: Record<string, unknown>
    confirmed?: boolean
    reviewedAction?: unknown
    reviewedConnection?: unknown
  }): Promise<IntegrationActionResult> {
    const { integrations } = await this.integrationContributions()
    const contribution = integrations.find(candidate => candidate.id === options.integrationId)
    if (!contribution)
      throw new Error(`Integration contribution is unavailable: ${options.integrationId}`)
    const action = contribution.actions.find(candidate => candidate.id === options.actionId)
    if (!action)
      throw new Error(`Integration action is unavailable: ${options.actionId}`)
    if (options.reviewedAction !== undefined) {
      const reviewed = integrationReviewedActionSchema.parse(options.reviewedAction)
      if (reviewed.operation !== action.operation || reviewed.effect !== action.effect)
        throw new IntegrationReviewChangedError()
    }
    if (action.effectiveConfirmation !== 'never' && options.confirmed !== true)
      throw new IntegrationConfirmationRequiredError(contribution.id, action.id)
    const project = options.projectId ? await this.projects.get(options.projectId) : undefined
    const operation = action.operation
    if (options.reviewedConnection !== undefined) {
      const statusAction = contribution.actions.find(candidate => candidate.operation === 'connection.status')
      if (operation !== 'connection.update' || !statusAction || statusAction.effectiveConfirmation !== 'never')
        throw new IntegrationReviewChangedError()
      const status = await this.integrationRegistry.invoke({
        contribution,
        actionId: statusAction.id,
        context: { hostEnvironment: this.hostEnvironment.kind, ...(project ? { projectId: project.id, projectPath: project.path } : {}), ...(options.input?.locale === 'zh-CN' ? { locale: 'zh-CN' as const } : {}) },
      })
      if (!('connected' in status) || !matchesConnectionReview(status, options.reviewedConnection, options.input ?? {}))
        throw new IntegrationReviewChangedError()
    }
    if (operation === 'resources.update' || operation === 'resources.execute') {
      if (!this.hostEnvironment.capabilities.localProjectDirectories)
        throw new Error('Local project resource operations are unavailable on this host')
      if ((project && project.trust !== 'trusted') || (!project && (operation === 'resources.execute' || options.projectId)))
        throw new Error('Trust a local project before modifying resources or executing actions')
    }
    if (operation?.startsWith('configuration.')) {
      if (this.hostEnvironment.kind !== 'local')
        throw new Error('Configuration management requires a connected local service')
      if (!['configuration.read', 'configuration.list'].includes(operation) && ((project && project.trust !== 'trusted') || (options.projectId && !project)))
        throw new Error('Trust the project before changing configuration')
    }
    const resourceProjects = operation?.startsWith('resources.') ? await this.projects.list() : undefined
    const invoke = (input = options.input): Promise<IntegrationActionResult> => this.integrationRegistry.invoke({
      contribution,
      actionId: options.actionId,
      context: { hostEnvironment: this.hostEnvironment.kind, ...(resourceProjects ? { projects: resourceProjects } : {}), ...(contribution.actions.find(action => action.id === options.actionId)?.operation === 'connection.update' ? { callbackUrl: options.callbackUrl } : {}), ...(project ? { projectId: project.id, projectPath: project.path } : {}), ...(options.input?.locale === 'zh-CN' ? { locale: 'zh-CN' as const } : {}) },
      input,
      confirmed: options.confirmed,
    })
    const connectionAction = contribution.actions.find(action => action.operation === 'connection.status')
    const cacheable = this.hostEnvironment.kind === 'local' && ['work-items.list', 'work-items.search'].includes(operation ?? '')
    const writingWorkItems = this.hostEnvironment.kind === 'local' && operation?.startsWith('work-items.') && contribution.actions.find(action => action.id === options.actionId)?.effect === 'remote-write' && options.confirmed === true
    const readConnection = (): Promise<IntegrationActionResult | undefined> => connectionAction
      ? this.integrationRegistry.invoke({ contribution, actionId: connectionAction.id, context: { hostEnvironment: this.hostEnvironment.kind, ...(project ? { projectId: project.id, projectPath: project.path } : {}), ...(options.input?.locale === 'zh-CN' ? { locale: 'zh-CN' as const } : {}) } })
      : Promise.resolve(undefined)
    // Optional continuity metadata must not prevent the provider's authoritative operation.
    const connection = cacheable || writingWorkItems
      ? await readConnection().catch(() => undefined)
      : undefined
    const session = connection && 'connected' in connection ? connection.session : undefined
    const key = cacheable && session?.cacheReads ? session.cacheKey : undefined
    if (!key) {
      if (cacheable && options.input?.cacheOnly === true)
        return { items: [] }
      try {
        const result = await invoke()
        if (writingWorkItems) {
          // Retain the pre-write identity if a successful write makes the next probe fail.
          const status = await readConnection().catch(() => undefined)
          const keys = new Set([session?.cacheKey, status && 'connected' in status ? status.session?.cacheKey : undefined].filter((value): value is string => Boolean(value)))
          await Promise.all([...keys].map(key => this.integrationLocalState.invalidate(contribution.id, key).catch(() => {})))
        }
        return 'configuration' in result && result.configuration === true && Array.isArray(result.items)
          ? presentConfigurationManagement(result, contribution.provider.id)
          : result
      }
      finally {
        if (action.effect === 'local-write' || action.effect === 'remote-write') {
          for (const listener of this.integrationListeners) {
            try {
              listener(contribution.id)
            }
            catch { /* Observers cannot change the authoritative write result. */ }
          }
        }
      }
    }
    const { cacheOnly, ...input } = options.input ?? {}
    const scope = [options.actionId, project?.path ?? '', input]
    const reason = connection && 'connected' in connection && !connection.connected ? 'authorization' as const : 'offline' as const
    const cached = await this.integrationLocalState.cached(contribution.id, key, scope, cacheOnly === true ? 'preview' : reason)
    if (cacheOnly === true)
      return cached ?? { items: [] }
    if (reason === 'authorization' && cached)
      return cached
    const epoch = this.integrationLocalState.epoch(contribution.id, key)
    let accountChanged = false
    try {
      const result = await invoke(input)
      const current = await readConnection()
      if (!current || !('connected' in current) || current.session?.cacheKey !== key) {
        accountChanged = true
        throw new Error('Account changed during read; refresh to load the current account')
      }
      if ('items' in result && !('configuration' in result)) {
        result.fetchedAt ??= new Date().toISOString()
        await this.integrationLocalState.savePage(contribution.id, key, scope, result, epoch).catch(() => {})
      }
      return result
    }
    catch (error) {
      if (cached && !accountChanged) {
        const current = await readConnection()
        if (current && 'connected' in current && current.session?.cacheKey === key)
          return cached
      }
      throw error
    }
  }

  /** Persist display filters in local, account-isolated storage after validating the installed view. */
  async integrationViewFilters(options: { integrationId: string, viewId: string, blockId: string, projectId?: string, accountKey?: string, filters?: unknown }): Promise<unknown> {
    if (this.hostEnvironment.kind !== 'local')
      throw new Error('Local view state is unavailable on this host')
    const { integrations } = await this.integrationContributions()
    const contribution = integrations.find(item => item.id === options.integrationId)
    const view = contribution?.views.find(item => item.id === options.viewId)
    const block = view?.blocks.find(item => item.id === options.blockId)
    if (!contribution || !view || !block || !['entity-list', 'entity-search'].includes(block.type))
      throw new Error('Integration view is unavailable')
    const project = options.projectId ? await this.projects.get(options.projectId) : undefined
    if ((options.projectId && !project) || (view.scope === 'global' && project) || (view.scope === 'project' && !project))
      throw new Error('Invalid view project scope')
    const action = contribution.actions.find(item => item.operation === 'connection.status')
    if (!action)
      return undefined
    const status = await this.integrationRegistry.invoke({ contribution, actionId: action.id, context: { hostEnvironment: this.hostEnvironment.kind, ...(project ? { projectId: project.id, projectPath: project.path } : {}) } })
    if (!('connected' in status) || !status.session?.cacheKey)
      return undefined
    if (options.accountKey && options.accountKey !== status.session.cacheKey)
      throw new Error('Account changed; refresh before saving filters')
    if (options.filters !== undefined)
      integrationFiltersSchema.parse(options.filters)
    return this.integrationLocalState.filters(contribution.id, status.session.cacheKey, [view.id, block.id, project?.path ?? ''], options.filters)
  }

  /** Finish only an OAuth session previously started through an enabled integration. */
  async completeIntegrationConnection(integrationId: string, input: Record<string, unknown>): Promise<void> {
    const { integrations } = await this.integrationContributions()
    const contribution = integrations.find(item => item.id === integrationId)
    if (!contribution)
      throw new Error('Integration is unavailable')
    await this.integrationRegistry.completeConnection(contribution, input)
  }

  /** Resolve a source from a fresh provider result, never a renderer-supplied path. */
  async integrationSourcePath(integrationId: string, actionId: string, entityId: string, detailIndex: number, projectId?: string): Promise<string> {
    const { integrations } = await this.integrationContributions()
    const action = integrations.find(item => item.id === integrationId)?.actions.find(item => item.id === actionId)
    if (action?.operation !== 'configuration.list' || !Number.isInteger(detailIndex) || detailIndex < 0)
      throw new Error('Invalid configuration source request')
    const result = await this.invokeIntegrationAction({ integrationId, actionId, projectId })
    const path = 'items' in result && !('configuration' in result) ? result.items.find(item => item.id === entityId)?.details?.[detailIndex]?.sourcePath : undefined
    if (!path || !isAbsolute(path))
      throw new Error('Configuration source is unavailable')
    return path
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
    const [project, extensionSettings, contributions] = await Promise.all([
      this.projects.get(projectId),
      this.settings.extensionValues(),
      this.pluginManager.skillContributions(),
    ])
    const [projectConfig, localSkillActivation] = await Promise.all([
      loadProjectConfig(project.path),
      this.store.getSkillActivation(projectId),
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
    const skillActivations = await resolveSkillActivations({
      projectPath: project.path,
      packages: commandContributions.packages,
      contributions,
      project: projectConfig?.capabilities?.skills,
      local: localSkillActivation,
    })
    diagnostics.push(...skillActivations.diagnostics)
    const resolvedCapabilities = [...commandContributions.capabilities, ...skillActivations.capabilities]
    const resolvedIds = new Set<string>()
    await validateCapabilities(resolvedCapabilities, resolvedIds, project.path)
    return {
      capabilities: resolvedCapabilities,
      diagnostics,
      packages: commandContributions.packages,
      skills: skillActivations.skills,
      skillActivation: {
        mode: skillActivations.mode,
        modeSource: skillActivations.modeSource,
        missingPluginIds: skillActivations.missingPluginIds,
      },
      skillWatchPatterns: skillActivations.watchPatterns,
    }
  }

  /** Return effective repository and machine-local Skill activation state. */
  async projectSkills(projectId: string): Promise<ProjectSkillsState> {
    const project = await this.projects.get(projectId)
    const [config, local, discovery] = await Promise.all([
      loadProjectConfig(project.path),
      this.store.getSkillActivation(projectId),
      this.capabilityDiscovery(projectId),
    ])
    return {
      projectId,
      mode: discovery.skillActivation?.mode ?? 'manual',
      modeSource: discovery.skillActivation?.modeSource ?? 'default',
      project: config?.capabilities?.skills ?? {},
      local,
      skills: discovery.skills ?? [],
      missingPluginIds: discovery.skillActivation?.missingPluginIds ?? [],
    }
  }

  /** Replace machine-local Skill preferences after validating their bounded shape. */
  async updateProjectSkills(projectId: string, input: LocalSkillActivationSettings): Promise<ProjectSkillsState> {
    await this.projects.get(projectId)
    const settings = localSkillActivationSettingsSchema.parse(input)
    await this.store.saveSkillActivation(projectId, settings)
    return this.projectSkills(projectId)
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
    return [...this.hostPluginDiagnostics, ...this.diagnostics]
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

  /** Execute a discovered command after trust/input validation; optional host reviews are rechecked before spawn. */
  async run(projectId: string, capabilityId: string, onOutput?: (event: RunOutputEvent) => void, inputs: CommandInputValues = {}, approval?: CommandRunGuard): Promise<RunHandle> {
    const reviewed = approval && { ...approval, capability: structuredClone(approval.capability), inputs: structuredClone(approval.inputs ?? {}) }
    if (reviewed)
      inputs = structuredClone(inputs)
    const project = await this.projects.get(projectId)
    const capability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability)
      throw new Error(`Unknown capability: ${capabilityId}`)
    if (capability.kind !== 'command')
      throw new Error('Skills are inspected or handed to an agent; they are not shell commands')
    if (reviewed)
      assertCommandRunGuardMatches(reviewed, project, capability, inputs)
    if (capability.availability?.available === false)
      throw new Error(capability.availability.diagnostic ?? `Command is unavailable: ${capability.invocation.command}`)
    if (capability.operation?.kind === 'release') {
      const plan = await this.releasePlanner.plan(project, capability, inputs)
      if (plan.blockers.length)
        throw new Error(`Release preflight failed: ${plan.blockers.join(' ')}`)
    }
    const invocation = resolveCommandInvocation(capability, inputs)
    const persistedInvocation = resolvePersistedCommandInvocation(capability, inputs)
    const handle = await executeCommand(this.store, project, { ...capability, invocation } as CommandCapability, onOutput, persistedInvocation, reviewed && {
      validate: async () => {
        const currentCapability = (await this.capabilities(projectId)).find(item => item.id === capabilityId)
        const currentProject = await this.projects.get(projectId)
        assertCommandRunGuardMatches(reviewed, currentProject, currentCapability?.kind === 'command' ? currentCapability : undefined, inputs)
      },
      assertActive: () => assertCommandRunGuardActive(reviewed),
    })
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

  /** Send text or exact terminal protocol bytes to an active run. */
  writeRun(runId: string, data: string | Uint8Array): void {
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
    this.commandReviews.close()
    this.integrationForms.close()
    await this.environmentSources.close()
    await this.agentTasks.cancelAll()
    await this.cancelAllRuns()
    await this.configurationQueue.catch(() => {})
    await this.userConfig.close()
    await this.settings.close()
    const lease = await this.profileLease
    lease?.release()
    this.profileLease = undefined
  }

  /** Hold a shared migration barrier for the lifetime of a host or direct CLI operation. */
  async protectProfile(): Promise<void> {
    this.profileLease ??= acquireProfileLease([resolve(this.store.dataDir), resolve(this.userConfig.configDir)]).catch((error) => {
      this.profileLease = undefined
      throw error
    })
    await this.profileLease
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
