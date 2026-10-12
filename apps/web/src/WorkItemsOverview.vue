<script setup lang="ts">
import type { IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { personalActiveWork, workItemIdentityKey } from 'craft-hub/work-items'
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { homeWorkSources } from './personal-workbench'
import { useWorkbenchStore } from './store'
import { mergeIntegrationEntityPages } from './work-item-pagination'
import { formatWorkItemDueDate, formatWorkItemTimestamp } from './work-item-presentation'

const props = withDefaults(defineProps<{ compact?: boolean, integrations?: string[], refreshKey?: number }>(), { compact: false, refreshKey: 0 })
const emit = defineEmits<{
  prepareHandoff: [work: { source: HomeWorkSource, item: IntegrationEntity }]
  openIntegration: [integrationId: string, viewId: string, scope: 'global']
  openMarketplace: []
}>()
const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const sources = computed(() => homeWorkSources(store.integrationContributions, locale.value).filter(source => !props.integrations || props.integrations.includes(source.integrationId)))
interface SourceState { page?: IntegrationEntityPage, loading: boolean, error?: string, fetchedAt?: string, cursors: string[], expanded?: boolean, retryMore?: boolean }
const states = ref<Record<string, SourceState>>({})
const loading = computed(() => Object.values(states.value).some(state => state.loading))
let generation = 0

async function load(source: HomeWorkSource, more = false): Promise<void> {
  const state = states.value[source.key]
  if (!state || state.loading)
    return
  const requestGeneration = generation
  const cursor = more ? state.page?.nextCursor : undefined
  if (more && !cursor)
    return
  state.loading = true
  state.retryMore = more
  state.error = undefined
  try {
    const page = await api.invokeIntegrationAction<IntegrationEntityPage>(source.integrationId, source.actionId, { ...source.input, ...(cursor ? { cursor } : {}) })
    if (generation !== requestGeneration || states.value[source.key] !== state)
      return
    if (cursor && state.page) {
      const merged = mergeIntegrationEntityPages(state.page, page)
      state.page = merged.page
      if (merged.identityChanged) {
        state.cursors = []
        state.error = copy('来源账号已变化，已清除旧账号的分页结果。', 'Source account changed; previous account results were cleared.')
      }
      else { state.cursors.push(cursor) }
    }
    else {
      state.page = page
      state.cursors = []
    }
    if (state.page.nextCursor && state.cursors.includes(state.page.nextCursor)) {
      state.page = { ...state.page, nextCursor: undefined, coverage: 'partial' }
      state.retryMore = false
      state.error = copy('来源返回了重复的分页游标，请刷新或进入来源查看。', 'The source returned a repeated cursor. Refresh or open the source.')
    }
    state.fetchedAt = page.fetchedAt ?? new Date().toISOString()
    if (more)
      state.expanded = true
  }
  catch {
    if (generation === requestGeneration && states.value[source.key] === state)
      state.error = copy('无法读取工作事项，请在集成中检查连接。', 'Could not load work items. Check the connection in this integration.')
  }
  finally {
    if (generation === requestGeneration && states.value[source.key] === state)
      state.loading = false
  }
}

async function refresh(): Promise<void> {
  generation++
  states.value = Object.fromEntries(sources.value.map(source => [source.key, { ...states.value[source.key], loading: false, cursors: [] }]))
  await Promise.allSettled(sources.value.map(source => load(source)))
}
watch([sources, () => props.refreshKey], () => {
  generation++
  states.value = Object.fromEntries(sources.value.map(source => [source.key, { ...states.value[source.key], loading: false, cursors: [] }]))
  void Promise.allSettled(sources.value.map(source => load(source)))
}, { immediate: true })
function visibleItems(source: HomeWorkSource): IntegrationEntity[] {
  const state = states.value[source.key]
  const items = state?.page ? personalActiveWork(state.page) : []
  return props.compact && !state?.expanded ? items.slice(0, 5) : items
}
function coverageLabel(source: HomeWorkSource): string {
  const state = states.value[source.key]
  const page = state?.page
  if (page?.nextCursor)
    return copy('还有更多', 'More available')
  if (page?.coverage === 'partial' || (page && props.compact && !state?.expanded && personalActiveWork(page).length > 5))
    return copy('部分预览', 'Partial preview')
  return page?.coverage === 'complete' ? copy('已完整载入', 'Complete') : copy('范围未确认', 'Coverage unconfirmed')
}
onUnmounted(() => { generation++ })
</script>

<template>
  <section class="home-work work-items-overview daily-section">
    <div v-if="compact" class="home-section-heading daily-section-heading">
      <h2>{{ copy('我的工作', 'My work') }}</h2>
      <UiButton v-if="sources.length" variant="ghost" size="icon" class="home-icon-button" :disabled="loading" :aria-label="copy('刷新我的工作', 'Refresh my work')" @click="refresh"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton>
    </div>
    <div v-if="['idle', 'loading'].includes(store.integrationsLoadState) && !sources.length" class="daily-surface daily-empty home-hint" role="status">
      <Icon name="loading" /><strong>{{ copy('正在读取工作来源…', 'Loading work sources…') }}</strong>
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
    <section v-for="source in sources" :key="source.key" class="home-work-source daily-surface">
      <div class="home-source-heading">
        <div class="home-source-copy">
          <strong>{{ source.title }}</strong>
          <p v-if="states[source.key]?.page?.currentUser?.id" class="home-preview-note daily-caption" :title="states[source.key]?.page?.currentUser?.id">{{ states[source.key]?.page?.currentUser?.label || copy('个人事项', 'Personal work') }}</p>
        </div>
        <div class="home-source-actions">
          <UiButton variant="ghost" size="compact" class="home-text-button" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">{{ copy('查看全部', 'View all') }}<Icon name="arrowRight" /></UiButton>
          <UiButton v-if="!compact" variant="ghost" size="icon" class="home-icon-button" :disabled="states[source.key]?.loading" :aria-label="`${copy('刷新', 'Refresh')} ${source.title}`" @click="load(source)"><Icon :name="states[source.key]?.loading ? 'loading' : 'refresh'" /></UiButton>
        </div>
      </div>
      <div v-if="states[source.key]?.loading" class="home-source-notice home-hint daily-caption" role="status"><Icon name="loading" />{{ copy('正在读取…', 'Loading…') }}</div>
      <div v-if="states[source.key]?.error" class="home-source-notice home-error" role="alert">
        <div><strong>{{ states[source.key]?.error }}</strong><p v-if="states[source.key]?.page" class="daily-caption">{{ copy('保留上次结果，可能已过期。', 'Previous results may be stale.') }}</p></div>
        <UiButton variant="secondary" size="compact" class="home-text-button" :disabled="states[source.key]?.loading" @click="load(source, states[source.key]?.retryMore)">{{ copy('重试', 'Retry') }}</UiButton>
      </div>
      <template v-if="states[source.key]?.page">
        <div v-if="!states[source.key]?.page?.currentUser?.id" class="daily-empty home-hint"><strong>{{ copy('账号身份待确认', 'Account identity unavailable') }}</strong><p class="daily-caption">{{ copy('此来源尚未提供当前账号身份，请进入列表查看。', 'This source has not provided your account identity. Open its list to view items.') }}</p></div>
        <template v-else>
          <div class="daily-list">
            <div v-for="item in visibleItems(source)" :key="workItemIdentityKey(item)" class="home-work-row daily-row">
              <button class="home-work-item daily-row-main" :title="`${item.title} · ${item.id}`" @click="emit('openIntegration', source.integrationId, source.viewId, 'global')">
                <Icon name="list" />
                <span class="home-work-copy daily-row-copy">
                  <strong class="daily-row-title">{{ item.title }}</strong>
                  <span v-if="item.archived || item.status || item.dueDate" class="daily-row-meta">
                    <span v-if="item.archived || item.status">{{ item.archived ? copy('已归档', 'Archived') : item.statusLabel || item.status }}</span>
                    <time v-if="item.dueDate" :datetime="item.dueDate.dateTime" :title="`${item.dueDate.dateTime} · ${item.dueDate.timeZone}`">{{ copy('截止', 'Due') }} {{ formatWorkItemDueDate(item.dueDate, locale) }}</time>
                  </span>
                </span>
                <Icon name="arrowRight" />
              </button>
              <UiButton variant="ghost" size="icon" class="home-icon-button" :aria-label="`${copy('准备交接', 'Prepare handoff')} ${item.title}`" @click="emit('prepareHandoff', { source, item })"><Icon name="copy" /></UiButton>
            </div>
          </div>
          <div v-if="!visibleItems(source).length && !states[source.key]?.loading" class="daily-empty home-hint"><strong>{{ copy('本次暂无待处理事项', 'No pending work in these results') }}</strong><p class="daily-caption">{{ copy('本次返回的事项中，没有你的未完成事项。', 'No unfinished personal work in these results.') }}</p></div>
        </template>
        <div class="daily-list-footer">
          <div class="home-preview-note daily-caption">
            <p>{{ copy('已载入', 'Loaded') }} {{ states[source.key]?.page?.items.length }} {{ copy('条', 'items') }} · {{ coverageLabel(source) }}</p>
            <p v-if="states[source.key]?.fetchedAt">{{ copy('最近更新', 'Updated') }} <time :datetime="states[source.key]?.fetchedAt" :title="states[source.key]?.fetchedAt">{{ formatWorkItemTimestamp(states[source.key]!.fetchedAt!, locale) }}</time></p>
          </div>
          <UiButton v-if="compact && !states[source.key]?.expanded && states[source.key]?.page?.currentUser?.id && personalActiveWork(states[source.key]!.page!).length > 5" variant="ghost" size="compact" class="home-text-button" @click="states[source.key]!.expanded = true">{{ copy('显示已载入事项', 'Show loaded items') }}</UiButton>
          <UiButton v-if="states[source.key]?.page?.nextCursor" variant="ghost" size="compact" class="home-text-button" :disabled="states[source.key]?.loading" @click="load(source, true)">{{ copy('加载更多', 'Load more') }}</UiButton>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.work-items-overview { min-width: 0; }
.home-source-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
.home-source-copy { display: grid; gap: var(--space-1); min-width: 0; overflow-wrap: anywhere; }
.home-source-copy p { margin: 0; }
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
.home-error { color: var(--danger); font-size: var(--font-size-control); }
.home-error strong { font-weight: 500; }
.home-preview-note p, .home-source-notice p, .home-empty p { margin: 0; }
.home-preview-note { display: grid; gap: var(--space-1); }
</style>
