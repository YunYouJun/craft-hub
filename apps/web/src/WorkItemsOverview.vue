<script setup lang="ts">
import type { IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import type { HomeWorkGroup, HomeWorkSource } from './personal-workbench'
import { personalActiveWork, workItemIdentityKey } from 'craft-hub/work-items'
import { computed, onUnmounted, ref, watch } from 'vue'
import { completionActionId, connectionKey, useHomeWorkDataStore } from './home-work-data'
import { Button as UiButton } from './components/ui/button'
import { SkeletonList } from './components/ui/skeleton'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './components/ui/tabs'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { homeWorkGroups, homeWorkSources } from './personal-workbench'
import { useWorkbenchStore } from './store'
import { formatWorkItemDueDate, formatWorkItemTimestamp, workItemStatusIcon, workItemTypeIcon } from './work-item-presentation'
import TodayFocus from './TodayFocus.vue'
import VisualIcon from './VisualIcon.vue'
import WorkCollectionBrowser from './WorkCollectionBrowser.vue'

const props = withDefaults(defineProps<{ compact?: boolean, tabbed?: boolean, integrations?: string[], refreshKey?: number }>(), { compact: false, tabbed: false, refreshKey: 0 })
const emit = defineEmits<{
  prepareHandoff: [work: { source: HomeWorkSource, item: IntegrationEntity }]
  openIntegration: [integrationId: string, viewId: string, scope: 'global']
  capture: []
  openMarketplace: []
}>()
const store = useWorkbenchStore()
const workData = useHomeWorkDataStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const sources = computed(() => homeWorkSources(store.integrationContributions, locale.value).filter(source => !props.integrations || props.integrations.includes(source.integrationId)))
const groups = computed(() => homeWorkGroups(sources.value))
const selectedGroup = ref('')
const selectedSources = ref<Record<string, string>>({})
watch(groups, (value) => {
  if (!value.some(group => group.integrationId === selectedGroup.value))
    selectedGroup.value = value[0]?.integrationId ?? ''
  selectedSources.value = Object.fromEntries(value.map(group => [
    group.integrationId,
    group.sources.find(source => source.key === selectedSources.value[group.integrationId])?.key ?? group.sources[0]!.key,
  ]))
}, { immediate: true })
function selectGroup(value: string | number): void {
  selectedGroup.value = String(value)
}
function selectSource(groupId: string, value: string | number): void {
  selectedSources.value[groupId] = String(value)
}
const states = computed(() => Object.fromEntries(sources.value.map(source => [source.key, workData.stateFor(source)])))
const loading = computed(() => sources.value.some(source => states.value[source.key]?.loading))
const focusEntries = computed(() => sources.value.flatMap(source => {
  const state = states.value[source.key]
  return state?.page && state.connection?.connected !== false ? personalActiveWork(state.page).map(item => ({ source, item })) : []
}))
const focusCoverage = computed(() => {
  const loaded = sources.value.filter(source => states.value[source.key]?.page && states.value[source.key]?.connection?.connected !== false)
  const complete = loaded.filter(source => states.value[source.key]?.page?.coverage === 'complete' && !states.value[source.key]?.page?.nextCursor).length
  const failed = loaded.filter(source => states.value[source.key]?.error).length
  const coverage = copy(`已读取 ${loaded.length}/${sources.value.length} 个来源 · ${complete} 个完整载入 · 仅分析当前账号的未完成事项`, `${loaded.length}/${sources.value.length} sources read · ${complete} complete · Personal unfinished work only`)
  return failed ? `${coverage} · ${copy(`${failed} 个来源更新失败，保留上次结果`, `${failed} sources could not update; showing previous results`)}` : coverage
})

function disconnectedSources(group: HomeWorkGroup): HomeWorkSource[] {
  const disconnected = new Map<string, HomeWorkSource>()
  for (const source of group.sources) {
    if (states.value[source.key]?.connection?.connected === false && !disconnected.has(connectionKey(source)))
      disconnected.set(connectionKey(source), source)
  }
  return [...disconnected.values()]
}

/** A group whose every source still needs authorization shows only its connection prompt, not empty list chrome. */
function awaitingConnection(group: HomeWorkGroup): boolean {
  return group.sources.every(source => states.value[source.key]?.connection?.connected === false)
}

function groupCount(group: HomeWorkGroup): number | undefined {
  const pages = group.sources.flatMap(source => states.value[source.key]?.page ? [states.value[source.key]!.page!] : [])
  return pages.length ? new Set(pages.flatMap(page => personalActiveWork(page).map(workItemIdentityKey))).size : undefined
}

function needsAttention(group: HomeWorkGroup): boolean {
  return group.sources.some(source => states.value[source.key]?.error || states.value[source.key]?.connection?.connected === false)
}

function groupLoading(group: HomeWorkGroup): boolean {
  return group.sources.some(source => states.value[source.key]?.loading)
}

async function refreshGroup(group: HomeWorkGroup): Promise<void> {
  await Promise.allSettled(group.sources.map(source => load(source)))
}

async function load(source: HomeWorkSource, more = false): Promise<void> {
  await workData.load(source, { force: !more, more })
}

async function refresh(): Promise<void> {
  await Promise.allSettled(sources.value.map(source => load(source)))
}
watch([sources, () => props.refreshKey, () => workData.revision], ([value, refreshKey], previous) => {
  const force = Boolean(previous?.length && previous[1] !== refreshKey)
  void Promise.allSettled(value.map(source => workData.load(source, { force })))
}, { immediate: true })
function visibleItems(source: HomeWorkSource): IntegrationEntity[] {
  const state = states.value[source.key]
  const items = filteredItems(source)
  return props.compact && !state?.expanded ? items.slice(0, 5) : items
}
function filteredItems(source: HomeWorkSource): IntegrationEntity[] {
  const state = states.value[source.key]
  return state?.page ? personalActiveWork(state.page) : []
}
function classifiedPage(page: IntegrationEntityPage | undefined): boolean {
  return Boolean(page?.collections?.length || page?.items.some(item => item.project))
}
const completing = ref(new Set<string>())
const completion = ref<{ sourceKey: string, previous: IntegrationEntity, undoing?: boolean }>()
const completionError = ref<{ sourceKey: string, message: string }>()
let completionTimer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(completionTimer))
function canComplete(source: HomeWorkSource, item: IntegrationEntity): boolean {
  return item.statusUpdateAvailable === true && !states.value[source.key]?.page?.cache && Boolean(completionActionId(store.integrationContributions.find(contribution => contribution.id === source.integrationId)))
}
function completionFailure(source: HomeWorkSource, title: string, caught: unknown): void {
  const reason = caught instanceof Error ? caught.message : String(caught)
  completionError.value = { sourceKey: source.key, message: `${copy(`未能更新「${title}」`, `Could not update “${title}”`)}: ${reason}` }
}
/** Clicking the circle is the explicit confirmation for this single, reversible task write. */
async function complete(source: HomeWorkSource, item: IntegrationEntity): Promise<void> {
  const key = workItemIdentityKey(item)
  if (completing.value.has(key))
    return
  completing.value.add(key)
  completionError.value = undefined
  try {
    await workData.setCompletion(source, item, true)
    clearTimeout(completionTimer)
    completion.value = { sourceKey: source.key, previous: item }
    completionTimer = setTimeout(() => { completion.value = undefined }, 8000)
  }
  catch (caught) { completionFailure(source, item.title, caught) }
  finally { completing.value.delete(key) }
}
async function undoCompletion(): Promise<void> {
  const current = completion.value
  const source = sources.value.find(candidate => candidate.key === current?.sourceKey)
  if (!current || !source || current.undoing)
    return
  clearTimeout(completionTimer)
  completion.value = { ...current, undoing: true }
  completionError.value = undefined
  try {
    await workData.setCompletion(source, current.previous, false)
    completion.value = undefined
  }
  catch (caught) {
    completion.value = current
    completionFailure(source, current.previous.title, caught)
  }
}
function coverageLabel(source: HomeWorkSource): string {
  const state = states.value[source.key]
  const page = state?.page
  if (page?.nextCursor)
    return copy('还有更多', 'More available')
  if (page?.coverage === 'partial' || (page && !classifiedPage(page) && props.compact && !state?.expanded && filteredItems(source).length > 5))
    return copy('部分预览', 'Partial preview')
  return page?.coverage === 'complete' ? copy('已完整载入', 'Complete') : copy('范围未确认', 'Coverage unconfirmed')
}
</script>

