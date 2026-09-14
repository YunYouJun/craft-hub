<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { SplitterPanel } from 'reka-ui'
import Breadcrumb from './components/ui/breadcrumb/Breadcrumb.vue'
import { useI18n } from './i18n'
import WorkbenchSplitter from './WorkbenchSplitter.vue'

defineProps<{ breadcrumbs: { label: string, to?: string }[] }>()
const { locale } = useI18n()
const compactViewport = useMediaQuery('(max-width: 900px)')
</script>

<template>
  <component :is="$slots.sidebar ? WorkbenchSplitter : 'section'" class="workbench-page-shell" :compact="compactViewport" :sidebar-label="locale === 'zh-CN' ? '调整侧边栏宽度' : 'Resize sidebar'">
    <template v-if="$slots.sidebar" #sidebar>
      <aside class="workbench-page-sidebar"><slot name="sidebar" /></aside>
    </template>
    <component :is="$slots.sidebar && !compactViewport ? SplitterPanel : 'div'" class="workbench-page-main" :order="2" size-unit="px" :min-size="350">
      <header class="workbench-page-path"><Breadcrumb :items="breadcrumbs" :more-label="locale === 'zh-CN' ? '展开上级页面' : 'Show parent pages'" :label="locale === 'zh-CN' ? '当前位置' : 'Breadcrumb'" /></header>
      <div class="workbench-page-content"><slot /></div>
    </component>
  </component>
</template>

<style scoped>
.workbench-page-shell { display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.workbench-page-main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.workbench-page-sidebar { display: flex; height: 100%; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--workbench-sidebar-background); }
.workbench-page-path { padding: 10px var(--page-padding-inline); border-bottom: 1px solid var(--border); background: var(--surface); }
.workbench-page-content { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.workbench-page-content > :deep(*) { flex: 1; min-width: 0; }
@media (max-width: 900px) {
  .workbench-page-shell { flex-direction: column; }
  .workbench-page-sidebar { border-bottom: 1px solid var(--workbench-sidebar-border); }
}
@media (max-width: 720px) { .workbench-page-path { padding: 12px var(--page-padding-inline); } }
</style>
