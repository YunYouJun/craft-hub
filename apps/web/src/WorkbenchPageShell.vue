<script setup lang="ts">
import Breadcrumb from './components/ui/breadcrumb/Breadcrumb.vue'
import { useI18n } from './i18n'

defineProps<{ breadcrumbs: { label: string, to?: string }[] }>()
const { locale } = useI18n()
</script>

<template>
  <section class="workbench-page-shell">
    <header class="workbench-page-path"><Breadcrumb :items="breadcrumbs" :more-label="locale === 'zh-CN' ? '展开上级页面' : 'Show parent pages'" :label="locale === 'zh-CN' ? '当前位置' : 'Breadcrumb'" /></header>
    <div class="workbench-page-content"><slot /></div>
  </section>
</template>

<style scoped>
.workbench-page-shell { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.workbench-page-path { padding: 10px var(--page-padding-inline); border-bottom: 1px solid var(--border); background: var(--surface); }
.workbench-page-content { display: flex; flex: 1; min-width: 0; min-height: 0; overflow: auto; }
.workbench-page-content > :deep(*) { flex: 1; min-width: 0; }
@media (max-width: 720px) { .workbench-page-path { padding: 12px var(--page-padding-inline); } }
</style>
