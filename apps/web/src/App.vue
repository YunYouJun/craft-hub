<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, ref } from 'vue'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { subscribeToProjectChanges } from './api'
import CapabilityList from './CapabilityList.vue'
import CommandPalette from './CommandPalette.vue'
import DetailPanel from './DetailPanel.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import MarketplaceDialog from './MarketplaceDialog.vue'
import ProjectRail from './ProjectRail.vue'
import ProjectAgentActionDialog from './ProjectAgentActionDialog.vue'
import ProjectToolbar from './ProjectToolbar.vue'
import SettingsDialog from './SettingsDialog.vue'
import { capabilityShortcutPrefix, commandPaletteShortcutId, defaultCommandPaletteShortcut, matchesShortcut, parseCapabilityShortcutId } from './shortcuts'
import WelcomePanel from './WelcomePanel.vue'
import WorkspaceDashboard from './WorkspaceDashboard.vue'
import WorkspaceProjectList from './WorkspaceProjectList.vue'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const paletteOpen = ref(false)
const settingsOpen = ref(false)
const marketplaceOpen = ref(false)
const marketplaceImportCatalogUrl = ref('')
const onboardingOpen = ref(false)
const eventStreamConnected = ref(false)
const codexActivityStatus = ref<CodexActivityStatus>()
const runningCodexTaskCount = computed(() => {
  const sessionIds = new Set(codexActivityStatus.value?.runningSessionIds ?? [])
  let localOnlyCount = 0
  for (const task of store.agentTasks.filter(task => task.provider === 'codex' && task.status === 'running')) {
    if (task.externalThreadId)
      sessionIds.add(task.externalThreadId)
    else
      localOnlyCount++
  }
  return sessionIds.size + localOnlyCount
})
let stopProjectEvents: (() => void) | undefined
let stopCodexActivityEvents: (() => void) | undefined
let stopOnboardingEvents: (() => void) | undefined
let stopMarketplaceImportEvents: (() => void) | undefined

function openMarketplaceSourceImport(catalogUrl: string): void {
  marketplaceImportCatalogUrl.value = catalogUrl
  marketplaceOpen.value = true
}

async function openShortcutCapability(shortcutId: string): Promise<void> {
  const target = parseCapabilityShortcutId(shortcutId)
  if (!target || !store.paletteItems.some(item => item.project.id === target.projectId && item.capability.id === target.capabilityId))
    return
  if (target.projectId !== store.selectedProjectId)
    await store.selectProject(target.projectId)
  store.selectedCapabilityId = target.capabilityId
  paletteOpen.value = false
  marketplaceOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  const shortcuts = store.settings?.settings['workbench.shortcuts'] ?? { [commandPaletteShortcutId]: defaultCommandPaletteShortcut }
  const paletteShortcut = shortcuts[commandPaletteShortcutId] ?? defaultCommandPaletteShortcut
  if (matchesShortcut(event, paletteShortcut)) {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
    return
  }
  const match = Object.entries(shortcuts).find(([id, shortcut]) => id.startsWith(capabilityShortcutPrefix) && matchesShortcut(event, shortcut))
  if (!match)
    return
  event.preventDefault()
  void openShortcutCapability(match[0])
}

async function refreshCodexActivity(): Promise<void> {
  codexActivityStatus.value = await window.craftHubDesktop?.codexActivityStatus?.() ?? codexActivityStatus.value
}

function refreshWhenVisible(): void {
  if (document.visibilityState === 'visible')
    void Promise.all([store.refreshProjects(), store.loadWorkspaces(), store.loadAgentTasks(), refreshCodexActivity()]).catch(() => {})
}

function retryProjects(): void {
  void store.loadProjects().catch(() => {})
}

async function focusCodexApplication(): Promise<void> {
  await window.craftHubDesktop?.focusCodexApplication?.()
}

onBeforeMount(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  const initialProjectId = new URLSearchParams(window.location.search).get('project') ?? undefined
  await store.loadSettings()
  await store.loadOwnerScopes()
  await Promise.all([
    store.loadProjects(initialProjectId).catch(() => {}),
    store.loadWorkspaces(),
    store.loadAgentTasks(),
    refreshCodexActivity(),
    store.loadRuns(),
  ])
  await store.loadWorkspaceState(initialProjectId)
  await store.loadRunSummaries()
  stopProjectEvents = subscribeToProjectChanges({
    onChange: event => void store.refreshProject(event).catch(() => {}),
    onRunChange: summary => store.applyRunSummary(summary),
    onSettingsChange: snapshot => void store.applySettings(snapshot).catch(() => {}),
    onAgentTaskChange: task => store.applyAgentTask(task),
    onPluginChange: () => void store.refreshProjects().catch(() => {}),
    onError: () => { eventStreamConnected.value = false },
    onOpen: () => {
      eventStreamConnected.value = true
      void store.loadSettings().catch(() => {})
    },
  })
  stopCodexActivityEvents = window.craftHubDesktop?.onCodexActivityStatus?.(status => codexActivityStatus.value = status)
  stopOnboardingEvents = window.craftHubDesktop?.onReplayOnboarding?.(() => {
    marketplaceOpen.value = false
    onboardingOpen.value = true
  })
  stopMarketplaceImportEvents = window.craftHubDesktop?.onMarketplaceSourceImport?.(openMarketplaceSourceImport)
  const pendingMarketplaceImport = await window.craftHubDesktop?.consumeMarketplaceSourceImport?.()
  if (pendingMarketplaceImport)
    openMarketplaceSourceImport(pendingMarketplaceImport)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  stopProjectEvents?.()
  stopCodexActivityEvents?.()
  stopOnboardingEvents?.()
  stopMarketplaceImportEvents?.()
})
</script>