<template>
  <TodayFocus v-if="compact" :wide="tabbed" :entries="focusEntries" :coverage="focusCoverage" :loading="loading || ['idle', 'loading'].includes(store.integrationsLoadState)" @capture="emit('capture')" @refresh="refresh" @handoff="work => emit('prepareHandoff', work)" />
  <section class="home-work work-items-overview daily-section" :class="{ 'is-tabbed': tabbed }">
    <div v-if="compact && !tabbed" class="home-section-heading daily-section-heading">
      <h2>{{ copy('我的工作', 'My work') }}</h2>
      <UiButton v-if="sources.length" variant="ghost" size="icon" class="home-icon-button" :aria-label="copy('刷新我的工作', 'Refresh my work')" @click="refresh"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton>
    </div>
    <div v-if="['idle', 'loading'].includes(store.integrationsLoadState) && !sources.length" class="daily-surface home-loading">
      <SkeletonList :label="copy('正在读取工作来源…', 'Loading work sources…')" icon />
    </div>
    <div v-else-if="store.integrationsLoadState === 'error'" class="daily-surface daily-empty home-error" role="alert">
      <strong>{{ copy('工作来源未载入', 'Work sources could not be loaded') }}</strong>
      <p class="daily-caption">{{ copy('检查连接后再试一次。', 'Check the connection and try again.') }}</p>
      <UiButton variant="secondary" size="compact" @click="store.loadIntegrations()">{{ copy('重试', 'Retry') }}</UiButton>
    </div>
    <div v-else-if="!sources.length" class="home-empty daily-surface daily-empty">
      <Icon name="list" /><strong>{{ copy('接入你的工作事项', 'Connect your work items') }}</strong>
      <p class="daily-caption">{{ copy('通过插件接入个人待办或分配给你的事项。', 'Connect personal or assigned work through plugins.') }}</p>
      <UiButton variant="secondary" size="compact" @click="emit('openMarketplace')">{{ copy('浏览插件', 'Browse plugins') }}</UiButton>
    </div>
    <component :is="tabbed ? TabsRoot : 'div'" class="home-work-tabs" v-bind="tabbed ? { modelValue: selectedGroup } : {}" @update:model-value="selectGroup">
      <div v-if="tabbed && groups.length" class="home-provider-bar">
        <TabsList class="home-provider-tabs" :aria-label="copy('待办来源', 'Work sources')">
          <TabsTrigger v-for="group in groups" :key="group.integrationId" :value="group.integrationId" :aria-busy="groupLoading(group)">
            <VisualIcon :icon="group.sources[0]?.icon" fallback="list" />
            <span>{{ group.title }}</span>
            <Icon v-if="groupLoading(group)" name="loading" class="home-tab-loading" :aria-label="copy('正在更新', 'Updating')" />
            <small v-if="groupCount(group) !== undefined" :title="copy('已载入的未完成事项', 'Loaded unfinished items')">{{ groupCount(group) }}</small>
            <Icon v-if="needsAttention(group)" name="error" class="home-tab-attention" :aria-label="copy('需要处理', 'Needs attention')" />
          </TabsTrigger>
        </TabsList>
        <UiButton variant="ghost" size="icon" :aria-label="copy('刷新我的工作', 'Refresh my work')" @click="refresh"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton>
      </div>
      <component :is="tabbed ? TabsContent : 'section'" v-for="group in groups" :key="group.integrationId" v-bind="tabbed ? { value: group.integrationId, forceMount: true, hidden: selectedGroup !== group.integrationId } : {}" class="home-work-source daily-surface" :aria-busy="groupLoading(group)">
        <div v-if="!tabbed || group.sources.length === 1" class="home-group-heading home-source-heading">
          <div class="home-source-copy">
            <strong v-if="!tabbed" class="home-source-title"><VisualIcon :icon="group.sources[0]?.icon" fallback="list" />{{ group.title }}</strong>
            <template v-if="group.sources.length === 1">
              <span v-if="states[group.sources[0]!.key]?.connection?.connected" class="home-connected daily-caption">{{ copy('已连接', 'Connected') }}</span>
              <p v-if="states[group.sources[0]!.key]?.page?.currentUser?.id" class="home-preview-note daily-caption" :title="states[group.sources[0]!.key]?.page?.currentUser?.id">{{ states[group.sources[0]!.key]?.page?.currentUser?.label || copy('个人事项', 'Personal work') }}</p>
            </template>
          </div>
          <div class="home-source-actions">
            <UiButton v-if="group.sources.length === 1 && !awaitingConnection(group)" variant="ghost" size="compact" class="home-text-button" @click="emit('openIntegration', group.integrationId, group.sources[0]!.viewId, 'global')">{{ copy('查看全部', 'View all') }}<Icon name="arrowRight" /></UiButton>
            <UiButton variant="ghost" size="icon" class="home-icon-button" :disabled="group.sources.some(source => states[source.key]?.loading)" :aria-label="`${copy('刷新', 'Refresh')} ${group.title}`" @click="refreshGroup(group)"><Icon :name="group.sources.some(source => states[source.key]?.loading) ? 'loading' : 'refresh'" /></UiButton>
          </div>
        </div>
        <div v-for="source in disconnectedSources(group)" :key="connectionKey(source)" class="home-source-notice home-connection" role="status">
          <div><strong>{{ copy('需要连接账号', 'Account connection required') }}</strong><p class="daily-caption">{{ states[source.key]?.connection?.message || copy('请先授权此来源，完成后刷新即可读取待办。', 'Authorize this source, then refresh to load your work items.') }}</p></div>
          <UiButton variant="secondary" size="compact" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">{{ copy('连接账号', 'Connect account') }}<Icon name="arrowRight" /></UiButton>
        </div>
        <component :is="tabbed && group.sources.length > 1 ? TabsRoot : 'div'" v-if="!awaitingConnection(group)" class="home-source-lists" v-bind="tabbed && group.sources.length > 1 ? { modelValue: selectedSources[group.integrationId] } : {}" @update:model-value="(value: string | number) => selectSource(group.integrationId, value)">
          <div v-if="tabbed && group.sources.length > 1" class="home-list-switcher">
            <TabsList :aria-label="`${group.title} ${copy('列表', 'lists')}`">
              <TabsTrigger v-for="source in group.sources" :key="source.key" :value="source.key">{{ source.sectionTitle }}</TabsTrigger>
            </TabsList>
            <UiButton variant="ghost" size="icon" :disabled="group.sources.some(source => states[source.key]?.loading)" :aria-label="`${copy('刷新', 'Refresh')} ${group.title}`" @click="refreshGroup(group)"><Icon :name="group.sources.some(source => states[source.key]?.loading) ? 'loading' : 'refresh'" /></UiButton>
          </div>
          <component :is="tabbed && group.sources.length > 1 ? TabsContent : 'section'" v-for="source in group.sources" :key="source.key" v-bind="tabbed && group.sources.length > 1 ? { value: source.key, forceMount: true, hidden: selectedSources[group.integrationId] !== source.key } : {}" class="home-work-list" :aria-busy="Boolean(states[source.key]?.loading)" :class="{ 'home-work-list-grouped': group.sources.length > 1 }">
            <div v-if="group.sources.length > 1" class="home-list-heading home-source-heading">
              <div class="home-source-copy">
                <strong v-if="!tabbed">{{ source.sectionTitle }}</strong>
                <span v-if="states[source.key]?.connection?.connected" class="home-connected daily-caption">{{ copy('已连接', 'Connected') }}</span>
                <p v-if="states[source.key]?.page?.currentUser?.id" class="home-preview-note daily-caption" :title="states[source.key]?.page?.currentUser?.id">{{ states[source.key]?.page?.currentUser?.label || copy('个人事项', 'Personal work') }}</p>
              </div>
              <div class="home-source-actions">
                <UiButton variant="ghost" size="compact" class="home-text-button" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">{{ copy('查看全部', 'View all') }}<Icon name="arrowRight" /></UiButton>
                <UiButton variant="ghost" size="icon" class="home-icon-button" :disabled="states[source.key]?.loading" :aria-label="`${copy('刷新', 'Refresh')} ${source.sectionTitle}`" @click="load(source)"><Icon :name="states[source.key]?.loading ? 'loading' : 'refresh'" /></UiButton>
              </div>
            </div>
            <SkeletonList v-if="states[source.key]?.loading && !states[source.key]?.page" :label="copy('正在读取…', 'Loading…')" icon />
            <p v-else-if="states[source.key]?.loading" class="home-source-progress daily-caption" role="status"><Icon name="loading" />{{ copy('后台更新中…', 'Updating…') }}</p>
            <div v-if="states[source.key]?.error" class="home-source-notice home-error" role="alert">
              <div><strong>{{ states[source.key]?.error }}</strong><p v-if="states[source.key]?.page" class="daily-caption">{{ copy('保留上次结果，可能已过期。', 'Previous results may be stale.') }}</p></div>
              <div class="home-source-actions">
                <UiButton v-if="source.connection" variant="ghost" size="compact" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">{{ copy('检查连接', 'Check connection') }}</UiButton>
                <UiButton variant="secondary" size="compact" class="home-text-button" :disabled="states[source.key]?.loading" @click="load(source, states[source.key]?.retryMore)">{{ copy('重试', 'Retry') }}</UiButton>
              </div>
            </div>
            <div v-if="completion?.sourceKey === source.key" class="home-source-notice home-completion" role="status">
              <span><Icon name="check" />{{ copy(`已完成「${completion.previous.title}」`, `Completed “${completion.previous.title}”`) }}</span>
              <UiButton variant="ghost" size="compact" class="home-text-button" :disabled="completion.undoing" @click="undoCompletion">{{ completion.undoing ? copy('正在撤销…', 'Undoing…') : copy('撤销', 'Undo') }}</UiButton>
            </div>
            <p v-if="completionError?.sourceKey === source.key" class="home-source-notice home-error" role="alert">{{ completionError.message }}</p>
            <template v-if="states[source.key]?.page">
              <div v-if="!states[source.key]?.page?.currentUser?.id" class="daily-empty home-hint"><strong>{{ copy('账号身份待确认', 'Account identity unavailable') }}</strong><p class="daily-caption">{{ copy('此来源尚未提供当前账号身份，请进入列表查看。', 'This source has not provided your account identity. Open its list to view items.') }}</p></div>
              <template v-else>
                <WorkCollectionBrowser v-if="classifiedPage(states[source.key]?.page)" :page="states[source.key]!.page!" :compact="compact" :wide="tabbed">
                  <template #item="{ item, showCollection }">
                    <div class="home-work-row daily-row" :class="{ 'is-completing': completing.has(workItemIdentityKey(item)) }">
                      <button v-if="canComplete(source, item)" type="button" role="checkbox" class="home-complete" :aria-checked="completing.has(workItemIdentityKey(item))" :aria-label="`${copy('完成', 'Complete')} ${item.title}`" :title="copy('标记为已完成', 'Mark as completed')" :disabled="completing.has(workItemIdentityKey(item))" @click="complete(source, item)"><Icon :name="completing.has(workItemIdentityKey(item)) ? 'check' : 'pending'" /></button>
                      <button class="home-work-item daily-row-main" :title="`${item.title} · ${item.id}`" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">
                        <VisualIcon v-if="!canComplete(source, item)" :icon="item.icon" :fallback="workItemTypeIcon(item)" class="home-item-symbol" />
                        <span class="home-work-copy daily-row-copy">
                          <strong class="daily-row-title">{{ item.title }}<Icon v-if="item.important" name="starFilled" class="home-important" /></strong>
                          <span v-if="item.archived || item.status || item.dueDate || item.sourceRef" class="daily-row-meta">
                            <span v-if="showCollection && item.project">{{ item.project.title }}</span>
                            <span v-if="showCollection && !item.project && item.sourceRef && states[source.key]?.page?.collections">{{ states[source.key]?.page?.collections?.find(collection => collection.id === item.sourceRef?.containerId)?.title }}</span>
                            <span v-if="item.type" class="home-type">{{ item.type.title }}</span>
                            <span v-if="item.priority">{{ item.priority.label }}</span>
                            <span v-if="item.archived || item.status" :data-status="item.statusCategory" class="home-status"><Icon :name="workItemStatusIcon(item.statusCategory)" />{{ item.archived ? copy('已归档', 'Archived') : item.statusLabel || item.status }}</span>
                            <time v-if="item.dueDate" :datetime="item.dueDate.dateTime" :title="`${item.dueDate.dateTime} · ${item.dueDate.timeZone}`">{{ copy('截止', 'Due') }} {{ formatWorkItemDueDate(item.dueDate, locale) }}</time>
                          </span>
                        </span>
                        <Icon name="arrowRight" />
                      </button>
                      <UiButton variant="ghost" size="icon" class="home-icon-button" :aria-label="`${copy('准备交接', 'Prepare handoff')} ${item.title}`" @click="emit('prepareHandoff', { source, item })"><Icon name="copy" /></UiButton>
                    </div>
                  </template>
                </WorkCollectionBrowser>
                <div v-else class="daily-list motion-reveal-list">
                  <div v-for="item in visibleItems(source)" :key="workItemIdentityKey(item)" class="home-work-row daily-row" :class="{ 'is-completing': completing.has(workItemIdentityKey(item)) }">
                    <button v-if="canComplete(source, item)" type="button" role="checkbox" class="home-complete" :aria-checked="completing.has(workItemIdentityKey(item))" :aria-label="`${copy('完成', 'Complete')} ${item.title}`" :title="copy('标记为已完成', 'Mark as completed')" :disabled="completing.has(workItemIdentityKey(item))" @click="complete(source, item)"><Icon :name="completing.has(workItemIdentityKey(item)) ? 'check' : 'pending'" /></button>
                    <button class="home-work-item daily-row-main" :title="`${item.title} · ${item.id}`" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">
                      <VisualIcon v-if="!canComplete(source, item)" :icon="item.icon" :fallback="workItemTypeIcon(item)" class="home-item-symbol" />
                      <span class="home-work-copy daily-row-copy">
                        <strong class="daily-row-title">{{ item.title }}</strong>
                        <span v-if="item.archived || item.status || item.dueDate || item.sourceRef" class="daily-row-meta">
                          <span v-if="item.sourceRef && states[source.key]?.page?.collections">{{ states[source.key]?.page?.collections?.find(collection => collection.id === item.sourceRef?.containerId)?.title }}</span>
                          <span v-if="item.priority">{{ item.priority.label }}</span>
                          <span v-if="item.archived || item.status">{{ item.archived ? copy('已归档', 'Archived') : item.statusLabel || item.status }}</span>
                          <time v-if="item.dueDate" :datetime="item.dueDate.dateTime" :title="`${item.dueDate.dateTime} · ${item.dueDate.timeZone}`">{{ copy('截止', 'Due') }} {{ formatWorkItemDueDate(item.dueDate, locale) }}</time>
                        </span>
                      </span>
                      <Icon name="arrowRight" />
                    </button>
                    <UiButton variant="ghost" size="icon" class="home-icon-button" :aria-label="`${copy('准备交接', 'Prepare handoff')} ${item.title}`" @click="emit('prepareHandoff', { source, item })"><Icon name="copy" /></UiButton>
                  </div>
                </div>
                <div v-if="!classifiedPage(states[source.key]?.page) && !visibleItems(source).length && !states[source.key]?.loading" class="daily-empty home-hint"><strong>{{ copy('本次暂无待处理事项', 'No pending work in these results') }}</strong><p class="daily-caption">{{ copy('本次返回的事项中，没有你的未完成事项。', 'No unfinished personal work in these results.') }}</p></div>
              </template>
              <div class="daily-list-footer">
                <div class="home-preview-note daily-caption">
                  <p>{{ copy('已载入', 'Loaded') }} {{ states[source.key]?.page?.items.length }} {{ copy('条', 'items') }} · {{ coverageLabel(source) }}</p>
                  <p v-if="states[source.key]?.fetchedAt">{{ copy('最近更新', 'Updated') }} <time :datetime="states[source.key]?.fetchedAt" :title="states[source.key]?.fetchedAt">{{ formatWorkItemTimestamp(states[source.key]!.fetchedAt!, locale) }}</time></p>
                </div>
                <UiButton v-if="!classifiedPage(states[source.key]?.page) && compact && !states[source.key]?.expanded && states[source.key]?.page?.currentUser?.id && filteredItems(source).length > 5" variant="ghost" size="compact" class="home-text-button" @click="states[source.key]!.expanded = true">{{ copy('显示已载入事项', 'Show loaded items') }}</UiButton>
                <UiButton v-if="states[source.key]?.page?.nextCursor" variant="ghost" size="compact" class="home-text-button" :disabled="states[source.key]?.loading" @click="load(source, true)">{{ copy('加载更多', 'Load more') }}</UiButton>
              </div>
            </template>
          </component>
        </component>
      </component>
    </component>
  </section>
