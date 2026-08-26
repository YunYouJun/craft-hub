<script setup lang="ts">
import { onBeforeMount, onBeforeUnmount, ref } from 'vue'
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
import WorkspaceDashboard from './WorkspaceDashboard.vue'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const paletteOpen = ref(false)
const settingsOpen = ref(false)
const marketplaceOpen = ref(false)
const eventStreamConnected = ref(false)
let stopProjectEvents: (() => void) | undefined

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

function refreshWhenVisible(): void {
  if (document.visibilityState === 'visible')
    void store.refreshProjects().catch(() => {})
}

onBeforeMount(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  const initialProjectId = new URLSearchParams(window.location.search).get('project') ?? undefined
  await store.loadSettings()
  await Promise.all([
    store.loadProjects(initialProjectId),
    store.loadWorkspaces(),
    store.loadAgentTasks(),
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
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  stopProjectEvents?.()
})
</script>

<template>
  <div class="app-shell">
    <SplitterGroup
      id="craft-hub-workbench"
      class="workbench-splitter"
      direction="horizontal"
      auto-save-id="craft-hub-workbench-layout"
      :keyboard-resize-by="16"
    >
      <SplitterPanel id="projects-panel" size-unit="px" :default-size="300" :min-size="220" :max-size="390">
        <ProjectRail
          :active-view="marketplaceOpen ? 'marketplace' : 'workbench'"
          @open-marketplace="marketplaceOpen = true"
          @open-settings="settingsOpen = true"
          @open-workbench="marketplaceOpen = false"
        />
      </SplitterPanel>
      <SplitterResizeHandle id="projects-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeProjects')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeProjects')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel id="capabilities-panel" size-unit="px" :default-size="360" :min-size="280" :max-size="540" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <CapabilityList />
      </SplitterPanel>
      <SplitterResizeHandle id="capabilities-resize-handle" class="workbench-resize-handle" :aria-label="t('resizeCapabilities')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" :title="t('resizeCapabilities')">
        <span class="splitter-grip" aria-hidden="true" />
      </SplitterResizeHandle>
      <SplitterPanel id="detail-panel" size-unit="px" :min-size="420" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <section class="detail-workspace">
          <ProjectToolbar />
          <WorkspaceDashboard v-if="store.selectedWorkspace" />
          <DetailPanel v-else />
        </section>
      </SplitterPanel>
    </SplitterGroup>
    <footer class="status-bar">
      <span>
        <Icon v-if="store.refreshing" name="refresh" class="refresh-icon" />
        <i v-else :class="{ updated: store.recentlyUpdated }" />
        {{ store.refreshing ? t('refreshing') : store.recentlyUpdated ? t('filesUpdated') : eventStreamConnected ? t('ready') : t('reconnecting') }}
      </span>
      <div class="status-actions">
        <button :aria-label="t('refresh')" :title="t('refresh')" @click="refreshWhenVisible">
          <Icon name="refresh" :class="{ 'refresh-icon': store.refreshing }" />
        </button>
        <span v-if="store.selectedProject">{{ t('project', { name: store.selectedProject.name }) }}</span>
      </div>
    </footer>
    <CommandPalette v-model:open="paletteOpen" />
    <SettingsDialog v-model:open="settingsOpen" />
    <MarketplaceDialog :open="marketplaceOpen" />
    <ProjectAgentActionDialog v-model:open="store.agentActionDialogOpen" />
  </div>
</template>
