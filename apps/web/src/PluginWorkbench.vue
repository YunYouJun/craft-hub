<script setup lang="ts">
import type { InstalledNavigationPanel, WorkbenchViewReference } from 'craft-hub'
import { computed, onMounted, ref, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
import { useI18n } from './i18n'
import IntegrationWorkbench from './IntegrationWorkbench.vue'
import NavigationPanelCollection from './NavigationPanelCollection.vue'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{ pluginId: string, refreshKey?: number, workbenchId: string }>(), { refreshKey: 0 })
const emit = defineEmits<{ managePlugins: [] }>()
const store = useWorkbenchStore()
const { locale, t } = useI18n()
const panels = ref<InstalledNavigationPanel[]>([])
const panelsLoading = ref(true)
const panelsError = ref('')
const selectedKey = ref('')

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
  <main class="plugin-workbench">
    <template v-if="workbench">
      <header class="plugin-workbench-header">
        <span class="plugin-workbench-mark"><VisualIcon :icon="workbench.icon" fallback="workspace" /></span>
        <div>
          <p>{{ t('pluginWorkbenchFromPlugin', { plugin: workbench.pluginName }) }}</p>
          <h1>{{ workbench.title }}</h1>
          <span v-if="workbench.description">{{ workbench.description }}</span>
        </div>
        <button type="button" @click="emit('managePlugins')"><Icon name="settings" />{{ t('managePluginWorkbench') }}</button>
      </header>

      <nav class="plugin-workbench-tabs" role="tablist" :aria-label="workbench.title">
        <button
          v-for="member in members"
          :key="member.key"
          type="button"
          role="tab"
          :aria-selected="activeMember?.key === member.key"
          :class="{ active: activeMember?.key === member.key, unavailable: !member.available }"
          @click="selectedKey = member.key"
        >
          <VisualIcon :icon="member.icon" :fallback="member.reference.type === 'integration' ? 'list' : 'web'" />
          <span>{{ member.title }}</span>
          <Icon v-if="!member.available && !(member.reference.type === 'navigation' && panelsLoading)" name="error" />
        </button>
      </nav>

      <section class="plugin-workbench-content" role="tabpanel">
        <IntegrationWorkbench
          v-if="activeMember?.reference.type === 'integration' && activeMember.available"
          embedded
          :integration-id="activeMember.reference.integration"
          :view-id="activeMember.reference.view"
        />
        <NavigationPanelCollection
          v-else-if="activeMember?.reference.type === 'navigation' && activeMember.panel"
          :panels="[activeMember.panel]"
        />
        <div v-else class="plugin-workbench-state" :class="{ error: panelsError }">
          <Icon :name="panelsLoading && activeMember?.reference.type === 'navigation' ? 'loading' : 'error'" />
          <h2>{{ t('pluginWorkbenchViewUnavailable') }}</h2>
          <p>{{ panelsError || t('pluginWorkbenchViewUnavailableDescription') }}</p>
          <button type="button" @click="emit('managePlugins')">{{ t('managePlugins') }}</button>
        </div>
      </section>
    </template>

    <section v-else class="plugin-workbench-state">
      <Icon name="plugins" />
      <h1>{{ t('pluginWorkbenchUnavailable') }}</h1>
      <p>{{ t('pluginWorkbenchUnavailableDescription') }}</p>
      <button type="button" @click="emit('managePlugins')">{{ t('managePlugins') }}</button>
    </section>
  </main>
</template>

<style scoped>
.plugin-workbench { min-width: 0; min-height: 0; flex: 1; overflow: auto; padding: 34px clamp(24px, 5vw, 72px) 64px; background: var(--surface); }
.plugin-workbench-header { display: grid; max-width: 1120px; grid-template-columns: auto 1fr auto; align-items: center; gap: 14px; margin: 0 auto; }
.plugin-workbench-header h1 { margin: 1px 0 0; font-size: clamp(25px, 3vw, 34px); letter-spacing: -.04em; }
.plugin-workbench-header p, .plugin-workbench-header span { margin: 0; color: var(--muted); font-size: 12px; }
.plugin-workbench-header button, .plugin-workbench-state button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 9px; color: var(--text); background: var(--surface); cursor: pointer; }
.plugin-workbench-header button .app-icon { width: 15px; height: 15px; }
.plugin-workbench-mark { display: grid; width: 48px; height: 48px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 14px; color: var(--accent); background: var(--accent-soft); }
.plugin-workbench-mark :deep(.app-icon) { width: 24px; height: 24px; }
.plugin-workbench-tabs { display: flex; max-width: 1120px; gap: 6px; margin: 28px auto 0; padding-bottom: 9px; border-bottom: 1px solid var(--border); overflow-x: auto; }
.plugin-workbench-tabs button { display: inline-flex; min-height: 36px; flex: none; align-items: center; gap: 7px; padding: 0 12px; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.plugin-workbench-tabs button:hover { color: var(--text); background: var(--surface-soft); }
.plugin-workbench-tabs button.active { color: var(--accent); background: var(--accent-soft); }
.plugin-workbench-tabs button.unavailable { opacity: .72; }
.plugin-workbench-tabs :deep(.visual-icon), .plugin-workbench-tabs .app-icon { width: 16px; height: 16px; }
.plugin-workbench-tabs button > .app-icon { color: var(--danger); }
.plugin-workbench-content { max-width: 1120px; margin: 22px auto 0; }
.plugin-workbench-content :deep(.navigation-panels) { margin-top: 0; }
.plugin-workbench-state { display: grid; min-height: 320px; place-items: center; align-content: center; gap: 8px; color: var(--muted); text-align: center; }
.plugin-workbench-state > .app-icon { width: 28px; height: 28px; }
.plugin-workbench-state h1, .plugin-workbench-state h2, .plugin-workbench-state p { margin: 0; }
.plugin-workbench-state h1, .plugin-workbench-state h2 { color: var(--text); font-size: 17px; }
.plugin-workbench-state.error > .app-icon { color: var(--danger); }
@media (max-width: 720px) {
  .plugin-workbench { padding: 24px 16px 48px; }
  .plugin-workbench-header { grid-template-columns: auto 1fr; }
  .plugin-workbench-header > button { display: none; }
}
</style>
