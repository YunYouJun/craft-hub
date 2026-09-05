<script setup lang="ts">
import type { InstalledNavigationPanel } from 'craft-hub'
import { computed, onMounted, ref, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
import { useI18n } from './i18n'
import NavigationPanelCollection from './NavigationPanelCollection.vue'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{ refreshKey?: number }>(), { refreshKey: 0 })
const emit = defineEmits<{ managePlugins: [] }>()
const { locale, t } = useI18n()
const panels = ref<InstalledNavigationPanel[]>([])
const query = ref('')
const loading = ref(true)
const error = ref('')

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const visiblePanels = computed(() => panels.value.map(panel => ({
  ...panel,
  links: panel.links.filter(link => !normalizedQuery.value || [panel.title, panel.description, panel.pluginName, link.title, link.description, ...link.keywords]
    .some(value => value?.toLocaleLowerCase().includes(normalizedQuery.value))),
})).filter(panel => panel.links.length))
const linkCount = computed(() => panels.value.reduce((total, panel) => total + panel.links.length, 0))
const pluginCount = computed(() => new Set(panels.value.map(panel => panel.pluginId)).size)

async function loadPanels(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    panels.value = await api.navigationPanels(locale.value)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}

watch([locale, () => props.refreshKey], () => void loadPanels())
onMounted(() => void loadPanels())
</script>

<template>
  <main class="navigation-workbench">
    <header class="navigation-header">
      <div><h1>{{ t('navigationWorkbench') }}</h1><p>{{ t('navigationWorkbenchDescription') }}</p></div>
      <button type="button" class="navigation-manage" @click="emit('managePlugins')"><Icon name="settings" />{{ t('manageNavigationPlugins') }}</button>
    </header>
    <div class="navigation-search-row">
      <label class="navigation-search"><Icon name="search" /><input v-model="query" type="search" :placeholder="t('searchNavigationLinks')" :aria-label="t('searchNavigationLinks')"><button v-if="query" type="button" :aria-label="t('clearSearch')" @click="query = ''"><Icon name="close" /></button></label>
      <span v-if="panels.length" class="navigation-count">{{ t('navigationSourceCount', { plugins: String(pluginCount), links: String(linkCount) }) }}</span>
    </div>
    <section v-if="loading" class="navigation-state" aria-live="polite"><Icon name="loading" /><p>{{ t('loadingNavigationLinks') }}</p></section>
    <section v-else-if="error" class="navigation-state error" role="alert"><Icon name="error" /><h2>{{ t('navigationLoadFailed') }}</h2><p>{{ error }}</p><button type="button" @click="loadPanels">{{ t('retry') }}</button></section>
    <section v-else-if="!panels.length" class="navigation-state empty"><span class="navigation-state-icon"><Icon name="compass" /></span><h2>{{ t('navigationEmptyTitle') }}</h2><p>{{ t('navigationEmptyDescription') }}</p><button type="button" @click="emit('managePlugins')"><Icon name="plugins" />{{ t('browseNavigationPlugins') }}</button></section>
    <section v-else-if="!visiblePanels.length" class="navigation-state empty"><span class="navigation-state-icon"><Icon name="search" /></span><h2>{{ t('navigationNoResultsTitle') }}</h2><p>{{ t('navigationNoResultsDescription', { query }) }}</p><button type="button" @click="query = ''">{{ t('clearSearch') }}</button></section>
    <NavigationPanelCollection v-else :panels="visiblePanels" />
  </main>
</template>
