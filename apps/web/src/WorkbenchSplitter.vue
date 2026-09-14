<script setup lang="ts">
import { StorageSerializers, useLocalStorage } from '@vueuse/core'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import WorkbenchResizeHandle from './WorkbenchResizeHandle.vue'

const props = withDefaults(defineProps<{
  compact: boolean
  sidebarLabel: string
  sidebarId?: string
  handleId?: string
  includesActivityRail?: boolean
  autoSaveId?: string
}>(), {
  sidebarId: 'primary-sidebar-panel',
  handleId: 'primary-sidebar-resize-handle',
})

const tokens = getComputedStyle(document.documentElement)
function layoutSize(name: string): number | undefined {
  const value = Number.parseFloat(tokens.getPropertyValue(name))
  return Number.isFinite(value) && value > 0 ? value : undefined
}
const defaultWidth = layoutSize('--workbench-sidebar-width')
const minWidth = layoutSize('--workbench-sidebar-min-width')
const maxWidth = layoutSize('--workbench-sidebar-max-width')
const activityWidth = layoutSize('--workbench-activity-width') ?? 0
const offset = computed(() => props.includesActivityRail ? activityWidth : 0)
const savedWidth = useLocalStorage<number | null>('craft-hub-primary-sidebar-width', null, { serializer: StorageSerializers.object })
const preferredWidth = computed(() => {
  const width = savedWidth.value
  return typeof width === 'number' && Number.isFinite(width) && minWidth && maxWidth
    ? Math.min(maxWidth, Math.max(minWidth, width))
    : defaultWidth
})
function panelWidth(width: number | undefined): number | undefined {
  return width === undefined ? undefined : width + offset.value
}

const sidebar = ref<InstanceType<typeof SplitterPanel> | HTMLDivElement>()
function panel(): InstanceType<typeof SplitterPanel> | undefined {
  return sidebar.value instanceof HTMLElement ? undefined : sidebar.value
}
function rememberWidth(): void {
  const size = panel()?.getSize()
  if (props.compact || size === undefined || !Number.isFinite(size) || !minWidth || !maxWidth)
    return
  savedWidth.value = Math.round(Math.min(maxWidth, Math.max(minWidth, size - offset.value)) * 100) / 100
}

let panelCount = 0
watch(() => props.compact, () => { panelCount = 0 })
async function restoreWidth(layout: number[]): Promise<void> {
  if (layout.length === panelCount)
    return
  panelCount = layout.length
  const legacyWidth = (layout[0] ?? 0) - offset.value
  if (savedWidth.value === null && props.autoSaveId && minWidth && maxWidth && legacyWidth >= minWidth && legacyWidth <= maxWidth)
    savedWidth.value = Math.round(legacyWidth * 100) / 100
  // Home also remembers its content panels. A newer sidebar preference from another
  // page must win when that saved layout loads, including after async panels mount.
  const width = savedWidth.value === null ? undefined : panelWidth(preferredWidth.value)
  await nextTick()
  if (!props.compact && width !== undefined)
    panel()?.resize(width)
}
</script>

<template>
  <component :is="compact ? 'div' : SplitterGroup" class="workbench-sidebar-splitter" direction="horizontal" :auto-save-id="autoSaveId" :keyboard-resize-by="2" @layout="restoreWidth">
    <component :is="compact ? 'div' : SplitterPanel" :id="sidebarId" ref="sidebar" data-panel :order="1" size-unit="px" :default-size="panelWidth(preferredWidth)" :min-size="panelWidth(minWidth)" :max-size="panelWidth(maxWidth)">
      <slot name="sidebar" />
    </component>
    <WorkbenchResizeHandle v-if="!compact" :id="handleId" :label="sidebarLabel" @resize-end="rememberWidth" />
    <slot />
  </component>
</template>

<style scoped>
.workbench-sidebar-splitter { display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.workbench-sidebar-splitter > :deep([data-panel]) { min-width: 0; min-height: 0; overflow: hidden; }
</style>
