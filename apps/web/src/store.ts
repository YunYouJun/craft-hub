import type { AgentActionId, AgentActionSummary, AgentTaskRecord, Capability, CapabilityDiscoveryDiagnostic, CommandInputValues, CommandInvocation, CommandPackage, OwnerScope, ProjectAccentColor, ProjectCatalogDiagnostic, ProjectChangeEvent, ProjectConfigInitializationResult, ProjectDescriptionApplication, ProjectDescriptionChange, ProjectOverview, ProjectRecord, ProjectRunSummary, RunRecord, SettingsSnapshot, TeamDeletionResult, TeamGitSyncStatus, UserConfigStatus, WorkbenchCodexSetting, WorkbenchEditorSetting, WorkbenchLocale, WorkbenchTheme, WorkspaceGroup, WorkspaceManifest, WorkspaceRecord } from 'craft-hub'
import { projectConfigSchemaRevision } from 'craft-hub/project-config-schema-revision'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiRequestError } from './api'
import { legacyLocaleStorageKey, useI18n } from './i18n'
import { applyWorkbenchTheme } from './theme'

export type FirstRunStage = 'add-project' | 'select-project' | 'no-capabilities' | 'select-command' | 'trust' | 'run' | 'complete'
export type ProjectsLoadState = 'idle' | 'loading' | 'ready' | 'error'

const recentProjectsStorageKey = 'craft-hub-recent-projects'

function storedRecentProjectIds(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(recentProjectsStorageKey) ?? '[]') as unknown
    return Array.isArray(stored) && stored.every(id => typeof id === 'string') ? stored.slice(0, 8) : []
  }
  catch {
    return []
  }
}

