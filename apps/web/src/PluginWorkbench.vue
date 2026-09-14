<script setup lang="ts">
import type { InstalledNavigationPanel, WorkbenchViewReference } from 'craft-hub'
import { useMediaQuery } from '@vueuse/core'
import { computed, onMounted, ref, useId, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import Icon from './NavigationIcon.vue'
import { useI18n } from './i18n'
import IntegrationWorkbench from './IntegrationWorkbench.vue'
import NavigationPanelCollection from './NavigationPanelCollection.vue'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'
import WorkbenchPageShell from './WorkbenchPageShell.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const props = withDefaults(defineProps<{ breadcrumbs?: { label: string, to?: string }[], pluginId: string, refreshKey?: number, workbenchId: string }>(), { breadcrumbs: () => [], refreshKey: 0 })
const emit = defineEmits<{ managePlugins: [] }>()
const store = useWorkbenchStore()
const { locale, t } = useI18n()
const panels = ref<InstalledNavigationPanel[]>([])
const panelsLoading = ref(true)
const panelsError = ref('')
const selectedKey = ref('')
const navigationId = useId()
const compactNavigation = useMediaQuery('(max-width: 900px)')

const workbench = computed(() => store.pluginWorkbenches.find(candidate => candidate.pluginId === props.pluginId && candidate.id === props.workbenchId))

function referenceKey(reference: WorkbenchViewReference): string {
  return reference.type === 'integration'
    ? `integration:${reference.plugin}:${reference.integration}:${reference.view}`
    : `navigation:${reference.plugin}:${reference.panel}`
}

const members = computed(() => (workbench.value?.views ?? []).map((reference) => {
  if (reference.type === 'integration') {
    const view = store.integrationViews.find(candidate => candidate.pluginId === reference.plugin
      && candidate.integrationId === reference.integration
      && candidate.id === reference.view)
    return {
      available: Boolean(view),
      icon: view?.icon,
      key: referenceKey(reference),
      reference,
      title: view?.title ?? reference.integration,
    }
  }
  const panel = panels.value.find(candidate => candidate.pluginId === reference.plugin && candidate.id === reference.panel)
  return {
    available: Boolean(panel),
    icon: panel?.icon,
    key: referenceKey(reference),
    panel,
    reference,
    title: panel?.title ?? reference.panel,
  }
}))
const activeMember = computed(() => members.value.find(member => member.key === selectedKey.value) ?? members.value[0])

const groups = computed(() => {
  const result = new Map<string, typeof members.value>()
  for (const member of members.value) {
    const group = member.reference.group ?? ''
    result.set(group, [...(result.get(group) ?? []), member])
  }
  return [...result].map(([title, items]) => ({ title, items }))
})

function moveSelection(event: KeyboardEvent): void {
  const step = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 0
  if (!step && event.key !== 'Home' && event.key !== 'End')
    return
  event.preventDefault()
  const current = members.value.findIndex(member => member.key === activeMember.value?.key)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? members.value.length - 1 : (current + step + members.value.length) % members.value.length
  selectedKey.value = members.value[index]?.key ?? ''
  ;(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
}

async function loadPanels(): Promise<void> {
  panelsLoading.value = true
  panelsError.value = ''
  try {
    panels.value = await api.navigationPanels(locale.value)
  }
  catch (caught) {
    panels.value = []
    panelsError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    panelsLoading.value = false
  }
}

watch([workbench, members], () => {
  if (!members.value.some(member => member.key === selectedKey.value))
    selectedKey.value = members.value[0]?.key ?? ''
}, { immediate: true })
watch([locale, () => props.refreshKey], () => void loadPanels())
onMounted(() => void loadPanels())
</script>

<template>
  <WorkbenchPageShell class="plugin-workbench" :breadcrumbs="breadcrumbs">
    <template v-if="workbench" #sidebar>
      <header class="plugin-workbench-sidebar-header">
        <VisualIcon :icon="workbench.icon" fallback="plugins" monochrome />
        <strong :title="workbench.description">{{ workbench.title }}</strong>
        <UiButton size="icon" :title="t('managePluginWorkbench')" :aria-label="t('managePluginWorkbench')" @click="emit('managePlugins')"><Icon name="settings" /></UiButton>
      </header>
      <nav class="plugin-workbench-sidebar" role="tablist" :aria-label="workbench.title" :aria-orientation="compactNavigation ? 'horizontal' : 'vertical'" @keydown="moveSelection">
        <div v-for="group in groups" :key="group.title" class="plugin-workbench-group" role="presentation">
        <h2 v-if="group.title" role="presentation">{{ group.title }}</h2>
        <button
          v-for="member in group.items"
          :key="member.key"
          type="button"
          role="tab"
          :title="member.title"
          :id="`${navigationId}-${members.indexOf(member)}`"
          :aria-controls="`${navigationId}-panel`"
          :tabindex="activeMember?.key === member.key ? 0 : -1"
          :aria-selected="activeMember?.key === member.key"
          :class="{ active: activeMember?.key === member.key, unavailable: !member.available }"
          @click="selectedKey = member.key"
        >
          <VisualIcon :icon="member.icon" :fallback="member.reference.type === 'integration' ? 'list' : 'web'" monochrome />
          <span>{{ member.title }}</span>
          <Icon v-if="!member.available && !(member.reference.type === 'navigation' && panelsLoading)" name="error" />
        </button>
        </div>
      </nav>
    </template>

    <WorkbenchViewFrame v-if="workbench" :title="activeMember?.title ?? workbench.title" :icon="activeMember?.icon ?? workbench.icon">
      <section :id="`${navigationId}-panel`" class="plugin-workbench-content" role="tabpanel" :aria-labelledby="`${navigationId}-${members.indexOf(activeMember!)}`" tabindex="0">
        <IntegrationWorkbench
          v-if="activeMember?.reference.type === 'integration' && activeMember.available"
          embedded
          :integration-id="activeMember.reference.integration"
          :view-id="activeMember.reference.view"
        />
        <NavigationPanelCollection
          v-else-if="activeMember?.reference.type === 'navigation' && activeMember.panel"
          embedded
          :panels="[activeMember.panel]"
        />
        <div v-else class="plugin-workbench-state" :class="{ error: panelsError }">
          <Icon :name="panelsLoading && activeMember?.reference.type === 'navigation' ? 'loading' : 'error'" />
          <h2>{{ t('pluginWorkbenchViewUnavailable') }}</h2>
          <p>{{ panelsError || t('pluginWorkbenchViewUnavailableDescription') }}</p>
          <UiButton size="compact" @click="emit('managePlugins')">{{ t('managePluginWorkbench') }}</UiButton>
        </div>
      </section>
    </WorkbenchViewFrame>

    <section v-else class="plugin-workbench-state">
      <Icon name="plugins" />
      <h1>{{ t('pluginWorkbenchUnavailable') }}</h1>
      <p>{{ t('pluginWorkbenchUnavailableDescription') }}</p>
      <UiButton size="compact" @click="emit('managePlugins')">{{ t('managePluginWorkbench') }}</UiButton>
    </section>
  </WorkbenchPageShell>
</template>

<style scoped>
.plugin-workbench-sidebar-header { display: flex; flex: none; min-height: var(--workbench-sidebar-header-height); align-items: center; gap: var(--space-2); padding: var(--space-2) var(--workbench-sidebar-padding-inline); }
.plugin-workbench-sidebar-header > .visual-icon { width: var(--workbench-sidebar-icon-size); height: var(--workbench-sidebar-icon-size); flex: none; }
.plugin-workbench-sidebar-header strong { flex: 1; min-width: 0; color: var(--workbench-sidebar-color); font-size: var(--workbench-sidebar-font-size); font-weight: var(--workbench-sidebar-heading-weight); overflow-wrap: anywhere; }
.plugin-workbench-sidebar-header .ui-button { flex: none; width: var(--workbench-sidebar-action-size); height: var(--workbench-sidebar-action-size); min-height: var(--workbench-sidebar-action-size); padding: 4px; border: 0; background: transparent; }
.plugin-workbench-sidebar-header .app-icon { width: var(--workbench-sidebar-icon-size); height: var(--workbench-sidebar-icon-size); }
.plugin-workbench-sidebar { display: grid; align-content: start; gap: var(--workbench-sidebar-group-gap); min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: 0 0 var(--space-3); }
.plugin-workbench-group { display: grid; gap: 2px; min-width: 0; }
.plugin-workbench-group h2 { margin: 0; padding: var(--space-2) var(--workbench-sidebar-padding-inline); color: var(--workbench-sidebar-color); font-size: var(--workbench-sidebar-heading-size); font-weight: var(--workbench-sidebar-heading-weight); }
.plugin-workbench-sidebar button { position: relative; display: flex; min-height: var(--workbench-sidebar-row-height); align-items: center; gap: var(--space-2); min-width: 0; margin: 0 var(--workbench-sidebar-item-inset); padding: var(--space-1) var(--workbench-sidebar-item-padding); border: 0; border-radius: var(--workbench-sidebar-item-radius); color: var(--workbench-sidebar-color); background: transparent; text-align: start; font-size: var(--workbench-sidebar-font-size); font-weight: var(--workbench-sidebar-font-weight); cursor: pointer; white-space: nowrap; }
.plugin-workbench-sidebar button > span:not(.visual-icon):not(.app-icon) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.plugin-workbench-sidebar button:hover { color: var(--text); background: var(--surface-hover); }
.plugin-workbench-sidebar button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.plugin-workbench-sidebar button.active { color: var(--workbench-sidebar-active-color); background: var(--workbench-sidebar-active-background); font-weight: var(--workbench-sidebar-active-weight); }
.plugin-workbench-sidebar button.active::before { position: absolute; inset: var(--workbench-sidebar-selection-inset) auto var(--workbench-sidebar-selection-inset) 0; width: var(--workbench-sidebar-selection-width); border-radius: 1px; background: var(--workbench-sidebar-active-color); content: ''; }
.plugin-workbench-sidebar button.unavailable { opacity: .72; }
.plugin-workbench-sidebar :deep(.visual-icon), .plugin-workbench-sidebar .app-icon { width: var(--workbench-sidebar-icon-size); height: var(--workbench-sidebar-icon-size); flex: none; }
.plugin-workbench-sidebar button > .app-icon { color: var(--danger); }
.plugin-workbench-content { min-width: 0; margin: 0; }
.plugin-workbench-content:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.plugin-workbench-content :deep(.navigation-panels) { margin-top: 0; }
.plugin-workbench-state { display: grid; min-height: 320px; place-items: center; align-content: center; gap: 8px; color: var(--muted); text-align: center; }
.plugin-workbench-state > .app-icon { width: 28px; height: 28px; }
.plugin-workbench-state h1, .plugin-workbench-state h2, .plugin-workbench-state p { margin: 0; }
.plugin-workbench-state h1, .plugin-workbench-state h2 { color: var(--text); font-size: 17px; }
.plugin-workbench-state.error > .app-icon { color: var(--danger); }
@media (max-width: 900px) {
  .plugin-workbench-sidebar { display: flex; gap: var(--space-2); overflow-x: auto; scrollbar-width: thin; padding: var(--space-1) var(--space-2); }
  .plugin-workbench-group { display: flex; flex: none; }
  .plugin-workbench-group + .plugin-workbench-group { border-left: 1px solid var(--workbench-sidebar-border); padding-left: var(--space-2); }
  .plugin-workbench-group h2 { display: none; }
  .plugin-workbench-sidebar button { flex: none; min-height: 40px; margin: 0; }
}
</style>
