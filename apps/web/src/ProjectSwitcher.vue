<script setup lang="ts">
import type { ProjectRecord } from 'craft-hub'
import type { AcceptableValue } from 'reka-ui'
import { useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxLabel,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import ProjectIcon from './ProjectIcon.vue'
import { projectAccentStyle } from './project-visuals'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const open = ref(false)
const search = ref('')
const showAll = ref(false)
const addDialogOpen = ref(false)
const projectPath = ref('')
const addError = ref('')
const adding = ref(false)
const narrowWindow = useMediaQuery('(max-width: 760px)')

const currentProject = computed(() => store.selectedProject)
const recentProjects = computed(() => store.recentProjectIds
  .filter(id => id !== store.selectedProjectId)
  .map(id => store.projects.find(project => project.id === id))
  .filter((project): project is ProjectRecord => Boolean(project)))
const recentIds = computed(() => new Set(store.recentProjectIds))

function workspaceNames(projectId: string): string[] {
  return store.allWorkspaces
    .filter(workspace => workspace.members.some(member => member.projectId === projectId))
    .map(workspace => workspace.name)
}

function searchableText(project: ProjectRecord): string {
  return [project.name, project.path, ...workspaceNames(project.id)].join(' ').toLocaleLowerCase()
}

function matchScore(project: ProjectRecord, query: string): number {
  const name = project.name.toLocaleLowerCase()
  const path = project.path.toLocaleLowerCase()
  const workspace = workspaceNames(project.id).join(' ').toLocaleLowerCase()
  if (name.startsWith(query))
    return 0
  if (name.includes(query))
    return 1
  if (workspace.includes(query))
    return 2
  if (path.includes(query))
    return 3
  return Number.POSITIVE_INFINITY
}

const normalizedSearch = computed(() => search.value.trim().toLocaleLowerCase())
const searchResults = computed(() => {
  const query = normalizedSearch.value
  if (!query)
    return []
  return store.projects
    .filter(project => searchableText(project).includes(query))
    .sort((left, right) => matchScore(left, query) - matchScore(right, query)
      || Number(recentIds.value.has(right.id)) - Number(recentIds.value.has(left.id))
      || left.name.localeCompare(right.name))
})
const allProjects = computed(() => {
  if (!showAll.value)
    return []
  const displayed = new Set([store.selectedProjectId, ...recentProjects.value.map(project => project.id)])
  return store.projects.filter(project => !displayed.has(project.id))
})
const canShowAll = computed(() => store.projects.length > 1 + recentProjects.value.length)

function workspaceLabel(project: ProjectRecord): string {
  return workspaceNames(project.id).join(' · ')
}

function closeSwitcher(): void {
  open.value = false
}

async function selectProject(value: AcceptableValue): Promise<void> {
  if (typeof value !== 'string')
    return
  closeSwitcher()
  if (value !== store.selectedProjectId)
    await store.selectProject(value)
}

function onShortcut(event: KeyboardEvent): void {
  if (event.key.toLocaleLowerCase() !== 'r' || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
    return
  event.preventDefault()
  open.value = true
}

async function openAddProject(): Promise<void> {
  closeSwitcher()
  projectPath.value = ''
  addError.value = ''
  const selectProjectDirectory = window.craftHubDesktop?.selectProjectDirectory
  if (!selectProjectDirectory) {
    addDialogOpen.value = true
    return
  }
  try {
    const selectedPath = await selectProjectDirectory(store.repositoriesRoot)
    if (selectedPath)
      await addProject(selectedPath)
  }
  catch (caught) {
    addDialogOpen.value = true
    addError.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

async function addProject(path = projectPath.value.trim()): Promise<void> {
  if (!path || adding.value)
    return
  adding.value = true
  addError.value = ''
  try {
    await store.addProject(path)
    addDialogOpen.value = false
  }
  catch (caught) {
    projectPath.value = path
    addDialogOpen.value = true
    addError.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    adding.value = false
  }
}

watch(open, (value) => {
  if (!value) {
    search.value = ''
    showAll.value = false
  }
})

onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut))
</script>

<template>
  <ComboboxRoot
    v-if="currentProject"
    class="project-switcher"
    :model-value="store.selectedProjectId"
    :open="open"
    ignore-filter
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    @update:model-value="selectProject"
    @update:open="open = $event"
  >
    <ComboboxAnchor as-child>
      <ComboboxTrigger as-child>
        <button
          type="button"
          class="project-switcher-trigger"
          data-testid="project-switcher-trigger"
          :aria-label="t('switchProject')"
          :title="t('switchProjectShortcut')"
        >
          <ProjectIcon :project="currentProject" />
          <span class="project-toolbar-copy">
            <strong>{{ currentProject.name }}</strong>
            <small>{{ currentProject.path }}</small>
          </span>
          <Icon name="arrowDown" />
        </button>
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        class="project-switcher-content"
        :position="narrowWindow ? 'inline' : 'popper'"
        align="start"
        :side-offset="6"
        data-testid="project-switcher"
      >
        <div class="project-switcher-search">
          <Icon name="search" />
          <ComboboxInput v-model="search" autofocus :placeholder="t('searchProjects')" :aria-label="t('searchProjects')" />
        </div>
        <ComboboxViewport class="project-switcher-viewport">
          <ComboboxEmpty class="project-switcher-empty">{{ t('noMatchingProjects') }}</ComboboxEmpty>

          <ComboboxGroup v-if="normalizedSearch" class="project-switcher-group">
            <ComboboxLabel class="project-switcher-label">{{ t('searchResults') }}</ComboboxLabel>
            <ComboboxItem
              v-for="project in searchResults"
              :key="project.id"
              class="project-switcher-item"
              :value="project.id"
              :text-value="searchableText(project)"
              :style="projectAccentStyle(project.color)"
            >
              <ProjectIcon :project="project" />
              <span><strong>{{ project.name }}</strong><small>{{ workspaceLabel(project) || project.path }}</small></span>
              <ComboboxItemIndicator><Icon name="check" /></ComboboxItemIndicator>
            </ComboboxItem>
          </ComboboxGroup>

          <template v-else>
            <ComboboxGroup class="project-switcher-group">
              <ComboboxLabel class="project-switcher-label">{{ t('currentProject') }}</ComboboxLabel>
              <ComboboxItem class="project-switcher-item" :value="currentProject.id" :style="projectAccentStyle(currentProject.color)">
                <ProjectIcon :project="currentProject" />
                <span><strong>{{ currentProject.name }}</strong><small>{{ workspaceLabel(currentProject) || currentProject.path }}</small></span>
                <ComboboxItemIndicator><Icon name="check" /></ComboboxItemIndicator>
              </ComboboxItem>
            </ComboboxGroup>

            <template v-if="recentProjects.length">
              <ComboboxSeparator />
              <ComboboxGroup class="project-switcher-group">
                <ComboboxLabel class="project-switcher-label">{{ t('recentProjects') }}</ComboboxLabel>
                <ComboboxItem
                  v-for="project in recentProjects"
                  :key="project.id"
                  class="project-switcher-item"
                  :value="project.id"
                  :style="projectAccentStyle(project.color)"
                >
                  <ProjectIcon :project="project" />
                  <span><strong>{{ project.name }}</strong><small>{{ workspaceLabel(project) || project.path }}</small></span>
                </ComboboxItem>
              </ComboboxGroup>
            </template>

            <template v-if="allProjects.length">
              <ComboboxSeparator />
              <ComboboxGroup class="project-switcher-group">
                <ComboboxLabel class="project-switcher-label">{{ t('allProjects') }}</ComboboxLabel>
                <ComboboxItem
                  v-for="project in allProjects"
                  :key="project.id"
                  class="project-switcher-item"
                  :value="project.id"
                  :style="projectAccentStyle(project.color)"
                >
                  <ProjectIcon :project="project" />
                  <span><strong>{{ project.name }}</strong><small>{{ workspaceLabel(project) || project.path }}</small></span>
                </ComboboxItem>
              </ComboboxGroup>
            </template>
          </template>
        </ComboboxViewport>

        <div class="project-switcher-footer">
          <button v-if="!normalizedSearch && canShowAll && !showAll" type="button" @click="showAll = true"><Icon name="collection" /> {{ t('showAllProjects') }}</button>
          <button type="button" data-testid="project-switcher-add" @click="openAddProject"><Icon name="plus" /> {{ t('addProjectEllipsis') }}</button>
          <kbd>Ctrl R</kbd>
        </div>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>

  <DialogShell :open="addDialogOpen" content-class="add-project-dialog" @update:open="addDialogOpen = $event">
    <template #title>{{ t('addProject') }}</template>
    <template #description>{{ t('addProjectDescription') }}</template>
    <form data-testid="project-switcher-add-form" @submit.prevent="addProject()">
      <input v-model="projectPath" autofocus :placeholder="t('workspacePathPlaceholder')" :aria-label="t('workingDirectory')">
      <p v-if="addError" class="error-message" role="alert">{{ addError }}</p>
      <footer>
        <UiButton type="button" :disabled="adding" @click="addDialogOpen = false">{{ t('cancel') }}</UiButton>
        <UiButton type="submit" variant="primary" :disabled="!projectPath.trim() || adding">{{ adding ? t('adding') : t('addProject') }}</UiButton>
      </footer>
    </form>
  </DialogShell>
</template>
