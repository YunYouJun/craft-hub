<script setup lang="ts">
import { ref } from 'vue'
import WorkbenchViewHeader from './WorkbenchViewHeader.vue'

defineProps<{ title: string, description?: string, icon?: string, hideHeading?: boolean }>()
const scrollContainer = ref<HTMLElement>()
// The title header stays put; its separator appears once content scrolls beneath it, like a native toolbar.
const scrolled = ref(false)
defineExpose({
  getScrollTop: () => scrollContainer.value?.scrollTop ?? 0,
  scrollTo: (top: number) => { if (scrollContainer.value) scrollContainer.value.scrollTop = top },
})
</script>

<template>
  <main class="workbench-view workbench-view-frame" :class="{ 'workbench-view-frame--without-heading': hideHeading && !$slots.actions && !$slots.navigation }" :data-scrolled="scrolled || undefined">
    <div v-if="!hideHeading || $slots.actions || $slots.navigation" class="workbench-frame-header">
      <WorkbenchViewHeader :title="title" :description="description" :icon="icon" :hide-heading="hideHeading">
        <template v-if="$slots.actions" #actions><slot name="actions" /></template>
      </WorkbenchViewHeader>
      <div v-if="$slots.navigation" class="workbench-frame-navigation"><slot name="navigation" /></div>
    </div>
    <h1 v-else class="sr-only">{{ title }}</h1>
    <div class="workbench-frame-layout">
      <aside v-if="$slots.sidebar" class="workbench-frame-sidebar"><slot name="sidebar" /></aside>
      <div ref="scrollContainer" class="workbench-frame-scroll" @scroll.passive="scrolled = (scrollContainer?.scrollTop ?? 0) > 0">
        <div class="workbench-frame-content"><slot /></div>
      </div>
    </div>
  </main>
</template>
