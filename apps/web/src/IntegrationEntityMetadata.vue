<script setup lang="ts">
import type { IntegrationEntity } from 'craft-hub'
import { computed } from 'vue'
import { useI18n } from './i18n'

const props = defineProps<{ entity: IntegrationEntity }>()
const { t } = useI18n()
const assignees = computed<NonNullable<IntegrationEntity['assignees']>>(() => props.entity.assignees ?? (props.entity.metadata?.owner ? [{ id: String(props.entity.metadata.owner) }] : []))

function contactUrl(value: string | undefined): string | undefined {
  if (!value || /[\s\u0000-\u001F]/.test(value))
    return undefined
  try {
    const url = new URL(value)
    // URLs are constructed by trusted providers. Permit their contact applications,
    // but never interpret script, browser-internal, or local-file URLs as contacts.
    if (!url.hostname || url.username || url.password || /^(?:javascript|vbscript|data|file|filesystem|blob|about|chrome|chrome-extension|devtools):$/.test(url.protocol))
      return undefined
    return url.href
  }
  catch {
    return undefined
  }
}
</script>

<template>
  <div v-if="assignees.length || entity.metadata?.due" class="integration-metadata">
    <span v-if="assignees.length" class="integration-assignees" :aria-label="t('integrationAssigneeFilter')">
      <span class="app-icon i-lucide-user-round" aria-hidden="true" />
      <component
        :is="contactUrl(account.url) ? 'a' : 'span'" v-for="account in assignees" :key="account.id"
        :href="contactUrl(account.url)" :target="contactUrl(account.url)?.startsWith('http') ? '_blank' : undefined" :rel="contactUrl(account.url) ? 'noopener noreferrer' : undefined"
        :title="contactUrl(account.url) ? account.urlLabel ?? t('integrationOpenAssignee', { user: account.label || account.id }) : account.label || account.id"
      >{{ account.label || account.id }}</component>
    </span>
    <span v-if="entity.metadata?.due" class="integration-due">{{ t('integrationDueDate') }} {{ entity.metadata.due }}</span>
  </div>
</template>

<style scoped>
.integration-metadata { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 5px 10px; color: var(--muted); font-size: var(--font-size-control); line-height: 18px; }
.integration-assignees { display: inline-flex; min-width: 0; max-width: 100%; align-items: center; flex-wrap: wrap; gap: 3px 7px; }
.integration-assignees .app-icon { width: 12px; height: 12px; flex: none; }
.integration-assignees a, .integration-assignees > span:not(.app-icon) { color: inherit; text-decoration: none; overflow-wrap: anywhere; }
.integration-assignees a:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.integration-due { overflow-wrap: anywhere; }
</style>
