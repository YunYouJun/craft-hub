<script setup lang="ts">
import { ref } from 'vue'
import WorkbenchViewHeader from './WorkbenchViewHeader.vue'

defineProps<{ title: string, description?: string, icon?: string }>()
const scrollContainer = ref<HTMLElement>()
defineExpose({
  getScrollTop: () => scrollContainer.value?.scrollTop ?? 0,
  scrollTo: (top: number) => { if (scrollContainer.value) scrollContainer.value.scrollTop = top },
})
</script>

<template>
  <main class="workbench-view workbench-view-frame">
    <div class="workbench-frame-header">
      <WorkbenchViewHeader :title="title" :description="description" :icon="icon">
        <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      </WorkbenchViewHeader>
    </div>
    <div class="workbench-frame-layout">
      <aside v-if="$slots.sidebar" class="workbench-frame-sidebar"><slot name="sidebar" /></aside>
      <div ref="scrollContainer" class="workbench-frame-scroll">
        <div class="workbench-frame-content"><slot /></div>
      </div>
    </div>
  </main>
</template>
