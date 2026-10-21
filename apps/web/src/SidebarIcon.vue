<script setup lang="ts">
import type { IconName } from './icons'
import { computed } from 'vue'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{
  name?: IconName | 'home'
  icon?: string
  fallback?: IconName
  active?: boolean
}>(), { fallback: 'plugins', active: false })

const customIcon = computed(() => !props.name && props.icon && !props.icon.startsWith('builtin:'))
const pluginIcons = ['i-ri-apps-2-line', 'i-ri-apps-2-fill'] as const
// Keep both variants literal so UnoCSS includes every selected-state icon.
const sidebarIcons: Record<string, readonly [string, string]> = {
  home: ['i-ri-home-5-line', 'i-ri-home-5-fill'],
  hub: ['i-ri-layout-2-line', 'i-ri-layout-2-fill'],
  workspace: ['i-ri-folders-line', 'i-ri-folders-fill'],
  folder: ['i-ri-folder-3-line', 'i-ri-folder-3-fill'],
  folderOpen: ['i-ri-folder-open-line', 'i-ri-folder-open-fill'],
  package: ['i-ri-box-3-line', 'i-ri-box-3-fill'],
  terminal: ['i-ri-terminal-box-line', 'i-ri-terminal-box-fill'],
  plugins: pluginIcons,
  settings: ['i-ri-settings-3-line', 'i-ri-settings-3-fill'],
  check: ['i-ri-checkbox-circle-line', 'i-ri-checkbox-circle-fill'],
  error: ['i-ri-error-warning-line', 'i-ri-error-warning-fill'],
  personal: ['i-ri-user-line', 'i-ri-user-fill'],
  briefcase: ['i-ri-briefcase-4-line', 'i-ri-briefcase-4-fill'],
  code: ['i-ri-code-box-line', 'i-ri-code-box-fill'],
  codex: ['i-ri-code-box-line', 'i-ri-code-box-fill'],
  docs: ['i-ri-file-text-line', 'i-ri-file-text-fill'],
  design: ['i-ri-brush-line', 'i-ri-brush-fill'],
  database: ['i-ri-database-2-line', 'i-ri-database-2-fill'],
  rocket: ['i-ri-rocket-line', 'i-ri-rocket-fill'],
  team: ['i-ri-team-line', 'i-ri-team-fill'],
  experiment: ['i-ri-flask-line', 'i-ri-flask-fill'],
  security: ['i-ri-shield-keyhole-line', 'i-ri-shield-keyhole-fill'],
  cloud: ['i-ri-cloud-line', 'i-ri-cloud-fill'],
  mobile: ['i-ri-smartphone-line', 'i-ri-smartphone-fill'],
  web: ['i-ri-global-line', 'i-ri-global-fill'],
  skill: ['i-ri-sparkling-2-line', 'i-ri-sparkling-2-fill'],
  calendar: ['i-ri-calendar-line', 'i-ri-calendar-fill'],
  chart: ['i-ri-bar-chart-2-line', 'i-ri-bar-chart-2-fill'],
  list: ['i-ri-file-list-3-line', 'i-ri-file-list-3-fill'],
  collection: ['i-ri-stack-line', 'i-ri-stack-fill'],
  gitRepository: ['i-ri-git-repository-line', 'i-ri-git-repository-fill'],
  help: ['i-ri-question-line', 'i-ri-question-fill'],
  play: ['i-ri-play-circle-line', 'i-ri-play-circle-fill'],
  compass: ['i-ri-compass-3-line', 'i-ri-compass-3-fill'],
  star: ['i-ri-star-line', 'i-ri-star-fill'],
  keyboard: ['i-ri-keyboard-line', 'i-ri-keyboard-fill'],
  link: ['i-ri-links-line', 'i-ri-links-fill'],
  transfer: ['i-ri-arrow-left-right-line', 'i-ri-arrow-left-right-fill'],
  more: ['i-ri-more-line', 'i-ri-more-fill'],
  plus: ['i-ri-add-line', 'i-ri-add-line'],
  close: ['i-ri-close-line', 'i-ri-close-line'],
  drag: ['i-ri-draggable', 'i-ri-draggable'],
}
const iconClass = computed(() => {
  const name = props.name ?? (props.icon?.startsWith('builtin:') ? props.icon.slice('builtin:'.length) : undefined)
  const pair = sidebarIcons[name ?? ''] ?? sidebarIcons[props.fallback] ?? pluginIcons
  return pair[props.active ? 1 : 0]
})
</script>

<template>
  <VisualIcon v-if="customIcon" :icon="icon" :fallback="fallback" aria-hidden="true" class="sidebar-icon" />
  <span v-else aria-hidden="true" class="app-icon sidebar-icon" :class="iconClass" />
</template>
