<script setup lang="ts">
import { computed } from 'vue'
import { isIconName } from './icons'
import NavigationIcon from './NavigationIcon.vue'
import VisualIcon from './VisualIcon.vue'

const props = defineProps<{ title: string, description?: string, icon?: string }>()
const builtinIcon = computed(() => {
  const name = props.icon?.startsWith('builtin:') ? props.icon.slice('builtin:'.length) : undefined
  return isIconName(name) ? name : undefined
})
</script>

<template>
  <header class="workbench-view-header">
    <span class="workbench-view-mark"><NavigationIcon v-if="builtinIcon" :name="builtinIcon" /><VisualIcon v-else :icon="icon" fallback="plugins" /></span>
    <div class="workbench-view-heading">
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="workbench-view-actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.workbench-view-header { display: flex; align-items: center; gap: var(--page-header-gap); min-height: var(--page-header-min-height); min-width: 0; margin-bottom: var(--page-section-gap); }
.workbench-view-heading { flex: 1; min-width: 0; }
.workbench-view-heading h1 { margin: 0; color: var(--text); font-size: var(--page-title-size); font-weight: var(--page-title-weight); line-height: var(--page-title-line-height); letter-spacing: -.02em; overflow-wrap: anywhere; }
.workbench-view-heading p { margin: var(--page-heading-gap) 0 0; color: var(--muted); font-size: var(--page-description-size); line-height: var(--page-description-line-height); overflow-wrap: anywhere; }
.workbench-view-mark { display: grid; flex: none; width: var(--page-header-mark-size); height: var(--page-header-mark-size); place-items: center; color: var(--accent); }
.workbench-view-mark :deep(.visual-icon), .workbench-view-mark :deep(.app-icon) { width: var(--page-header-icon-size); height: var(--page-header-icon-size); }
.workbench-view-actions { display: flex; align-items: center; flex: none; gap: var(--space-2); }
@media (max-width: 760px) {
  .workbench-view-header { flex-wrap: wrap; }
  .workbench-view-actions { flex-wrap: wrap; margin-left: calc(var(--page-header-mark-size) + var(--page-header-gap)); max-width: calc(100% - var(--page-header-mark-size) - var(--page-header-gap)); }
}
</style>
