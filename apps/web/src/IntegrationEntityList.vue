<script setup lang="ts">
import type { IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import { computed, ref, useId, watch } from 'vue'
import { FormSelect } from './components/ui/select'
import IntegrationEntityStatus from './IntegrationEntityStatus.vue'
import IntegrationEntityMetadata from './IntegrationEntityMetadata.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import IntegrationWorkItemDetail from './IntegrationWorkItemDetail.vue'
import IntegrationConfigurationToggle from './IntegrationConfigurationToggle.vue'
import IntegrationStatusTransitionControl from './IntegrationStatusTransitionControl.vue'

interface IntegrationStatusActions {
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
}

const props = defineProps<{ items: IntegrationEntity[], statusFilter?: 'active' | 'all', assigneeFilter?: 'current-user' | 'all', currentUser?: IntegrationEntityPage['currentUser'], selectable?: boolean, workItemActions?: { integrationId: string, projectId?: string, detailActionId?: string }, configurationActionId?: string, loading?: boolean, statusActions?: IntegrationStatusActions, sourceContext?: { integrationId: string, actionId: string, projectId?: string } }>()
const emit = defineEmits<{ selected: [entity: IntegrationEntity], updated: [entity: IntegrationEntity], configurationUpdated: [page: IntegrationEntityPage] }>()
const { t } = useI18n()
const query = ref('')
const statusSelection = ref<string>(props.statusFilter ?? 'all')
const statusFilterId = useId()
const assigneeFilterId = useId()
const identityHintId = useId()
const priorityColumnId = useId()
const updatedColumnId = useId()
const assigneeSelection = ref('all')
watch([() => props.assigneeFilter, () => props.currentUser?.id], () => {
  assigneeSelection.value = props.assigneeFilter === 'current-user' && props.currentUser ? 'current-user' : 'all'
}, { immediate: true })
watch(() => props.statusFilter, value => statusSelection.value = value ?? 'all')
const sourceError = ref('')
const openingSource = ref(false)
const desktopSource = Boolean(window.craftHubDesktop?.openIntegrationSource)

function sourceUrl(path: string | undefined): string | undefined {
  if (!path || !(/^(?:\/|[a-z]:[\\/])/i.test(path)) || /[\r\n\0]/.test(path))
    return undefined
  const normalized = path.replaceAll('\\', '/')
  return `vscode://file${(normalized.startsWith('/') ? normalized : `/${normalized}`).split('/').map(encodeURIComponent).join('/')}`
}

async function openSource(event: MouseEvent, entityId: string, detailIndex: number): Promise<void> {
  if (!desktopSource || !props.sourceContext)
    return
  event.preventDefault()
  if (openingSource.value)
    return
  openingSource.value = true
  sourceError.value = ''
  try {
    const { integrationId, actionId, projectId } = props.sourceContext
    await window.craftHubDesktop!.openIntegrationSource!(integrationId, actionId, entityId, detailIndex, projectId)
  }
  catch {
    sourceError.value = t('integrationSourceOpenFailed')
  }
  finally {
    openingSource.value = false
  }
}

const terminalStatuses = new Set(['resolved', 'done', 'closed', 'cancelled'])
function statusKey(item: IntegrationEntity): string {
  if (item.archived)
    return 'archived'
  // One native code may have different meanings in different providers or workspaces.
  return `status:${JSON.stringify([item.status ?? '', item.statusLabel ?? item.status ?? ''])}`
}
const statusOptions = computed(() => {
  const counts = new Map<string, { label: string, count: number }>()
  for (const item of props.items) {
    const key = statusKey(item)
    const entry = counts.get(key) ?? { label: item.archived ? t('integrationArchivedStatus') : item.statusLabel || item.status || t('integrationUnknownStatus'), count: 0 }
    entry.count++
    counts.set(key, entry)
  }
  return [
    { value: 'active', label: t('integrationActiveStatuses') },
    { value: 'all', label: t('integrationAllStatuses') },
    ...[...counts].map(([value, entry]) => ({ value, label: `${entry.label} (${entry.count})` })),
  ]
})
const assigneeOptions = computed(() => {
  const accounts = new Map<string, { label: string, count: number }>()
  let unassigned = 0
  for (const item of props.items) {
    if (!item.assignees?.length)
      unassigned++
    for (const id of new Set(item.assignees?.map(account => account.id) ?? [])) {
      const account = item.assignees!.find(account => account.id === id)!
      const entry = accounts.get(id) ?? { label: account.label || id, count: 0 }
      entry.count++
      accounts.set(id, entry)
    }
  }
  return [
    { value: 'all', label: t('integrationAllAssignees') },
    ...(props.currentUser ? [{ value: 'current-user', label: t('integrationCurrentAssignee', { user: props.currentUser.id }) }] : []),
    { value: 'unassigned', label: `${t('integrationUnassigned')} (${unassigned})` },
    ...[...accounts].sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([id, entry]) => ({ value: `account:${id}`, label: `${entry.label} (${entry.count})` })),
  ]
})
const visibleItems = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return props.items.filter((item) => {
    if (props.statusFilter && statusSelection.value === 'active' && (item.archived || terminalStatuses.has(item.statusCategory ?? '')))
      return false
    if (props.statusFilter && statusSelection.value === 'archived' && !item.archived)
      return false
    if (props.statusFilter && statusSelection.value.startsWith('status:') && statusKey(item) !== statusSelection.value)
      return false
    if (props.assigneeFilter) {
      const accountId = assigneeSelection.value === 'current-user' ? props.currentUser?.id
        : assigneeSelection.value.startsWith('account:') ? assigneeSelection.value.slice(8) : undefined
      if (accountId && !item.assignees?.some(account => account.id === accountId))
        return false
      if (assigneeSelection.value === 'unassigned' && item.assignees?.length)
        return false
    }
    return !keyword || searchableValues(item).some(value => value.toLocaleLowerCase().includes(keyword))
  })
})

