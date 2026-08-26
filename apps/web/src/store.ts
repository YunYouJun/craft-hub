import type { AgentActionId, AgentActionSummary, AgentTaskRecord, Capability, ProjectAccentColor, ProjectChangeEvent, ProjectRecord, ProjectRunSummary, RunRecord, SettingsSnapshot, WorkbenchLocale, WorkbenchTheme, WorkspaceManifest, WorkspaceRecord } from 'craft-hub'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from './api'
import { legacyLocaleStorageKey, useI18n } from './i18n'
import { applyWorkbenchTheme } from './theme'

export const useWorkbenchStore = defineStore('workbench', () => {
  const projects = ref<ProjectRecord[]>([])
  const workspaces = ref<WorkspaceRecord[]>([])
  const selectedWorkspaceId = ref('')
  const expandedWorkspaceIds = ref<string[]>([])
  const agentTasks = ref<AgentTaskRecord[]>([])
  const agentActions = ref<AgentActionSummary[]>([])
  const agentActionDialogOpen = ref(false)
  const selectedProjectId = ref('')
  const capabilities = ref<Capability[]>([])
  const paletteItems = ref<Array<{ project: ProjectRecord, capability: Capability }>>([])
  const capabilityPinsByProject = ref<Record<string, string[]>>({})
  const selectedCapabilityId = ref('')
  const run = ref<RunRecord>()
  const busy = ref(false)
  const runSummaries = ref<ProjectRunSummary[]>([])
  const startingProjectIds = ref<string[]>([])
  const terminalVisible = ref(true)
  const refreshing = ref(false)
  const recentlyUpdated = ref(false)
  const error = ref('')
  const settings = ref<SettingsSnapshot>()
  let snapshot = ''
  let refreshTail: Promise<void> = Promise.resolve()
  let workspaceStateTail: Promise<void> = Promise.resolve()
  let updatedTimer: ReturnType<typeof setTimeout> | undefined
  const runStatusTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const selectedProject = computed(() => projects.value.find(item => item.id === selectedProjectId.value))
  const selectedWorkspace = computed(() => workspaces.value.find(item => item.id === selectedWorkspaceId.value))
  const unassignedProjects = computed(() => {
    const assigned = new Set(workspaces.value.flatMap(workspace => workspace.members.map(member => member.projectId).filter(Boolean)))
    return projects.value.filter(project => !assigned.has(project.id))
  })
  const selectedCapability = computed(() => capabilities.value.find(item => item.id === selectedCapabilityId.value))
  const pinnedCapabilityIds = computed(() => capabilityPinsByProject.value[selectedProjectId.value] ?? [])
  const pinnedCapabilities = computed(() => pinnedCapabilityIds.value
    .map(id => capabilities.value.find(capability => capability.id === id))
    .filter((capability): capability is Capability => Boolean(capability)))

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

  function announceUpdate(): void {
    recentlyUpdated.value = true
    if (updatedTimer)
      clearTimeout(updatedTimer)
    updatedTimer = setTimeout(() => {
      recentlyUpdated.value = false
    }, 2400)
  }

  function selectFrom(nextCapabilities: Capability[]): void {
    const previousCapability = selectedCapability.value
    const nextCapability = nextCapabilities.find(capability => capability.id === selectedCapabilityId.value)
      ?? nextCapabilities.find(capability => capability.kind === previousCapability?.kind
        && capability.name === previousCapability.name
        && capability.source === previousCapability.source)
      ?? nextCapabilities[0]
    if (selectedCapabilityId.value !== (nextCapability?.id ?? ''))
      run.value = undefined
    selectedCapabilityId.value = nextCapability?.id ?? ''
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
    })))
  }

  async function loadProjects(initialProjectId?: string): Promise<void> {
    await refreshProjects(initialProjectId, false)
  }

  async function loadWorkspaces(): Promise<void> {
    workspaces.value = await api.workspaces()
  }

  async function loadWorkspaceState(preferredProjectId?: string): Promise<void> {
    const state = await api.workspaceState()
    expandedWorkspaceIds.value = state.expandedWorkspaceIds
    if (preferredProjectId)
      return
    if (state.selectedWorkspaceId && workspaces.value.some(workspace => workspace.id === state.selectedWorkspaceId)) {
      selectedWorkspaceId.value = state.selectedWorkspaceId
      selectedProjectId.value = ''
      capabilities.value = []
      agentActions.value = []
      selectedCapabilityId.value = ''
      return
    }
    if (state.selectedProjectId && projects.value.some(project => project.id === state.selectedProjectId))
      await selectProject(state.selectedProjectId)
  }

  function persistWorkspaceState(): void {
    const state = {
      expandedWorkspaceIds: expandedWorkspaceIds.value,
      selectedWorkspaceId: selectedWorkspaceId.value || undefined,
      selectedProjectId: selectedProjectId.value || undefined,
    }
    workspaceStateTail = workspaceStateTail
      .then(async () => { await api.updateWorkspaceState(state) })
      .catch(() => {})
  }

  async function createWorkspace(name: string, projectPaths: string[] = [], projectLabels: Record<string, string> = {}): Promise<void> {
    let workspace = await api.createWorkspace(name)
    for (const path of [...new Set(projectPaths)]) {
      const project = await api.addProject(path)
      const updatedWorkspace = await api.addWorkspaceProject(workspace.id, project.id)
      const label = projectLabels[path]?.trim()
      if (label) {
        workspace = updatedWorkspace
        const manifest = workspaceManifest(workspace)
        const member = manifest.members.find(item => item.project === workspace.members.find(item => item.projectId === project.id)?.project)
        if (member) {
          member.label = label
          workspace = await api.updateWorkspace(manifest, workspace.revision)
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
    run.value = undefined
    persistWorkspaceState()
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
    await api.addWorkspaceProject(workspaceId, projectId)
    await loadWorkspaces()
    if (!expandedWorkspaceIds.value.includes(workspaceId))
      toggleWorkspaceExpanded(workspaceId)
  }

  async function addProjectPathToWorkspace(workspaceId: string, path: string): Promise<void> {
    const project = await api.addProject(path)
    await api.addWorkspaceProject(workspaceId, project.id)
    await Promise.all([loadProjects(), loadWorkspaces()])
    if (!expandedWorkspaceIds.value.includes(workspaceId))
      toggleWorkspaceExpanded(workspaceId)
  }

  async function removeProjectFromWorkspace(workspaceId: string, projectIdOrKey: string): Promise<void> {
    await api.removeWorkspaceProject(workspaceId, projectIdOrKey)
    await loadWorkspaces()
  }

  async function locateWorkspaceProject(workspaceId: string, projectKey: string, path: string): Promise<void> {
    const project = await api.addProject(path)
    await api.bindWorkspaceProject(workspaceId, projectKey, project.id)
    await Promise.all([loadProjects(), loadWorkspaces()])
  }

  async function deleteWorkspace(workspace: WorkspaceRecord): Promise<void> {
    await api.deleteWorkspace(workspace.id, workspace.revision)
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
    const saved = await api.updateWorkspace(manifest, workspace.revision)
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
    await api.reorderWorkspaces(order)
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

  async function startAgentTask(prompt: string, projectIds: string[], primaryProjectId: string, workspaceId?: string): Promise<void> {
    applyAgentTask(await api.startAgentTask({ prompt, projectIds, primaryProjectId, workspaceId }))
  }

  async function startAgentAction(actionId: AgentActionId, locale: WorkbenchLocale): Promise<AgentTaskRecord> {
    if (!selectedProject.value)
      throw new Error('Select a project before starting an agent action')
    const task = await api.startAgentAction(selectedProject.value.id, actionId, locale)
    applyAgentTask(task)
    return task
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
    return enqueueRefresh(() => performProjectsRefresh(initialProjectId, announce))
  }

  async function performProjectsRefresh(initialProjectId?: string, announce = true): Promise<boolean> {
    refreshing.value = true
    try {
      const nextProjects = await api.projects()
      const groups = await Promise.all(nextProjects.map(async (project) => {
        const [projectCapabilities, pins] = await Promise.all([
          api.capabilities(project.id),
          api.capabilityPins(project.id),
        ])
        return { project, capabilities: projectCapabilities, pins }
      }))
      const nextSnapshot = JSON.stringify(groups)
      const changed = snapshot !== '' && snapshot !== nextSnapshot
      const nextProject = nextProjects.find(project => project.id === selectedProjectId.value)
        ?? nextProjects.find(project => project.id === initialProjectId)
        ?? nextProjects[0]
      const nextCapabilities = groups.find(group => group.project.id === nextProject?.id)?.capabilities ?? []

      projects.value = nextProjects
      paletteItems.value = groups.flatMap(group => group.capabilities.map(capability => ({ project: group.project, capability })))
      capabilityPinsByProject.value = Object.fromEntries(groups.map(group => [group.project.id, group.pins.capabilityIds]))
      selectedProjectId.value = nextProject?.id ?? ''
      capabilities.value = nextCapabilities
      agentActions.value = nextProject
        ? await api.agentActions(nextProject.id, settings.value?.settings['workbench.locale'] ?? 'en')
        : []
      selectFrom(nextCapabilities)
      snapshot = nextSnapshot

      if (changed && announce)
        announceUpdate()
      return changed
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
        const nextProjects = await api.projects()
        changed ||= JSON.stringify(projects.value) !== JSON.stringify(nextProjects)
        projects.value = nextProjects
        paletteItems.value = paletteItems.value.map(item => ({
          ...item,
          project: nextProjects.find(project => project.id === item.project.id) ?? item.project,
        }))
      }
      if (event.scopes.includes('capabilities')) {
        const project = projects.value.find(item => item.id === event.projectId)
        if (project) {
          const [nextCapabilities, pins] = await Promise.all([
            api.capabilities(project.id),
            api.capabilityPins(project.id),
          ])
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
          if (selectedProjectId.value === project.id) {
            capabilities.value = nextCapabilities
            selectFrom(nextCapabilities)
            await loadAgentActions(project.id)
          }
        }
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

  async function selectProject(id: string): Promise<void> {
    selectedWorkspaceId.value = ''
    selectedProjectId.value = id
    const [nextCapabilities, pins, nextAgentActions] = await Promise.all([
      api.capabilities(id),
      api.capabilityPins(id),
      api.agentActions(id, settings.value?.settings['workbench.locale'] ?? 'en'),
    ])
    capabilities.value = nextCapabilities
    agentActions.value = nextAgentActions
    capabilityPinsByProject.value = { ...capabilityPinsByProject.value, [id]: pins.capabilityIds }
    selectedCapabilityId.value = capabilities.value[0]?.id ?? ''
    run.value = undefined
    persistWorkspaceState()
  }

  async function addProject(path: string): Promise<void> {
    const project = await api.addProject(path)
    await loadProjects()
    await selectProject(project.id)
  }

  async function trustProject(): Promise<void> {
    if (!selectedProject.value)
      return
    const updated = await api.trust(selectedProject.value.id)
    projects.value = projects.value.map(project => project.id === updated.id ? updated : project)
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

  async function runSelected(): Promise<void> {
    if (!selectedProject.value || selectedCapability.value?.kind !== 'command')
      return
    const projectId = selectedProject.value.id
    busy.value = true
    startingProjectIds.value = [...new Set([...startingProjectIds.value, projectId])]
    terminalVisible.value = true
    error.value = ''
    run.value = undefined
    try {
      run.value = await api.run(selectedProject.value.id, selectedCapability.value.id, (nextRun) => {
        run.value = nextRun
        startingProjectIds.value = startingProjectIds.value.filter(id => id !== projectId)
      })
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
      if (run.value?.id === runId)
        run.value = stopped
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
    if (run.value)
      run.value = await api.pinRun(run.value.id, !run.value.pinned)
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
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    expandedWorkspaceIds,
    unassignedProjects,
    agentTasks,
    agentActions,
    agentActionDialogOpen,
    selectedProjectId,
    capabilities,
    paletteItems,
    capabilityPinsByProject,
    selectedCapabilityId,
    selectedProject,
    selectedCapability,
    pinnedCapabilityIds,
    pinnedCapabilities,
    run,
    busy,
    runSummaries,
    startingProjectIds,
    terminalVisible,
    refreshing,
    recentlyUpdated,
    error,
    settings,
    applySettings,
    loadSettings,
    updateLocale,
    updateTheme,
    loadProjects,
    loadWorkspaces,
    loadWorkspaceState,
    createWorkspace,
    selectWorkspace,
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
    loadAgentTasks,
    loadAgentActions,
    applyAgentTask,
    startAgentTask,
    startAgentAction,
    loadRunSummaries,
    applyRunSummary,
    projectRunSummary,
    isProjectStarting,
    refreshProjects,
    refreshProject,
    selectProject,
    addProject,
    trustProject,
    isCapabilityPinned,
    setCapabilityPinOrder,
    toggleCapabilityPin,
    runSelected,
    stopRun,
    closeTerminal,
    toggleCurrentRunPin,
    writeRunInput,
    resizeRun,
  }
})

function workspaceManifest(workspace: WorkspaceRecord): WorkspaceManifest {
  return {
    schemaVersion: 1,
    id: workspace.id,
    name: workspace.name,
    icon: workspace.icon,
    color: workspace.color,
    pinned: workspace.pinned,
    primaryProject: workspace.primaryProject,
    members: workspace.members.map(({ project, label, pinned, discoveryHint }) => ({ project, label, pinned, discoveryHint })),
  }
}
