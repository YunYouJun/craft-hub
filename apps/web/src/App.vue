<script setup lang="ts">
import { computed, onBeforeMount, onBeforeUnmount, ref } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { useRoute, useRouter } from 'vue-router'
import { subscribeToProjectChanges } from './api'
import CapabilityList from './CapabilityList.vue'
import CommandPalette from './CommandPalette.vue'
import { Button as UiButton } from './components/ui/button'
import DesktopNavigationDialog from './DesktopNavigationDialog.vue'
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
const route = useRoute()
const router = useRouter()
const paletteOpen = ref(false)
const settingsOpen = ref(false)
const marketplaceOpen = computed(() => route.name === 'marketplace' || route.name === 'plugin-detail')
const marketplaceImportCatalogUrl = ref('')
const onboardingOpen = ref(false)
const desktopNavigation = ref<Extract<DesktopNavigation, { kind: 'project' }>>()
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
let stopDesktopNavigationEvents: (() => void) | undefined
let visibilityRefreshTimer: ReturnType<typeof setTimeout> | undefined
let workbenchRefresh: Promise<void> | undefined

async function openMarketplace(): Promise<void> {
  if (!marketplaceOpen.value)
    await router.push({ name: 'marketplace' })
}

async function openWorkbench(): Promise<void> {
  if (marketplaceOpen.value)
    await router.push({ name: 'workbench' })
}

async function openMarketplaceSourceImport(catalogUrl: string): Promise<void> {
  marketplaceImportCatalogUrl.value = catalogUrl
  await openMarketplace()
}

async function openDesktopNavigation(navigation: DesktopNavigation): Promise<void> {
  onboardingOpen.value = false
  settingsOpen.value = false
  desktopNavigation.value = undefined
  if (navigation.kind === 'marketplace') {
    await openMarketplace()
    return
  }
  await openWorkbench()
  if (navigation.kind === 'settings') {
    settingsOpen.value = true
    return
  }
  if (navigation.kind === 'home') {
    return
  }
  if (navigation.kind === 'workspace') {
    if (navigation.ownerScopeId && navigation.ownerScopeId !== store.activeOwnerScopeId)
      await store.switchOwnerScope(navigation.ownerScopeId)
    if (store.allWorkspaces.some(workspace => workspace.id === navigation.workspaceId))
      store.selectWorkspace(navigation.workspaceId)
    return
  }
  if (navigation.matches.length === 1) {
    await store.selectProject(navigation.matches[0]!.id)
    if (navigation.capabilityId)
      store.selectCapability(navigation.capabilityId)
    return
  }
  desktopNavigation.value = navigation
}

