import type { AgentActionId, AgentActionSummary, AgentTaskRecord, Capability, CapabilityDiscoveryResult, CapabilityPins, CatalogPluginV1, CommandInputValues, CommandInvocation, InstalledPlugin, MarketplaceSource, MarketplaceSourcePreview, OwnerScope, OwnerScopeUiState, PersonalGitSyncResolution, PersonalGitSyncStatus, ProjectCatalogSnapshot, ProjectChangeEvent, ProjectConfigInitializationResult, ProjectDescriptionApplication, ProjectDescriptionAudit, ProjectDescriptionChange, ProjectRecord, ProjectRunSummary, ProjectVisualInput, ReleasePlan, RunCleanupOptions, RunCleanupResult, RunRecord, RunStreamEvent, RuntimeHealth, SettingsExportEnvelope, SettingsExportMode, SettingsImportPreview, SettingsImportStrategy, SettingsSnapshot, TeamDeletionResult, TeamGitSyncStatus, WorkbenchLocale, WorkspaceCatalog, WorkspaceGroup, WorkspaceImportPreview, WorkspaceImportResult, WorkspaceManifest, WorkspaceRecord, WorkspaceUiState } from 'craft-hub'

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok)
    throw new ApiRequestError(body.error ?? `Request failed: ${response.status}`, response.status)
  return body
}

function scopedPath(path: string, ownerScopeId: string): string {
  if (ownerScopeId === 'personal')
    return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}ownerScopeId=${encodeURIComponent(ownerScopeId)}`
}

async function capabilityDiscovery(projectId: string): Promise<CapabilityDiscoveryResult> {
  try {
    const result = await request<CapabilityDiscoveryResult | Capability[]>(`/api/projects/${projectId}/capability-discovery`)
    return Array.isArray(result) ? { capabilities: result, diagnostics: [] } : result
  }
  catch {
    return { capabilities: await request<Capability[]>(`/api/projects/${projectId}/capabilities`), diagnostics: [] }
  }
}

async function projectCatalog(): Promise<ProjectCatalogSnapshot> {
  const result = await request<ProjectCatalogSnapshot | ProjectRecord[]>('/api/projects')
  return Array.isArray(result) ? { projects: result, diagnostics: [] } : result
}

async function runtimeHealth(): Promise<RuntimeHealth | undefined> {
  const result = await request<unknown>('/api/health')
  if (!result || typeof result !== 'object')
    return undefined
  const health = result as Partial<RuntimeHealth>
  return health.status === 'ok' && typeof health.projectConfigSchemaRevision === 'string'
    ? health as RuntimeHealth
    : undefined
}

async function runCommand(projectId: string, capabilityId: string, inputs: CommandInputValues, onUpdate: (run: RunRecord) => void): Promise<RunRecord> {
  const response = await fetch(`/api/projects/${projectId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilityId, inputs }),
  })
  if (!response.ok) {
    const body = await response.json() as { error?: string }
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  }
  if (!response.body)
    throw new Error('Command stream is unavailable')

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  let current: RunRecord | undefined

  while (true) {
    const { done, value = '' } = await reader.read()
    buffered += value
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    if (done && buffered)
      lines.push(buffered)

    for (const line of lines) {
      if (!line)
        continue
      const event = JSON.parse(line) as RunStreamEvent
      if (event.type === 'start' || event.type === 'complete')
        current = event.run
      else if (current)
        current = { ...current, [event.stream]: current[event.stream] + event.chunk }
      if (current)
        onUpdate({ ...current })
    }
    if (done)
      break
  }

  if (!current)
    throw new Error('Command stream ended without a run record')
  return current
}

