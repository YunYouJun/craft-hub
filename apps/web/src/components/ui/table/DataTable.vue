<script setup lang="ts">
defineProps<{ label?: string }>()
</script>

<template>
  <div class="ui-data-table" role="region" :aria-label="label" tabindex="0">
    <table><slot /></table>
  </div>
</template>

<style scoped>
.ui-data-table { overflow: auto; max-height: 540px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
.ui-data-table:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; text-align: start; font-size: var(--font-size-body); }
.ui-data-table :deep(th) { position: sticky; top: 0; z-index: 1; background: var(--surface-subtle, var(--surface)); color: var(--text-secondary); font-size: var(--font-size-control); font-weight: 600; }
.ui-data-table :deep(td), .ui-data-table :deep(th) { height: 38px; padding: 5px 12px; border-bottom: 1px solid var(--border); text-align: start; white-space: nowrap; }
.ui-data-table :deep(tbody tr:last-child td) { border-bottom: 0; }
.ui-data-table :deep(tbody tr:nth-child(even)) { background: color-mix(in srgb, var(--text) 2%, var(--surface)); }
.ui-data-table :deep(tbody tr[data-selected='true']) { background: var(--accent-soft); }
.ui-data-table :deep(td) { user-select: text; }
</style>
