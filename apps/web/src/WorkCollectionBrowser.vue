<script setup lang="ts">
import type { IntegrationEntity, IntegrationEntityPage, PersonalWorkbenchHome } from 'craft-hub'
import type { IconName } from './icons'
import { personalActiveWork, workItemIdentityKey } from 'craft-hub/work-items'
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import { FormSelect } from './components/ui/select'
import { Switch } from './components/ui/switch'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import { isWorkItemOverdue, workItemTypeIcon } from './work-item-presentation'

const props = defineProps<{ page: IntegrationEntityPage, compact?: boolean, wide?: boolean }>()
const { locale } = useI18n()
const store = useWorkbenchStore()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const id = useId()
type Preferences = NonNullable<PersonalWorkbenchHome['workItems']>
type SmartFilter = 'all' | 'important' | 'overdue'
const defaults: Preferences = { groupByList: true, density: 'comfortable', showEmptyLists: true }
const preferences = computed(() => store.settings?.settings['workbench.home'].workItems ?? defaults)
const saving = ref(false)
const saveError = ref('')
const optionsOpen = ref(false)
const query = ref('')
const filter = ref<SmartFilter>('all')
const collectionId = ref<string>()
const typeId = ref('all')
const statusId = ref('all')
const allLists = ref(false)
const expanded = ref(false)
const collapsed = ref(new Set<string>())
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 60_000)
onUnmounted(() => clearInterval(clock))
const items = computed(() => personalActiveWork(props.page))
const projectMode = computed(() => props.page.items.some(item => item.project))
const collections = computed(() => projectMode.value
  ? [...new Map(items.value.flatMap(item => item.project ? [[item.project.id, item.project] as const] : [])).values()]
  : props.page.collections ?? [])
