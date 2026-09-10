<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'secondary' | 'success' | 'warning' | 'danger' }>(), { variant: 'secondary' })
</script>
<template><span class="ui-badge" :class="`ui-badge--${variant}`"><slot /></span></template>
<style scoped>
.ui-badge { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: var(--control-radius); padding: 2px 6px; font-size: var(--font-size-caption); font-weight: 500; line-height: 1.5; color: var(--muted); background: var(--surface-hover); }
.ui-badge--success { color: var(--success); }
.ui-badge--warning { color: var(--warning); }
.ui-badge--danger { color: var(--danger); }
</style>
