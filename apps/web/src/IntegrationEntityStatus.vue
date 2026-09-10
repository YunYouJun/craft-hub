<script setup lang="ts">
import type { IntegrationEntity } from 'craft-hub'
import { useI18n } from './i18n'
defineProps<{ entity: IntegrationEntity }>()
const { t } = useI18n()
const icons = {
  open: 'i-lucide-circle-dashed', planning: 'i-lucide-calendar-clock', active: 'i-lucide-code-xml',
  testing: 'i-lucide-flask-conical', review: 'i-lucide-scan-eye', releasing: 'i-lucide-rocket', resolved: 'i-lucide-circle-check',
  done: 'i-lucide-circle-check-big', closed: 'i-lucide-circle-minus', cancelled: 'i-lucide-circle-x', unknown: 'i-lucide-circle-help',
}
</script>

<template>
  <span v-if="entity.archived || entity.status" class="entity-status" :class="entity.archived ? 'archived' : entity.statusCategory" :title="entity.status">
    <span v-if="entity.archived || entity.statusCategory" class="app-icon" :class="entity.archived ? 'i-lucide-archive' : entity.statusCategory ? icons[entity.statusCategory] : undefined" aria-hidden="true" />
    <span>{{ entity.archived ? t('integrationArchivedStatus') : entity.statusLabel || entity.status }}</span>
  </span>
</template>

<style scoped>
.entity-status { display: inline-flex; flex: none; align-items: center; gap: 5px; padding: 2px 7px; border-radius: var(--status-badge-radius); color: var(--status-foreground, var(--muted)); background: color-mix(in srgb, var(--status-foreground, var(--muted)) 9%, var(--surface)); font-size: var(--font-size-control); line-height: 18px; white-space: nowrap; }
.entity-status .app-icon { width: 14px; height: 14px; }
.entity-status.planning { --status-foreground: var(--status-planning); }
.entity-status.active { --status-foreground: var(--accent); }
.entity-status.testing { --status-foreground: var(--warning); }
.entity-status.review { --status-foreground: var(--status-review); }
.entity-status.releasing { --status-foreground: var(--status-releasing); }
.entity-status.resolved { --status-foreground: var(--status-resolved); }
.entity-status.done { --status-foreground: var(--success); }
.entity-status.cancelled { --status-foreground: var(--danger); }
</style>
