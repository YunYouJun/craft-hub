<script setup lang="ts">
import type { IconName } from './icons'
import { Icon } from './icons'

defineProps<{ name: IconName | 'home' }>()
const navigationIcons: Partial<Record<IconName | 'home', string>> = {
  home: 'i-lucide-house', hub: 'i-lucide-panels-top-left', compass: 'i-lucide-compass',
  workspace: 'i-lucide-folders', folder: 'i-lucide-folder', folderOpen: 'i-lucide-folder-open',
  arrowDown: 'i-lucide-chevron-down', arrowRight: 'i-lucide-chevron-right',
  search: 'i-lucide-search', terminal: 'i-lucide-square-terminal', list: 'i-lucide-list-todo',
  settings: 'i-lucide-settings-2', plugins: 'i-lucide-blocks', check: 'i-lucide-circle-check',
  error: 'i-lucide-circle-alert', trusted: 'i-lucide-shield-check', untrusted: 'i-lucide-shield-question',
  personal: 'i-lucide-user-round', team: 'i-lucide-users-round', refresh: 'i-lucide-refresh-cw',
  plus: 'i-lucide-plus', close: 'i-lucide-x', play: 'i-lucide-play', more: 'i-lucide-ellipsis',
}
</script>

<template>
  <span v-if="navigationIcons[name]" aria-hidden="true" class="app-icon" :class="navigationIcons[name]" />
  <Icon v-else :name="name === 'home' ? 'hub' : name" />
</template>