export const useWorkbenchStore = defineStore('workbench', () => {
  const projects = ref<ProjectRecord[]>([])
  const projectsLoadState = ref<ProjectsLoadState>('idle')
  const projectsLoadError = ref('')
  const projectCatalogDiagnostics = ref<ProjectCatalogDiagnostic[]>([])
  const runtimeSchemaMismatch = ref<{ actual: string, expected: string }>()
  const applicationName = ref('Craft Hub')
  const ownerScopes = ref<OwnerScope[]>([])
  const activeOwnerScopeId = ref('personal')
  const activeTeamSyncStatus = ref<TeamGitSyncStatus>()
  const ownerScopeError = ref('')
  const ownerScopeWorkspaceIndex = ref<Array<{ ownerScope: OwnerScope, workspace: WorkspaceRecord }>>([])
  const teamProjectOwnerScopes = ref<Record<string, string[]>>({})
  const workspaces = ref<WorkspaceRecord[]>([])
  const workspaceGroups = ref<WorkspaceGroup[]>([])
  const projectGroupAssignments = ref<Record<string, string>>({})
  const selectedWorkspaceId = ref('')
  const expandedWorkspaceIds = ref<string[]>([])
  const workspaceLoading = ref(false)
  const workspaceError = ref('')
  const workspaceCapabilityProjectId = ref('')
  const workspaceCapabilityId = ref('')
  const agentTasks = ref<AgentTaskRecord[]>([])
  const agentActions = ref<AgentActionSummary[]>([])
  const agentActionDialogOpen = ref(false)
  const selectedProjectId = ref('')
  const recentProjectIds = ref(storedRecentProjectIds())
  const capabilities = ref<Capability[]>([])
  const capabilityDiagnosticsByProject = ref<Record<string, CapabilityDiscoveryDiagnostic[]>>({})
  const commandPackagesByProject = ref<Record<string, CommandPackage[]>>({})
  const paletteItems = ref<Array<{ project: ProjectRecord, capability: Capability }>>([])
  const capabilityPinsByProject = ref<Record<string, string[]>>({})
  const selectedCapabilityId = ref('')
  const selectedPackagePath = ref('')
  const packageCapabilityDrawerOpen = ref(false)
  const projectOverview = ref<ProjectOverview>()
  const projectOverviewLoading = ref(false)
  const projectOverviewError = ref('')
  const recentPackagePaths = ref<string[]>([])
  const run = ref<RunRecord>()
  const runs = ref<RunRecord[]>([])
  const busy = ref(false)
  const runSummaries = ref<ProjectRunSummary[]>([])
  const startingProjectIds = ref<string[]>([])
  const terminalVisible = ref(true)
  const refreshing = ref(false)
  const recentlyUpdated = ref(false)
  const error = ref('')
  const projectConfigInitialization = ref<ProjectConfigInitializationResult>()
  const settings = ref<SettingsSnapshot>()
  const userConfigStatus = ref<UserConfigStatus>()
  let snapshot = ''
  let refreshTail: Promise<void> = Promise.resolve()
  let projectsRefresh: Promise<boolean> | undefined
  let workspaceStateTail: Promise<void> = Promise.resolve()
  let updatedTimer: ReturnType<typeof setTimeout> | undefined
  const runStatusTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const selectedProject = computed(() => projects.value.find(item => item.id === selectedProjectId.value))
  const selectedProjectDiagnostics = computed(() => projectCatalogDiagnostics.value.filter(diagnostic => diagnostic.projectId === selectedProjectId.value))
  const repositoriesRoot = computed(() => settings.value?.settings['workbench.repositoriesRoot'] || undefined)
  const activeOwnerScope = computed(() => ownerScopes.value.find(scope => scope.id === activeOwnerScopeId.value))
  const allWorkspaces = computed(() => workspaces.value)
  const selectedWorkspace = computed(() => allWorkspaces.value.find(item => item.id === selectedWorkspaceId.value))
  const unassignedProjects = computed(() => {
    const assigned = new Set(allWorkspaces.value.flatMap(workspace => workspace.members.map(member => member.projectId).filter(Boolean)))
    const standalone = projects.value.filter(project => !assigned.has(project.id))
    if (activeOwnerScopeId.value === 'personal')
      return standalone.filter(project => !teamProjectOwnerScopes.value[project.id]?.length)
    return standalone.filter(project => teamProjectOwnerScopes.value[project.id]?.includes(activeOwnerScopeId.value))
  })
  const selectedCapability = computed(() => capabilities.value.find(item => item.id === selectedCapabilityId.value))
  const workspaceCapabilityProject = computed(() => projects.value.find(item => item.id === workspaceCapabilityProjectId.value))
  const workspaceCapability = computed(() => paletteItems.value.find(item => item.project.id === workspaceCapabilityProjectId.value
    && item.capability.id === workspaceCapabilityId.value)?.capability)
  const activeProject = computed(() => selectedProject.value ?? workspaceCapabilityProject.value)
  const activeCapability = computed(() => selectedCapability.value ?? workspaceCapability.value)
  const capabilityDiagnostics = computed(() => capabilityDiagnosticsByProject.value[selectedProjectId.value] ?? [])
  const commandPackages = computed(() => commandPackagesByProject.value[selectedProjectId.value] ?? [])
  const selectedPackage = computed(() => commandPackages.value.find(commandPackage => commandPackage.relativePath === selectedPackagePath.value))
  const pinnedCapabilityIds = computed(() => capabilityPinsByProject.value[selectedProjectId.value] ?? [])
  const pinnedCapabilities = computed(() => pinnedCapabilityIds.value
    .map(id => capabilities.value.find(capability => capability.id === id))
    .filter((capability): capability is Capability => Boolean(capability)))
  const projectRuns = computed(() => runs.value.filter(item => item.projectId === selectedProjectId.value))
  const firstRunStage = computed<FirstRunStage>(() => {
    if (!projects.value.length)
      return 'add-project'
    if (!selectedProject.value)
      return 'select-project'
    if (!capabilities.value.length)
      return 'no-capabilities'
    if (selectedCapability.value?.kind !== 'command')
      return 'select-command'
    if (selectedProject.value.trust !== 'trusted')
      return 'trust'
    if (!projectRuns.value.some(item => item.status === 'completed' && item.exitCode === 0))
      return 'run'
    return 'complete'
  })

  function rememberProject(projectId: string): void {
    recentProjectIds.value = [projectId, ...recentProjectIds.value.filter(id => id !== projectId)].slice(0, 8)
    window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(recentProjectIds.value))
  }

  async function applySettings(next: SettingsSnapshot): Promise<void> {
    const previousLocale = settings.value?.settings['workbench.locale']
    settings.value = next
    useI18n().setLocale(next.settings['workbench.locale'])
    applyWorkbenchTheme(next.settings['workbench.theme'])
    if (previousLocale && previousLocale !== next.settings['workbench.locale'] && projects.value.length)
      await refreshProjects(undefined, false)
  }

  async function loadSettings(): Promise<void> {
    let next = await api.settings()
    const legacyLocale = window.localStorage.getItem(legacyLocaleStorageKey)
    if ((legacyLocale === 'en' || legacyLocale === 'zh-CN') && !next.explicitKeys.includes('workbench.locale'))
      next = await api.updateSettings({ 'workbench.locale': legacyLocale }, next.revision)
    window.localStorage.removeItem(legacyLocaleStorageKey)
    await applySettings(next)
  }

  async function loadUserConfigStatus(): Promise<void> {
    userConfigStatus.value = await api.userConfigStatus()
  }

  function applyUserConfigStatus(status: UserConfigStatus): void {
    userConfigStatus.value = status
  }

  async function updateLocale(locale: WorkbenchLocale): Promise<void> {
    if (!settings.value)
      await loadSettings()
    await applySettings(await api.updateSettings({ 'workbench.locale': locale }, settings.value!.revision))
  }

  async function updateTheme(theme: WorkbenchTheme): Promise<void> {
    if (!settings.value)
      await loadSettings()
    await applySettings(await api.updateSettings({ 'workbench.theme': theme }, settings.value!.revision))
  }

  async function updateEditorSetting(editor: WorkbenchEditorSetting): Promise<void> {
    if (!settings.value)
      await loadSettings()
    await applySettings(await api.updateSettings({ 'workbench.editor': editor }, settings.value!.revision))
  }

  async function updateCodexSetting(codex: WorkbenchCodexSetting): Promise<void> {
    if (!settings.value)
      await loadSettings()
    const value = Object.keys(codex).length ? codex : null
    await applySettings(await api.updateSettings({ 'workbench.codex': value }, settings.value!.revision))
  }

  async function updateShortcuts(shortcuts: Record<string, string>): Promise<void> {
    if (!settings.value)
      await loadSettings()
    await applySettings(await api.updateSettings({ 'workbench.shortcuts': shortcuts }, settings.value!.revision))
  }

  async function updateRepositoriesRoot(path: string): Promise<void> {
    if (!settings.value)
      await loadSettings()
    await applySettings(await api.updateSettings({ 'workbench.repositoriesRoot': path.trim() || null }, settings.value!.revision))
  }

  function announceUpdate(): void {
    recentlyUpdated.value = true
    if (updatedTimer)
      clearTimeout(updatedTimer)
    updatedTimer = setTimeout(() => {
      recentlyUpdated.value = false
    }, 2400)
  }

  function selectFrom(nextCapabilities: Capability[], previousCapability = selectedCapability.value): void {
    const nextCapability = nextCapabilities.find(capability => capability.id === selectedCapabilityId.value)
      ?? nextCapabilities.find(capability => capability.kind === previousCapability?.kind
        && capability.name === previousCapability.name
        && capability.source === previousCapability.source)
    if (selectedCapabilityId.value !== (nextCapability?.id ?? ''))
      run.value = undefined
    selectedCapabilityId.value = nextCapability?.id ?? ''
    if (!selectedCapabilityId.value)
      packageCapabilityDrawerOpen.value = false
  }

  function currentSnapshot(): string {
    return JSON.stringify(projects.value.map(project => ({
      project,
      capabilities: paletteItems.value
        .filter(item => item.project.id === project.id)
        .map(item => item.capability),
      pins: {
        projectId: project.id,
        capabilityIds: capabilityPinsByProject.value[project.id] ?? [],
      },
      diagnostics: capabilityDiagnosticsByProject.value[project.id] ?? [],
      packages: commandPackagesByProject.value[project.id] ?? [],
    })))
  }

  async function loadProjects(initialProjectId?: string): Promise<void> {
    await refreshProjects(initialProjectId, false)
  }

  async function loadOwnerScopes(): Promise<void> {
    ownerScopeError.value = ''
    try {
      const [nextScopes, state, nextProjectOwnerScopes] = await Promise.all([api.ownerScopes(), api.ownerScopeState(), api.projectOwnerScopes()])
      ownerScopes.value = nextScopes
      teamProjectOwnerScopes.value = nextProjectOwnerScopes
      activeOwnerScopeId.value = nextScopes.some(scope => scope.id === state.activeScopeId) ? state.activeScopeId : 'personal'
      if (activeOwnerScopeId.value !== 'personal')
        await refreshActiveTeamSyncStatus()
      else
        activeTeamSyncStatus.value = undefined
    }
    catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        ownerScopes.value = [{ id: 'personal', kind: 'personal', name: 'Personal' }]
        activeOwnerScopeId.value = 'personal'
        teamProjectOwnerScopes.value = {}
        return
      }
      ownerScopeError.value = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async function switchOwnerScope(ownerScopeId: string): Promise<void> {
    if (ownerScopeId === activeOwnerScopeId.value || !ownerScopes.value.some(scope => scope.id === ownerScopeId))
      return
    await api.activateOwnerScope(ownerScopeId)
    activeOwnerScopeId.value = ownerScopeId
    selectedWorkspaceId.value = ''
    selectedProjectId.value = ''
    capabilities.value = []
    agentActions.value = []
    clearWorkspaceCapability()
    await loadWorkspaces()
    await loadWorkspaceState()
    if (ownerScopeId !== 'personal')
      await refreshActiveTeamSyncStatus()
    else
      activeTeamSyncStatus.value = undefined
  }

  async function createTeam(name: string, repositoryPath: string, directory?: string): Promise<OwnerScope> {
    const team = await api.createTeam(name, repositoryPath, directory)
    ownerScopes.value = [...ownerScopes.value, team]
    await switchOwnerScope(team.id)
    return team
  }

  async function renameTeam(ownerScopeId: string, name: string): Promise<OwnerScope> {
    const team = await api.renameTeam(ownerScopeId, name)
    ownerScopes.value = ownerScopes.value.map(scope => scope.id === ownerScopeId ? team : scope)
    if (activeTeamSyncStatus.value?.ownerScopeId === ownerScopeId)
      await refreshActiveTeamSyncStatus()
    return team
  }

  async function deleteTeam(ownerScopeId: string, confirmationName: string): Promise<TeamDeletionResult> {
    const result = await api.deleteTeam(ownerScopeId, confirmationName)
    ownerScopes.value = ownerScopes.value.filter(scope => scope.id !== ownerScopeId)
    teamProjectOwnerScopes.value = Object.fromEntries(Object.entries(teamProjectOwnerScopes.value)
      .map(([projectId, ownerScopeIds]) => [projectId, ownerScopeIds.filter(id => id !== ownerScopeId)] as const)
      .filter(([, ownerScopeIds]) => ownerScopeIds.length))
    if (activeOwnerScopeId.value === ownerScopeId) {
      activeOwnerScopeId.value = 'personal'
      activeTeamSyncStatus.value = undefined
      selectedWorkspaceId.value = ''
      selectedProjectId.value = ''
      await loadWorkspaces()
      await loadWorkspaceState()
    }
    return result
  }

  async function loadOwnerScopeWorkspaceIndex(): Promise<void> {
    ownerScopeWorkspaceIndex.value = (await Promise.all(ownerScopes.value.map(async ownerScope => ({
      ownerScope,
      workspaces: await api.workspaces(ownerScope.id),
    })))).flatMap(entry => entry.workspaces.map(workspace => ({ ownerScope: entry.ownerScope, workspace })))
  }

  async function jumpToWorkspace(ownerScopeId: string, workspaceId: string): Promise<void> {
    if (ownerScopeId !== activeOwnerScopeId.value)
      await switchOwnerScope(ownerScopeId)
    if (workspaces.value.some(workspace => workspace.id === workspaceId))
      selectWorkspace(workspaceId)
  }

  async function refreshActiveTeamSyncStatus(): Promise<TeamGitSyncStatus | undefined> {
    if (activeOwnerScopeId.value === 'personal') {
      activeTeamSyncStatus.value = undefined
      return undefined
    }
    activeTeamSyncStatus.value = await api.teamGitSyncStatus(activeOwnerScopeId.value)
    return activeTeamSyncStatus.value
  }

  async function synchronizeActiveTeam(resolution: 'auto' | 'use-local' | 'use-repository' = 'auto'): Promise<void> {
    if (activeOwnerScopeId.value === 'personal')
      return
    activeTeamSyncStatus.value = await api.synchronizeTeamGit(activeOwnerScopeId.value, resolution)
    await loadWorkspaces()
    await loadWorkspaceState()
  }

  async function loadWorkspaces(): Promise<void> {
    workspaceLoading.value = true
    workspaceError.value = ''
    try {
      const [nextWorkspaces, nextGroups, nextProjectGroups] = await Promise.all([
        api.workspaces(activeOwnerScopeId.value),
        api.workspaceGroups(activeOwnerScopeId.value),
        api.projectGroupAssignments(activeOwnerScopeId.value),
      ])
      workspaces.value = nextWorkspaces
      workspaceGroups.value = nextGroups
      projectGroupAssignments.value = nextProjectGroups
      updateActiveTeamProjectOwnerScopes()
      if (selectedWorkspaceId.value && !nextWorkspaces.some(workspace => workspace.id === selectedWorkspaceId.value)) {
        selectedWorkspaceId.value = ''
        clearWorkspaceCapability()
      }
    }
    catch (caught) {
      workspaceError.value = caught instanceof Error ? caught.message : String(caught)
      throw caught
    }
    finally {
      workspaceLoading.value = false
    }
  }

  function updateActiveTeamProjectOwnerScopes(): void {
    const ownerScopeId = activeOwnerScopeId.value
    if (ownerScopeId === 'personal')
      return
    const ownedProjectIds = new Set([
      ...Object.keys(projectGroupAssignments.value),
      ...workspaces.value.flatMap(workspace => workspace.members.map(member => member.projectId).filter((projectId): projectId is string => Boolean(projectId))),
    ])
    const next = Object.fromEntries(Object.entries(teamProjectOwnerScopes.value)
      .map(([projectId, ownerScopeIds]) => [projectId, ownerScopeIds.filter(id => id !== ownerScopeId)] as const)
      .filter(([, ownerScopeIds]) => ownerScopeIds.length))
    for (const projectId of ownedProjectIds)
      next[projectId] = [...(next[projectId] ?? []), ownerScopeId]
    teamProjectOwnerScopes.value = next
  }

  async function loadWorkspaceState(preferredProjectId?: string): Promise<string | undefined> {
    const state = await api.workspaceState(activeOwnerScopeId.value)
    expandedWorkspaceIds.value = state.expandedWorkspaceIds
    if (preferredProjectId)
      return preferredProjectId
    if (state.selectedWorkspaceId && allWorkspaces.value.some(workspace => workspace.id === state.selectedWorkspaceId)) {
      selectedWorkspaceId.value = state.selectedWorkspaceId
      selectedProjectId.value = ''
      capabilities.value = []
      agentActions.value = []
      selectedCapabilityId.value = ''
      packageCapabilityDrawerOpen.value = false
      return
    }
    if (state.selectedProjectId) {
      if (projects.value.some(project => project.id === state.selectedProjectId))
        await selectProject(state.selectedProjectId)
      return state.selectedProjectId
    }
  }

  function persistWorkspaceState(): void {
    const ownerScopeId = activeOwnerScopeId.value
    const state = {
      expandedWorkspaceIds: expandedWorkspaceIds.value,
      selectedWorkspaceId: selectedWorkspaceId.value || undefined,
      selectedProjectId: selectedProjectId.value || undefined,
    }
    workspaceStateTail = workspaceStateTail
      .then(async () => { await api.updateWorkspaceState(state, ownerScopeId) })
      .catch(() => {})
  }

  async function createWorkspace(name: string, projectPaths: string[] = [], projectLabels: Record<string, string> = {}): Promise<void> {
    const ownerScopeId = activeOwnerScopeId.value
    let workspace = await api.createWorkspace(name, ownerScopeId)
    for (const path of [...new Set(projectPaths)]) {
      const project = await api.addProject(path)
      const updatedWorkspace = await api.addWorkspaceProject(workspace.id, project.id, ownerScopeId)
      const label = projectLabels[path]?.trim()
      if (label) {
        workspace = updatedWorkspace
        const manifest = workspaceManifest(workspace)
        const member = manifest.members.find(item => item.project === workspace.members.find(item => item.projectId === project.id)?.project)
        if (member) {
          member.label = label
          workspace = await api.updateWorkspace(manifest, workspace.revision, ownerScopeId)
        }
      }
    }
    await Promise.all([
      projectPaths.length ? loadProjects() : Promise.resolve(),
      loadWorkspaces(),
    ])
    if (projectPaths.length && !expandedWorkspaceIds.value.includes(workspace.id))
      toggleWorkspaceExpanded(workspace.id)
    selectWorkspace(workspace.id)
  }

  function selectWorkspace(id: string): void {
    selectedWorkspaceId.value = id
    selectedProjectId.value = ''
    capabilities.value = []
    agentActions.value = []
    selectedCapabilityId.value = ''
    packageCapabilityDrawerOpen.value = false
    run.value = undefined
    clearWorkspaceCapability()
    persistWorkspaceState()
  }

  function selectWorkspaceCapability(projectId: string, capabilityId: string): void {
    workspaceCapabilityProjectId.value = projectId
    workspaceCapabilityId.value = capabilityId
    run.value = undefined
    terminalVisible.value = true
  }

  function clearWorkspaceCapability(): void {
    workspaceCapabilityProjectId.value = ''
    workspaceCapabilityId.value = ''
    run.value = undefined
  }

  function toggleWorkspaceExpanded(id: string): void {
    expandedWorkspaceIds.value = expandedWorkspaceIds.value.includes(id)
      ? expandedWorkspaceIds.value.filter(item => item !== id)
      : [...expandedWorkspaceIds.value, id]
    persistWorkspaceState()
  }

  function workspaceProjects(workspace: WorkspaceRecord): ProjectRecord[] {
    return workspace.members
      .map(member => projects.value.find(project => project.id === member.projectId))
      .filter((project): project is ProjectRecord => Boolean(project))
  }

  async function addProjectToWorkspace(workspaceId: string, projectId: string): Promise<void> {
    await api.addWorkspaceProject(workspaceId, projectId, activeOwnerScopeId.value)
    await loadWorkspaces()
    if (!expandedWorkspaceIds.value.includes(workspaceId))
      toggleWorkspaceExpanded(workspaceId)
  }

  async function addProjectPathToWorkspace(workspaceId: string, path: string): Promise<void> {
    const project = await api.addProject(path)
    await api.addWorkspaceProject(workspaceId, project.id, activeOwnerScopeId.value)
    await Promise.all([loadProjects(), loadWorkspaces()])
    if (!expandedWorkspaceIds.value.includes(workspaceId))
      toggleWorkspaceExpanded(workspaceId)
  }

  async function removeProjectFromWorkspace(workspaceId: string, projectIdOrKey: string): Promise<void> {
    await api.removeWorkspaceProject(workspaceId, projectIdOrKey, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function locateWorkspaceProject(workspaceId: string, projectKey: string, path: string): Promise<void> {
    const project = await api.addProject(path)
    await api.bindWorkspaceProject(workspaceId, projectKey, project.id, activeOwnerScopeId.value)
    await Promise.all([loadProjects(), loadWorkspaces()])
  }

  async function deleteWorkspace(workspace: WorkspaceRecord): Promise<void> {
    await api.deleteWorkspace(workspace.id, workspace.revision, activeOwnerScopeId.value)
    if (selectedWorkspaceId.value === workspace.id)
      selectedWorkspaceId.value = ''
    await loadWorkspaces()
  }

  async function unregisterProject(projectId: string): Promise<void> {
    await api.unregisterProject(projectId)
    await Promise.all([loadProjects(), loadWorkspaces()])
  }

  async function updateWorkspace(workspace: WorkspaceRecord, update: (manifest: WorkspaceManifest) => void): Promise<void> {
    const manifest = workspaceManifest(workspace)
    update(manifest)
    const saved = await api.updateWorkspace(manifest, workspace.revision, activeOwnerScopeId.value)
    workspaces.value = workspaces.value.map(item => item.id === saved.id ? saved : item)
  }

  async function toggleWorkspacePin(workspace: WorkspaceRecord): Promise<void> {
    await updateWorkspace(workspace, (manifest) => {
      manifest.pinned = !manifest.pinned || undefined
    })
    await loadWorkspaces()
  }

  async function setWorkspaceAppearance(workspace: WorkspaceRecord, appearance: { name: string, icon?: string, color?: ProjectAccentColor }): Promise<void> {
    await updateWorkspace(workspace, (manifest) => {
      manifest.name = appearance.name
      manifest.icon = appearance.icon || undefined
      manifest.color = appearance.color
    })
  }

  async function setProjectVisual(projectId: string, icon?: string, color?: ProjectAccentColor): Promise<void> {
    const updated = await api.updateProjectVisual(projectId, { icon: icon || undefined, color })
    projects.value = projects.value.map(project => project.id === updated.id ? updated : project)
  }

  async function setWorkspaceProjectLabel(workspace: WorkspaceRecord, projectId: string, label?: string): Promise<void> {
    const member = workspace.members.find(item => item.projectId === projectId)
    if (!member)
      return
    await updateWorkspace(workspace, (manifest) => {
      const target = manifest.members.find(item => item.project === member.project)
      if (target)
        target.label = label?.trim() || undefined
    })
  }

  async function toggleWorkspaceProjectPin(workspace: WorkspaceRecord, projectId: string): Promise<void> {
    const member = workspace.members.find(item => item.projectId === projectId)
    if (!member)
      return
    await updateWorkspace(workspace, (manifest) => {
      const target = manifest.members.find(item => item.project === member.project)!
      target.pinned = !target.pinned || undefined
      manifest.members.sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)))
    })
  }

  async function moveWorkspaceProject(workspace: WorkspaceRecord, projectId: string, direction: -1 | 1): Promise<void> {
    const member = workspace.members.find(item => item.projectId === projectId)
    if (!member)
      return
    await updateWorkspace(workspace, (manifest) => {
      const index = manifest.members.findIndex(item => item.project === member.project)
      const target = index + direction
      if (target < 0 || target >= manifest.members.length)
        return
      const [moved] = manifest.members.splice(index, 1)
      manifest.members.splice(target, 0, moved!)
    })
  }

  async function reorderWorkspaceProject(workspace: WorkspaceRecord, projectId: string, targetProjectId: string): Promise<void> {
    const member = workspace.members.find(item => item.projectId === projectId)
    const targetMember = workspace.members.find(item => item.projectId === targetProjectId)
    if (!member || !targetMember || member.project === targetMember.project || Boolean(member.pinned) !== Boolean(targetMember.pinned))
      return
    await updateWorkspace(workspace, (manifest) => {
      const sourceIndex = manifest.members.findIndex(item => item.project === member.project)
      const targetIndex = manifest.members.findIndex(item => item.project === targetMember.project)
      const [moved] = manifest.members.splice(sourceIndex, 1)
      manifest.members.splice(targetIndex, 0, moved!)
    })
  }

  async function reorderWorkspace(workspaceId: string, targetWorkspaceId: string): Promise<void> {
    const source = workspaces.value.find(item => item.id === workspaceId)
    const target = workspaces.value.find(item => item.id === targetWorkspaceId)
    if (!source || !target || source.id === target.id || Boolean(source.pinned) !== Boolean(target.pinned))
      return
    const order = workspaces.value.map(item => item.id)
    const sourceIndex = order.indexOf(source.id)
    const targetIndex = order.indexOf(target.id)
    order.splice(sourceIndex, 1)
    order.splice(targetIndex, 0, source.id)
    if (source.groupId !== target.groupId)
      await api.assignWorkspaceGroup(source.id, target.groupId, activeOwnerScopeId.value)
    await api.reorderWorkspaces(order, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function reorderProject(projectId: string, targetProjectId: string): Promise<void> {
    if (projectId === targetProjectId)
      return
    const order = projects.value.map(project => project.id)
    const sourceIndex = order.indexOf(projectId)
    const targetIndex = order.indexOf(targetProjectId)
    if (sourceIndex < 0 || targetIndex < 0)
      return
    order.splice(sourceIndex, 1)
    order.splice(targetIndex, 0, projectId)
    projects.value = await api.reorderProjects(order)
  }

  async function makePrimaryProject(workspace: WorkspaceRecord, projectId: string): Promise<void> {
    const member = workspace.members.find(item => item.projectId === projectId)
    if (member) {
      await updateWorkspace(workspace, (manifest) => {
        manifest.primaryProject = member.project
      })
    }
  }

  async function registerWorkspaceMember(workspace: WorkspaceRecord, projectKey: string, path?: string): Promise<void> {
    await api.registerWorkspaceMember(workspace.id, projectKey, path, activeOwnerScopeId.value)
    await Promise.all([loadProjects(), loadWorkspaces()])
  }

  async function previewVscodeWorkspaces(sourceDirectory: string, groupName?: string): Promise<import('craft-hub').WorkspaceImportPreview> {
    return api.previewVscodeWorkspaces(sourceDirectory, groupName, activeOwnerScopeId.value)
  }

  async function importVscodeWorkspaces(sourceDirectory: string, groupName: string | undefined, expectedRevision: string): Promise<import('craft-hub').WorkspaceImportResult> {
    const imported = await api.importVscodeWorkspaces(sourceDirectory, groupName, expectedRevision, activeOwnerScopeId.value)
    if (!imported.validation.valid)
      throw new Error(imported.validation.issues.join('; '))
    await loadWorkspaces()
    selectWorkspace(imported.workspaces[0]!.id)
    return imported
  }

  async function createWorkspaceGroup(name: string): Promise<WorkspaceGroup> {
    const group = await api.createWorkspaceGroup(name, activeOwnerScopeId.value)
    await loadWorkspaces()
    return group
  }

  async function assignWorkspaceGroup(workspaceId: string, groupId?: string): Promise<void> {
    await api.assignWorkspaceGroup(workspaceId, groupId, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function assignProjectGroup(projectId: string, groupId?: string): Promise<void> {
    projectGroupAssignments.value = await api.assignProjectGroup(projectId, groupId, activeOwnerScopeId.value)
  }

  async function renameWorkspaceGroup(groupId: string, name: string): Promise<void> {
    await api.renameWorkspaceGroup(groupId, name, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function setWorkspaceGroupAppearance(groupId: string, icon?: string): Promise<void> {
    await api.updateWorkspaceGroupAppearance(groupId, icon, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function deleteWorkspaceGroup(groupId: string): Promise<void> {
    await api.deleteWorkspaceGroup(groupId, activeOwnerScopeId.value)
    await loadWorkspaces()
  }

  async function loadAgentTasks(): Promise<void> {
    agentTasks.value = await api.agentTasks()
  }

  async function loadAgentActions(projectId = selectedProjectId.value, locale?: WorkbenchLocale): Promise<void> {
    if (!projectId) {
      agentActions.value = []
      return
    }
    const targetLocale = locale ?? settings.value?.settings['workbench.locale'] ?? 'en'
    agentActions.value = await api.agentActions(projectId, targetLocale)
  }

  function applyAgentTask(task: AgentTaskRecord): void {
    agentTasks.value = [task, ...agentTasks.value.filter(item => item.id !== task.id)]
    if (task.actionId && task.projectIds.includes(selectedProjectId.value) && task.status !== 'running')
      void loadAgentActions().catch(() => {})
  }

  async function startAgentTask(prompt: string, projectIds: string[], primaryProjectId: string, workspaceId?: string, capabilityId?: string): Promise<AgentTaskRecord> {
    const task = await api.startAgentTask({ prompt, projectIds, primaryProjectId, workspaceId, capabilityId })
    applyAgentTask(task)
    return task
  }

  async function startAgentAction(actionId: AgentActionId, locale: WorkbenchLocale): Promise<AgentTaskRecord> {
    if (!selectedProject.value)
      throw new Error('Select a project before starting an agent action')
    const task = await api.startAgentAction(selectedProject.value.id, actionId, locale)
    applyAgentTask(task)
    return task
  }

  async function applyProjectDescriptionProposal(taskId: string, changes: ProjectDescriptionChange[]): Promise<ProjectDescriptionApplication> {
    if (!selectedProject.value)
      throw new Error('Select a project before applying descriptions')
    const application = await api.applyProjectDescriptionProposal(selectedProject.value.id, taskId, changes)
    await Promise.all([selectProject(selectedProject.value.id), loadAgentTasks()])
    return application
  }

  async function loadRunSummaries(): Promise<void> {
    for (const summary of await api.runSummaries())
      applyRunSummary(summary)
  }

  function applyRunSummary(summary: ProjectRunSummary): void {
    runSummaries.value = [
      ...runSummaries.value.filter(item => item.projectId !== summary.projectId),
      summary,
    ]
    if (summary.running > 0)
      startingProjectIds.value = startingProjectIds.value.filter(id => id !== summary.projectId)

    const existingTimer = runStatusTimers.get(summary.projectId)
    if (existingTimer)
      clearTimeout(existingTimer)
    if (summary.running === 0 && summary.lastStatus) {
      const elapsed = summary.lastFinishedAt ? Date.now() - Date.parse(summary.lastFinishedAt) : 0
      const remaining = Math.max(0, 2400 - elapsed)
      if (remaining === 0) {
        clearRunResult(summary.projectId)
        return
      }
      runStatusTimers.set(summary.projectId, setTimeout(clearRunResult, remaining, summary.projectId))
    }
  }

  function clearRunResult(projectId: string): void {
    runStatusTimers.delete(projectId)
    runSummaries.value = runSummaries.value.map(summary => summary.projectId === projectId
      ? { projectId: summary.projectId, running: summary.running }
      : summary)
  }

  function projectRunSummary(projectId: string): ProjectRunSummary | undefined {
    return runSummaries.value.find(summary => summary.projectId === projectId)
  }

  function isProjectStarting(projectId: string): boolean {
    return startingProjectIds.value.includes(projectId)
  }

  function enqueueRefresh(operation: () => Promise<boolean>): Promise<boolean> {
    const result = refreshTail.then(operation)
    refreshTail = result.then(() => {}, () => {})
    return result
  }

  function refreshProjects(initialProjectId?: string, announce = true): Promise<boolean> {
    if (projectsRefresh)
      return projectsRefresh
    projectsRefresh = enqueueRefresh(() => performProjectsRefresh(initialProjectId, announce))
    projectsRefresh.then(
      () => { projectsRefresh = undefined },
      () => { projectsRefresh = undefined },
    )
    return projectsRefresh
  }

  async function performProjectsRefresh(initialProjectId?: string, announce = true): Promise<boolean> {
    refreshing.value = true
    projectsLoadState.value = 'loading'
    projectsLoadError.value = ''
    try {
      const previousCapability = selectedCapability.value
      const previousProjectId = selectedProjectId.value
      const [catalog, health] = await Promise.all([
        api.projects(),
        api.runtimeHealth().catch(() => undefined),
      ])
      const nextProjects = catalog.projects
      projects.value = nextProjects
      const projectIds = new Set(nextProjects.map(project => project.id))
      recentProjectIds.value = recentProjectIds.value.filter(id => projectIds.has(id))
      window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(recentProjectIds.value))
      projectCatalogDiagnostics.value = catalog.diagnostics
      runtimeSchemaMismatch.value = health && health.projectConfigSchemaRevision !== projectConfigSchemaRevision
        ? { actual: health.projectConfigSchemaRevision, expected: projectConfigSchemaRevision }
        : undefined
      if (health?.distribution.name) {
        applicationName.value = health.distribution.name
        document.title = applicationName.value
        document.documentElement.style.setProperty('--desktop-product-name', JSON.stringify(applicationName.value))
      }
      const groups = await Promise.all(nextProjects.map(async (project) => {
        const [discovery, pins] = await Promise.all([
          api.capabilityDiscovery(project.id).catch(caught => ({
            capabilities: [],
            packages: [],
            diagnostics: [{
              source: 'project' as const,
              path: project.path,
              message: caught instanceof Error ? caught.message : String(caught),
            }],
          })),
          api.capabilityPins(project.id).catch(() => ({ projectId: project.id, capabilityIds: [] })),
        ])
        return { project, capabilities: discovery.capabilities, diagnostics: discovery.diagnostics, packages: discovery.packages ?? [], pins }
      }))
      const nextSnapshot = JSON.stringify(groups)
      const changed = snapshot !== '' && snapshot !== nextSnapshot
      const nextProject = selectedWorkspace.value
        ? undefined
        : nextProjects.find(project => project.id === selectedProjectId.value)
          ?? nextProjects.find(project => project.id === initialProjectId)
          ?? nextProjects[0]
      const nextCapabilities = groups.find(group => group.project.id === nextProject?.id)?.capabilities ?? []

      paletteItems.value = groups.flatMap(group => group.capabilities.map(capability => ({ project: group.project, capability })))
      capabilityPinsByProject.value = Object.fromEntries(groups.map(group => [group.project.id, group.pins.capabilityIds]))
      capabilityDiagnosticsByProject.value = Object.fromEntries(groups.map(group => [group.project.id, group.diagnostics]))
      commandPackagesByProject.value = Object.fromEntries(groups.map(group => [group.project.id, group.packages]))
      selectedProjectId.value = nextProject?.id ?? ''
      if (nextProject)
        rememberProject(nextProject.id)
      if (selectedProjectId.value !== previousProjectId) {
        selectedPackagePath.value = ''
        try {
          const stored = JSON.parse(window.localStorage.getItem(`craft-hub-recent-packages:${selectedProjectId.value}`) ?? '[]') as unknown
          recentPackagePaths.value = Array.isArray(stored) && stored.every(path => typeof path === 'string') ? stored.slice(0, 4) : []
        }
        catch {
          recentPackagePaths.value = []
        }
      }
      capabilities.value = nextCapabilities
      agentActions.value = nextProject
        ? await api.agentActions(nextProject.id, settings.value?.settings['workbench.locale'] ?? 'en').catch(() => [])
        : []
      selectFrom(nextCapabilities, previousCapability)
      if (nextProject && !selectedCapabilityId.value)
        await loadProjectOverview(selectedPackagePath.value || '.')
      else if (!nextProject)
        projectOverview.value = undefined
      snapshot = nextSnapshot

      if (changed && announce)
        announceUpdate()
      projectsLoadState.value = 'ready'
      return changed
    }
    catch (caught) {
      projectsLoadState.value = 'error'
      projectsLoadError.value = caught instanceof Error ? caught.message : String(caught)
      throw caught
    }
    finally {
      refreshing.value = false
    }
  }

  function refreshProject(event: ProjectChangeEvent): Promise<boolean> {
    return enqueueRefresh(() => performProjectRefresh(event))
  }

  async function performProjectRefresh(event: ProjectChangeEvent): Promise<boolean> {
    refreshing.value = true
    try {
      let changed = false
      if (event.scopes.includes('project')) {
        const catalog = await api.projects()
        const nextProjects = catalog.projects
        changed ||= JSON.stringify(projects.value) !== JSON.stringify(nextProjects)
        projects.value = nextProjects
        projectCatalogDiagnostics.value = catalog.diagnostics
        paletteItems.value = paletteItems.value.map(item => ({
          ...item,
          project: nextProjects.find(project => project.id === item.project.id) ?? item.project,
        }))
      }
      if (event.scopes.includes('capabilities')) {
        const project = projects.value.find(item => item.id === event.projectId)
        if (project) {
          const [discovery, pins] = await Promise.all([
            api.capabilityDiscovery(project.id),
            api.capabilityPins(project.id),
          ])
          const nextCapabilities = discovery.capabilities
          const previousCapabilities = paletteItems.value
            .filter(item => item.project.id === project.id)
            .map(item => item.capability)
          changed ||= JSON.stringify(previousCapabilities) !== JSON.stringify(nextCapabilities)
          paletteItems.value = [
            ...paletteItems.value.filter(item => item.project.id !== project.id),
            ...nextCapabilities.map(capability => ({ project, capability })),
          ]
          capabilityPinsByProject.value = {
            ...capabilityPinsByProject.value,
            [project.id]: pins.capabilityIds,
          }
          capabilityDiagnosticsByProject.value = {
            ...capabilityDiagnosticsByProject.value,
            [project.id]: discovery.diagnostics,
          }
          commandPackagesByProject.value = {
            ...commandPackagesByProject.value,
            [project.id]: discovery.packages ?? [],
          }
          if (selectedProjectId.value === project.id) {
            const previousCapability = selectedCapability.value
            capabilities.value = nextCapabilities
            selectFrom(nextCapabilities, previousCapability)
            await loadAgentActions(project.id)
          }
        }
      }
      if (selectedProjectId.value === event.projectId && (event.scopes.includes('overview') || event.scopes.includes('capabilities'))) {
        const packagePath = commandPackages.value.some(commandPackage => commandPackage.relativePath === selectedPackagePath.value)
          ? selectedPackagePath.value || '.'
          : '.'
        if (packagePath === '.')
          selectedPackagePath.value = ''
        await loadProjectOverview(packagePath)
      }
      snapshot = currentSnapshot()
      if (changed)
        announceUpdate()
      return changed
    }
    finally {
      refreshing.value = false
    }
  }

  async function loadProjectOverview(packagePath = selectedPackagePath.value || '.'): Promise<void> {
    if (!selectedProjectId.value)
      return
    projectOverviewLoading.value = true
    projectOverviewError.value = ''
    try {
      projectOverview.value = await api.projectOverview(
        selectedProjectId.value,
        packagePath,
        settings.value?.settings['workbench.locale'] ?? 'en',
      )
    }
    catch (caught) {
      projectOverview.value = undefined
      projectOverviewError.value = caught instanceof Error ? caught.message : String(caught)
    }
    finally {
      projectOverviewLoading.value = false
    }
  }

  async function selectPackage(packagePath: string): Promise<void> {
    if (!commandPackages.value.some(commandPackage => commandPackage.relativePath === packagePath))
      return
    selectedPackagePath.value = packagePath
    selectedCapabilityId.value = ''
    packageCapabilityDrawerOpen.value = false
    run.value = undefined
    if (selectedProjectId.value && packagePath !== '.') {
      recentPackagePaths.value = [packagePath, ...recentPackagePaths.value.filter(path => path !== packagePath)].slice(0, 4)
      window.localStorage.setItem(`craft-hub-recent-packages:${selectedProjectId.value}`, JSON.stringify(recentPackagePaths.value))
    }
    await loadProjectOverview(packagePath)
  }

  async function clearPackageSelection(): Promise<void> {
    selectedPackagePath.value = ''
    selectedCapabilityId.value = ''
    packageCapabilityDrawerOpen.value = false
    run.value = undefined
    await loadProjectOverview('.')
  }

  function selectCapability(capabilityId: string, packagePath?: string): void {
    if (!capabilities.value.some(capability => capability.id === capabilityId))
      return
    if (packagePath !== undefined)
      selectedPackagePath.value = packagePath
    selectedCapabilityId.value = capabilityId
    packageCapabilityDrawerOpen.value = false
    run.value = undefined
  }

  function openPackageCapability(capabilityId: string, packagePath: string): void {
    if (!capabilities.value.some(capability => capability.id === capabilityId))
      return
    selectedPackagePath.value = packagePath
    selectedCapabilityId.value = capabilityId
    packageCapabilityDrawerOpen.value = true
    run.value = undefined
  }

  function closePackageCapabilityDrawer(): void {
    packageCapabilityDrawerOpen.value = false
    selectedCapabilityId.value = ''
  }

  async function selectProject(id: string): Promise<void> {
    if (!projects.value.some(project => project.id === id))
      return
    clearWorkspaceCapability()
    selectedWorkspaceId.value = ''
    selectedProjectId.value = id
    rememberProject(id)
    const nextCapabilities = paletteItems.value
      .filter(item => item.project.id === id)
      .map(item => item.capability)
    capabilities.value = nextCapabilities
    selectedCapabilityId.value = ''
    selectedPackagePath.value = ''
    packageCapabilityDrawerOpen.value = false
    try {
      const stored = JSON.parse(window.localStorage.getItem(`craft-hub-recent-packages:${id}`) ?? '[]') as unknown
      recentPackagePaths.value = Array.isArray(stored) && stored.every(path => typeof path === 'string') ? stored.slice(0, 4) : []
    }
    catch {
      recentPackagePaths.value = []
    }
    run.value = undefined
    await Promise.all([
      loadAgentActions(id),
      loadProjectOverview('.'),
    ])
    persistWorkspaceState()
  }

  async function addProject(path: string): Promise<void> {
    const project = await api.addProject(path)
    await loadProjects()
    await selectProject(project.id)
  }

  async function previewProjectConfigInitialization(): Promise<ProjectConfigInitializationResult | undefined> {
    if (!selectedProject.value)
      return undefined
    projectConfigInitialization.value = await api.initializeProjectConfig(selectedProject.value.id, 'preview')
    return projectConfigInitialization.value
  }

  async function applyProjectConfigInitialization(): Promise<ProjectConfigInitializationResult | undefined> {
    if (!selectedProject.value || !projectConfigInitialization.value)
      return undefined
    projectConfigInitialization.value = await api.initializeProjectConfig(
      selectedProject.value.id,
      'apply',
      projectConfigInitialization.value.revision,
    )
    await refreshProject({ projectId: selectedProject.value.id, scopes: ['project', 'capabilities'] })
    return projectConfigInitialization.value
  }

  async function trustProjectById(projectId: string): Promise<boolean> {
    if (!projects.value.some(project => project.id === projectId))
      return false
    busy.value = true
    error.value = ''
    try {
      const updated = await api.trust(projectId)
      projects.value = projects.value.map(project => project.id === updated.id ? updated : project)
      return true
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return false
    }
    finally {
      busy.value = false
    }
  }

  async function trustProject(): Promise<boolean> {
    return activeProject.value ? trustProjectById(activeProject.value.id) : false
  }

  async function trustAndRunSelected(inputs: CommandInputValues = {}): Promise<boolean> {
    if (!await trustProject())
      return false
    void runSelected(inputs)
    return true
  }

  function isCapabilityPinned(projectId: string, capabilityId: string): boolean {
    return (capabilityPinsByProject.value[projectId] ?? []).includes(capabilityId)
  }

  async function setCapabilityPinOrder(capabilityIds: string[], projectId = selectedProjectId.value): Promise<boolean> {
    if (!projectId)
      return false
    error.value = ''
    try {
      const pins = await api.updateCapabilityPins(projectId, capabilityIds)
      capabilityPinsByProject.value = {
        ...capabilityPinsByProject.value,
        [projectId]: pins.capabilityIds,
      }
      return true
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
      return false
    }
  }

  async function toggleCapabilityPin(capabilityId: string, projectId = selectedProjectId.value): Promise<boolean> {
    const current = capabilityPinsByProject.value[projectId] ?? []
    const next = current.includes(capabilityId)
      ? current.filter(id => id !== capabilityId)
      : [...current, capabilityId]
    return setCapabilityPinOrder(next, projectId)
  }

  async function previewSelectedCommand(inputs: CommandInputValues = {}): Promise<CommandInvocation | undefined> {
    if (!activeProject.value || activeCapability.value?.kind !== 'command')
      return undefined
    return api.previewCommand(activeProject.value.id, activeCapability.value.id, inputs)
  }

  async function runSelected(inputs: CommandInputValues = {}): Promise<void> {
    if (!activeProject.value || activeCapability.value?.kind !== 'command')
      return
    const projectId = activeProject.value.id
    const capabilityId = activeCapability.value.id
    busy.value = true
    startingProjectIds.value = [...new Set([...startingProjectIds.value, projectId])]
    terminalVisible.value = true
    error.value = ''
    run.value = undefined
    try {
      run.value = await api.run(projectId, capabilityId, inputs, (nextRun) => {
        run.value = nextRun
        startingProjectIds.value = startingProjectIds.value.filter(id => id !== projectId)
      })
      rememberRun(run.value)
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
    finally {
      startingProjectIds.value = startingProjectIds.value.filter(id => id !== projectId)
      busy.value = false
    }
  }

  async function stopRun(): Promise<void> {
    if (!run.value || run.value.status !== 'running')
      return
    try {
      const runId = run.value.id
      const stopped = await api.cancelRun(runId)
      if (run.value?.id === runId) {
        run.value = stopped
        rememberRun(stopped)
      }
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  function closeTerminal(): void {
    if (busy.value)
      return
    run.value = undefined
    terminalVisible.value = false
  }

  async function toggleCurrentRunPin(): Promise<void> {
    if (run.value) {
      run.value = await api.pinRun(run.value.id, !run.value.pinned)
      rememberRun(run.value)
    }
  }

  function rememberRun(nextRun: RunRecord): void {
    runs.value = [nextRun, ...runs.value.filter(item => item.id !== nextRun.id)]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
  }

  async function loadRuns(): Promise<void> {
    runs.value = await api.runs()
  }

  function openRun(nextRun: RunRecord): void {
    run.value = nextRun
    terminalVisible.value = true
    error.value = ''
  }

  async function writeRunInput(data: string): Promise<void> {
    if (run.value?.status !== 'running')
      return
    try {
      await api.writeRun(run.value.id, data)
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  async function resizeRun(columns: number, rows: number): Promise<void> {
    if (run.value?.status !== 'running')
      return
    try {
      await api.resizeRun(run.value.id, columns, rows)
    }
    catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }

  return {
    projects,
    projectsLoadState,
    projectsLoadError,
    projectCatalogDiagnostics,
    selectedProjectDiagnostics,
    runtimeSchemaMismatch,
    applicationName,
    ownerScopes,
    activeOwnerScopeId,
    activeOwnerScope,
    activeTeamSyncStatus,
    ownerScopeError,
    ownerScopeWorkspaceIndex,
    teamProjectOwnerScopes,
    workspaces,
    workspaceGroups,
    projectGroupAssignments,
    allWorkspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    expandedWorkspaceIds,
    workspaceLoading,
    workspaceError,
    workspaceCapabilityProjectId,
    workspaceCapabilityId,
    workspaceCapabilityProject,
    workspaceCapability,
    activeProject,
    activeCapability,
    unassignedProjects,
    agentTasks,
    agentActions,
    agentActionDialogOpen,
    selectedProjectId,
    recentProjectIds,
    capabilities,
    capabilityDiagnostics,
    capabilityDiagnosticsByProject,
    commandPackages,
    commandPackagesByProject,
    selectedPackagePath,
    selectedPackage,
    packageCapabilityDrawerOpen,
    projectOverview,
    projectOverviewLoading,
    projectOverviewError,
    recentPackagePaths,
    paletteItems,
    capabilityPinsByProject,
    selectedCapabilityId,
    selectedProject,
    selectedCapability,
    pinnedCapabilityIds,
    pinnedCapabilities,
    run,
    runs,
    projectRuns,
    firstRunStage,
    busy,
    runSummaries,
    startingProjectIds,
    terminalVisible,
    refreshing,
    recentlyUpdated,
    error,
    projectConfigInitialization,
    settings,
    userConfigStatus,
    repositoriesRoot,
    applySettings,
    loadSettings,
    loadUserConfigStatus,
    applyUserConfigStatus,
    updateLocale,
    updateRepositoriesRoot,
    updateCodexSetting,
    updateEditorSetting,
    updateShortcuts,
    updateTheme,
    loadProjects,
    loadOwnerScopes,
    switchOwnerScope,
    createTeam,
    renameTeam,
    deleteTeam,
    refreshActiveTeamSyncStatus,
    synchronizeActiveTeam,
    loadOwnerScopeWorkspaceIndex,
    jumpToWorkspace,
    loadWorkspaces,
    loadWorkspaceState,
    createWorkspace,
    selectWorkspace,
    selectWorkspaceCapability,
    clearWorkspaceCapability,
    toggleWorkspaceExpanded,
    workspaceProjects,
    addProjectToWorkspace,
    addProjectPathToWorkspace,
    removeProjectFromWorkspace,
    locateWorkspaceProject,
    deleteWorkspace,
    unregisterProject,
    toggleWorkspacePin,
    setWorkspaceAppearance,
    setProjectVisual,
    setWorkspaceProjectLabel,
    toggleWorkspaceProjectPin,
    moveWorkspaceProject,
    reorderWorkspaceProject,
    reorderWorkspace,
    reorderProject,
    makePrimaryProject,
    registerWorkspaceMember,
    previewVscodeWorkspaces,
    importVscodeWorkspaces,
    createWorkspaceGroup,
    assignWorkspaceGroup,
    assignProjectGroup,
    renameWorkspaceGroup,
    setWorkspaceGroupAppearance,
    deleteWorkspaceGroup,
    loadAgentTasks,
    loadAgentActions,
    applyAgentTask,
    startAgentTask,
    startAgentAction,
    applyProjectDescriptionProposal,
    loadRunSummaries,
    loadRuns,
    applyRunSummary,
    projectRunSummary,
    isProjectStarting,
    refreshProjects,
    refreshProject,
    selectProject,
    loadProjectOverview,
    selectPackage,
    clearPackageSelection,
    selectCapability,
    openPackageCapability,
    closePackageCapabilityDrawer,
    addProject,
    previewProjectConfigInitialization,
    applyProjectConfigInitialization,
    trustProjectById,
    trustProject,
    trustAndRunSelected,
    isCapabilityPinned,
    setCapabilityPinOrder,
    toggleCapabilityPin,
    previewSelectedCommand,
    runSelected,
    stopRun,
    closeTerminal,
    toggleCurrentRunPin,
    openRun,
    writeRunInput,
    resizeRun,
  }
})

function workspaceManifest(workspace: WorkspaceRecord): WorkspaceManifest {
  return {
    schemaVersion: 1,
    id: workspace.id,
    ownerScopeId: workspace.ownerScopeId === 'personal' ? undefined : workspace.ownerScopeId,
    name: workspace.name,
    icon: workspace.icon,
    color: workspace.color,
    pinned: workspace.pinned,
    primaryProject: workspace.primaryProject,
    members: workspace.members.map(({ project, label, pinned, discoveryHint }) => ({ project, label, pinned, discoveryHint })),
  }
}
