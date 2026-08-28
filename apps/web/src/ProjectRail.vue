<script setup lang="ts">
import type { ProjectAccentColor, ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppearanceDialog from './AppearanceDialog.vue'
import CompactEditableField from './CompactEditableField.vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from './components/ui/select'
import { Icon } from './icons'
import { useI18n } from './i18n'
import ProjectIcon from './ProjectIcon.vue'
import { projectAccentStyle } from './project-visuals'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'

withDefaults(defineProps<{ activeView?: 'marketplace' | 'workbench' }>(), { activeView: 'workbench' })
const emit = defineEmits<{ openMarketplace: [], openSettings: [], openWorkbench: [] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const canChooseWorkspaceFolders = Boolean(window.craftHubDesktop?.selectProjectDirectories)
const canChooseTeamRepository = Boolean(window.craftHubDesktop?.selectProjectDirectory)
const dialogOpen = ref(false)
const workspaceDialogOpen = ref(false)
const workspaceName = ref('')
const workspacePaths = ref<string[]>([])
const workspacePathLabels = ref<Record<string, string>>({})
const workspacePathDraft = ref('')
const workspaceError = ref('')
const workspaceSubmitting = ref(false)
const workspaceGroupDialogOpen = ref(false)
const workspaceGroupEditingId = ref('')
const workspaceGroupDraft = ref('')
const workspaceGroupError = ref('')
const workspaceGroupSubmitting = ref(false)
const teamDialogOpen = ref(false)
const teamName = ref('')
const teamRepositoryPath = ref('')
const teamDirectory = ref('')
const teamError = ref('')
const teamSubmitting = ref(false)
const teamManageDialogOpen = ref(false)
const teamRenameName = ref('')
const teamDeleteConfirmation = ref('')
const teamManageError = ref('')
const teamManageSubmitting = ref(false)
const teamSyncSubmitting = ref(false)
const path = ref('')
const error = ref('')
const railActionError = ref('')
const submitting = ref(false)
const searchQuery = ref('')
const groupFilter = ref('all')
const collapsedGroupIds = ref<string[]>([])
const workspaceGroupUiStorageKey = 'craft-hub-workspace-group-ui'
const draggedWorkspaceId = ref('')
const draggedProjectId = ref('')
const normalizedSearch = computed(() => searchQuery.value.trim().toLocaleLowerCase())
const contextMenu = ref<{ kind: 'workspace-group' | 'workspace' | 'workspace-member' | 'project', id: string, workspaceId?: string, x: number, y: number }>()
const appearanceOpen = ref(false)
const appearanceTarget = ref<{ kind: 'workspace-group' | 'workspace' | 'project', id: string, workspaceId?: string, title: string, note?: string, icon?: string, color?: ProjectAccentColor }>()
const addExistingOpen = ref(false)
const addExistingWorkspaceId = ref('')
const selectedExistingProjectIds = ref<string[]>([])
const projectHasConfigurationIssue = (projectId: string): boolean => store.projectCatalogDiagnostics.some(diagnostic => diagnostic.projectId === projectId)
const availableExistingProjects = computed(() => {
  const workspace = store.workspaces.find(item => item.id === addExistingWorkspaceId.value)
  const memberIds = new Set(workspace?.members.map(member => member.projectId).filter(Boolean))
  return store.projects.filter(project => !memberIds.has(project.id))
})
const groupedWorkspaces = computed(() => [
  ...store.workspaceGroups.flatMap(group => store.workspaces.filter(workspace => workspace.groupId === group.id)),
  ...store.workspaces.filter(workspace => !workspace.groupId || !store.workspaceGroups.some(group => group.id === workspace.groupId)),
])
const filteredWorkspaces = computed(() => groupedWorkspaces.value.filter((workspace) => {
  if (groupFilter.value === 'ungrouped' && workspace.groupId)
    return false
  if (groupFilter.value !== 'all' && groupFilter.value !== 'ungrouped' && workspace.groupId !== groupFilter.value)
    return false
  if (!normalizedSearch.value)
    return true
  return workspace.name.toLocaleLowerCase().includes(normalizedSearch.value)
    || workspace.members.some(member => workspaceMemberMatches(member))
}))
const filteredStandaloneProjects = computed(() => store.unassignedProjects.filter(project => projectMatches(project)))
const visibleStandaloneProjects = computed(() => filteredStandaloneProjects.value.filter((project) => {
  const projectGroupId = store.projectGroupAssignments[project.id]
  if (groupFilter.value === 'ungrouped')
    return !projectGroupId
  return groupFilter.value === 'all' || projectGroupId === groupFilter.value
}))
const headerOnlyVisibleGroups = computed(() => store.workspaceGroups.filter((group) => {
  if (groupFilter.value !== 'all' && groupFilter.value !== group.id)
    return false
  if (filteredWorkspaces.value.some(workspace => workspace.groupId === group.id))
    return false
  return standaloneProjectsForGroup(group.id).length > 0
    || (!normalizedSearch.value && !store.workspaces.some(workspace => workspace.groupId === group.id))
}))
const filteredUngroupedProjects = computed(() => groupFilter.value === 'all' || groupFilter.value === 'ungrouped'
  ? filteredStandaloneProjects.value.filter(project => !store.projectGroupAssignments[project.id])
  : [])
const hasSearchResults = computed(() => filteredWorkspaces.value.length > 0 || visibleStandaloneProjects.value.length > 0)
const teamSyncNeedsAttention = computed(() => Boolean(store.activeTeamSyncStatus
  && (store.activeTeamSyncStatus.state !== 'clean' || store.activeTeamSyncStatus.workingTreeChanged)))

async function switchOwnerScope(value: unknown): Promise<void> {
  if (typeof value !== 'string')
    return
  groupFilter.value = 'all'
  searchQuery.value = ''
  railActionError.value = ''
  try {
    await store.switchOwnerScope(value)
  }
  catch (caught) {
    railActionError.value = t('ownerScopeActionFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

async function createTeam(): Promise<void> {
  const name = teamName.value.trim()
  const repositoryPath = teamRepositoryPath.value.trim()
  if (!name || !repositoryPath || teamSubmitting.value)
    return
  teamSubmitting.value = true
  teamError.value = ''
  try {
    await store.createTeam(name, repositoryPath, teamDirectory.value.trim() || undefined)
    teamDialogOpen.value = false
    teamName.value = ''
    teamRepositoryPath.value = ''
    teamDirectory.value = ''
  }
  catch (caught) {
    teamError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    teamSubmitting.value = false
  }
}

async function chooseTeamRepository(): Promise<void> {
  const selected = await window.craftHubDesktop?.selectProjectDirectory?.(store.repositoriesRoot)
  if (selected)
    teamRepositoryPath.value = selected
}

function openTeamManagement(): void {
  if (store.activeOwnerScope?.kind !== 'team')
    return
  teamRenameName.value = store.activeOwnerScope.name
  teamDeleteConfirmation.value = ''
  teamManageError.value = ''
  teamManageDialogOpen.value = true
}

async function renameTeam(): Promise<void> {
  const team = store.activeOwnerScope
  const name = teamRenameName.value.trim()
  if (team?.kind !== 'team' || !name || teamManageSubmitting.value)
    return
  teamManageSubmitting.value = true
  teamManageError.value = ''
  try {
    await store.renameTeam(team.id, name)
    teamRenameName.value = name
  }
  catch (caught) {
    teamManageError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    teamManageSubmitting.value = false
  }
}

async function deleteTeam(): Promise<void> {
  const team = store.activeOwnerScope
  if (team?.kind !== 'team' || teamDeleteConfirmation.value.trim() !== team.name || teamManageSubmitting.value)
    return
  teamManageSubmitting.value = true
  teamManageError.value = ''
  try {
    await store.deleteTeam(team.id, teamDeleteConfirmation.value)
    teamManageDialogOpen.value = false
  }
  catch (caught) {
    teamManageError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    teamManageSubmitting.value = false
  }
}

async function synchronizeTeam(resolution: 'auto' | 'use-local' | 'use-repository' = 'auto'): Promise<void> {
  if (teamSyncSubmitting.value)
    return
  teamSyncSubmitting.value = true
  railActionError.value = ''
  try {
    await store.synchronizeActiveTeam(resolution)
  }
  catch (caught) {
    railActionError.value = t('teamSyncFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    teamSyncSubmitting.value = false
  }
}

function teamSyncStateLabel(): string {
  const state = store.activeTeamSyncStatus?.state
  if (state === 'clean')
    return t('personalGitSyncState_clean')
  if (state === 'local-ahead')
    return t('personalGitSyncState_localAhead')
  if (state === 'repository-ahead')
    return t('personalGitSyncState_repositoryAhead')
  if (state === 'conflict')
    return t('personalGitSyncState_conflict')
  return t('personalGitSyncState_unconfigured')
}

function teamSyncTooltip(): string {
  const label = teamSyncStateLabel()
  return store.activeTeamSyncStatus?.workingTreeChanged ? `${label} · ${t('gitSyncPendingCommit')}` : label
}

function projectMatches(project: ProjectRecord, label?: string): boolean {
  if (!normalizedSearch.value)
    return true
  return [project.name, project.path, label].some(value => value?.toLocaleLowerCase().includes(normalizedSearch.value))
}

function workspaceMemberMatches(member: WorkspaceRecord['members'][number]): boolean {
  const project = member.projectId ? store.projects.find(item => item.id === member.projectId) : undefined
  return project ? projectMatches(project, member.label) : member.project.toLocaleLowerCase().includes(normalizedSearch.value)
}

function standaloneProjectsForGroup(groupId: string): ProjectRecord[] {
  return filteredStandaloneProjects.value.filter(project => store.projectGroupAssignments[project.id] === groupId)
}

function visibleWorkspaceMembers(workspace: WorkspaceRecord): WorkspaceRecord['members'] {
  if (!normalizedSearch.value || workspace.name.toLocaleLowerCase().includes(normalizedSearch.value))
    return workspace.members
  return workspace.members.filter(member => workspaceMemberMatches(member))
}

function isFirstGroupWorkspace(workspace: WorkspaceRecord, index: number): boolean {
  return Boolean(workspace.groupId && filteredWorkspaces.value.findIndex(item => item.groupId === workspace.groupId) === index)
}

function groupWorkspaceCount(groupId: string): number {
  return filteredWorkspaces.value.filter(workspace => workspace.groupId === groupId).length
    + standaloneProjectsForGroup(groupId).length
}

function isFirstUngroupedWorkspace(workspace: WorkspaceRecord, index: number): boolean {
  return Boolean(!workspace.groupId && filteredWorkspaces.value.findIndex(item => !item.groupId) === index)
}

function ungroupedWorkspaceCount(): number {
  return filteredWorkspaces.value.filter(workspace => !workspace.groupId).length
}

function workspaceGroupName(groupId: string): string {
  return workspaceGroup(groupId)?.name ?? groupId
}

function workspaceGroup(groupId: string) {
  return store.workspaceGroups.find(group => group.id === groupId)
}

function isGroupCollapsed(groupId: string): boolean {
  return collapsedGroupIds.value.includes(groupId)
}

function toggleGroup(groupId: string): void {
  collapsedGroupIds.value = isGroupCollapsed(groupId)
    ? collapsedGroupIds.value.filter(id => id !== groupId)
    : [...collapsedGroupIds.value, groupId]
}

watch([groupFilter, collapsedGroupIds], () => {
  window.localStorage.setItem(workspaceGroupUiStorageKey, JSON.stringify({
    filter: groupFilter.value,
    collapsed: collapsedGroupIds.value,
  }))
}, { deep: true })

watch(() => store.workspaceGroups.map(group => group.id), (groupIds) => {
  collapsedGroupIds.value = collapsedGroupIds.value.filter(id => groupIds.includes(id))
  if (groupFilter.value !== 'all' && groupFilter.value !== 'ungrouped' && !groupIds.includes(groupFilter.value))
    groupFilter.value = 'all'
})

async function deleteWorkspaceGroup(groupId: string): Promise<void> {
  closeContextMenu()
  if (!window.confirm(t('confirmDeleteWorkspaceGroup', { name: workspaceGroupName(groupId) })))
    return
  if (groupFilter.value === groupId)
    groupFilter.value = 'all'
  await store.deleteWorkspaceGroup(groupId)
}

function openCreateWorkspaceGroup(): void {
  workspaceGroupEditingId.value = ''
  workspaceGroupDraft.value = ''
  workspaceGroupError.value = ''
  workspaceGroupDialogOpen.value = true
}

function openRenameWorkspaceGroup(groupId: string): void {
  closeContextMenu()
  workspaceGroupEditingId.value = groupId
  workspaceGroupDraft.value = workspaceGroupName(groupId)
  workspaceGroupError.value = ''
  workspaceGroupDialogOpen.value = true
}

async function saveWorkspaceGroup(): Promise<void> {
  const name = workspaceGroupDraft.value.trim()
  if (!name || workspaceGroupSubmitting.value)
    return
  workspaceGroupSubmitting.value = true
  workspaceGroupError.value = ''
  try {
    if (workspaceGroupEditingId.value)
      await store.renameWorkspaceGroup(workspaceGroupEditingId.value, name)
    else
      await store.createWorkspaceGroup(name)
    workspaceGroupDialogOpen.value = false
  }
  catch (caught) {
    workspaceGroupError.value = t('saveWorkspaceGroupFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    workspaceGroupSubmitting.value = false
  }
}

async function moveWorkspaceToGroup(workspaceId: string, event: Event): Promise<void> {
  const groupId = (event.target as HTMLSelectElement).value || undefined
  await store.assignWorkspaceGroup(workspaceId, groupId)
  closeContextMenu()
}

async function moveProjectToGroup(projectId: string, event: Event): Promise<void> {
  const groupId = (event.target as HTMLSelectElement).value || undefined
  await store.assignProjectGroup(projectId, groupId)
  closeContextMenu()
}

async function dropNavigationEntryIntoGroup(groupId?: string): Promise<void> {
  const projectId = draggedProjectId.value
  const workspaceId = draggedWorkspaceId.value
  draggedProjectId.value = ''
  draggedWorkspaceId.value = ''
  if (projectId)
    await store.assignProjectGroup(projectId, groupId)
  else if (workspaceId)
    await store.assignWorkspaceGroup(workspaceId, groupId)
}

function closeContextMenu(): void {
  contextMenu.value = undefined
}

async function removeContextProject(workspaceId: string, projectIdOrKey: string): Promise<void> {
  closeContextMenu()
  railActionError.value = ''
  try {
    await store.removeProjectFromWorkspace(workspaceId, projectIdOrKey)
  }
  catch (caught) {
    railActionError.value = t('removeFromWorkspaceFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

async function unregisterContextProject(projectId: string): Promise<void> {
  const project = store.projects.find(item => item.id === projectId)
  if (!project || !window.confirm(t('confirmUnregisterProject', { name: project.name })))
    return
  closeContextMenu()
  railActionError.value = ''
  try {
    await store.unregisterProject(project.id)
  }
  catch (caught) {
    railActionError.value = t('unregisterProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

function openWorkspaceContextMenu(event: MouseEvent, workspace: WorkspaceRecord): void {
  contextMenu.value = {
    kind: 'workspace',
    id: workspace.id,
    x: Math.min(event.clientX, window.innerWidth - 232),
    y: Math.min(event.clientY, window.innerHeight - 260),
  }
}

function openProjectContextMenu(event: MouseEvent, project: ProjectRecord, workspaceId?: string): void {
  contextMenu.value = {
    kind: 'project',
    id: project.id,
    workspaceId,
    x: Math.min(event.clientX, window.innerWidth - 232),
    y: Math.min(event.clientY, window.innerHeight - 180),
  }
}

function openWorkspaceMemberContextMenu(event: MouseEvent, workspace: WorkspaceRecord, member: WorkspaceRecord['members'][number]): void {
  contextMenu.value = {
    kind: 'workspace-member',
    id: member.project,
    workspaceId: workspace.id,
    x: Math.min(event.clientX, window.innerWidth - 232),
    y: Math.min(event.clientY, window.innerHeight - 180),
  }
}

function contextWorkspaceMember() {
  const menu = contextMenu.value
  if ((menu?.kind !== 'project' && menu?.kind !== 'workspace-member') || !menu.workspaceId)
    return undefined
  const workspace = store.workspaces.find(item => item.id === menu.workspaceId)
  return menu.kind === 'project'
    ? workspace?.members.find(member => member.projectId === menu.id)
    : workspace?.members.find(member => member.project === menu.id)
}

async function toggleContextProjectPin(): Promise<void> {
  const menu = contextMenu.value
  if (menu?.kind !== 'project' || !menu.workspaceId)
    return
  const workspace = store.workspaces.find(item => item.id === menu.workspaceId)
  if (!workspace || !workspace.members.some(member => member.projectId === menu.id))
    return
  closeContextMenu()
  await store.toggleWorkspaceProjectPin(workspace, menu.id)
}

function openWorkspaceGroupContextMenu(event: MouseEvent, groupId: string): void {
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const anchored = event.type === 'click' || (event.clientX === 0 && event.clientY === 0)
  contextMenu.value = {
    kind: 'workspace-group',
    id: groupId,
    x: Math.min(anchored ? rect.right - 220 : event.clientX, window.innerWidth - 232),
    y: Math.min(anchored ? rect.bottom + 4 : event.clientY, window.innerHeight - 180),
  }
}

function openAppearance(kind: 'workspace-group' | 'workspace' | 'project', id: string, workspaceId?: string): void {
  const target = kind === 'workspace-group'
    ? workspaceGroup(id)
    : kind === 'workspace'
      ? store.workspaces.find(item => item.id === id)
      : store.projects.find(item => item.id === id)
  if (!target)
    return
  const note = kind === 'project' && workspaceId
    ? store.workspaces.find(item => item.id === workspaceId)?.members.find(member => member.projectId === id)?.label
    : undefined
  const color = kind === 'workspace-group'
    ? undefined
    : kind === 'workspace'
      ? store.workspaces.find(item => item.id === id)?.color
      : store.projects.find(item => item.id === id)?.color
  appearanceTarget.value = { kind, id, workspaceId, title: target.name, note, icon: target.icon, color }
  appearanceOpen.value = true
  closeContextMenu()
}

async function saveAppearance(appearance: { name?: string, note?: string, icon?: string, color?: ProjectAccentColor }): Promise<void> {
  const target = appearanceTarget.value
  if (!target)
    return
  if (target.kind === 'workspace-group') {
    await store.setWorkspaceGroupAppearance(target.id, appearance.icon)
  }
  else if (target.kind === 'workspace') {
    const workspace = store.workspaces.find(item => item.id === target.id)
    if (workspace)
      await store.setWorkspaceAppearance(workspace, { name: appearance.name ?? workspace.name, icon: appearance.icon, color: appearance.color })
  }
  else {
    await store.setProjectVisual(target.id, appearance.icon, appearance.color)
    if (target.workspaceId) {
      const workspace = store.workspaces.find(item => item.id === target.workspaceId)
      if (workspace)
        await store.setWorkspaceProjectLabel(workspace, target.id, appearance.note)
    }
  }
  appearanceOpen.value = false
}

function openAddExisting(workspaceId: string): void {
  addExistingWorkspaceId.value = workspaceId
  selectedExistingProjectIds.value = []
  addExistingOpen.value = true
  closeContextMenu()
}

async function addExistingProjects(): Promise<void> {
  for (const projectId of selectedExistingProjectIds.value)
    await store.addProjectToWorkspace(addExistingWorkspaceId.value, projectId)
  addExistingOpen.value = false
}

async function addProjectFoldersToWorkspace(workspaceId: string): Promise<void> {
  closeContextMenu()
  const paths = window.craftHubDesktop?.selectProjectDirectories
    ? await window.craftHubDesktop.selectProjectDirectories(store.repositoriesRoot)
    : [window.prompt(t('projectPath')) ?? ''].filter(Boolean)
  for (const selectedPath of paths ?? [])
    await store.addProjectPathToWorkspace(workspaceId, selectedPath)
}

onMounted(() => {
  try {
    const stored = JSON.parse(window.localStorage.getItem(workspaceGroupUiStorageKey) ?? '{}') as { filter?: unknown, collapsed?: unknown }
    const groupIds = store.workspaceGroups.map(group => group.id)
    if (stored.filter === 'all' || stored.filter === 'ungrouped' || (typeof stored.filter === 'string' && groupIds.includes(stored.filter)))
      groupFilter.value = stored.filter
    if (Array.isArray(stored.collapsed) && stored.collapsed.every(id => typeof id === 'string'))
      collapsedGroupIds.value = stored.collapsed.filter(id => groupIds.includes(id))
  }
  catch {
    window.localStorage.removeItem(workspaceGroupUiStorageKey)
  }
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('blur', closeContextMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('blur', closeContextMenu)
})

function openCreateWorkspace(): void {
  workspaceName.value = ''
  workspacePaths.value = []
  workspacePathLabels.value = {}
  workspacePathDraft.value = ''
  workspaceError.value = ''
  workspaceDialogOpen.value = true
}

function appendWorkspacePaths(paths: string[]): void {
  const normalized = paths.map(path => path.trim()).filter(Boolean)
  for (const path of normalized)
    workspacePathLabels.value[path] ??= ''
  workspacePaths.value = [...new Set([...workspacePaths.value, ...normalized])]
}

function addWorkspacePath(): void {
  appendWorkspacePaths([workspacePathDraft.value])
  workspacePathDraft.value = ''
}

function removeWorkspacePath(path: string): void {
  workspacePaths.value = workspacePaths.value.filter(item => item !== path)
  delete workspacePathLabels.value[path]
}

function folderName(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}

async function chooseWorkspaceFolders(): Promise<void> {
  try {
    const paths = await window.craftHubDesktop?.selectProjectDirectories?.()
    if (paths)
      appendWorkspacePaths(paths)
  }
  catch (caught) {
    workspaceError.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

async function createWorkspace(): Promise<void> {
  const name = workspaceName.value.trim()
  if (!name || workspaceSubmitting.value)
    return
  workspaceSubmitting.value = true
  workspaceError.value = ''
  try {
    await store.createWorkspace(name, workspacePaths.value, workspacePathLabels.value)
    workspaceDialogOpen.value = false
  }
  catch (caught) {
    workspaceError.value = t('createWorkspaceFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    workspaceSubmitting.value = false
  }
}

async function confirmDeleteWorkspace(workspace: typeof store.workspaces[number]): Promise<void> {
  if (window.confirm(t('confirmDeleteWorkspace', { name: workspace.name })))
    await store.deleteWorkspace(workspace)
}

async function locateProject(workspace: WorkspaceRecord, member: WorkspaceRecord['members'][number]): Promise<void> {
  try {
    if (member.path) {
      try {
        await store.registerWorkspaceMember(workspace, member.project)
        return
      }
      catch {
        // The imported path may have moved; let the user locate it below.
      }
      const locatedPath = window.craftHubDesktop?.selectProjectDirectory
        ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
        : window.prompt(t('projectPath'))
      if (locatedPath)
        await store.registerWorkspaceMember(workspace, member.project, locatedPath)
      return
    }
    const selectedPath = window.craftHubDesktop?.selectProjectDirectory
      ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
      : window.prompt(t('projectPath'))
    if (selectedPath)
      await store.locateWorkspaceProject(workspace.id, member.project, selectedPath)
  }
  catch (caught) {
    window.alert(t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) }))
  }
}

function startWorkspaceDrag(workspaceId: string, event: DragEvent): void {
  draggedProjectId.value = ''
  draggedWorkspaceId.value = workspaceId
  event.dataTransfer?.setData('text/plain', workspaceId)
  if (event.dataTransfer)
    event.dataTransfer.effectAllowed = 'move'
}

function startProjectDrag(projectId: string, event: DragEvent): void {
  draggedWorkspaceId.value = ''
  draggedProjectId.value = projectId
  event.dataTransfer?.setData('text/plain', projectId)
  if (event.dataTransfer)
    event.dataTransfer.effectAllowed = 'move'
}

async function dropWorkspace(targetWorkspaceId: string): Promise<void> {
  const sourceWorkspaceId = draggedWorkspaceId.value
  draggedWorkspaceId.value = ''
  if (sourceWorkspaceId)
    await store.reorderWorkspace(sourceWorkspaceId, targetWorkspaceId)
}

async function importVscodeWorkspaces(): Promise<void> {
  const sourceDirectory = window.craftHubDesktop?.selectProjectDirectory
    ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
    : window.prompt(t('workspaceImportPath'))
  if (!sourceDirectory)
    return
  try {
    const preview = await store.previewVscodeWorkspaces(sourceDirectory)
    if (!preview.canImport)
      throw new Error([...preview.conflicts, ...preview.diagnostics.map(item => item.message)].join('; '))
    const members = preview.workspaces.flatMap(workspace => workspace.members)
    const confirmed = window.confirm(t('workspaceImportPreview', {
      workspaces: String(preview.workspaces.length),
      registered: String(members.filter(member => member.status === 'registered').length),
      available: String(members.filter(member => member.status === 'available').length),
      missing: String(members.filter(member => member.status === 'missing').length),
    }))
    if (!confirmed)
      return
    await store.importVscodeWorkspaces(sourceDirectory, preview.groupName, preview.revision)
    workspaceDialogOpen.value = false
  }
  catch (caught) {
    workspaceError.value = t('importWorkspaceFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

function runState(projectId: string): 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | undefined {
  if (store.isProjectStarting(projectId))
    return 'starting'
  const summary = store.projectRunSummary(projectId)
  return summary?.running ? 'running' : summary?.lastStatus
}

function runStateTitle(projectId: string): string {
  const state = runState(projectId)
  if (state === 'starting')
    return t('startingCommand')
  if (state === 'running')
    return t('runningCommands', { count: String(store.projectRunSummary(projectId)?.running ?? 0) })
  if (state === 'completed')
    return t('commandCompleted')
  if (state === 'failed')
    return t('commandFailed')
  return t('commandCancelled')
}

async function openAddProject(): Promise<void> {
  path.value = ''
  error.value = ''
  const selectProjectDirectory = window.craftHubDesktop?.selectProjectDirectory
  if (!selectProjectDirectory) {
    dialogOpen.value = true
    return
  }

  try {
    const selectedPath = await selectProjectDirectory(store.repositoriesRoot)
    if (selectedPath)
      await addProjectPath(selectedPath)
  }
  catch (caught) {
    dialogOpen.value = true
    error.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

async function addProject(): Promise<void> {
  const projectPath = path.value.trim()
  if (!projectPath || submitting.value)
    return
  await addProjectPath(projectPath)
}

async function addProjectPath(projectPath: string): Promise<void> {
  submitting.value = true
  error.value = ''
  try {
    await store.addProject(projectPath)
    dialogOpen.value = false
  }
  catch (caught) {
    path.value = projectPath
    dialogOpen.value = true
    error.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <aside class="project-rail">
    <div class="activity-rail">
      <button
        class="activity-button brand-mark"
        :class="{ active: activeView === 'workbench' }"
        data-testid="open-workbench"
        aria-label="Craft Hub"
        title="Craft Hub"
        @click="emit('openWorkbench')"
      ><Icon name="hub" /></button>
      <button
        class="activity-button marketplace-button"
        :class="{ active: activeView === 'marketplace' }"
        data-testid="open-marketplace"
        :aria-label="t('pluginMarketplace')"
        :title="t('pluginMarketplace')"
        @click="emit('openMarketplace')"
      >
        <Icon name="plugins" />
      </button>
      <button
        class="activity-button settings-button"
        data-testid="open-settings"
        :aria-label="t('settings')"
        :title="t('settings')"
        @click="emit('openSettings')"
      >
        <Icon name="settings" />
      </button>
    </div>
    <div class="rail-content" :class="{ 'search-active': normalizedSearch }" :inert="activeView === 'marketplace'" :aria-hidden="activeView === 'marketplace'">
      <div class="rail-controls">
        <div class="owner-scope-switcher">
          <div class="owner-scope-select">
            <Select :model-value="store.activeOwnerScopeId" @update:model-value="switchOwnerScope">
              <SelectTrigger class="owner-scope-trigger" data-testid="owner-scope-trigger" :aria-label="t('ownerScope')">
                <span v-if="store.activeOwnerScope" class="owner-scope-value">
                  <span class="owner-scope-icon" :class="store.activeOwnerScope.kind" aria-hidden="true">
                    <Icon :name="store.activeOwnerScope.kind === 'team' ? 'team' : 'personal'" />
                  </span>
                  <span class="owner-scope-name">{{ store.activeOwnerScope.name }}</span>
                </span>
                <span v-else class="owner-scope-name">{{ t('ownerScope') }}</span>
              </SelectTrigger>
              <SelectContent class="owner-scope-content" align="start">
                <SelectGroup>
                  <SelectItem v-for="scope in store.ownerScopes" :key="scope.id" class="owner-scope-item" :value="scope.id">
                    <span class="owner-scope-icon" :class="scope.kind" aria-hidden="true">
                      <Icon :name="scope.kind === 'team' ? 'team' : 'personal'" />
                    </span>
                    <span class="owner-scope-name">{{ scope.name }}</span>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <button
            v-if="store.activeOwnerScope?.kind === 'team'"
            type="button"
            class="team-sync-indicator"
            :class="[store.activeTeamSyncStatus?.state, { pending: store.activeTeamSyncStatus?.workingTreeChanged }]"
            :disabled="teamSyncSubmitting"
            :aria-label="store.activeTeamSyncStatus ? teamSyncTooltip() : t('syncTeam')"
            :title="store.activeTeamSyncStatus ? teamSyncTooltip() : t('syncTeam')"
            @click="synchronizeTeam()"
          >
            <Icon :name="teamSyncSubmitting ? 'loading' : store.activeTeamSyncStatus?.state === 'conflict' ? 'error' : store.activeTeamSyncStatus?.state === 'clean' && !store.activeTeamSyncStatus?.workingTreeChanged ? 'check' : 'refresh'" />
          </button>
          <button v-if="store.activeOwnerScope?.kind === 'team'" type="button" data-testid="manage-team" :aria-label="t('manageTeam')" :title="t('manageTeam')" @click="openTeamManagement"><Icon name="edit" /></button>
          <button v-if="store.activeOwnerScope?.kind !== 'team'" type="button" :aria-label="t('createTeam')" :title="t('createTeam')" @click="teamDialogOpen = true"><Icon name="plus" /></button>
        </div>
        <div v-if="store.activeOwnerScope?.kind === 'team' && store.activeTeamSyncStatus && teamSyncNeedsAttention" class="team-sync-status" :class="store.activeTeamSyncStatus.state">
          <span><Icon :name="store.activeTeamSyncStatus.state === 'conflict' ? 'error' : store.activeTeamSyncStatus.state === 'clean' ? 'check' : 'refresh'" />{{ teamSyncStateLabel() }}</span>
          <small v-if="store.activeTeamSyncStatus.workingTreeChanged">{{ t('gitSyncPendingCommit') }}</small>
          <div v-if="store.activeTeamSyncStatus.state === 'conflict'" class="team-sync-resolution">
            <button type="button" :disabled="teamSyncSubmitting" @click="synchronizeTeam('use-local')">{{ t('useLocalConfiguration') }}</button>
            <button type="button" :disabled="teamSyncSubmitting" @click="synchronizeTeam('use-repository')">{{ t('useRepositoryConfiguration') }}</button>
          </div>
        </div>
        <div class="rail-heading">
        <h1>{{ t('workspaces') }}</h1>
        <button class="rail-create-action" data-testid="add-workspace" :aria-label="t('addWorkspace')" :title="t('addWorkspace')" @click="openCreateWorkspace">
          <Icon name="plus" />
        </button>
        </div>
        <label class="rail-search">
          <Icon name="search" />
          <input v-model="searchQuery" type="search" :placeholder="t('searchProjectsWorkspaces')" :aria-label="t('searchProjectsWorkspaces')">
          <button v-if="searchQuery" type="button" :aria-label="t('clearSearch')" @click="searchQuery = ''"><Icon name="close" /></button>
        </label>
        <div class="workspace-group-toolbar">
          <label v-if="store.workspaceGroups.length" class="collection-filter">
            <Icon name="collection" />
            <span class="sr-only">{{ t('workspaceGroupFilter') }}</span>
            <select v-model="groupFilter" :aria-label="t('workspaceGroupFilter')">
              <option value="all">{{ t('allWorkspaceGroups') }}</option>
              <option value="ungrouped">{{ t('ungroupedWorkspaces') }}</option>
              <option v-for="group in store.workspaceGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
            </select>
          </label>
          <button class="rail-icon-action workspace-group-create" :class="{ labelled: !store.workspaceGroups.length }" type="button" data-testid="add-workspace-group" :aria-label="t('createWorkspaceGroup')" :title="t('createWorkspaceGroup')" @click="openCreateWorkspaceGroup">
            <Icon name="collection" /><span v-if="!store.workspaceGroups.length">{{ t('createWorkspaceGroup') }}</span>
          </button>
        </div>
      </div>
      <div class="rail-list">
      <template v-for="group in headerOnlyVisibleGroups" :key="group.id">
        <div
          class="unassigned-heading collection-heading"
          :class="{ 'empty-workspace-group': groupWorkspaceCount(group.id) === 0 }"
          @dragover.prevent
          @drop.prevent="dropNavigationEntryIntoGroup(group.id)"
          @contextmenu.prevent="openWorkspaceGroupContextMenu($event, group.id)"
        >
          <button class="collection-toggle" :aria-expanded="!isGroupCollapsed(group.id)" @click="toggleGroup(group.id)">
            <Icon name="arrowRight" :class="{ expanded: !isGroupCollapsed(group.id) }" />
            <span class="collection-icon"><VisualIcon :icon="group.icon" fallback="collection" /></span>
            <span class="collection-copy"><strong>{{ group.name }}</strong></span>
            <small class="collection-count">{{ groupWorkspaceCount(group.id) }}</small>
          </button>
        </div>
        <button
          v-for="project in standaloneProjectsForGroup(group.id)"
          v-show="!isGroupCollapsed(group.id)"
          :key="project.id"
          class="project-row nested rail-root-entry standalone-project"
          :class="{ selected: project.id === store.selectedProjectId }"
          :style="projectAccentStyle(project.color)"
          draggable="true"
          @dragstart="startProjectDrag(project.id, $event)"
          @dragend="draggedProjectId = ''"
          @click="store.selectProject(project.id)"
          @contextmenu.stop.prevent="openProjectContextMenu($event, project)"
        >
          <ProjectIcon class="rail-item-icon" :project="project" /><span class="project-name">{{ project.name }}</span>
          <span class="project-trust" :class="project.trust" :aria-label="t(project.trust === 'trusted' ? 'trusted' : 'untrusted')"><Icon :name="project.trust" /></span>
          <span v-if="projectHasConfigurationIssue(project.id)" class="project-config-warning" :aria-label="t('projectConfigInvalid')" :title="t('projectConfigInvalid')"><Icon name="error" /></span>
        </button>
      </template>
      <template v-for="(workspace, workspaceIndex) in filteredWorkspaces" :key="workspace.id">
        <div
          v-if="workspace.groupId && isFirstGroupWorkspace(workspace, workspaceIndex)"
          class="unassigned-heading collection-heading"
          @dragover.prevent
          @drop.prevent="dropNavigationEntryIntoGroup(workspace.groupId)"
          @contextmenu.prevent="openWorkspaceGroupContextMenu($event, workspace.groupId)"
        >
          <button class="collection-toggle" :aria-expanded="!isGroupCollapsed(workspace.groupId)" @click="toggleGroup(workspace.groupId)">
            <Icon name="arrowRight" :class="{ expanded: !isGroupCollapsed(workspace.groupId) }" />
            <span class="collection-icon"><VisualIcon :icon="workspaceGroup(workspace.groupId)?.icon" fallback="collection" /></span>
            <span class="collection-copy">
              <strong>{{ workspaceGroupName(workspace.groupId) }}</strong>
            </span>
            <small class="collection-count">{{ groupWorkspaceCount(workspace.groupId) }}</small>
          </button>
        </div>
        <button
          v-for="project in workspace.groupId && isFirstGroupWorkspace(workspace, workspaceIndex) && !isGroupCollapsed(workspace.groupId) ? standaloneProjectsForGroup(workspace.groupId) : []"
          :key="project.id"
          class="project-row nested rail-root-entry standalone-project"
          :class="{ selected: project.id === store.selectedProjectId }"
          :style="projectAccentStyle(project.color)"
          draggable="true"
          @dragstart="startProjectDrag(project.id, $event)"
          @dragend="draggedProjectId = ''"
          @click="store.selectProject(project.id)"
          @contextmenu.stop.prevent="openProjectContextMenu($event, project)"
        >
          <ProjectIcon class="rail-item-icon" :project="project" /><span class="project-name">{{ project.name }}</span>
          <span class="project-trust" :class="project.trust" :aria-label="t(project.trust === 'trusted' ? 'trusted' : 'untrusted')"><Icon :name="project.trust" /></span>
          <span v-if="projectHasConfigurationIssue(project.id)" class="project-config-warning" :aria-label="t('projectConfigInvalid')" :title="t('projectConfigInvalid')"><Icon name="error" /></span>
        </button>
        <div
          v-if="groupFilter === 'all' && store.workspaceGroups.length && isFirstUngroupedWorkspace(workspace, workspaceIndex)"
          class="unassigned-heading personal-heading"
          @dragover.prevent
          @drop.prevent="dropNavigationEntryIntoGroup()"
        >
          <h2>{{ t('ungroupedWorkspaces') }}</h2>
          <small>{{ ungroupedWorkspaceCount() }}</small>
        </div>
        <section
        v-if="!workspace.groupId || normalizedSearch || !isGroupCollapsed(workspace.groupId)"
        class="workspace-group"
        :class="{ 'grouped-workspace': workspace.groupId }"
        :style="projectAccentStyle(workspace.color)"
        draggable="true"
        @dragstart="startWorkspaceDrag(workspace.id, $event)"
        @dragover.prevent
        @drop.prevent="dropWorkspace(workspace.id)"
        @dragend="draggedWorkspaceId = ''"
        @contextmenu.prevent="openWorkspaceContextMenu($event, workspace)"
        >
        <div class="workspace-row" :class="{ selected: workspace.id === store.selectedWorkspaceId }">
          <button class="workspace-select rail-root-entry" @click="store.selectWorkspace(workspace.id)">
            <VisualIcon class="rail-item-icon" :icon="workspace.icon" /><span class="workspace-label">{{ workspace.name }}</span><small>{{ workspace.members.length }}</small>
          </button>
          <button class="workspace-disclosure" :aria-expanded="store.expandedWorkspaceIds.includes(workspace.id)" @click="store.toggleWorkspaceExpanded(workspace.id)">
            <Icon name="arrowRight" :class="{ expanded: store.expandedWorkspaceIds.includes(workspace.id) }" />
          </button>
        </div>
        <div v-if="normalizedSearch || store.expandedWorkspaceIds.includes(workspace.id)" class="workspace-children">
          <p v-if="!workspace.members.length" class="workspace-empty">{{ t('workspaceEmpty') }}</p>
          <div
            v-for="member in visibleWorkspaceMembers(workspace)"
            :key="member.project"
            class="workspace-project"
          >
            <template v-if="member.projectId && store.projects.find(project => project.id === member.projectId)">
              <button
                class="project-row nested"
                :class="{ selected: member.projectId === store.selectedProjectId }"
                :style="projectAccentStyle(store.projects.find(project => project.id === member.projectId)!.color)"
                @click="store.selectProject(member.projectId)"
                @contextmenu.stop.prevent="openProjectContextMenu($event, store.projects.find(project => project.id === member.projectId)!, workspace.id)"
              >
                <ProjectIcon class="rail-item-icon" :project="store.projects.find(project => project.id === member.projectId)!" />
                <span class="project-name" :title="member.label ? store.projects.find(project => project.id === member.projectId)!.name : undefined">{{ member.label || store.projects.find(project => project.id === member.projectId)!.name }}</span>
                <small v-if="workspace.primaryProject === member.project" class="primary-badge">{{ t('primary') }}</small>
                <span
                  class="project-trust"
                  :class="store.projects.find(project => project.id === member.projectId)!.trust"
                  :title="t(store.projects.find(project => project.id === member.projectId)!.trust === 'trusted' ? 'trusted' : 'untrusted')"
                ><Icon :name="store.projects.find(project => project.id === member.projectId)!.trust" /></span>
                <span v-if="projectHasConfigurationIssue(member.projectId)" class="project-config-warning" :aria-label="t('projectConfigInvalid')" :title="t('projectConfigInvalid')"><Icon name="error" /></span>
              </button>
            </template>
            <div v-else class="project-row nested unresolved" @contextmenu.stop.prevent="openWorkspaceMemberContextMenu($event, workspace, member)">
              <span
                class="member-source-status"
                :class="{ available: member.path }"
                :aria-label="t(member.path ? 'availableProject' : 'unresolved')"
                :title="t(member.path ? 'availableProject' : 'unresolved')"
              ><Icon :name="member.path ? 'folder' : 'error'" /></span>
              <span class="project-name">{{ member.label || member.project }}</span>
            </div>
            <template v-if="!member.projectId">
              <button class="member-pin" :aria-label="t(member.path ? 'addProject' : 'locateProject')" :title="t(member.path ? 'addProject' : 'locateProject')" @click="locateProject(workspace, member)"><Icon :name="member.path ? 'plus' : 'folder'" /></button>
            </template>
          </div>
        </div>
        </section>
      </template>
      <section v-if="filteredUngroupedProjects.length" class="unassigned-group" @dragover.prevent @drop.prevent="dropNavigationEntryIntoGroup()">
        <div class="unassigned-heading" :title="t('unassignedDescription')">
          <h2>{{ t('unassigned') }}</h2>
          <small>{{ filteredUngroupedProjects.length }}</small>
        </div>
        <button
          v-for="project in filteredUngroupedProjects"
          :key="project.id"
          class="project-row nested rail-root-entry"
          :class="{ selected: project.id === store.selectedProjectId }"
          :style="projectAccentStyle(project.color)"
          draggable="true"
          @dragstart="startProjectDrag(project.id, $event)"
          @dragend="draggedProjectId = ''"
          @click="store.selectProject(project.id)"
          @contextmenu.stop.prevent="openProjectContextMenu($event, project)"
        >
          <ProjectIcon class="rail-item-icon" :project="project" /><span class="project-name">{{ project.name }}</span>
          <span class="project-trust" :class="project.trust" :aria-label="t(project.trust === 'trusted' ? 'trusted' : 'untrusted')"><Icon :name="project.trust" /></span>
          <span v-if="projectHasConfigurationIssue(project.id)" class="project-config-warning" :aria-label="t('projectConfigInvalid')" :title="t('projectConfigInvalid')"><Icon name="error" /></span>
          <span v-if="runState(project.id)" class="project-run-state" :class="runState(project.id)" :aria-label="runStateTitle(project.id)" :title="runStateTitle(project.id)" :data-testid="`project-run-state-${project.id}`">
            <Icon v-if="runState(project.id) === 'starting'" name="refresh" />
            <Icon v-else-if="runState(project.id) === 'running'" name="terminal" />
            <Icon v-else-if="runState(project.id) === 'completed'" name="check" />
            <Icon v-else-if="runState(project.id) === 'failed'" name="error" />
            <Icon v-else name="stop" />
            <small v-if="runState(project.id) === 'running' && (store.projectRunSummary(project.id)?.running ?? 0) > 1">{{ store.projectRunSummary(project.id)?.running }}</small>
          </span>
        </button>
      </section>
      <p v-if="normalizedSearch && !hasSearchResults" class="rail-search-empty">{{ t('noProjectWorkspaceMatches') }}</p>
      <p v-if="railActionError" class="error-message rail-action-error" role="alert">{{ railActionError }}</p>
      <button class="add-project" data-testid="add-project" @click="openAddProject">
        <Icon name="plus" /> {{ t('addProject') }}
      </button>
      </div>
    </div>
  </aside>

  <DialogShell :open="teamDialogOpen" content-class="add-project-dialog team-create-dialog" @update:open="teamDialogOpen = $event">
    <template #title>{{ t('createTeam') }}</template>
    <template #description>{{ t('createTeamDescription') }}</template>
    <form class="team-create-form" data-testid="create-team-form" @submit.prevent="createTeam">
      <label><span>{{ t('teamName') }}</span><input v-model="teamName" name="team-name" autofocus></label>
      <label>
        <span>{{ t('teamGitRepository') }}</span>
        <span class="dialog-path-entry">
          <input v-model="teamRepositoryPath" name="team-repository-path" :placeholder="t('gitRepositoryPathPlaceholder')">
          <UiButton v-if="canChooseTeamRepository" type="button" size="compact" data-testid="choose-team-repository" @click="chooseTeamRepository">
            <Icon name="folder" /> {{ t('chooseGitRepository') }}
          </UiButton>
        </span>
      </label>
      <label><span>{{ t('gitSyncDirectory') }}</span><input v-model="teamDirectory" name="team-directory" :placeholder="`.craft-hub/teams/${teamName.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-') || 'team'}`"></label>
      <p v-if="teamError" class="error-message">{{ teamError }}</p>
      <footer>
        <UiButton @click="teamDialogOpen = false">{{ t('cancel') }}</UiButton>
        <UiButton type="submit" variant="primary" :disabled="!teamName.trim() || !teamRepositoryPath.trim() || teamSubmitting">{{ teamSubmitting ? t('saving') : t('create') }}</UiButton>
      </footer>
    </form>
  </DialogShell>

  <DialogShell :open="teamManageDialogOpen" content-class="add-project-dialog team-manage-dialog" @update:open="teamManageDialogOpen = $event">
    <template #title>{{ t('manageTeam') }}</template>
    <template #description>{{ t('manageTeamDescription', { name: store.activeOwnerScope?.name ?? '' }) }}</template>
    <form data-testid="rename-team-form" @submit.prevent="renameTeam">
      <label><span>{{ t('teamName') }}</span><input v-model="teamRenameName" name="team-rename-name" autofocus></label>
      <footer>
        <UiButton type="submit" variant="primary" :disabled="!teamRenameName.trim() || teamManageSubmitting">{{ t('renameTeam') }}</UiButton>
      </footer>
    </form>
    <section class="team-danger-zone">
      <h3>{{ t('deleteTeam') }}</h3>
      <p>{{ t('deleteTeamDescription', { name: store.activeOwnerScope?.name ?? '', count: String(store.workspaces.length) }) }}</p>
      <label><span>{{ t('deleteTeamConfirmation', { name: store.activeOwnerScope?.name ?? '' }) }}</span><input v-model="teamDeleteConfirmation" name="team-delete-confirmation" autocomplete="off"></label>
      <UiButton variant="danger" data-testid="delete-team" :disabled="teamDeleteConfirmation.trim() !== store.activeOwnerScope?.name || teamManageSubmitting" @click="deleteTeam">{{ t('deleteTeam') }}</UiButton>
    </section>
    <p v-if="teamManageError" class="error-message" role="alert">{{ teamManageError }}</p>
  </DialogShell>

  <DialogShell :open="dialogOpen" content-class="add-project-dialog" @update:open="dialogOpen = $event">
    <template #title>{{ t('addProject') }}</template>
    <template #description>{{ t('addProjectDescription') }}</template>
        <form data-testid="add-project-form" @submit.prevent="addProject">
          <label>
            <span>{{ t('projectPath') }}</span>
            <input v-model="path" name="project-path" :placeholder="t('projectPathPlaceholder')" autofocus>
          </label>
          <p v-if="error" class="error-message">{{ error }}</p>
          <footer>
            <UiButton @click="dialogOpen = false">{{ t('cancel') }}</UiButton>
            <UiButton type="submit" variant="primary" :disabled="!path.trim() || submitting">
              {{ submitting ? t('adding') : t('addProject') }}
            </UiButton>
          </footer>
        </form>
  </DialogShell>

  <DialogShell :open="workspaceGroupDialogOpen" content-class="add-project-dialog" @update:open="workspaceGroupDialogOpen = $event">
    <template #title>{{ t(workspaceGroupEditingId ? 'renameWorkspaceGroup' : 'createWorkspaceGroup') }}</template>
    <template #description>{{ t('workspaceGroupDescription') }}</template>
        <form data-testid="workspace-group-form" @submit.prevent="saveWorkspaceGroup">
          <label>
            <span>{{ t('workspaceGroupName') }}</span>
            <input v-model="workspaceGroupDraft" name="workspace-group-name" autofocus>
          </label>
          <p v-if="workspaceGroupError" class="error-message">{{ workspaceGroupError }}</p>
          <footer>
            <UiButton @click="workspaceGroupDialogOpen = false">{{ t('cancel') }}</UiButton>
            <UiButton type="submit" variant="primary" :disabled="!workspaceGroupDraft.trim() || workspaceGroupSubmitting">
              {{ workspaceGroupSubmitting ? t('saving') : t('save') }}
            </UiButton>
          </footer>
        </form>
  </DialogShell>

  <DialogShell :open="workspaceDialogOpen" content-class="add-project-dialog workspace-dialog" @update:open="workspaceDialogOpen = $event">
    <template #title>{{ t('addWorkspace') }}</template>
    <template #description>{{ t('createWorkspaceDescription') }}</template>
        <UiButton class="workspace-import-button" @click="importVscodeWorkspaces">
          <Icon name="vscode" /> {{ t('importVscodeWorkspaces') }}
        </UiButton>
        <form data-testid="add-workspace-form" @submit.prevent="createWorkspace">
          <label>
            <span>{{ t('workspaceName') }}</span>
            <input v-model="workspaceName" name="workspace-name" autofocus>
          </label>
          <section class="workspace-folder-fieldset">
            <div class="workspace-folder-heading">
              <div>
                <strong>{{ t('workspaceFolders') }}</strong>
                <small>{{ t('workspaceFoldersDescription') }}</small>
              </div>
              <UiButton
                v-if="canChooseWorkspaceFolders"
                size="compact"
                data-testid="choose-workspace-folders"
                @click="chooseWorkspaceFolders"
              >
                <Icon name="folder" /> {{ t('chooseFolders') }}
              </UiButton>
            </div>
            <div class="workspace-path-entry">
              <input
                v-model="workspacePathDraft"
                name="workspace-project-path"
                :placeholder="t('workspacePathPlaceholder')"
                @keydown.enter.prevent="addWorkspacePath"
              >
              <UiButton :disabled="!workspacePathDraft.trim()" @click="addWorkspacePath">
                {{ t('addFolder') }}
              </UiButton>
            </div>
            <ul v-if="workspacePaths.length" class="workspace-folder-list">
              <li v-for="folderPath in workspacePaths" :key="folderPath" class="workspace-folder-item">
                <Icon name="folder" />
                <span class="workspace-folder-copy"><strong>{{ folderName(folderPath) }}</strong><small>{{ folderPath }}</small></span>
                <CompactEditableField
                  v-model="workspacePathLabels[folderPath]"
                  class="workspace-folder-label"
                  :aria-label="t('workspaceProjectRemark')"
                  :placeholder="t('workspaceProjectRemarkShort')"
                />
                <button type="button" :aria-label="t('removeFolder', { name: folderName(folderPath) })" @click="removeWorkspacePath(folderPath)">
                  <Icon name="close" />
                </button>
              </li>
            </ul>
          </section>
          <p v-if="workspaceError" class="error-message">{{ workspaceError }}</p>
          <footer>
            <UiButton @click="workspaceDialogOpen = false">{{ t('cancel') }}</UiButton>
            <UiButton type="submit" variant="primary" :disabled="!workspaceName.trim() || workspaceSubmitting">
              {{ workspaceSubmitting ? t('creating') : t('addWorkspace') }}
            </UiButton>
          </footer>
        </form>
  </DialogShell>

  <div
    v-if="contextMenu"
    class="rail-context-menu"
    role="menu"
    :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    data-testid="rail-context-menu"
    @click.stop
    @contextmenu.prevent
  >
    <template v-if="contextMenu.kind === 'workspace-group'">
      <strong>{{ workspaceGroupName(contextMenu.id) }}</strong>
      <button role="menuitem" @click="openRenameWorkspaceGroup(contextMenu!.id)"><Icon name="edit" />{{ t('renameWorkspaceGroup') }}</button>
      <button role="menuitem" @click="openAppearance('workspace-group', contextMenu!.id)"><Icon name="palette" />{{ t('appearance') }}</button>
      <span class="context-menu-separator" />
      <button class="danger-menu-item" role="menuitem" @click="deleteWorkspaceGroup(contextMenu!.id)"><Icon name="close" />{{ t('deleteWorkspaceGroup') }}</button>
    </template>
    <template v-else-if="contextMenu.kind === 'workspace'">
      <strong>{{ store.workspaces.find(workspace => workspace.id === contextMenu!.id)?.name }}</strong>
      <button role="menuitem" @click="openAddExisting(contextMenu!.id)"><Icon name="plus" />{{ t('addExistingProjects') }}</button>
      <button role="menuitem" @click="addProjectFoldersToWorkspace(contextMenu!.id)"><Icon name="folder" />{{ t('addProjectFolders') }}</button>
      <button role="menuitem" @click="openAppearance('workspace', contextMenu!.id)"><Icon name="palette" />{{ t('appearance') }}</button>
      <label class="context-menu-select">
        <Icon name="collection" />
        <span>{{ t('moveToWorkspaceGroup') }}</span>
        <select
          :value="store.workspaces.find(workspace => workspace.id === contextMenu!.id)?.groupId ?? ''"
          :aria-label="t('moveToWorkspaceGroup')"
          @change="moveWorkspaceToGroup(contextMenu!.id, $event)"
        >
          <option value="">{{ t('ungroupedWorkspaces') }}</option>
          <option v-for="group in store.workspaceGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
      <span class="context-menu-separator" />
      <button
        v-if="store.workspaces.find(workspace => workspace.id === contextMenu!.id)"
        role="menuitem"
        @click="store.toggleWorkspacePin(store.workspaces.find(workspace => workspace.id === contextMenu!.id)!); closeContextMenu()"
      ><Icon name="star" />{{ t(store.workspaces.find(workspace => workspace.id === contextMenu!.id)!.pinned ? 'unpinWorkspace' : 'pinWorkspace') }}</button>
      <button
        v-if="store.workspaces.find(workspace => workspace.id === contextMenu!.id)"
        class="danger-menu-item"
        role="menuitem"
        @click="confirmDeleteWorkspace(store.workspaces.find(workspace => workspace.id === contextMenu!.id)!); closeContextMenu()"
      ><Icon name="close" />{{ t('deleteWorkspace') }}</button>
    </template>
    <template v-else-if="contextMenu.kind === 'project'">
      <strong>{{ store.projects.find(project => project.id === contextMenu!.id)?.name }}</strong>
      <button role="menuitem" @click="openAppearance('project', contextMenu!.id, contextMenu!.workspaceId)"><Icon name="palette" />{{ t('appearance') }}</button>
      <label v-if="!contextMenu.workspaceId" class="context-menu-select">
        <Icon name="collection" />
        <span>{{ t('moveToWorkspaceGroup') }}</span>
        <select
          :value="store.projectGroupAssignments[contextMenu.id] ?? ''"
          :aria-label="t('moveToWorkspaceGroup')"
          @change="moveProjectToGroup(contextMenu!.id, $event)"
        >
          <option value="">{{ t('ungroupedWorkspaces') }}</option>
          <option v-for="group in store.workspaceGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
      <template v-if="!contextMenu.workspaceId">
        <span class="context-menu-separator" />
        <button
          class="danger-menu-item"
          role="menuitem"
          data-testid="unregister-project"
          @click="unregisterContextProject(contextMenu!.id)"
        ><Icon name="close" />{{ t('unregisterProject') }}</button>
      </template>
      <button
        v-if="contextWorkspaceMember()"
        role="menuitem"
        @click="toggleContextProjectPin"
      ><Icon :name="contextWorkspaceMember()!.pinned ? 'starFilled' : 'star'" />{{ t(contextWorkspaceMember()!.pinned ? 'unpinProject' : 'pinProject') }}</button>
      <button
        v-if="contextMenu.workspaceId"
        class="danger-menu-item"
        role="menuitem"
        @click="removeContextProject(contextMenu!.workspaceId!, contextMenu!.id)"
      ><Icon name="close" />{{ t('removeFromWorkspace') }}</button>
    </template>
    <template v-else>
      <strong>{{ contextWorkspaceMember()?.label || contextWorkspaceMember()?.project }}</strong>
      <button
        class="danger-menu-item"
        role="menuitem"
        @click="removeContextProject(contextMenu!.workspaceId!, contextMenu!.id)"
      ><Icon name="close" />{{ t('removeFromWorkspace') }}</button>
    </template>
  </div>

  <DialogShell :open="addExistingOpen" content-class="dialog-content add-existing-dialog" @update:open="addExistingOpen = $event">
    <template #title>{{ t('addExistingProjects') }}</template>
    <template #description>{{ t('addExistingProjectsDescription') }}</template>
        <form data-testid="add-existing-projects-form" @submit.prevent="addExistingProjects">
          <div v-if="availableExistingProjects.length" class="existing-project-list">
            <label v-for="project in availableExistingProjects" :key="project.id" :style="projectAccentStyle(project.color)">
              <input v-model="selectedExistingProjectIds" type="checkbox" :value="project.id">
              <ProjectIcon :project="project" />
              <span><strong>{{ project.name }}</strong><small>{{ project.path }}</small></span>
            </label>
          </div>
          <p v-else class="dialog-empty-state">{{ t('noProjectsAvailable') }}</p>
          <footer>
            <UiButton @click="addExistingOpen = false">{{ t('cancel') }}</UiButton>
            <UiButton type="submit" variant="primary" :disabled="!selectedExistingProjectIds.length">{{ t('addProject') }}</UiButton>
          </footer>
        </form>
  </DialogShell>

  <AppearanceDialog
    v-if="appearanceTarget"
    :open="appearanceOpen"
    :title="appearanceTarget.title"
    :name="appearanceTarget.title"
    :editable-name="appearanceTarget.kind === 'workspace'"
    :note="appearanceTarget.note"
    :editable-note="appearanceTarget.kind === 'project' && Boolean(appearanceTarget.workspaceId)"
    :icon="appearanceTarget.icon"
    :color="appearanceTarget.color"
    :fallback-icon="appearanceTarget.kind === 'workspace-group' ? 'collection' : 'workspace'"
    :show-color="appearanceTarget.kind !== 'workspace-group'"
    @update:open="appearanceOpen = $event"
    @save="saveAppearance"
  />
</template>