export const api = {
  runtimeHealth,
  ownerScopes: () => request<OwnerScope[]>('/api/owner-scopes'),
  ownerScopeState: () => request<OwnerScopeUiState>('/api/owner-scopes/state'),
  createTeam: (name: string, repositoryPath: string, directory?: string) => request<OwnerScope>('/api/owner-scopes', { method: 'POST', body: JSON.stringify({ name, repositoryPath, directory }) }),
  renameTeam: (ownerScopeId: string, name: string) => request<OwnerScope>(`/api/owner-scopes/${encodeURIComponent(ownerScopeId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTeam: (ownerScopeId: string, confirmationName: string) => request<TeamDeletionResult>(`/api/owner-scopes/${encodeURIComponent(ownerScopeId)}`, { method: 'DELETE', body: JSON.stringify({ confirmationName }) }),
  activateOwnerScope: (activeScopeId: string) => request<OwnerScopeUiState>('/api/owner-scopes/state', { method: 'PUT', body: JSON.stringify({ activeScopeId }) }),
  teamGitSyncStatus: (ownerScopeId: string) => request<TeamGitSyncStatus>(`/api/owner-scopes/${encodeURIComponent(ownerScopeId)}/git-sync`),
  synchronizeTeamGit: (ownerScopeId: string, resolution: PersonalGitSyncResolution = 'auto') => request<TeamGitSyncStatus>(`/api/owner-scopes/${encodeURIComponent(ownerScopeId)}/git-sync/synchronize`, { method: 'POST', body: JSON.stringify({ resolution }) }),
  projectOwnerScopes: () => request<Record<string, string[]>>('/api/projects/owner-scopes'),
  projects: projectCatalog,
  marketplaceCatalog: () => request<Array<CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }>>('/api/marketplace/catalog'),
  marketplaceSources: () => request<MarketplaceSource[]>('/api/marketplace/sources'),
  previewMarketplaceSource: (input: { name?: string, catalogUrl: string, registry?: string }) => request<MarketplaceSourcePreview>('/api/marketplace/sources/preview', { method: 'POST', body: JSON.stringify(input) }),
  addMarketplaceSource: (input: { name: string, catalogUrl: string, registry?: string }) => request<MarketplaceSource>('/api/marketplace/sources', { method: 'POST', body: JSON.stringify(input) }),
  removeMarketplaceSource: (sourceId: string) => request<{ deleted: true }>(`/api/marketplace/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }),
  refreshMarketplaceSource: (sourceId: string) => request<MarketplaceSource>(`/api/marketplace/sources/${encodeURIComponent(sourceId)}/refresh`, { method: 'POST' }),
  installedPlugins: () => request<InstalledPlugin[]>('/api/plugins'),
  installPlugin: (sourceId: string, packageName: string, version?: string) => request<InstalledPlugin>('/api/plugins/install', { method: 'POST', body: JSON.stringify({ sourceId, package: packageName, version }) }),
  setPluginEnabled: (packageName: string, enabled: boolean) => request<InstalledPlugin>(`/api/plugins/${encodeURIComponent(packageName)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  rollbackPlugin: (packageName: string) => request<InstalledPlugin>(`/api/plugins/${encodeURIComponent(packageName)}/rollback`, { method: 'POST' }),
  removePlugin: (packageName: string, deleteData = false) => request<{ deleted: true }>(`/api/plugins/${encodeURIComponent(packageName)}`, { method: 'DELETE', body: JSON.stringify({ deleteData }) }),
  addProject: (path: string) => request<ProjectRecord>('/api/projects', { method: 'POST', body: JSON.stringify({ path }) }),
  updateProjectVisual: (projectId: string, visual: ProjectVisualInput) => request<ProjectRecord>(`/api/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(visual) }),
  reorderProjects: (projectOrder: string[]) => request<ProjectRecord[]>('/api/projects/order', { method: 'PUT', body: JSON.stringify({ projectOrder }) }),
  unregisterProject: (projectId: string) => request<ProjectRecord>(`/api/projects/${projectId}`, { method: 'DELETE' }),
  workspaces: (ownerScopeId = 'personal') => request<WorkspaceRecord[]>(scopedPath('/api/workspaces', ownerScopeId)),
  workspaceGroups: (ownerScopeId = 'personal') => request<WorkspaceGroup[]>(scopedPath('/api/workspace-groups', ownerScopeId)),
  projectGroupAssignments: (ownerScopeId = 'personal') => request<Record<string, string>>(scopedPath('/api/workspace-groups/project-assignments', ownerScopeId)),
  personalGitSyncStatus: () => request<PersonalGitSyncStatus>('/api/personal-git-sync'),
  configurePersonalGitSync: (repositoryPath: string, directory: string) => request<PersonalGitSyncStatus>('/api/personal-git-sync', { method: 'PUT', body: JSON.stringify({ repositoryPath, directory }) }),
  synchronizePersonalGit: (resolution: PersonalGitSyncResolution = 'auto') => request<PersonalGitSyncStatus>('/api/personal-git-sync/synchronize', { method: 'POST', body: JSON.stringify({ resolution }) }),
  createWorkspaceGroup: (name: string, ownerScopeId = 'personal') => request<WorkspaceGroup>(scopedPath('/api/workspace-groups', ownerScopeId), { method: 'POST', body: JSON.stringify({ name }) }),
  renameWorkspaceGroup: (groupId: string, name: string, ownerScopeId = 'personal') => request<WorkspaceGroup>(scopedPath(`/api/workspace-groups/${groupId}`, ownerScopeId), { method: 'PUT', body: JSON.stringify({ name }) }),
  updateWorkspaceGroupAppearance: (groupId: string, icon: string | undefined, ownerScopeId = 'personal') => request<WorkspaceGroup>(scopedPath(`/api/workspace-groups/${groupId}`, ownerScopeId), { method: 'PATCH', body: JSON.stringify({ icon }) }),
  deleteWorkspaceGroup: (groupId: string, ownerScopeId = 'personal') => request<{ deleted: true }>(scopedPath(`/api/workspace-groups/${groupId}`, ownerScopeId), { method: 'DELETE' }),
  assignWorkspaceGroup: (workspaceId: string, groupId: string | undefined, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath(`/api/workspaces/${workspaceId}/group`, ownerScopeId), { method: 'PUT', body: JSON.stringify({ groupId }) }),
  assignProjectGroup: (projectId: string, groupId: string | undefined, ownerScopeId = 'personal') => request<Record<string, string>>(scopedPath(`/api/projects/${projectId}/group`, ownerScopeId), { method: 'PUT', body: JSON.stringify({ groupId }) }),
  previewVscodeWorkspaces: (sourceDirectory: string, groupName: string | undefined, ownerScopeId = 'personal') => request<WorkspaceImportPreview>(scopedPath('/api/workspaces/import/vscode/preview', ownerScopeId), {
    method: 'POST',
    body: JSON.stringify({ sourceDirectory, groupName }),
  }),
  importVscodeWorkspaces: (sourceDirectory: string, groupName: string | undefined, expectedRevision: string, ownerScopeId = 'personal') => request<WorkspaceImportResult>(scopedPath('/api/workspaces/import/vscode', ownerScopeId), {
    method: 'POST',
    body: JSON.stringify({ sourceDirectory, groupName, expectedRevision }),
  }),
  registerWorkspaceMember: (workspaceId: string, project: string, path: string | undefined, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath('/api/workspaces/register-member', ownerScopeId), {
    method: 'POST',
    body: JSON.stringify({ workspaceId, project, path }),
  }),
  workspaceState: (ownerScopeId = 'personal') => request<WorkspaceUiState>(scopedPath('/api/workspaces/state', ownerScopeId)),
  updateWorkspaceState: (state: WorkspaceUiState, ownerScopeId = 'personal') => request<WorkspaceUiState>(scopedPath('/api/workspaces/state', ownerScopeId), { method: 'PUT', body: JSON.stringify(state) }),
  createWorkspace: (name: string, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath('/api/workspaces', ownerScopeId), { method: 'POST', body: JSON.stringify({ name }) }),
  updateWorkspace: (manifest: WorkspaceManifest, revision: string, ownerScopeId = manifest.ownerScopeId ?? 'personal') => request<WorkspaceRecord>(scopedPath(`/api/workspaces/${manifest.id}`, ownerScopeId), {
    method: 'PUT',
    body: JSON.stringify({ manifest, revision }),
  }),
  deleteWorkspace: (id: string, revision: string, ownerScopeId = 'personal') => request<{ deleted: true }>(scopedPath(`/api/workspaces/${id}`, ownerScopeId), { method: 'DELETE', body: JSON.stringify({ revision }) }),
  reorderWorkspaces: (workspaceOrder: string[], ownerScopeId = 'personal') => request<WorkspaceCatalog>(scopedPath('/api/workspaces/order', ownerScopeId), { method: 'PUT', body: JSON.stringify({ workspaceOrder }) }),
  bindWorkspaceProject: (workspaceId: string, project: string, projectId: string, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath(`/api/workspaces/${workspaceId}/bindings`, ownerScopeId), {
    method: 'POST',
    body: JSON.stringify({ project, projectId }),
  }),
  addWorkspaceProject: (workspaceId: string, projectId: string, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath(`/api/workspaces/${workspaceId}/members`, ownerScopeId), {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  }),
  removeWorkspaceProject: (workspaceId: string, projectIdOrKey: string, ownerScopeId = 'personal') => request<WorkspaceRecord>(scopedPath(`/api/workspaces/${workspaceId}/members/${encodeURIComponent(projectIdOrKey)}`, ownerScopeId), { method: 'DELETE' }),
  capabilities: (projectId: string) => request<Capability[]>(`/api/projects/${projectId}/capabilities`),
  capabilityDiscovery,
  agentActions: (projectId: string, locale: WorkbenchLocale) => request<AgentActionSummary[]>(`/api/projects/${projectId}/agent-actions?locale=${encodeURIComponent(locale)}`),
  projectDescriptionAudit: (projectId: string, locale: WorkbenchLocale) => request<ProjectDescriptionAudit>(`/api/projects/${projectId}/agent-actions/improve-project-config/audit?locale=${encodeURIComponent(locale)}`),
  startAgentAction: (projectId: string, actionId: AgentActionId, locale: WorkbenchLocale) => request<AgentTaskRecord>(`/api/projects/${projectId}/agent-actions/${actionId}?locale=${encodeURIComponent(locale)}`, { method: 'POST' }),
  applyProjectDescriptionProposal: (projectId: string, taskId: string, changes: ProjectDescriptionChange[]) => request<ProjectDescriptionApplication>(`/api/projects/${projectId}/agent-actions/improve-project-config/apply`, {
    method: 'POST',
    body: JSON.stringify({ taskId, changes }),
  }),
  capabilityPins: (projectId: string) => request<CapabilityPins>(`/api/projects/${projectId}/pins`),
  updateCapabilityPins: (projectId: string, capabilityIds: string[]) => request<CapabilityPins>(`/api/projects/${projectId}/pins`, {
    method: 'PUT',
    body: JSON.stringify({ capabilityIds }),
  }),
  previewCommand: (projectId: string, capabilityId: string, inputs: CommandInputValues) => request<CommandInvocation>(`/api/projects/${projectId}/preview-command`, {
    method: 'POST',
    body: JSON.stringify({ capabilityId, inputs }),
  }),
  releasePlan: (projectId: string, capabilityId: string) => request<ReleasePlan>(`/api/projects/${projectId}/release-plan/${encodeURIComponent(capabilityId)}`),
  runSummaries: () => request<ProjectRunSummary[]>('/api/runs/summary'),
  runs: () => request<RunRecord[]>('/api/runs'),
  cleanupRuns: (options: RunCleanupOptions) => request<RunCleanupResult>('/api/runs/cleanup', { method: 'POST', body: JSON.stringify(options) }),
  pinRun: (runId: string, pinned: boolean) => request<RunRecord>(`/api/runs/${runId}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  agentTasks: () => request<AgentTaskRecord[]>('/api/agent-tasks'),
  startAgentTask: (input: { prompt: string, projectIds: string[], primaryProjectId: string, capabilityId?: string, workspaceId?: string }) => request<AgentTaskRecord>('/api/agent-tasks', { method: 'POST', body: JSON.stringify(input) }),
  cancelAgentTask: (id: string) => request<AgentTaskRecord>(`/api/agent-tasks/${id}`, { method: 'DELETE' }),
  trust: (projectId: string) => request<ProjectRecord>(`/api/projects/${projectId}/trust`, { method: 'POST' }),
  initializeProjectConfig: (projectId: string, mode: 'preview' | 'apply', expectedRevision?: string) => request<ProjectConfigInitializationResult>(`/api/projects/${projectId}/config/initialize`, {
    method: 'POST',
    body: JSON.stringify({ mode, expectedRevision }),
  }),
  run: runCommand,
  cancelRun: (runId: string) => request<RunRecord>(`/api/runs/${runId}`, { method: 'DELETE' }),
  resizeRun: (runId: string, columns: number, rows: number) => request<{ accepted: true }>(`/api/runs/${runId}/resize`, {
    method: 'POST',
    body: JSON.stringify({ columns, rows }),
  }),
  writeRun: (runId: string, data: string) => request<{ accepted: true }>(`/api/runs/${runId}/input`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  }),
  settings: () => request<SettingsSnapshot>('/api/settings'),
  updateSettings: (settings: Record<string, unknown>, revision: string) => request<SettingsSnapshot>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ revision, settings }),
  }),
  exportSettings: (mode: SettingsExportMode) => request<SettingsExportEnvelope>('/api/settings/export', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  }),
  previewSettingsImport: (document: unknown, strategy: SettingsImportStrategy) => request<SettingsImportPreview>('/api/settings/import/preview', {
    method: 'POST',
    body: JSON.stringify({ document, strategy }),
  }),
  importSettings: (document: unknown, strategy: SettingsImportStrategy, revision: string) => request<SettingsSnapshot>('/api/settings/import', {
    method: 'POST',
    body: JSON.stringify({ document, strategy, revision }),
  }),
}

export interface ProjectChangeSubscription {
  onChange: (event: ProjectChangeEvent) => void
  onRunChange?: (summary: ProjectRunSummary) => void
  onSettingsChange?: (snapshot: SettingsSnapshot) => void
  onAgentTaskChange?: (task: AgentTaskRecord) => void
  onPluginChange?: () => void
  onError?: () => void
  onOpen?: () => void
}

export function subscribeToProjectChanges(subscription: ProjectChangeSubscription): () => void {
  const events = new EventSource('/api/events')
  events.addEventListener('open', () => subscription.onOpen?.())
  events.addEventListener('error', () => subscription.onError?.())
  events.addEventListener('project-change', (event) => {
    try {
      subscription.onChange(JSON.parse((event as MessageEvent<string>).data) as ProjectChangeEvent)
    }
    catch {
      // Ignore malformed local events and wait for the next valid update.
    }
  })
  events.addEventListener('run-change', (event) => {
    try {
      subscription.onRunChange?.(JSON.parse((event as MessageEvent<string>).data) as ProjectRunSummary)
    }
    catch {
      // Ignore malformed local events and wait for the next valid update.
    }
  })
  events.addEventListener('settings-change', (event) => {
    try {
      subscription.onSettingsChange?.(JSON.parse((event as MessageEvent<string>).data) as SettingsSnapshot)
    }
    catch {
      // Ignore malformed local events and wait for the next valid update.
    }
  })
  events.addEventListener('agent-task-change', (event) => {
    try {
      subscription.onAgentTaskChange?.(JSON.parse((event as MessageEvent<string>).data) as AgentTaskRecord)
    }
    catch {
      // Ignore malformed local events and wait for the next valid update.
    }
  })
  events.addEventListener('plugin-change', () => subscription.onPluginChange?.())
  return () => events.close()
}