async function openShortcutCapability(shortcutId: string): Promise<void> {
  const target = parseCapabilityShortcutId(shortcutId)
  if (!target || !store.paletteItems.some(item => item.project.id === target.projectId && item.capability.id === target.capabilityId))
    return
  if (target.projectId !== store.selectedProjectId)
    await store.selectProject(target.projectId)
  store.selectedCapabilityId = target.capabilityId
  paletteOpen.value = false
  await openWorkbench()
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

async function refreshWorkbench(): Promise<void> {
  if (workbenchRefresh)
    return workbenchRefresh
  const request = Promise.all([
    store.refreshProjects(),
    store.loadWorkspaces(),
    store.loadAgentTasks(),
    refreshCodexActivity(),
  ]).then(() => {})
  workbenchRefresh = request
  try {
    await request
  }
  finally {
    if (workbenchRefresh === request)
      workbenchRefresh = undefined
  }
}

function refreshWhenVisible(): void {
  if (document.visibilityState !== 'visible')
    return
  if (visibilityRefreshTimer)
    clearTimeout(visibilityRefreshTimer)
  visibilityRefreshTimer = setTimeout(() => {
    visibilityRefreshTimer = undefined
    void refreshWorkbench().catch(() => {})
  }, 100)
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
  const initialProjectId = typeof route.query.project === 'string' ? route.query.project : undefined
  await store.loadSettings()
  await store.loadOwnerScopes()
  await store.loadWorkspaces()
  const restoredProjectId = await store.loadWorkspaceState(initialProjectId)
  await Promise.all([
    store.loadProjects(restoredProjectId).catch(() => {}),
    store.loadAgentTasks(),
    refreshCodexActivity(),
    store.loadRuns(),
  ])
  await store.loadRunSummaries()
  stopProjectEvents = subscribeToProjectChanges({
    onChange: event => void store.refreshProject(event).catch(() => {}),
    onRunChange: summary => store.applyRunSummary(summary),
    onSettingsChange: snapshot => void store.applySettings(snapshot).catch(() => {}),
    onUserConfigChange: (status) => {
      store.applyUserConfigStatus(status)
      void Promise.all([store.loadOwnerScopes(), store.loadWorkspaces()]).catch(() => {})
    },
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
    void openWorkbench()
    onboardingOpen.value = true
  })
  stopMarketplaceImportEvents = window.craftHubDesktop?.onMarketplaceSourceImport?.(catalogUrl => void openMarketplaceSourceImport(catalogUrl))
  stopDesktopNavigationEvents = window.craftHubDesktop?.onDesktopNavigation?.(navigation => void openDesktopNavigation(navigation))
  const pendingMarketplaceImport = await window.craftHubDesktop?.consumeMarketplaceSourceImport?.()
  if (pendingMarketplaceImport)
    await openMarketplaceSourceImport(pendingMarketplaceImport)
  const pendingDesktopNavigation = await window.craftHubDesktop?.consumeDesktopNavigation?.()
  if (pendingDesktopNavigation)
    await openDesktopNavigation(pendingDesktopNavigation)
})
onBeforeUnmount(() => {
  if (visibilityRefreshTimer)
    clearTimeout(visibilityRefreshTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  stopProjectEvents?.()
  stopCodexActivityEvents?.()
  stopOnboardingEvents?.()
  stopMarketplaceImportEvents?.()
  stopDesktopNavigationEvents?.()
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
      <SplitterPanel id="projects-panel" :order="1" size-unit="px" :default-size="280" :min-size="252" :max-size="390">
        <ProjectRail
          :active-view="marketplaceOpen ? 'marketplace' : 'workbench'"
          @open-marketplace="openMarketplace"
          @open-settings="settingsOpen = true"
          @open-workbench="openWorkbench"
        />
      </SplitterPanel>
      <SplitterResizeHandle v-if="store.projects.length" id="projects-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeProjects')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeProjects')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel v-if="store.projects.length" id="capabilities-panel" :order="2" size-unit="px" :default-size="320" :min-size="230" :max-size="540" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <WorkspaceProjectList v-if="store.selectedWorkspace" />
        <CapabilityList v-else />
      </SplitterPanel>
      <SplitterResizeHandle v-if="store.projects.length" id="capabilities-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeCapabilities')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeCapabilities')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel id="detail-panel" :order="3" size-unit="px" :min-size="350" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <section class="detail-workspace">
          <ProjectToolbar v-if="store.selectedProject && !store.selectedWorkspace" />
          <section v-if="store.projectsLoadState === 'error' && !store.projects.length" class="project-load-state error" data-testid="project-load-error" role="alert">
            <Icon name="error" />
            <h1>{{ t('projectLoadFailed') }}</h1>
            <p>{{ store.projectsLoadError }}</p>
            <button type="button" @click="retryProjects">{{ t('retry') }}</button>
          </section>
          <section v-else-if="store.projectsLoadState !== 'ready' && store.projectsLoadState !== 'error' && !store.selectedProject && !store.selectedWorkspace" class="project-load-state" aria-live="polite">
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
        <button class="tooltip-action" :aria-label="t('refresh')" :aria-busy="store.refreshing" :data-tooltip="t('refresh')" :disabled="store.refreshing" :title="t('refresh')" @click="refreshWorkbench">
          <Icon :name="store.refreshing ? 'loading' : 'refresh'" :class="{ 'refresh-loading-icon': store.refreshing }" />
        </button>
        <span v-if="store.selectedProject">{{ t('project', { name: store.selectedProject.name }) }}</span>
      </div>
    </footer>
    <CommandPalette v-model:open="paletteOpen" />
    <SettingsDialog v-model:open="settingsOpen" />
    <MarketplaceDialog :open="marketplaceOpen" :import-catalog-url="marketplaceImportCatalogUrl" />
    <ProjectAgentActionDialog v-model:open="store.agentActionDialogOpen" />
    <DesktopNavigationDialog
      v-if="desktopNavigation"
      :matches="desktopNavigation.matches"
      :reference="desktopNavigation.reference"
      :capability-id="desktopNavigation.capabilityId"
      @close="desktopNavigation = undefined"
      @resolved="desktopNavigation = undefined"
    />
    <DialogRoot :open="store.packageCapabilityDrawerOpen" @update:open="$event || store.closePackageCapabilityDrawer()">
      <DialogPortal>
        <DialogOverlay class="package-drawer-overlay" />
        <DialogContent class="package-drawer-content">
          <DialogTitle class="sr-only">{{ store.activeCapability?.name ?? t('package') }}</DialogTitle>
          <DialogDescription class="sr-only">{{ store.selectedPackage?.name ?? store.activeProject?.name }}</DialogDescription>
          <DialogClose as-child>
            <UiButton class="package-drawer-close" size="icon" variant="ghost" :aria-label="t('close')" :title="t('close')">
              <Icon name="close" />
            </UiButton>
          </DialogClose>
          <DetailPanel package-drawer-content />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
