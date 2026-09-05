<script setup lang="ts">
import type { IntegrationEntity } from 'craft-hub'
import { computed, ref } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import IntegrationStatusTransitionControl from './IntegrationStatusTransitionControl.vue'

interface IntegrationStatusActions {
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
}

const props = defineProps<{ items: IntegrationEntity[], statusActions?: IntegrationStatusActions }>()
const emit = defineEmits<{ updated: [entity: IntegrationEntity] }>()
const { t } = useI18n()
const query = ref('')

const visibleItems = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword)
    return props.items
  return props.items.filter(item => searchableValues(item).some(value => value.toLocaleLowerCase().includes(keyword)))
})

function searchableValues(item: IntegrationEntity): string[] {
  return [
    item.id,
    item.title,
    item.status,
    item.description ? descriptionText(item.description) : undefined,
    ...Object.values(item.metadata ?? {}),
  ].filter((value): value is string | number | boolean => value !== null && value !== undefined)
    .map(String)
}

function descriptionText(value: string): string {
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('script, style, template').forEach(element => element.remove())
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function metadata(item: IntegrationEntity): Array<[string, string | number | boolean]> {
  const preferred = ['type', 'owner', 'due', 'priority', 'updatedAt', 'workspaceId']
  return preferred.flatMap((key) => {
    const value = item.metadata?.[key]
    return value === null || value === undefined ? [] : [[key, value] as [string, string | number | boolean]]
  })
}
</script>

<template>
  <div class="integration-entity-browser">
    <header v-if="items.length" class="integration-entity-toolbar">
      <label>
        <Icon name="search" />
        <input v-model="query" type="search" :placeholder="t('integrationFilterItems')" :aria-label="t('integrationFilterItems')">
      </label>
      <span>{{ t('integrationItemCount', { visible: String(visibleItems.length), total: String(items.length) }) }}</span>
    </header>

    <p v-if="!items.length" class="integration-empty-copy">{{ t('integrationNoResults') }}</p>
    <p v-else-if="!visibleItems.length" class="integration-empty-copy">{{ t('integrationNoFilteredResults') }}</p>
    <div v-else class="integration-entities" role="list">
      <div
        v-for="item in visibleItems"
        :key="item.id"
        class="integration-entity"
        role="listitem"
      >
        <a
          class="integration-entity-link"
          :href="item.url"
          :target="item.url ? '_blank' : undefined"
          :rel="item.url ? 'noreferrer' : undefined"
          @click="!item.url && $event.preventDefault()"
        >
          <span class="integration-entity-body">
            <strong>{{ item.title }}</strong>
            <small v-if="item.description">{{ descriptionText(item.description) }}</small>
            <span v-if="metadata(item).length" class="integration-metadata">
              <small v-for="entry in metadata(item)" :key="entry[0]">{{ entry[0] }}: {{ entry[1] }}</small>
            </span>
          </span>
          <span class="integration-entity-tail">
            <small v-if="item.status">{{ item.status }}</small>
            <Icon v-if="item.url" name="externalLink" />
          </span>
        </a>
        <IntegrationStatusTransitionControl
          v-if="statusActions && item.status && item.statusUpdateAvailable !== false"
          :entity="item"
          :integration-id="statusActions.integrationId"
          :project-id="statusActions.projectId"
          :transitions-action-id="statusActions.transitionsActionId"
          :update-action-id="statusActions.updateActionId"
          @updated="emit('updated', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.integration-entity-browser { display: grid; min-width: 0; }
.integration-entity-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
.integration-entity-toolbar label { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; }
.integration-entity-toolbar label .app-icon { width: 15px; height: 15px; color: var(--muted); }
.integration-entity-toolbar input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 12px; }
.integration-entity-toolbar > span { flex: none; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.integration-entities { display: grid; }
.integration-entity { display: flex; align-items: center; gap: 10px; min-width: 0; border-top: 1px solid var(--border-subtle, var(--border)); padding: 7px 10px 7px 18px; }
.integration-entity:first-child { border-top: 0; }
.integration-entity:has(.integration-entity-link[href]):hover { background: var(--surface-hover); }
.integration-entity-link { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: space-between; gap: 18px; padding: 6px 0; color: inherit; text-decoration: none; }
.integration-entity-body { display: grid; min-width: 0; gap: 4px; }
.integration-entity-body > strong, .integration-entity-body > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.integration-entity-body > strong { font-size: 13px; font-weight: 600; }
.integration-entity-body > small { color: var(--muted); }
.integration-entity-tail { display: flex; flex: none; align-items: center; gap: 10px; color: var(--muted); }
.integration-entity-tail .app-icon { width: 15px; height: 15px; }
.integration-metadata { display: flex; flex-wrap: wrap; gap: 5px; color: var(--muted); }
.integration-metadata small { padding: 2px 6px; border-radius: 999px; background: var(--surface-muted); }
.integration-empty-copy { margin: 0; padding: 18px; color: var(--muted); font-size: 13px; text-align: center; }
@media (max-width: 720px) { .integration-entity-toolbar { align-items: stretch; flex-direction: column; gap: 5px; } }
</style>