const containerId = (item: IntegrationEntity) => projectMode.value ? item.project?.id : item.sourceRef?.containerId
const titles = computed(() => new Map(collections.value.map(collection => [collection.id, collection.title])))
const typeFilters = computed(() => {
  const types = new Map<string, { value: string, title: string, count: number, icon: IconName }>()
  for (const item of items.value) {
    const value = item.type ? JSON.stringify([item.type.id]) : 'unknown'
    const type = types.get(value) ?? { value, icon: workItemTypeIcon(item), title: item.type?.title ?? copy('未分类', 'Unclassified'), count: 0 }
    type.count++
    types.set(value, type)
  }
  return [{ value: 'all', icon: 'collection' as IconName, title: copy('全部', 'All'), count: items.value.length }, ...types.values()]
})
const counts = computed(() => ({ all: items.value.length, important: items.value.filter(item => item.important).length, overdue: items.value.filter(item => isWorkItemOverdue(item.dueDate, now.value)).length }))
const smartFilters = computed<Array<{ value: SmartFilter, title: string, icon: IconName }>>(() => [
  { value: 'all', title: copy('全部', 'All'), icon: 'list' },
  { value: 'important', title: copy('重要', 'Important'), icon: 'starFilled' },
  { value: 'overdue', title: copy('已逾期', 'Overdue'), icon: 'calendar' },
])
const search = computed(() => query.value.trim().toLocaleLowerCase(locale.value))
const matches = (value: string) => value.toLocaleLowerCase(locale.value).includes(search.value)
const categoryItems = computed(() => items.value.filter(item =>
  (projectMode.value ? typeId.value === 'all' || typeId.value === (item.type ? JSON.stringify([item.type.id]) : 'unknown') : filter.value === 'all' || (filter.value === 'important' ? item.important : isWorkItemOverdue(item.dueDate, now.value)))
))
const matchingItems = computed(() => categoryItems.value.filter(item =>
  !search.value || matches(item.title) || matches(titles.value.get(containerId(item) ?? '') ?? '') || (projectMode.value && (matches(item.type?.title ?? '') || matches(item.statusLabel ?? item.status ?? ''))),
))
const listCounts = computed(() => {
  const result = new Map<string, number>()
  for (const item of matchingItems.value) {
    const key = containerId(item) ?? ''
    result.set(key, (result.get(key) ?? 0) + 1)
  }
  return result
})
const matchingLists = computed(() => collections.value.filter(collection =>
  (preferences.value.showEmptyLists || listCounts.value.has(collection.id) || collection.id === collectionId.value)
  && (!search.value || matches(collection.title) || listCounts.value.has(collection.id)),
))
const visibleLists = computed(() => {
  if (allLists.value || search.value)
    return matchingLists.value
  const first = matchingLists.value.slice(0, 5)
  const selected = matchingLists.value.find(collection => collection.id === collectionId.value)
  if (selected && !first.includes(selected))
    first[first.length - 1] = selected
  return first
})
const scopedItems = computed(() => matchingItems.value.filter(item => !collectionId.value || containerId(item) === collectionId.value))
// Native workflow codes are scoped by project and type; labels alone are not identities.
const statusKey = (item: IntegrationEntity) => JSON.stringify([item.project?.id ?? '', item.type?.id ?? '', item.status ?? '', item.statusLabel ?? ''])
const statusOptions = computed(() => {
  const statuses = new Map<string, { label: string, count: number }>()
  const candidates = categoryItems.value.filter(item => !collectionId.value || containerId(item) === collectionId.value)
  for (const item of candidates) {
    const value = statusKey(item)
    const status = statuses.get(value) ?? { label: [item.statusLabel || item.status || copy('未知状态', 'Unknown status'), !collectionId.value && item.project?.title, typeId.value === 'all' && item.type?.title].filter(Boolean).join(' · '), count: 0 }
    status.count++
    statuses.set(value, status)
  }
  return [{ value: 'all', label: `${copy('所有状态', 'All statuses')} (${candidates.length})` }, ...[...statuses].map(([value, status]) => ({ value, label: `${status.label} (${status.count})` }))]
})
const filteredItems = computed(() => scopedItems.value.filter(item => !projectMode.value || statusId.value === 'all' || statusKey(item) === statusId.value))
const hasProjectFilters = computed(() => Boolean(query.value || collectionId.value || typeId.value !== 'all' || statusId.value !== 'all'))
function clearProjectFilters(): void {
  query.value = ''
  collectionId.value = undefined
  typeId.value = 'all'
  statusId.value = 'all'
}
const groups = computed(() => {
  if (!preferences.value.groupByList)
    return [{ key: 'flat', title: '', items: filteredItems.value }]
  const byList = new Map<string, IntegrationEntity[]>()
  const unknown: IntegrationEntity[] = []
  for (const item of filteredItems.value) {
    const container = containerId(item)
    if (!container || !titles.value.has(container)) {
      unknown.push(item)
      continue
    }
    const group = byList.get(container) ?? []
    group.push(item)
    byList.set(container, group)
  }
  return [
    ...collections.value.flatMap(collection => byList.has(collection.id) ? [{ key: JSON.stringify([collection.id]), title: collection.title, items: byList.get(collection.id)! }] : []),
    ...(unknown.length ? [{ key: 'unlisted', title: copy('其他事项', 'Other items'), items: unknown }] : []),
  ]
})
const preview = computed(() => props.compact && !expanded.value)
const visibleGroups = computed(() => (preview.value ? groups.value.slice(0, 3) : groups.value).map(group => ({
  ...group,
  visibleItems: preview.value ? group.items.slice(0, preferences.value.groupByList ? 2 : 5) : group.items,
})))
const previewCount = computed(() => visibleGroups.value.reduce((count, group) => count + group.visibleItems.length, 0))
watch([filter, collectionId, typeId, statusId, query, () => preferences.value.groupByList], () => { expanded.value = false; collapsed.value.clear() })
watch([collectionId, typeId], () => { statusId.value = 'all' })
watch(() => props.page.currentUser?.id, () => { clearProjectFilters(); filter.value = 'all'; allLists.value = false })
watch(typeFilters, () => {
  if (!typeFilters.value.some(type => type.value === typeId.value))
    typeId.value = 'all'
})
watch(statusOptions, () => {
  if (!statusOptions.value.some(status => status.value === statusId.value))
    statusId.value = 'all'
})
watch(collections, () => {
  if (!collections.value.some(collection => collection.id === collectionId.value))
    collectionId.value = undefined
})
function toggleGroup(key: string): void {
  if (collapsed.value.has(key))
    collapsed.value.delete(key)
  else collapsed.value.add(key)
}
async function save(patch: Partial<Preferences>): Promise<void> {
  if (saving.value || !store.settings)
    return
  saving.value = true
  saveError.value = ''
  const home = { ...store.settings.settings['workbench.home'], workItems: { ...preferences.value, ...patch } }
  try { await store.applySettings(await api.updateSettings({ 'workbench.home': home }, store.settings.revision)) }
  catch {
    saveError.value = copy('显示选项未保存，请重试。', 'Display options were not saved. Try again.')
    await store.loadSettings().catch(() => {})
  }
  finally { saving.value = false }
}
</script>