function entityKey(item: IntegrationEntity): string {
  return JSON.stringify([item.metadata?.workspaceId ?? '', item.metadata?.type ?? '', item.id])
}

const collapsedKeys = ref(new Set<string>())
// A new search or filter should reveal its matches, even inside a collapsed branch.
watch([query, statusSelection, assigneeSelection], () => collapsedKeys.value = new Set())
function toggleBranch(key: string): void {
  const next = new Set(collapsedKeys.value)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  collapsedKeys.value = next
}
function entityPriority(item: IntegrationEntity): IntegrationEntity['priority'] {
  if (item.priority?.label)
    return item.priority
  const label = String(item.metadata?.priority ?? '').trim()
  return label && label !== '-' ? { label } : undefined
}
const showPriority = computed(() => Boolean(props.workItemActions) || props.items.some(item => entityPriority(item)))
const showUpdatedAt = computed(() => Boolean(props.workItemActions) || props.items.some(item => item.metadata?.updatedAt))
const showColumns = computed(() => showPriority.value || showUpdatedAt.value)
const hierarchyRows = computed(() => {
  interface Branch { item: IntegrationEntity, context: boolean, children: Map<string, Branch> }
  const matches = new Map(visibleItems.value.map(item => [entityKey(item), item]))
  const roots = new Map<string, Branch>()
  for (const item of visibleItems.value) {
    let siblings = roots
    const chain = new Set<string>()
    for (const entry of [...(item.ancestors ?? []).slice(-32), item]) {
      const key = entityKey(entry)
      if (chain.has(key))
        continue
      chain.add(key)
      let branch = siblings.get(key)
      if (!branch) {
        branch = { item: matches.get(key) ?? entry, context: !matches.has(key), children: new Map() }
        siblings.set(key, branch)
      }
      siblings = branch.children
    }
  }
  const rows: Array<{ item: IntegrationEntity, context: boolean, depth: number, key: string, childCount: number, expanded: boolean }> = []
  const rendered = new Set<string>()
  const visit = (branches: Map<string, Branch>, depth: number): void => {
    for (const [key, branch] of branches) {
      if (!rendered.has(key)) {
        rendered.add(key)
        rows.push({ item: branch.item, context: branch.context, depth, key, childCount: branch.children.size, expanded: !collapsedKeys.value.has(key) })
      }
      if (!collapsedKeys.value.has(key))
        visit(branch.children, depth + 1)
    }
  }
  visit(roots, 0)
  return rows
})

