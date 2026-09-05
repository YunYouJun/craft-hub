<script setup lang="ts">
import type { InstalledNavigationPanel } from 'craft-hub'
import { Icon } from './icons'
import { useI18n } from './i18n'
import VisualIcon from './VisualIcon.vue'

defineProps<{ panels: InstalledNavigationPanel[] }>()
const { t } = useI18n()
</script>

<template>
  <div class="navigation-panels">
    <section v-for="panel in panels" :key="`${panel.pluginId}:${panel.id}`" class="navigation-panel">
      <header><span class="navigation-panel-icon"><VisualIcon :icon="panel.icon" fallback="web" /></span><div><div class="navigation-panel-title"><h2>{{ panel.title }}</h2><span>{{ t('navigationFromPlugin', { plugin: panel.pluginName }) }}</span></div><p v-if="panel.description">{{ panel.description }}</p></div></header>
      <div class="navigation-links">
        <a v-for="link in panel.links" :key="link.id" :href="link.url" target="_blank" rel="noopener noreferrer"><span class="navigation-link-icon"><VisualIcon :icon="link.icon" fallback="web" /></span><strong>{{ link.title }}</strong><small v-if="link.description">{{ link.description }}</small><Icon name="externalLink" /></a>
      </div>
    </section>
  </div>
</template>