<template>
  <div class="work-collections" :class="{ 'is-compact': preferences.density === 'compact', 'is-projects': projectMode, 'is-wide': wide }">
    <div class="collection-controls">
      <div v-if="projectMode" class="smart-filters type-filters" role="group" :aria-label="copy('类型', 'Type')">
        <button v-for="option in typeFilters" :key="option.value" type="button" class="smart-filter" :aria-pressed="typeId === option.value" @click="typeId = option.value"><Icon :name="option.icon" /><span>{{ option.title }}</span><strong>{{ option.count }}</strong></button>
      </div>
      <div v-else class="smart-filters" role="group" :aria-label="copy('智能分类', 'Smart categories')">
        <button v-for="option in smartFilters" :key="option.value" type="button" class="smart-filter" :class="option.value" :aria-pressed="filter === option.value" @click="filter = option.value">
          <Icon :name="option.icon" /><span>{{ option.title }}</span><strong>{{ counts[option.value] }}</strong>
        </button>
      </div>
      <div class="collections-heading">
        <h3>{{ projectMode ? copy('我的项目', 'My projects') : copy('我的列表', 'My lists') }} <span>{{ collections.length }}</span></h3>
        <UiButton variant="ghost" size="compact" :aria-expanded="optionsOpen" :aria-controls="`${id}-options`" @click="optionsOpen = !optionsOpen"><Icon name="settings" />{{ copy('显示选项', 'Display options') }}</UiButton>
      </div>
      <div v-if="optionsOpen" :id="`${id}-options`" class="collection-options">
        <label><span>{{ projectMode ? copy('按项目分组', 'Group by project') : copy('按列表分组', 'Group by list') }}</span><Switch :model-value="preferences.groupByList" :disabled="saving || !store.settings" :aria-label="projectMode ? copy('按项目分组', 'Group by project') : copy('按列表分组', 'Group by list')" @update:model-value="value => save({ groupByList: value })" /></label>
        <label><span>{{ copy('紧凑布局', 'Compact layout') }}</span><Switch :model-value="preferences.density === 'compact'" :disabled="saving || !store.settings" :aria-label="copy('紧凑布局', 'Compact layout')" @update:model-value="value => save({ density: value ? 'compact' : 'comfortable' })" /></label>
        <label v-if="!projectMode"><span>{{ copy('显示空列表', 'Show empty lists') }}</span><Switch :model-value="preferences.showEmptyLists" :disabled="saving || !store.settings" :aria-label="copy('显示空列表', 'Show empty lists')" @update:model-value="value => save({ showEmptyLists: value })" /></label>
        <p class="daily-caption" role="status">{{ saving ? copy('正在保存…', 'Saving…') : store.settings ? copy('显示偏好保存在本机，适用于首页的待办列表。', 'Display preferences are saved on this device for home task lists.') : copy('设置尚未载入，请刷新页面后重试。', 'Settings are unavailable. Reload the page to try again.') }}</p>
        <p v-if="saveError" class="collection-error daily-caption" role="alert">{{ saveError }}</p>
      </div>
      <div class="collection-search"><Icon name="search" /><Input v-model="query" type="search" :aria-label="projectMode ? copy('搜索项目和待办', 'Search projects and tasks') : copy('搜索列表和待办', 'Search lists and tasks')" :placeholder="projectMode ? copy('搜索项目和待办', 'Search projects and tasks') : copy('搜索列表和待办', 'Search lists and tasks')" /></div>
      <div class="collection-grid" role="group" :aria-label="projectMode ? copy('项目', 'Projects') : copy('原有列表', 'Original lists')">
        <button type="button" class="collection-choice" :aria-pressed="!collectionId" @click="collectionId = undefined"><Icon :name="projectMode ? 'workspace' : 'collection'" /><span>{{ projectMode ? copy('所有项目', 'All projects') : copy('所有列表', 'All lists') }}</span><span class="collection-count">{{ matchingItems.length }}</span></button>
        <button v-for="collection in visibleLists" :key="collection.id" type="button" class="collection-choice" :aria-pressed="collectionId === collection.id" :title="collection.title" @click="collectionId = collection.id"><Icon :name="projectMode ? 'folder' : 'list'" /><span>{{ collection.title }}</span><span class="collection-count">{{ listCounts.get(collection.id) ?? 0 }}</span></button>
      </div>
      <UiButton v-if="matchingLists.length > 5 && !search" variant="ghost" size="compact" class="collection-more" :aria-expanded="allLists" @click="allLists = !allLists">{{ allLists ? projectMode ? copy('收起项目', 'Show fewer projects') : copy('收起列表', 'Show fewer lists') : `${projectMode ? copy('显示所有项目', 'Show all projects') : copy('显示所有列表', 'Show all lists')} (${matchingLists.length})` }}<Icon :name="allLists ? 'arrowDown' : 'arrowRight'" /></UiButton>
      <div v-if="projectMode" class="collection-status-filter">
        <label :for="`${id}-status`">{{ copy('状态', 'Status') }}</label>
        <FormSelect :id="`${id}-status`" v-model="statusId" :options="statusOptions" :aria-label="copy('筛选状态', 'Filter status')" />
      </div>
      <div v-if="projectMode" class="collection-filter-summary"><span class="daily-caption" role="status">{{ filteredItems.length }} {{ copy('条未完成待办', 'unfinished tasks') }}</span><UiButton v-if="hasProjectFilters" variant="ghost" size="compact" @click="clearProjectFilters">{{ copy('清除筛选', 'Clear filters') }}</UiButton></div>
      <p v-if="page.coverage !== 'complete' || page.nextCursor" class="daily-caption">{{ copy('分类数量仅统计已载入的未完成事项。', 'Category counts include loaded unfinished items only.') }}</p>
    </div>
    <div class="collection-results" aria-live="polite">
      <section v-for="group in visibleGroups" :key="group.key" class="collection-task-group">
        <button v-if="group.title" type="button" class="collection-group-heading" :aria-expanded="!collapsed.has(group.key)" @click="toggleGroup(group.key)"><span>{{ group.title }}</span><span class="collection-count">{{ group.items.length }}</span><Icon :name="collapsed.has(group.key) ? 'arrowRight' : 'arrowDown'" /></button>
        <div v-if="!collapsed.has(group.key)" class="daily-list"><template v-for="item in group.visibleItems" :key="workItemIdentityKey(item)"><slot name="item" :item="item" :show-collection="!preferences.groupByList" /></template></div>
      </section>
      <div v-if="!filteredItems.length" class="daily-empty home-hint"><Icon name="list" /><strong>{{ copy('本次暂无待处理事项', 'No pending work in these results') }}</strong><p class="daily-caption">{{ copy('此分类下没有匹配的未完成待办。', 'No unfinished tasks match this category.') }}</p><UiButton v-if="!projectMode && (query || filter !== 'all')" variant="ghost" size="compact" @click="query = ''; filter = 'all'">{{ copy('清除筛选', 'Clear filters') }}</UiButton></div>
    </div>
    <div v-if="compact && (previewCount < filteredItems.length || expanded)" class="collection-preview-footer"><span class="daily-caption">{{ previewCount }} / {{ filteredItems.length }} {{ copy('条待办', 'tasks') }}</span><UiButton variant="ghost" size="compact" @click="expanded = !expanded">{{ expanded ? copy('收起待办', 'Show fewer tasks') : copy('显示更多待办', 'Show more tasks') }}</UiButton></div>
  </div>