function searchableValues(item: IntegrationEntity): string[] {
  return [
    item.id,
    item.title,
    item.status,
    item.statusLabel,
    item.priority?.label,
    ...(item.ancestors ?? []).flatMap(parent => [parent.id, parent.title]),
    item.archived ? t('integrationArchivedStatus') : undefined,
    item.description ? descriptionText(item.description) : undefined,
    ...Object.values(item.metadata ?? {}),
    ...(item.assignees ?? []).flatMap(account => [account.id, account.label]),
    ...(item.details ?? []).flatMap(detail => [detail.label, detail.value]),
  ].filter((value): value is string | number | boolean => value !== null && value !== undefined)
    .map(String)
}

function descriptionText(value: string): string {
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('script, style, template').forEach(element => element.remove())
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

function updatedTime(item: IntegrationEntity): { date: string, time: string, raw: string } | undefined {
  const value = item.metadata?.updatedAt
  if (typeof value !== 'string' || !value.trim())
    return undefined
  const raw = value.trim()
  const parts = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw)
  // Preserve the provider's timezone, including its explicit offset if supplied.
  return { date: parts?.[1] ?? raw, time: parts ? `${parts[2]}${parts[3] ? ` ${parts[3]}` : ''}` : '', raw }
}
</script>

<template>
  <div class="integration-entity-browser">
    <header v-if="items.length" class="integration-entity-toolbar">
      <label>
        <Icon name="search" />
        <input v-model="query" type="search" :placeholder="t('integrationFilterItems')" :aria-label="t('integrationFilterItems')">
      </label>
      <div v-if="statusFilter" class="integration-status-filter">
        <label :for="statusFilterId">{{ t('integrationStatusFilter') }}</label>
        <FormSelect :id="statusFilterId" v-model="statusSelection" :options="statusOptions" />
      </div>
      <div v-if="assigneeFilter" class="integration-assignee-filter" role="group" :aria-describedby="!currentUser ? identityHintId : undefined">
        <label :for="assigneeFilterId" :title="currentUser?.label">{{ t('integrationAssigneeFilter') }}</label>
        <FormSelect :id="assigneeFilterId" v-model="assigneeSelection" :options="assigneeOptions" />
      </div>
      <span aria-live="polite">{{ t('integrationItemCount', { visible: String(visibleItems.length), total: String(items.length) }) }}</span>
    </header>

    <p v-if="assigneeFilter && items.length && !currentUser" :id="identityHintId" class="integration-filter-hint" role="status">{{ t('integrationCurrentUserUnavailable') }}</p>
    <p v-if="sourceError" role="alert">{{ sourceError }}</p>
    <p v-if="!items.length" class="integration-empty-copy">{{ t('integrationNoResults') }}</p>
    <p v-else-if="!visibleItems.length" class="integration-empty-copy">{{ t('integrationNoFilteredResults') }}</p>
    <div v-else class="integration-entities" :class="{ 'has-updated-column': showUpdatedAt, 'has-priority-column': showPriority }">
      <div v-if="showColumns" class="integration-entity-columns">
        <span class="integration-item-column">{{ t('integrationItemColumn') }}</span>
        <span v-if="showPriority" :id="priorityColumnId">{{ t('integrationPriority') }}</span>
        <span v-if="showUpdatedAt" :id="updatedColumnId">{{ t('integrationUpdatedAt') }}</span>
        <span>{{ t('integrationStatusFilter') }}</span>
        <span class="integration-actions-column">{{ t('integrationActionsColumn') }}</span>
      </div>
      <div class="integration-entity-rows" role="list">
        <div
          v-for="{ item, context, depth, key, childCount, expanded } in hierarchyRows"
          :key="key"
          class="integration-entity"
          :class="{ 'integration-hierarchy-context': context, 'integration-hierarchy-child': depth > 0 }"
          :style="{ '--hierarchy-depth': Math.min(depth, 4) }"
          :aria-level="depth + 1"
          role="listitem"
        >
          <div class="integration-entity-main">
            <div class="integration-hierarchy-control">
              <button v-if="childCount" type="button" class="integration-hierarchy-toggle" :aria-expanded="expanded" :aria-label="t(expanded ? 'integrationCollapseChildren' : 'integrationExpandChildren', { title: item.title })" @click="toggleBranch(key)">
                <span class="app-icon" :class="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
              </button>
              <span v-else-if="depth > 0" class="integration-hierarchy-branch app-icon i-lucide-corner-down-right" aria-hidden="true" />
            </div>
            <div class="integration-entity-content">
              <component
                :is="selectable && !context ? 'button' : item.url ? 'a' : 'div'"
                class="integration-entity-link"
                :href="selectable && !context ? undefined : item.url"
                :type="selectable && !context ? 'button' : undefined"
                @click="selectable && !context && emit('selected', item)"
                :target="item.url ? '_blank' : undefined"
                :rel="item.url ? 'noreferrer' : undefined"
              >
                <span class="integration-entity-body">
                  <span class="integration-entity-title">
                    <span v-if="item.metadata?.type" class="integration-type-badge" :data-type="String(item.metadata.type).toLowerCase()">{{ String(item.metadata.type).toUpperCase() }}</span>
                    <strong :title="item.title">{{ item.title }}</strong>
                    <span v-if="childCount" class="integration-child-count" :title="t('integrationChildCount', { count: String(childCount) })">{{ childCount }}</span>
                  </span>
                  <small v-if="context">{{ t('integrationParentContext') }}</small>
                  <small v-else-if="item.description">{{ descriptionText(item.description) }}</small>
                  <dl v-if="!context && item.details?.length" class="integration-details">
                    <div v-for="(detail, index) in item.details" :key="index">
                      <dt>{{ detail.label }}</dt><dd>
                        <a v-if="sourceUrl(detail.sourcePath) && !item.url" :href="sourceUrl(detail.sourcePath)" :title="t(desktopSource ? 'integrationOpenSource' : 'integrationOpenSourceVSCode')" :aria-busy="openingSource" @click.stop="openSource($event, item.id, index)">{{ detail.value }} <Icon name="externalLink" /></a>
                        <template v-else>{{ detail.value }}</template>
                      </dd>
                    </div>
                  </dl>
                </span>
              </component>
              <IntegrationEntityMetadata v-if="!context" :entity="item" />
            </div>
          </div>
          <div v-if="showPriority" class="integration-entity-priority" :aria-labelledby="priorityColumnId">
            <span v-if="!context && entityPriority(item)" class="integration-priority-badge" :data-tone="entityPriority(item)!.tone ?? 'neutral'" :title="entityPriority(item)!.label">{{ entityPriority(item)!.label }}</span>
            <span v-else-if="!context" class="integration-empty-value">—</span>
          </div>
          <div v-if="showUpdatedAt" class="integration-updated-at" :aria-labelledby="updatedColumnId">
            <time v-if="!context && updatedTime(item)" :title="updatedTime(item)!.raw"><span>{{ updatedTime(item)!.date }}</span><span v-if="updatedTime(item)!.time">{{ updatedTime(item)!.time }}</span></time>
            <span v-else-if="!context" class="integration-empty-value">—</span>
          </div>
          <span class="integration-entity-tail">
            <IntegrationEntityStatus v-if="item.archived || (item.status && !(configurationActionId && item.configurationToggle))" :entity="item" />
          </span>
          <div class="integration-entity-actions">
            <a v-if="item.url" class="integration-original-link" :href="item.url" target="_blank" rel="noopener noreferrer" :aria-label="t('integrationOpenOriginal', { title: item.title })" :title="t('integrationOpenOriginal', { title: item.title })"><Icon name="externalLink" /></a>
            <IntegrationConfigurationToggle
              v-if="!context && configurationActionId && sourceContext && item.configurationToggle"
              :key="`${sourceContext.projectId ?? 'global'}:${configurationActionId}`"
              :entity="item" :integration-id="sourceContext.integrationId" :action-id="configurationActionId"
              :project-id="sourceContext.projectId" :disabled="loading"
              @updated="emit('configurationUpdated', $event)"
            />
            <IntegrationWorkItemDetail
              v-if="!context && workItemActions"
              :entity="item" :integration-id="workItemActions.integrationId"
              :project-id="workItemActions.projectId" :detail-action-id="workItemActions.detailActionId"
            />
            <IntegrationStatusTransitionControl
              v-if="!context && statusActions && item.status && item.statusUpdateAvailable !== false"
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
    </div>
  </div>
