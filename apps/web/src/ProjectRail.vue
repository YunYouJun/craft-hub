<script setup lang="ts">
import type { ProjectAccentColor, ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import AppearanceDialog from './AppearanceDialog.vue'
import CompactEditableField from './CompactEditableField.vue'
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
const dialogOpen = ref(false)
const workspaceDialogOpen = ref(false)
const workspaceName = ref('')
const workspacePaths = ref<string[]>([])
const workspacePathLabels = ref<Record<string, string>>({})
const workspacePathDraft = ref('')
const workspaceError = ref('')
const workspaceSubmitting = ref(false)
const path = ref('')
const error = ref('')
const submitting = ref(false)
const draggedProjectId = ref('')
const draggedWorkspaceId = ref('')
const dropTargetWorkspaceId = ref('')
const dropTargetProjectId = ref('')
const searchQuery = ref('')
const normalizedSearch = computed(() => searchQuery.value.trim().toLocaleLowerCase())
const contextMenu = ref<{ kind: 'workspace' | 'project', id: string, workspaceId?: string, x: number, y: number }>()
const appearanceOpen = ref(false)
const appearanceTarget = ref<{ kind: 'workspace' | 'project', id: string, workspaceId?: string, title: string, note?: string, icon?: string, color?: ProjectAccentColor }>()
const addExistingOpen = ref(false)
const addExistingWorkspaceId = ref('')
const selectedExistingProjectIds = ref<string[]>([])
const availableExistingProjects = computed(() => {
  const workspace = store.workspaces.find(item => item.id === addExistingWorkspaceId.value)
  const memberIds = new Set(workspace?.members.map(member => member.projectId).filter(Boolean))
  return store.projects.filter(project => !memberIds.has(project.id))
})
const filteredWorkspaces = computed(() => store.workspaces.filter((workspace) => {
  if (!normalizedSearch.value)
    return true
  return workspace.name.toLocaleLowerCase().includes(normalizedSearch.value)
    || workspace.members.some(member => workspaceMemberMatches(member))
}))
const filteredUnassignedProjects = computed(() => store.unassignedProjects.filter(project => projectMatches(project)))
const hasSearchResults = computed(() => filteredWorkspaces.value.length > 0 || filteredUnassignedProjects.value.length > 0)

function projectMatches(project: ProjectRecord, label?: string): boolean {
  if (!normalizedSearch.value)
    return true
  return [project.name, project.path, label].some(value => value?.toLocaleLowerCase().includes(normalizedSearch.value))
}

function workspaceMemberMatches(member: WorkspaceRecord['members'][number]): boolean {
  const project = member.projectId ? store.projects.find(item => item.id === member.projectId) : undefined
  return project ? projectMatches(project, member.label) : member.project.toLocaleLowerCase().includes(normalizedSearch.value)
}

function visibleWorkspaceMembers(workspace: WorkspaceRecord): WorkspaceRecord['members'] {
  if (!normalizedSearch.value || workspace.name.toLocaleLowerCase().includes(normalizedSearch.value))
    return workspace.members
  return workspace.members.filter(member => workspaceMemberMatches(member))
}

function closeContextMenu(): void {
  contextMenu.value = undefined
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

function openAppearance(kind: 'workspace' | 'project', id: string, workspaceId?: string): void {
  const target = kind === 'workspace'
    ? store.workspaces.find(item => item.id === id)
    : store.projects.find(item => item.id === id)
  if (!target)
    return
  const note = kind === 'project' && workspaceId
    ? store.workspaces.find(item => item.id === workspaceId)?.members.find(member => member.projectId === id)?.label
    : undefined
  appearanceTarget.value = { kind, id, workspaceId, title: target.name, note, icon: target.icon, color: target.color }
  appearanceOpen.value = true
  closeContextMenu()
}

async function saveAppearance(appearance: { name?: string, note?: string, icon?: string, color?: ProjectAccentColor }): Promise<void> {
  const target = appearanceTarget.value
  if (!target)
    return
  if (target.kind === 'workspace') {
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
    ? await window.craftHubDesktop.selectProjectDirectories()
    : [window.prompt(t('projectPath')) ?? ''].filter(Boolean)
  for (const selectedPath of paths ?? [])
    await store.addProjectPathToWorkspace(workspaceId, selectedPath)
}

onMounted(() => {
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

async function dropOnWorkspace(workspaceId: string): Promise<void> {
  if (draggedWorkspaceId.value)
    await store.reorderWorkspace(draggedWorkspaceId.value, workspaceId)
  else if (draggedProjectId.value)
    await store.addProjectToWorkspace(workspaceId, draggedProjectId.value)
  draggedWorkspaceId.value = ''
  draggedProjectId.value = ''
  dropTargetWorkspaceId.value = ''
}

async function dropOnWorkspaceProject(workspace: typeof store.workspaces[number], targetProjectId: string): Promise<void> {
  const sourceIsMember = workspace.members.some(member => member.projectId === draggedProjectId.value)
  if (sourceIsMember)
    await store.reorderWorkspaceProject(workspace, draggedProjectId.value, targetProjectId)
  else if (draggedProjectId.value)
    await store.addProjectToWorkspace(workspace.id, draggedProjectId.value)
  draggedProjectId.value = ''
  dropTargetProjectId.value = ''
}

async function dropOnUnassignedProject(targetProjectId: string): Promise<void> {
  if (draggedProjectId.value)
    await store.reorderProject(draggedProjectId.value, targetProjectId)
  draggedProjectId.value = ''
  dropTargetProjectId.value = ''
}

function clearDragState(): void {
  draggedProjectId.value = ''
  draggedWorkspaceId.value = ''
  dropTargetWorkspaceId.value = ''
  dropTargetProjectId.value = ''
}

function startWorkspaceDrag(workspaceId: string): void {
  if (!normalizedSearch.value)
    draggedWorkspaceId.value = workspaceId
}

function startProjectDrag(projectId: string): void {
  if (!normalizedSearch.value)
    draggedProjectId.value = projectId
}

async function confirmDeleteWorkspace(workspace: typeof store.workspaces[number]): Promise<void> {
  if (window.confirm(t('confirmDeleteWorkspace', { name: workspace.name })))
    await store.deleteWorkspace(workspace)
}

async function locateProject(workspaceId: string, projectKey: string): Promise<void> {
  try {
    const selectedPath = window.craftHubDesktop?.selectProjectDirectory
      ? await window.craftHubDesktop.selectProjectDirectory()
      : window.prompt(t('projectPath'))
    if (selectedPath)
      await store.locateWorkspaceProject(workspaceId, projectKey, selectedPath)
  }
  catch (caught) {
    window.alert(t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) }))
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
    const selectedPath = await selectProjectDirectory()
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
      <div class="rail-heading">
        <h1>{{ t('workspaces') }}</h1>
        <button class="rail-icon-action" data-testid="add-workspace" :aria-label="t('addWorkspace')" :title="t('addWorkspace')" @click="openCreateWorkspace"><Icon name="plus" /></button>
      </div>
      <label class="rail-search">
        <Icon name="search" />
        <input v-model="searchQuery" type="search" :placeholder="t('searchProjectsWorkspaces')" :aria-label="t('searchProjectsWorkspaces')">
        <button v-if="searchQuery" type="button" :aria-label="t('clearSearch')" @click="searchQuery = ''"><Icon name="close" /></button>
      </label>
      <section
        v-for="workspace in filteredWorkspaces"
        :key="workspace.id"
        class="workspace-group"
        :class="{ dragging: draggedWorkspaceId === workspace.id, 'drop-target': dropTargetWorkspaceId === workspace.id }"
        :style="projectAccentStyle(workspace.color)"
        :draggable="!normalizedSearch"
        @dragstart.self="startWorkspaceDrag(workspace.id)"
        @dragend.self="clearDragState"
        @dragover.prevent
        @dragenter.prevent="draggedWorkspaceId && (dropTargetWorkspaceId = workspace.id)"
        @drop.prevent="dropOnWorkspace(workspace.id)"
        @contextmenu.prevent="openWorkspaceContextMenu($event, workspace)"
      >
        <div class="workspace-row" :class="{ selected: workspace.id === store.selectedWorkspaceId }">
          <button class="workspace-select rail-root-entry" @click="store.selectWorkspace(workspace.id)">
            <span class="rail-drag-handle" :title="t('dragToReorder')"><Icon name="drag" /></span><VisualIcon class="rail-item-icon" :icon="workspace.icon" /><span class="workspace-label">{{ workspace.name }}</span><small>{{ workspace.members.length }}</small>
          </button>
          <button class="workspace-disclosure" :aria-expanded="store.expandedWorkspaceIds.includes(workspace.id)" @click="store.toggleWorkspaceExpanded(workspace.id)">
            <Icon name="arrowRight" :class="{ expanded: store.expandedWorkspaceIds.includes(workspace.id) }" />
          </button>
          <button class="workspace-pin" :class="{ active: workspace.pinned }" :aria-label="t(workspace.pinned ? 'unpinWorkspace' : 'pinWorkspace')" @click="store.toggleWorkspacePin(workspace)">
            <Icon :name="workspace.pinned ? 'starFilled' : 'star'" />
          </button>
          <button class="workspace-pin danger-hover" :aria-label="t('deleteWorkspace')" @click="confirmDeleteWorkspace(workspace)"><Icon name="close" /></button>
        </div>
        <div v-if="normalizedSearch || store.expandedWorkspaceIds.includes(workspace.id)" class="workspace-children">
          <p v-if="!workspace.members.length" class="workspace-empty">{{ t('workspaceEmpty') }}</p>
          <div
            v-for="member in visibleWorkspaceMembers(workspace)"
            :key="member.project"
            class="workspace-project"
            :class="{ 'drop-target': dropTargetProjectId === member.projectId }"
            @dragover.prevent
            @dragenter.prevent="draggedProjectId && (dropTargetProjectId = member.projectId ?? '')"
            @drop.stop.prevent="member.projectId && dropOnWorkspaceProject(workspace, member.projectId)"
          >
            <template v-if="member.projectId && store.projects.find(project => project.id === member.projectId)">
              <button
                class="project-row nested"
                :class="{ selected: member.projectId === store.selectedProjectId }"
                :style="projectAccentStyle(store.projects.find(project => project.id === member.projectId)!.color)"
                :draggable="!normalizedSearch"
                @dragstart="startProjectDrag(member.projectId)"
                @dragend="clearDragState"
                @click="store.selectProject(member.projectId)"
                @contextmenu.stop.prevent="openProjectContextMenu($event, store.projects.find(project => project.id === member.projectId)!, workspace.id)"
                @keydown.alt.up.prevent="store.moveWorkspaceProject(workspace, member.projectId, -1)"
                @keydown.alt.down.prevent="store.moveWorkspaceProject(workspace, member.projectId, 1)"
              >
                <span class="rail-drag-handle" :title="t('dragToReorder')"><Icon name="drag" /></span><ProjectIcon class="rail-item-icon" :project="store.projects.find(project => project.id === member.projectId)!" />
                <span class="project-name" :title="member.label ? store.projects.find(project => project.id === member.projectId)!.name : undefined">{{ member.label || store.projects.find(project => project.id === member.projectId)!.name }}</span>
                <small v-if="workspace.primaryProject === member.project" class="primary-badge">{{ t('primary') }}</small>
                <span
                  class="project-trust"
                  :class="store.projects.find(project => project.id === member.projectId)!.trust"
                  :title="t(store.projects.find(project => project.id === member.projectId)!.trust === 'trusted' ? 'trusted' : 'untrusted')"
                ><Icon :name="store.projects.find(project => project.id === member.projectId)!.trust" /></span>
              </button>
              <button class="member-pin" :aria-label="t(member.pinned ? 'unpinProject' : 'pinProject')" @click="store.toggleWorkspaceProjectPin(workspace, member.projectId)">
                <Icon :name="member.pinned ? 'starFilled' : 'star'" />
              </button>
              <button class="member-pin danger-hover" :aria-label="t('removeFromWorkspace')" @click="store.removeProjectFromWorkspace(workspace.id, member.projectId)"><Icon name="close" /></button>
            </template>
            <div v-else class="project-row nested unresolved">
              <Icon name="error" /><span class="project-name">{{ member.project }}</span><small>{{ t('unresolved') }}</small>
            </div>
            <template v-if="!member.projectId">
              <button class="member-pin" :aria-label="t('locateProject')" :title="t('locateProject')" @click="locateProject(workspace.id, member.project)"><Icon name="folder" /></button>
              <button class="member-pin danger-hover" :aria-label="t('removeFromWorkspace')" @click="store.removeProjectFromWorkspace(workspace.id, member.project)"><Icon name="close" /></button>
            </template>
          </div>
        </div>
      </section>
      <section v-if="filteredUnassignedProjects.length" class="unassigned-group">
        <div class="unassigned-heading" :title="t('unassignedDescription')">
          <h2>{{ t('unassigned') }}</h2>
          <small>{{ filteredUnassignedProjects.length }}</small>
        </div>
        <button
          v-for="project in filteredUnassignedProjects"
          :key="project.id"
          class="project-row nested rail-root-entry"
          :class="{ selected: project.id === store.selectedProjectId, dragging: draggedProjectId === project.id, 'drop-target': dropTargetProjectId === project.id }"
          :style="projectAccentStyle(project.color)"
          :draggable="!normalizedSearch"
          @dragstart="startProjectDrag(project.id)"
          @dragend="clearDragState"
          @dragover.prevent
          @dragenter.prevent="draggedProjectId && (dropTargetProjectId = project.id)"
          @drop.stop.prevent="dropOnUnassignedProject(project.id)"
          @click="store.selectProject(project.id)"
          @contextmenu.stop.prevent="openProjectContextMenu($event, project)"
        >
          <span class="rail-drag-handle" :title="t('dragToReorder')"><Icon name="drag" /></span><ProjectIcon class="rail-item-icon" :project="project" /><span class="project-name">{{ project.name }}</span>
          <span class="project-trust" :class="project.trust" :aria-label="t(project.trust === 'trusted' ? 'trusted' : 'untrusted')"><Icon :name="project.trust" /></span>
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
      <button class="add-project" data-testid="add-project" @click="openAddProject">
        <Icon name="plus" /> {{ t('addProject') }}
      </button>
    </div>
  </aside>

  <DialogRoot :open="dialogOpen" @update:open="dialogOpen = $event">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="add-project-dialog">
        <DialogTitle>{{ t('addProject') }}</DialogTitle>
        <DialogDescription>{{ t('addProjectDescription') }}</DialogDescription>
        <form data-testid="add-project-form" @submit.prevent="addProject">
          <label>
            <span>{{ t('projectPath') }}</span>
            <input v-model="path" name="project-path" :placeholder="t('projectPathPlaceholder')" autofocus>
          </label>
          <p v-if="error" class="error-message">{{ error }}</p>
          <footer>
            <button type="button" class="secondary-button" @click="dialogOpen = false">{{ t('cancel') }}</button>
            <button type="submit" class="primary-button" :disabled="!path.trim() || submitting">
              {{ submitting ? t('adding') : t('addProject') }}
            </button>
          </footer>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot :open="workspaceDialogOpen" @update:open="workspaceDialogOpen = $event">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="add-project-dialog workspace-dialog">
        <DialogTitle>{{ t('addWorkspace') }}</DialogTitle>
        <DialogDescription>{{ t('createWorkspaceDescription') }}</DialogDescription>
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
              <button
                v-if="canChooseWorkspaceFolders"
                type="button"
                class="secondary-button compact-button"
                data-testid="choose-workspace-folders"
                @click="chooseWorkspaceFolders"
              >
                <Icon name="folder" /> {{ t('chooseFolders') }}
              </button>
            </div>
            <div class="workspace-path-entry">
              <input
                v-model="workspacePathDraft"
                name="workspace-project-path"
                :placeholder="t('workspacePathPlaceholder')"
                @keydown.enter.prevent="addWorkspacePath"
              >
              <button type="button" class="secondary-button" :disabled="!workspacePathDraft.trim()" @click="addWorkspacePath">
                {{ t('addFolder') }}
              </button>
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
            <button type="button" class="secondary-button" @click="workspaceDialogOpen = false">{{ t('cancel') }}</button>
            <button type="submit" class="primary-button" :disabled="!workspaceName.trim() || workspaceSubmitting">
              {{ workspaceSubmitting ? t('creating') : t('addWorkspace') }}
            </button>
          </footer>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <div
    v-if="contextMenu"
    class="rail-context-menu"
    role="menu"
    :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    data-testid="rail-context-menu"
    @click.stop
    @contextmenu.prevent
  >
    <template v-if="contextMenu.kind === 'workspace'">
      <strong>{{ store.workspaces.find(workspace => workspace.id === contextMenu!.id)?.name }}</strong>
      <button role="menuitem" @click="openAddExisting(contextMenu!.id)"><Icon name="plus" />{{ t('addExistingProjects') }}</button>
      <button role="menuitem" @click="addProjectFoldersToWorkspace(contextMenu!.id)"><Icon name="folder" />{{ t('addProjectFolders') }}</button>
      <button role="menuitem" @click="openAppearance('workspace', contextMenu!.id)"><Icon name="palette" />{{ t('appearance') }}</button>
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
    <template v-else>
      <strong>{{ store.projects.find(project => project.id === contextMenu!.id)?.name }}</strong>
      <button role="menuitem" @click="openAppearance('project', contextMenu!.id, contextMenu!.workspaceId)"><Icon name="palette" />{{ t('appearance') }}</button>
      <button
        v-if="contextMenu.workspaceId"
        class="danger-menu-item"
        role="menuitem"
        @click="store.removeProjectFromWorkspace(contextMenu!.workspaceId!, contextMenu!.id); closeContextMenu()"
      ><Icon name="close" />{{ t('removeFromWorkspace') }}</button>
    </template>
  </div>

  <DialogRoot :open="addExistingOpen" @update:open="addExistingOpen = $event">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content add-existing-dialog">
        <DialogTitle>{{ t('addExistingProjects') }}</DialogTitle>
        <DialogDescription>{{ t('addExistingProjectsDescription') }}</DialogDescription>
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
            <button type="button" class="secondary-button" @click="addExistingOpen = false">{{ t('cancel') }}</button>
            <button type="submit" class="primary-button" :disabled="!selectedExistingProjectIds.length">{{ t('addProject') }}</button>
          </footer>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

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
    @update:open="appearanceOpen = $event"
    @save="saveAppearance"
  />
</template>
