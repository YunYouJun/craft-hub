<script setup lang="ts">
import type { InstalledNavigationPanel } from 'craft-hub'
import { useRouter } from 'vue-router'
import { Icon } from './icons'
import { useI18n } from './i18n'
import VisualIcon from './VisualIcon.vue'

defineProps<{ panels: InstalledNavigationPanel[], embedded?: boolean }>()
const { t } = useI18n()
const router = useRouter()
function internalPath(value: string): string | undefined {
  const url = new URL(value, window.location.origin)
  if (url.origin === window.location.origin && router.resolve(url.pathname).name)
    return `${url.pathname}${url.search}${url.hash}`
}
function navigate(event: MouseEvent, value: string): void {
  const path = internalPath(value)
  if (path && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    void router.push(path)
  }
}
</script>

<template>
  <div class="navigation-panels" :class="{ 'navigation-panels-embedded': embedded }">
    <section v-for="panel in panels" :key="`${panel.pluginId}:${panel.id}`" class="navigation-panel">
      <header><span class="navigation-panel-icon"><VisualIcon :icon="panel.icon" fallback="web" /></span><div><div class="navigation-panel-title"><h2>{{ panel.title }}</h2><span>{{ t('navigationFromPlugin', { plugin: panel.pluginName }) }}</span></div><p v-if="panel.description">{{ panel.description }}</p></div></header>
      <div class="navigation-links">
        <a v-for="link in panel.links" :key="link.id" :href="link.url" :target="internalPath(link.url) ? undefined : '_blank'" rel="noopener noreferrer" @click="navigate($event, link.url)"><span class="navigation-link-icon"><VisualIcon :icon="link.icon" fallback="web" /></span><strong>{{ link.title }}</strong><small v-if="link.description">{{ link.description }}</small><Icon v-if="!internalPath(link.url)" name="externalLink" /></a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.navigation-panels-embedded { margin-top: 0; }
.navigation-panels-embedded .navigation-panel > header { gap: 10px; padding-bottom: 10px; }
.navigation-panels-embedded .navigation-panel-icon { display: none; }
.navigation-panels-embedded .navigation-panel h2 { font-size: var(--font-size-emphasis); font-weight: 600; letter-spacing: 0; }
.navigation-panels-embedded .navigation-panel-title > span { display: none; }
</style>