</template>

<style scoped>
.integration-details { margin: 8px 0 0; display: grid; gap: 5px; font-size: var(--font-size-control); }
.integration-details > div { display: grid; grid-template-columns: minmax(100px, 140px) minmax(0, 1fr); gap: 12px; }
.integration-details a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.integration-details a .app-icon { width: 12px; height: 12px; display: inline; }
.integration-details dt { color: var(--muted); }
.integration-details dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.integration-entity-browser { display: grid; min-width: 0; container-type: inline-size; }
.integration-entity-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 10px 18px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
.integration-entity-toolbar > label { display: flex; flex: 1 1 150px; align-items: center; gap: 8px; min-width: 0; min-height: 28px; }
.integration-entity-toolbar > label .app-icon { width: 15px; height: 15px; color: var(--muted); }
.integration-entity-toolbar input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 12px; }
.integration-entity-toolbar > span { flex: none; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.integration-entities { --compact-columns: minmax(0, 1fr) auto; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 12px; }
.integration-entities.has-priority-column { grid-template-columns: minmax(0, 1fr) 80px 100px auto; }
.integration-entities.has-updated-column { grid-template-columns: minmax(0, 1fr) 104px 100px auto; }
.integration-entities.has-priority-column.has-updated-column { --compact-columns: minmax(0, .7fr) minmax(0, 1fr) minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) 80px 104px 100px auto; }
.integration-entity-rows { display: contents; }
.integration-entity-columns { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surface-muted); color: var(--muted); font-size: var(--font-size-control); border-bottom: 1px solid var(--border-subtle, var(--border)); }
.integration-item-column { padding-inline-start: 28px; }
.integration-actions-column { text-align: right; }
.integration-entity { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; gap: 12px; min-width: 0; border-top: 1px solid var(--border-subtle, var(--border)); padding: 10px 12px; }
.integration-entity:first-child { border-top: 0; }
.integration-entity-main { display: flex; min-width: 0; gap: 4px; padding-inline-start: calc(var(--hierarchy-depth) * 16px); }
.integration-entity-content { display: grid; flex: 1; min-width: 0; align-content: center; gap: 4px; }
.integration-hierarchy-control { display: flex; flex: 0 0 24px; align-items: flex-start; justify-content: center; }
.integration-hierarchy-toggle { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer; }
.integration-hierarchy-toggle:hover { background: var(--surface-hover); color: var(--text); }
.integration-hierarchy-toggle .app-icon, .integration-hierarchy-branch { width: 14px; height: 14px; }
.integration-hierarchy-branch { margin-top: 5px; color: var(--muted); }
.integration-hierarchy-context { background: var(--surface-subtle); }
.integration-hierarchy-context strong { color: var(--text-secondary); font-weight: 500; }
.integration-entity:has(.integration-entity-link[href]):hover { background: var(--surface-hover); }
.integration-entity-link { display: block; min-width: 0; padding: 0; color: inherit; text-decoration: none; }
button.integration-entity-link { border: 0; background: transparent; text-align: start; cursor: pointer; font: inherit; }
.integration-entity-body { display: grid; min-width: 0; gap: 4px; }
.integration-entity-title { display: flex; min-width: 0; align-items: center; gap: 7px; min-height: 24px; }
.integration-entity-title strong, .integration-entity-body > small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.integration-entity-title strong { font-size: var(--font-size-body); font-weight: 500; }
.integration-entity-body > small { color: var(--muted); font-size: var(--font-size-control); }
.integration-type-badge { flex: none; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 4px; border-radius: 3px; font-size: var(--font-size-micro); font-weight: 600; line-height: 14px; letter-spacing: .02em; color: var(--text-secondary); background: var(--surface-muted); }
.integration-type-badge[data-type="story"] { background: var(--accent); color: var(--on-accent); }
.integration-type-badge[data-type="bug"] { background: var(--danger); color: var(--on-danger); }
.integration-type-badge[data-type="task"] { background: var(--success); color: var(--on-success); }
.integration-child-count { flex: none; min-width: 16px; padding: 0 4px; border-radius: 4px; color: var(--muted); background: var(--surface-muted); font-size: var(--font-size-caption); text-align: center; }
.integration-entity-priority { min-width: 0; display: flex; align-items: center; }
.integration-empty-value { color: var(--muted); font-size: var(--font-size-control); }
.integration-priority-badge { max-width: 100%; padding: 0 5px; line-height: 18px; border-radius: 3px; overflow-wrap: anywhere; background: var(--surface-hover); color: var(--text-secondary); font-size: var(--font-size-caption); font-weight: 500; }
.integration-priority-badge[data-tone='danger'] { background: var(--danger); color: var(--on-danger); }
.integration-priority-badge[data-tone='warning'] { background: var(--warning); color: var(--on-warning); }
.integration-priority-badge[data-tone='success'] { background: var(--success); color: var(--on-success); }
.integration-priority-badge[data-tone='info'] { background: var(--accent); color: var(--on-accent); }
.integration-updated-at { min-width: 0; color: var(--muted); font-size: var(--font-size-control); font-variant-numeric: tabular-nums; }
.integration-updated-at time { display: grid; gap: 1px; overflow-wrap: anywhere; }
.integration-entity-tail { display: flex; min-width: 0; align-items: center; color: var(--muted); }
.integration-entity-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.integration-empty-copy { margin: 0; padding: 18px; color: var(--muted); font-size: 13px; text-align: center; }
.integration-status-filter, .integration-assignee-filter { display: flex; align-items: center; gap: 6px; flex: none; }
.integration-status-filter label, .integration-assignee-filter label { flex: none; white-space: nowrap; color: var(--muted); font-size: 11px; }
.integration-status-filter :deep([data-slot="select-trigger"]), .integration-assignee-filter :deep([data-slot="select-trigger"]) { width: 160px; min-height: 28px; padding: 3px 8px; font-size: 12px; }
.integration-assignee-filter :deep([data-slot="select-trigger"]) { width: 194px; }
.integration-filter-hint { margin: 0; padding: 8px 18px; color: var(--muted); font-size: var(--font-size-control); border-bottom: 1px solid var(--border); }
.integration-original-link { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 5px; color: var(--muted); }
.integration-original-link:hover { color: var(--accent); background: var(--accent-soft); }
.integration-original-link .app-icon { width: 14px; height: 14px; }
@media (max-width: 720px) { .integration-entity-toolbar { align-items: stretch; flex-direction: column; gap: 8px; } .integration-entity-toolbar > label { flex-basis: auto; min-height: 36px; } }
@media (max-width: 720px) {
  .integration-status-filter :deep([data-slot="select-trigger"]), .integration-assignee-filter :deep([data-slot="select-trigger"]) { min-height: 36px; width: 100%; }
  .integration-status-filter, .integration-assignee-filter { gap: 10px; }
  .integration-status-filter label, .integration-assignee-filter label { width: 36px; }
}
@container (max-width: 620px) {
  .integration-entities, .integration-entities.has-priority-column, .integration-entities.has-updated-column, .integration-entities.has-priority-column.has-updated-column { grid-template-columns: minmax(0, 1fr); }
  .integration-entity-columns, .integration-entity { grid-template-columns: var(--compact-columns); gap: 8px 10px; padding: 10px; }
  .integration-item-column { grid-column: 1 / -1; padding-inline-start: 28px; }
  .integration-actions-column { display: none; }
  .integration-entity-main { grid-column: 1 / -1; padding-inline-start: calc(var(--hierarchy-depth) * 10px); }
  .integration-entity-title strong { white-space: normal; overflow-wrap: anywhere; }
  .integration-entity-tail { justify-content: flex-start; }
  .integration-entity-tail :deep(.entity-status) { white-space: normal; }
  .integration-entity-actions { grid-column: 1 / -1; justify-content: flex-end; }
  .integration-hierarchy-context .integration-updated-at, .integration-hierarchy-context .integration-entity-priority { display: none; }
  .integration-hierarchy-context .integration-entity-tail { grid-column: 1 / -2; padding-inline-start: 28px; }
  .integration-hierarchy-context .integration-entity-actions { grid-column: -2 / -1; grid-row: 2; }
  .integration-hierarchy-toggle { min-height: 28px; }
  .integration-original-link { width: 32px; height: 32px; }
}
</style>
