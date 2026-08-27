import type { AgentActionId, AgentActionSummary, AgentTaskRecord, Capability, CapabilityDiscoveryResult, CapabilityPins, CatalogPluginV1, InstalledPlugin, MarketplaceSource, PersonalGitSyncResolution, PersonalGitSyncStatus, ProjectChangeEvent, ProjectRecord, ProjectRunSummary, ProjectVisualInput, RunCleanupOptions, RunCleanupResult, RunRecord, RunStreamEvent, SettingsExportEnvelope, SettingsExportMode, SettingsImportPreview, SettingsImportStrategy, SettingsSnapshot, WorkbenchLocale, WorkspaceCatalog, WorkspaceGroup, WorkspaceImportResult, WorkspaceManifest, WorkspaceRecord, WorkspaceUiState } from 'craft-hub'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok)
    throw new Error(body.error ?? `Request failed: ${response.status}`)
  return body
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

async function runCommand(projectId: string, capabilityId: string, onUpdate: (run: RunRecord) => void): Promise<RunRecord> {
  const response = await fetch(`/api/projects/${projectId}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilityId }),
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
  projects: () => request<ProjectRecord[]>('/api/projects'),
  marketplaceCatalog: () => request<Array<CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }>>('/api/marketplace/catalog'),
  marketplaceSources: () => request<MarketplaceSource[]>('/api/marketplace/sources'),
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
  workspaces: () => request<WorkspaceRecord[]>('/api/workspaces'),
  workspaceGroups: () => request<WorkspaceGroup[]>('/api/workspace-groups'),
  personalGitSyncStatus: () => request<PersonalGitSyncStatus>('/api/personal-git-sync'),
  configurePersonalGitSync: (repositoryPath: string, directory: string) => request<PersonalGitSyncStatus>('/api/personal-git-sync', { method: 'PUT', body: JSON.stringify({ repositoryPath, directory }) }),
  synchronizePersonalGit: (resolution: PersonalGitSyncResolution = 'auto') => request<PersonalGitSyncStatus>('/api/personal-git-sync/synchronize', { method: 'POST', body: JSON.stringify({ resolution }) }),
  createWorkspaceGroup: (name: string) => request<WorkspaceGroup>('/api/workspace-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  renameWorkspaceGroup: (groupId: string, name: string) => request<WorkspaceGroup>(`/api/workspace-groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteWorkspaceGroup: (groupId: string) => request<{ deleted: true }>(`/api/workspace-groups/${groupId}`, { method: 'DELETE' }),
  assignWorkspaceGroup: (workspaceId: string, groupId?: string) => request<WorkspaceRecord>(`/api/workspaces/${workspaceId}/group`, { method: 'PUT', body: JSON.stringify({ groupId }) }),
  importVscodeWorkspaces: (sourceDirectory: string, groupName?: string) => request<WorkspaceImportResult>('/api/workspaces/import/vscode', {
    method: 'POST',
    body: JSON.stringify({ sourceDirectory, groupName }),
  }),
  registerWorkspaceMember: (workspaceId: string, project: string, path?: string) => request<WorkspaceRecord>('/api/workspaces/register-member', {
    method: 'POST',
    body: JSON.stringify({ workspaceId, project, path }),
  }),
  workspaceState: () => request<WorkspaceUiState>('/api/workspaces/state'),
  updateWorkspaceState: (state: WorkspaceUiState) => request<WorkspaceUiState>('/api/workspaces/state', { method: 'PUT', body: JSON.stringify(state) }),
  createWorkspace: (name: string) => request<WorkspaceRecord>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  updateWorkspace: (manifest: WorkspaceManifest, revision: string) => request<WorkspaceRecord>(`/api/workspaces/${manifest.id}`, {
    method: 'PUT',
    body: JSON.stringify({ manifest, revision }),
  }),
  deleteWorkspace: (id: string, revision: string) => request<{ deleted: true }>(`/api/workspaces/${id}`, { method: 'DELETE', body: JSON.stringify({ revision }) }),
  reorderWorkspaces: (workspaceOrder: string[]) => request<WorkspaceCatalog>('/api/workspaces/order', { method: 'PUT', body: JSON.stringify({ workspaceOrder }) }),
  bindWorkspaceProject: (workspaceId: string, project: string, projectId: string) => request<WorkspaceRecord>(`/api/workspaces/${workspaceId}/bindings`, {
    method: 'POST',
    body: JSON.stringify({ project, projectId }),
  }),
  addWorkspaceProject: (workspaceId: string, projectId: string) => request<WorkspaceRecord>(`/api/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  }),
  removeWorkspaceProject: (workspaceId: string, projectIdOrKey: string) => request<WorkspaceRecord>(`/api/workspaces/${workspaceId}/members/${encodeURIComponent(projectIdOrKey)}`, { method: 'DELETE' }),
  capabilities: (projectId: string) => request<Capability[]>(`/api/projects/${projectId}/capabilities`),
  capabilityDiscovery,
  agentActions: (projectId: string, locale: WorkbenchLocale) => request<AgentActionSummary[]>(`/api/projects/${projectId}/agent-actions?locale=${encodeURIComponent(locale)}`),
  startAgentAction: (projectId: string, actionId: AgentActionId, locale: WorkbenchLocale) => request<AgentTaskRecord>(`/api/projects/${projectId}/agent-actions/${actionId}?locale=${encodeURIComponent(locale)}`, { method: 'POST' }),
  capabilityPins: (projectId: string) => request<CapabilityPins>(`/api/projects/${projectId}/pins`),
  updateCapabilityPins: (projectId: string, capabilityIds: string[]) => request<CapabilityPins>(`/api/projects/${projectId}/pins`, {
    method: 'PUT',
    body: JSON.stringify({ capabilityIds }),
  }),
  runSummaries: () => request<ProjectRunSummary[]>('/api/runs/summary'),
  runs: () => request<RunRecord[]>('/api/runs'),
  cleanupRuns: (options: RunCleanupOptions) => request<RunCleanupResult>('/api/runs/cleanup', { method: 'POST', body: JSON.stringify(options) }),
  pinRun: (runId: string, pinned: boolean) => request<RunRecord>(`/api/runs/${runId}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  agentTasks: () => request<AgentTaskRecord[]>('/api/agent-tasks'),
  startAgentTask: (input: { prompt: string, projectIds: string[], primaryProjectId: string, workspaceId?: string }) => request<AgentTaskRecord>('/api/agent-tasks', { method: 'POST', body: JSON.stringify(input) }),
  cancelAgentTask: (id: string) => request<AgentTaskRecord>(`/api/agent-tasks/${id}`, { method: 'DELETE' }),
  trust: (projectId: string) => request<ProjectRecord>(`/api/projects/${projectId}/trust`, { method: 'POST' }),
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
