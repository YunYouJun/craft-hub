<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'default' | 'danger' }>(), { variant: 'default' })
</script>
<template><div role="alert" class="ui-alert" :class="{ 'ui-alert--danger': variant === 'danger' }"><slot /></div></template>
<style scoped>
.ui-alert { border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface-subtle); padding: var(--space-3); color: var(--muted); line-height: var(--line-height-emphasis); }
.ui-alert--danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.ui-alert :deep(p) { margin: 0 0 var(--space-2); }
</style>
