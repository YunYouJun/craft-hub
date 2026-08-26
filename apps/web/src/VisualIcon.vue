<script setup lang="ts">
import { computed } from 'vue'
import { Icon, type IconName } from './icons'

const props = withDefaults(defineProps<{ icon?: string, fallback?: IconName }>(), { fallback: 'hub' })
const emoji = computed(() => props.icon?.startsWith('emoji:') ? props.icon.slice('emoji:'.length) : '')
const builtin = computed<IconName | undefined>(() => {
  if (!props.icon?.startsWith('builtin:'))
    return undefined
  const name = props.icon.slice('builtin:'.length)
  return ['folder', 'hub', 'skill', 'terminal'].includes(name) ? name as IconName : undefined
})
</script>

<template>
  <span class="visual-icon">
    <span v-if="emoji" class="visual-icon-emoji" aria-hidden="true">{{ emoji }}</span>
    <Icon v-else :name="builtin ?? fallback" />
  </span>
</template>