<template>
  <div class="app-shell" :class="{ 'has-app-notices': store.runtimeSchemaMismatch || (store.projectsLoadState === 'error' && store.projects.length) }">
    <section v-if="store.runtimeSchemaMismatch || (store.projectsLoadState === 'error' && store.projects.length)" class="app-notices">
      <div v-if="store.runtimeSchemaMismatch" class="runtime-schema-warning" data-testid="runtime-schema-mismatch" role="alert">
        <Icon name="error" />
        <span><strong>{{ t('runtimeOutdated') }}</strong> {{ t('runtimeOutdatedDescription') }}</span>
        <button type="button" @click="retryProjects">{{ t('retry') }}</button>
      </div>
      <div v-if="store.projectsLoadState === 'error' && store.projects.length" class="project-refresh-warning" data-testid="project-refresh-error" role="alert">
        <Icon name="error" />
        <span><strong>{{ t('projectRefreshFailed') }}</strong> {{ store.projectsLoadError }}</span>
        <button type="button" @click="retryProjects">{{ t('retry') }}</button>
      </div>
    </section>
    <SplitterGroup
      id="craft-hub-workbench"
      class="workbench-splitter"
      direction="horizontal"
      auto-save-id="craft-hub-workbench-layout-v2"
      :keyboard-resize-by="16"
    >
      <SplitterPanel id="projects-panel" size-unit="px" :default-size="280" :min-size="252" :max-size="390">
        <ProjectRail
          :active-view="marketplaceOpen ? 'marketplace' : 'workbench'"
          @open-marketplace="marketplaceOpen = true"
          @open-settings="settingsOpen = true"
          @open-workbench="marketplaceOpen = false"
        />
      </SplitterPanel>
      <SplitterResizeHandle v-if="store.projects.length" id="projects-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeProjects')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeProjects')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel v-if="store.projects.length" id="capabilities-panel" size-unit="px" :default-size="320" :min-size="230" :max-size="540" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <WorkspaceProjectList v-if="store.selectedWorkspace" />
        <CapabilityList v-else />
      </SplitterPanel>
      <SplitterResizeHandle v-if="store.projects.length" id="capabilities-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeCapabilities')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeCapabilities')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel id="detail-panel" size-unit="px" :min-size="350" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <section class="detail-workspace">
          <ProjectToolbar v-if="store.projects.length && !store.selectedWorkspace" />
          <section v-if="store.projectsLoadState === 'error' && !store.projects.length" class="project-load-state error" data-testid="project-load-error" role="alert">
            <Icon name="error" />
            <h1>{{ t('projectLoadFailed') }}</h1>
            <p>{{ store.projectsLoadError }}</p>
            <button type="button" @click="retryProjects">{{ t('retry') }}</button>
          </section>
          <section v-else-if="store.projectsLoadState !== 'ready' && !store.projects.length" class="project-load-state" aria-live="polite">
            <Icon name="loading" />
            <p>{{ t('loading') }}</p>
          </section>
          <WelcomePanel
            v-else-if="onboardingOpen || !store.projects.length"
            :replaying="Boolean(store.projects.length)"
            @close="onboardingOpen = false"
          />
          <DetailPanel v-else-if="store.workspaceCapability" />
          <WorkspaceDashboard v-else-if="store.selectedWorkspace" />
          <DetailPanel v-else />
        </section>
      </SplitterPanel>
    </SplitterGroup>
    <footer class="status-bar">
      <span :aria-busy="store.refreshing">
        <Icon v-if="store.refreshing" name="loading" class="refresh-loading-icon" />
        <i v-else :class="{ updated: store.recentlyUpdated }" />
        {{ store.refreshing ? t('refreshing') : store.recentlyUpdated ? t('filesUpdated') : eventStreamConnected ? t('ready') : t('reconnecting') }}
      </span>
      <div class="status-actions">
        <button
          v-if="runningCodexTaskCount"
          type="button"
          class="codex-task-status tooltip-action"
          :aria-label="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          :data-tooltip="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          :title="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          @click="focusCodexApplication"
        >
          <Icon name="codex" />
          <strong>{{ runningCodexTaskCount }}</strong>
        </button>
        <button class="tooltip-action" :aria-label="t('refresh')" :aria-busy="store.refreshing" :data-tooltip="t('refresh')" :disabled="store.refreshing" :title="t('refresh')" @click="refreshWhenVisible">
          <Icon :name="store.refreshing ? 'loading' : 'refresh'" :class="{ 'refresh-loading-icon': store.refreshing }" />
        </button>
        <span v-if="store.selectedProject">{{ t('project', { name: store.selectedProject.name }) }}</span>
      </div>
    </footer>
    <CommandPalette v-model:open="paletteOpen" />
    <SettingsDialog v-model:open="settingsOpen" />
    <MarketplaceDialog :open="marketplaceOpen" :import-catalog-url="marketplaceImportCatalogUrl" />
    <ProjectAgentActionDialog v-model:open="store.agentActionDialogOpen" />
  </div>
</template>