</template>

<style scoped>
.work-items-overview { min-width: 0; container: work-overview / inline-size; }
.home-work-tabs { display: grid; min-width: 0; gap: var(--space-4); }
.home-work-source[hidden], .home-work-list[hidden] { display: none; }
.home-provider-bar, .home-list-switcher { display: flex; align-items: center; gap: 12px; min-width: 0; }
.home-provider-bar > button, .home-list-switcher > button { margin-left: auto; flex: none; }
.home-provider-tabs { min-width: 0; max-width: 100%; overflow-x: auto; }
.home-provider-tabs :deep([role='tab']) { min-height: 34px; gap: 8px; padding-inline: 12px; }
.home-provider-tabs :deep(.visual-icon) { width: 18px; height: 18px; flex-basis: 18px; }
.home-source-progress { display: flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-4); }
.home-source-progress .app-icon, .home-provider-tabs :deep(.home-tab-loading) { flex: none; width: 14px; height: 14px; color: var(--muted); }
.home-provider-tabs :deep(small) { width: auto; padding: 0 5px; font-variant-numeric: tabular-nums; }
.home-provider-tabs :deep(.home-tab-attention) { width: 14px; height: 14px; flex-basis: 14px; color: var(--warning); }
.home-list-switcher { padding: 8px 16px; border-bottom: 1px solid var(--border); }
.home-list-switcher :deep([role='tablist']) { min-width: 0; overflow-x: auto; }
.is-tabbed .home-work-list-grouped { border-top: 0; }
.is-tabbed .home-list-heading { background: transparent; }
.is-tabbed .home-source-copy p { flex-basis: auto; }
.is-tabbed .home-source-copy { column-gap: 12px; }
@media (max-width: 760px), (pointer: coarse) {
  .home-provider-tabs :deep([role='tab']), .home-list-switcher :deep([role='tab']) { min-height: 44px; }
  .home-provider-bar { gap: 4px; }
  .home-provider-tabs :deep([role='tab']) { gap: 5px; padding-inline: 8px; }
}
.home-connected { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--success); }
.home-connected::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentcolor; }
.home-type { padding: 1px 6px; border-radius: 5px; background: var(--surface-subtle); color: var(--text-secondary); }
.home-status { display: inline-flex; align-items: center; gap: 5px; }
.home-status > .app-icon { width: 12px; height: 12px; }
.home-status[data-status='active'] { color: var(--accent); }
.home-status[data-status='testing'], .home-status[data-status='review'] { color: var(--warning); }
.home-status[data-status='releasing'] { color: var(--success); }
.home-source-title { display: flex; align-items: center; gap: 8px; }
.home-source-title > .visual-icon { flex: none; width: 20px; height: 20px; }
.home-item-symbol { flex: none; width: 18px; height: 18px; color: var(--accent); }
.home-complete { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin-left: -5px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-secondary); cursor: pointer; }
.home-complete > .app-icon { width: 18px; height: 18px; }
.home-complete:hover, .home-complete[aria-checked='true'] { color: var(--accent); }
.home-complete:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.home-complete:disabled { cursor: progress; }
.is-completing .daily-row-title { color: var(--text-secondary); text-decoration: line-through; }
.home-completion { background: var(--surface-subtle); font-size: var(--font-size-control); }
.home-completion > span { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; overflow-wrap: anywhere; }
.home-completion .app-icon { flex: none; width: 16px; height: 16px; color: var(--success); }
@media (max-width: 760px), (pointer: coarse) {
  .home-complete { width: 44px; height: 44px; margin-left: -13px; }
}
.home-important { display: inline-block; width: 14px; height: 14px; margin-left: var(--space-2); color: var(--warning); vertical-align: middle; }
.home-source-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.home-group-heading strong { font-weight: 600; }
.home-work-list-grouped { border-top: 1px solid var(--border); }
.home-work-list-grouped .home-list-heading { background: var(--surface-subtle); }
.home-work-list { min-width: 0; }
.home-source-copy { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; min-width: 0; }
.home-source-copy p { display: block; flex-basis: 100%; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-connected { flex: none; }
.home-source-actions { display: flex; flex: none; align-items: center; gap: var(--space-1); }
.home-source-heading strong { font-size: var(--font-size-body); }
.home-work-source { min-width: 0; }
.home-work-item { display: flex; align-items: center; flex: 1; align-self: stretch; min-width: 0; gap: var(--space-3); border: 0; padding: 0; color: var(--text); background: transparent; text-align: left; cursor: pointer; }
.home-work-item > .app-icon { flex: none; width: 16px; height: 16px; color: var(--text-secondary); }
.home-work-copy { flex: 1; }
.home-work-item:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--control-radius); }
.home-section-heading > .home-icon-button { margin-left: auto; }
.home-source-notice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); padding: var(--space-3) var(--space-4); }
.home-source-notice > .app-icon { flex: none; width: 16px; height: 16px; }
.home-connection { background: var(--surface-subtle); font-size: var(--font-size-control); }
.home-connection > div, .home-source-notice > div:first-child { min-width: 0; overflow-wrap: anywhere; }
.home-connection strong { color: var(--text); font-weight: 500; }
.home-connection > button { flex: none; }
.home-error { color: var(--danger); font-size: var(--font-size-control); }
.home-error strong { font-weight: 500; }
.home-preview-note p, .home-source-notice p, .home-empty p { margin: 0; }
.home-preview-note { display: flex; flex-wrap: wrap; gap: 2px 12px; }
</style>