</template>

<style scoped>
.collection-controls { display: grid; gap: var(--space-2); padding: var(--space-1) var(--space-4) var(--space-3); }
.smart-filters { display: flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 9px; background: var(--surface-subtle); }
.collection-status-filter { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: var(--space-3); font-size: var(--font-size-control); }
.collection-filter-summary { display: flex; justify-content: space-between; align-items: center; min-height: 24px; }
.smart-filter, .collection-choice { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 32px; padding: 4px 8px; border: 1px solid transparent; border-radius: var(--control-radius); background: transparent; color: var(--text); cursor: pointer; font-size: 13px; }
.smart-filter { flex: 1; min-height: 30px; white-space: nowrap; }
.smart-filter > .app-icon, .collection-choice > .app-icon { flex: none; width: 15px; height: 15px; color: var(--accent); }
.smart-filter.important > .app-icon { color: var(--warning); }
.smart-filter.overdue > .app-icon { color: var(--danger); }
.smart-filter > strong, .collection-count { margin-left: auto; flex: none; color: var(--text-secondary); font-size: var(--font-size-caption); font-weight: 400; font-variant-numeric: tabular-nums; }
.collection-choice[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); }
.smart-filter[aria-pressed='true'] { background: var(--surface); color: var(--accent); box-shadow: 0 1px 3px var(--shadow); border-color: var(--border); }
.smart-filter[aria-pressed='true'] strong, .collection-choice[aria-pressed='true'] .collection-count { color: var(--accent); }
.smart-filter:hover, .collection-choice:hover { background: var(--surface-hover); }
.smart-filter:focus-visible, .collection-choice:focus-visible, .collection-group-heading:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.collections-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.collections-heading h3 { margin: 0; font-size: var(--font-size-control); font-weight: 600; color: var(--text-secondary); }
.collections-heading h3 > span { margin-left: var(--space-2); color: var(--text-secondary); font-weight: 400; }
.collection-options { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface-subtle); }
.collection-options label { display: flex; min-height: var(--control-height-default); align-items: center; justify-content: space-between; gap: var(--space-3); font-size: var(--font-size-body); }
.collection-options p, .collection-controls > p { margin: 0; }
.collection-error { color: var(--danger); }
.collection-search { display: flex; align-items: center; position: relative; }
.collection-search > .app-icon { position: absolute; left: var(--space-3); width: 16px; height: 16px; color: var(--text-secondary); pointer-events: none; }
.collection-search input { width: 100%; padding-left: 36px; background: var(--surface-subtle); }
.collection-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 8px; }
.collection-choice > span:not(.collection-count) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.collection-more { justify-self: start; color: var(--accent); }
.collection-task-group { border-top: 1px solid var(--border); }
.collection-group-heading { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 32px; padding: 4px var(--space-4); border: 0; background: var(--surface-subtle); color: var(--text-secondary); font-size: var(--font-size-caption); font-weight: 600; text-align: left; cursor: pointer; }
.collection-group-heading > span:first-child { overflow-wrap: anywhere; min-width: 0; }
.collection-group-heading > .collection-count { margin-left: 0; }
.collection-group-heading > .app-icon { margin-left: auto; flex: none; width: 16px; height: 16px; color: var(--text-secondary); }
.collection-preview-footer { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); border-top: 1px solid var(--border); }
.is-compact :deep(.daily-row) { min-height: 40px; padding-top: var(--space-2); padding-bottom: var(--space-2); }
.is-compact :deep(.daily-row-copy) { gap: 0; }
@container work-overview (min-width: 760px) {
  .is-wide { display: grid; grid-template-columns: 256px minmax(0, 1fr); grid-template-rows: 1fr auto; border-top: 1px solid var(--border); }
  .is-wide .collection-controls { grid-column: 1; grid-row: 1 / 3; align-content: start; border-right: 1px solid var(--border); padding: 12px; background: var(--surface-subtle); }
  .is-wide .collection-grid { grid-template-columns: 1fr; }
  .is-wide .collection-results { grid-column: 2; grid-row: 1; min-width: 0; }
  .is-wide .collection-task-group:first-child { border-top: 0; }
  .is-wide .collection-preview-footer { grid-column: 2; grid-row: 2; }
  .is-wide .smart-filters { background: var(--surface-hover); }
  .is-wide .smart-filter { gap: 4px; padding-inline: 5px; font-size: 12px; }
  .is-wide .type-filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .is-wide .collection-status-filter { grid-template-columns: 1fr; gap: 4px; }
  .is-wide .collection-search input { background: var(--surface); }
}
@media (max-width: 760px), (pointer: coarse) {
  .smart-filter { gap: 4px; padding: 4px 6px; font-size: 12px; }
  .smart-filter, .collection-choice, .collection-group-heading, .collection-options label { min-height: 44px; }
  .is-compact :deep(.daily-row) { min-height: 48px; }
}
</style>
