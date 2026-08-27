<script setup lang="ts">
import type { ProjectRecord } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { Icon, type IconName, visualIconNames } from './icons'

const props = defineProps<{ project: ProjectRecord }>()
const failed = ref(false)
const emoji = computed(() => props.project.icon?.startsWith('emoji:') ? props.project.icon.slice('emoji:'.length) : '')
const builtin = computed<IconName | undefined>(() => {
  if (!props.project.icon?.startsWith('builtin:'))
    return undefined
  const name = props.project.icon.slice('builtin:'.length)
  return visualIconNames.includes(name as typeof visualIconNames[number]) ? name as IconName : undefined
})
const fileIcon = computed(() => props.project.icon
  && !props.project.icon.startsWith('emoji:')
  && !props.project.icon.startsWith('builtin:')
  && !failed.value)

watch(() => props.project.icon, () => {
  failed.value = false
})
</script>

<template>
  <span class="project-icon" :title="project.iconWarning">
    <span v-if="emoji" class="project-icon-emoji" aria-hidden="true">{{ emoji }}</span>
    <Icon v-else-if="builtin" :name="builtin" />
    <img v-else-if="fileIcon" :src="`/api/projects/${encodeURIComponent(project.id)}/icon`" alt="" @error="failed = true">
    <Icon v-else name="folder" />
  </span>
</template>
