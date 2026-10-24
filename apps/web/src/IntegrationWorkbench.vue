<script setup lang="ts">
import type { ConfigurationManagementPage, IntegrationActionResult, IntegrationConnectionStatus, IntegrationEntityPage } from 'craft-hub'
import type { WorkbenchIntegrationView } from './store'
import { workItemIdentityKey } from 'craft-hub/work-items'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { api } from './api'
import { FormSelect } from './components/ui/select'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import Icon from './NavigationIcon.vue'
import ConfigurationManager from './ConfigurationManager.vue'
import { useI18n } from './i18n'
import IntegrationResourceBrowser from './IntegrationResourceBrowser.vue'
import IntegrationActionForm from './IntegrationActionForm.vue'
import IntegrationConnectionSetup from './IntegrationConnectionSetup.vue'
import MicrosoftTodoOpenButton from './MicrosoftTodoOpenButton.vue'
import IntegrationEntityList from './IntegrationEntityList.vue'
import { useWorkbenchStore } from './store'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'
import { mergeIntegrationEntityPages } from './work-item-pagination'

const props = withDefaults(defineProps<{ embedded?: boolean, integrationId: string, viewId: string, initialScope?: 'global', initialProjectId?: string }>(), { embedded: false })
const store = useWorkbenchStore()
const { t, locale } = useI18n()

type ListFilters = { query: string, status: string, assignee: string }

interface BlockState {
  filters?: ListFilters
  filterAccount?: string
  loading: boolean
  error: string
  result?: IntegrationActionResult
  input: Record<string, unknown>
  requestId: number
  stale: boolean
  fetchedAt?: string
  failedCursor?: string
  seenCursors: Set<string>
}

const states = reactive<Record<string, BlockState>>({})
const searches = ref<Record<string, string>>({})
let contextGeneration = 0
const filterTimers = new Map<string, ReturnType<typeof setTimeout>>()
const now = ref(Date.now())
let connectionTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  connectionTimer = setInterval(() => {
    now.value = Date.now()
    const due = view.value?.blocks.find(block => {
      const status = connectionStatus(states[block.id]?.result)
      const expires = Date.parse(status?.session?.expiresAt ?? '')
      return status?.connected && Number.isFinite(expires) && expires - now.value <= 5 * 60_000
    })
    if (due)
      void refresh()
  }, 60_000)
})
onBeforeUnmount(() => {
  contextGeneration++
  clearInterval(connectionTimer)
  for (const timer of filterTimers.values()) clearTimeout(timer)
})
const inspectedProjectId = ref('')
watch([() => props.initialScope, () => props.initialProjectId, () => store.selectedProjectId, () => store.projects], ([scope, explicitProjectId, projectId]) => {
  inspectedProjectId.value = scope === 'global' ? '' : explicitProjectId !== undefined
    ? explicitProjectId
    : projectId || ''
}, { immediate: true })
const view = computed(() => store.integrationViews.find(candidate => candidate.integrationId === props.integrationId && candidate.id === props.viewId))
const contribution = computed(() => store.integrationContributions.find(candidate => candidate.id === props.integrationId))
const scopeSelection = computed({
  get: () => inspectedProjectId.value || 'global',
  set: (value: string) => { inspectedProjectId.value = value === 'global' ? '' : value },
})
const scopeOptions = computed(() => [
  { value: 'global', label: t('integrationGlobalScope') },
  ...store.projects.map(project => ({ value: project.id, label: project.name, icon: 'folder' })),
])
const requiresProject = computed(() => view.value?.scope === 'project')
const projectUnavailable = computed(() => Boolean(props.initialProjectId !== undefined && inspectedProjectId.value && !store.projects.some(project => project.id === inspectedProjectId.value)))
const diagnostics = computed(() => store.integrationDiagnostics.filter(diagnostic => diagnostic.integrationId === props.integrationId))

function stateFor(blockId: string): BlockState {
  if (!states[blockId])
    states[blockId] = { loading: false, error: '', input: {}, requestId: 0, stale: false, seenCursors: new Set() }
  return states[blockId]!
}

function actionTitle(block: WorkbenchIntegrationView['blocks'][number]): string {
  return translate(block.title ?? contribution.value?.actions.find(action => action.id === block.actionId)?.title ?? block.id)
}

function blockNeedsProject(block: WorkbenchIntegrationView['blocks'][number]): boolean {
  return Boolean(block.requiresProject && (view.value?.scope === 'global' || !inspectedProjectId.value))
}

function translate(value: string): string {
  return contribution.value?.translations?.[locale.value]?.[value] ?? value
}

function connectionStatus(result: IntegrationActionResult | undefined): IntegrationConnectionStatus | undefined {
  return result && 'connected' in result ? result : undefined
}

function currentSession(): IntegrationConnectionStatus['session'] {
  for (const block of view.value?.blocks ?? []) {
    const session = connectionStatus(states[block.id]?.result)?.session
    if (session) return session
  }
}

function listReadOnly(blockId: string): boolean {
  return Boolean(stateFor(blockId).stale || entityPage(stateFor(blockId).result)?.cache?.readOnly
    || view.value?.blocks.some(block => connectionStatus(states[block.id]?.result)?.connected === false))
}

function sessionHint(status: IntegrationConnectionStatus): string {
  const session = status.session
  if (!session) return ''
  if (session.expiresAt && Date.parse(session.expiresAt) <= now.value)
    return copy('授权已到期 · 请重新连接', 'Authorization expired · reconnect')
  if (session.renewal === 'failed')
    return copy('自动续期失败 · 将重试', 'Automatic renewal failed · will retry')
  if (session.renewal === 'automatic')
    return copy('自动续期已启用', 'Automatic renewal enabled')
  return copy('自动续期未启用', 'Automatic renewal unavailable')
}

async function restoreFilters(block: WorkbenchIntegrationView['blocks'][number]): Promise<void> {
  const accountKey = currentSession()?.cacheKey
  if (!accountKey || !['entity-list', 'entity-search'].includes(block.type)) return
  const state = stateFor(block.id)
  if (state.filterAccount === accountKey) return
  const generation = contextGeneration
  try {
    const result = await api.integrationViewFilters(props.integrationId, { viewId: props.viewId, blockId: block.id, projectId: inspectedProjectId.value || undefined, accountKey })
    if (generation === contextGeneration && currentSession()?.cacheKey === accountKey) {
      state.filters = result.filters ?? undefined
      state.filterAccount = accountKey
    }
  }
  catch { /* Local preferences must not block remote reads. */ }
}

function saveFilters(blockId: string, filters: ListFilters): void {
  const state = stateFor(blockId)
  const accountKey = currentSession()?.cacheKey
  if (!accountKey || state.filterAccount !== accountKey || JSON.stringify(state.filters) === JSON.stringify(filters)) return
  state.filters = filters
  clearTimeout(filterTimers.get(blockId))
  const integrationId = props.integrationId
  const options = { viewId: props.viewId, blockId, projectId: inspectedProjectId.value || undefined, accountKey, filters }
  filterTimers.set(blockId, setTimeout(() => {
    void api.integrationViewFilters(integrationId, options).catch(() => {})
    filterTimers.delete(blockId)
  }, 250))
}

function entityPage(result: IntegrationActionResult | undefined): IntegrationEntityPage | undefined {
  return result && 'items' in result && !('configuration' in result) ? result : result && 'id' in result && 'title' in result ? { items: [result] } : undefined
}

function configurationPage(result: IntegrationActionResult | undefined): ConfigurationManagementPage | undefined {
  return result && 'configuration' in result ? result : undefined
}

function statusActionsFor(block: WorkbenchIntegrationView['blocks'][number]): {
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
} | undefined {
  const currentContribution = contribution.value
  if (!currentContribution || listReadOnly(block.id))
    return undefined
  const blockAction = currentContribution.actions.find(action => action.id === block.actionId)
  if (!blockAction || !['work-items.get', 'work-items.list', 'work-items.search'].includes(blockAction.operation))
    return undefined
  const transitions = currentContribution.actions.find(action => action.operation === 'work-items.transitions')
  const update = currentContribution.actions.find(action => action.operation === 'work-items.update-status')
  if (!transitions || !update)
    return undefined
  return {
    integrationId: currentContribution.id,
    projectId: view.value?.scope === 'global' ? undefined : inspectedProjectId.value || undefined,
    transitionsActionId: transitions.id,
    updateActionId: update.id,
  }
}

function workItemActionsFor(block: WorkbenchIntegrationView['blocks'][number]) {
  const current = contribution.value
  if (listReadOnly(block.id) || !current?.actions.some(action => action.id === block.actionId && ['work-items.list', 'work-items.search'].includes(action.operation)))
    return undefined
  return {
    integrationId: current.id,
    projectId: view.value?.scope === 'global' ? undefined : inspectedProjectId.value || undefined,
    detailActionId: current.actions.find(action => action.operation === 'work-items.get')?.id,
  }
}

function applyEntityUpdate(blockId: string, entity: IntegrationEntityPage['items'][number]): void {
  const page = entityPage(stateFor(blockId).result)
  if (page)
    page.items = page.items.map(item => workItemIdentityKey(item) === workItemIdentityKey(entity) ? entity : item)
}

function copy(zh: string, en: string): string {
  return locale.value === 'zh-CN' ? zh : en
}

function pageProgress(blockId: string): string {
  const state = stateFor(blockId)
  const page = entityPage(state.result)
  if (!page)
    return ''
  const progress = page.nextCursor || page.coverage === 'partial'
    ? copy('已加载部分事项', 'Partially loaded')
    : page.coverage === 'complete' ? copy('已加载全部事项', 'Fully loaded') : copy('已加载事项，总范围未知', 'Loaded items; total coverage unknown')
  const reason = page.cache?.reason
  return page.cache ? `${progress} · ${reason === 'preview' ? copy('本机缓存 · 正在更新', 'Local cache · updating') : reason === 'authorization' ? copy('本机缓存 · 授权已到期 · 只读', 'Local cache · authorization expired · read-only') : copy('本机缓存 · 读取失败 · 只读', 'Local cache · source unavailable · read-only')}` : state.stale ? `${progress} · ${copy('内容已过期 · 只读', 'Content is stale · read-only')}` : progress
}

function readBlock(block: WorkbenchIntegrationView['blocks'][number]): boolean {
  const action = contribution.value?.actions.find(action => action.id === block.actionId)
  return Boolean(action && ['local-read', 'remote-read'].includes(action.effect) && action.effectiveConfirmation === 'never')
}

function needsConnection(block: WorkbenchIntegrationView['blocks'][number]): boolean {
  const action = contribution.value?.actions.find(action => action.id === block.actionId)
  return Boolean(!currentSession()?.cacheReads && action?.effect === 'remote-read' && action.operation.startsWith('work-items.') && view.value?.blocks.some(candidate => candidate.type === 'connection-status' && connectionStatus(states[candidate.id]?.result)?.connected === false))
}

async function invoke(block: WorkbenchIntegrationView['blocks'][number], extraInput?: Record<string, unknown>, append = false): Promise<void> {
  const currentView = view.value
  if (!currentView || projectUnavailable.value || !readBlock(block) || blockNeedsProject(block))
    return
  const state = stateFor(block.id)
  if (needsConnection(block)) {
    state.requestId++
    state.result = undefined
    state.fetchedAt = undefined
    state.loading = false
    state.error = ''
    return
  }
  const cursor = append ? entityPage(state.result)?.nextCursor : undefined
  if (append && (!cursor || state.loading))
    return
  const integrationId = props.integrationId
  const generation = contextGeneration
  const requestId = ++state.requestId
  const current = (): boolean => generation === contextGeneration && states[block.id] === state && state.requestId === requestId
  const input = extraInput ?? state.input
  if (!append && JSON.stringify(state.input) !== JSON.stringify(input)) {
    state.result = undefined
    state.fetchedAt = undefined
    state.stale = false
  }
  state.input = input
  if (!append)
    state.seenCursors.clear()
  state.loading = true
  state.error = ''
  state.failedCursor = undefined
  try {
    const projectId = currentView.scope === 'global' ? undefined : inspectedProjectId.value || undefined
    if (currentView.scope === 'project' && !projectId)
      throw new Error(t('integrationProjectRequired'))
    const callInput = { ...(block.input ?? {}), ...input, ...(cursor ? { cursor } : {}), ...(contribution.value?.translations || contribution.value?.actions.find(action => action.id === block.actionId)?.operation === 'configuration.list' ? { locale: locale.value } : {}) }
    if (!state.result && (block.previewInput || (currentSession()?.cacheReads && block.type === 'entity-list'))) {
      try {
        const preview = await api.invokeIntegrationAction(integrationId, block.actionId, { ...callInput, ...(block.previewInput ?? { cacheOnly: true }) }, projectId)
        if (!current())
          return
        if (!('items' in preview) || preview.items.length) {
          state.result = preview
          state.fetchedAt = entityPage(preview)?.fetchedAt
        }
      }
      catch {
        // The complete read remains authoritative when an optional preview fails.
      }
    }
    if (!current())
      return
    const result = await api.invokeIntegrationAction(
      integrationId,
      block.actionId,
      callInput,
      projectId,
    )
    if (!current())
      return
    const previousPage = entityPage(state.result)
    const nextPage = entityPage(result)
    let identityChanged = false
    if (append && previousPage && nextPage) {
      const merged = mergeIntegrationEntityPages(previousPage, nextPage)
      state.result = merged.page
      identityChanged = merged.identityChanged
      if (merged.identityChanged)
        state.seenCursors.clear()
    }
    else {
      state.result = result
    }
    state.fetchedAt = nextPage?.fetchedAt ?? new Date().toISOString()
    state.stale = Boolean(nextPage?.cache)
    if (cursor && !identityChanged)
      state.seenCursors.add(cursor)
    const loadedPage = entityPage(state.result)
    if (loadedPage?.nextCursor && state.seenCursors.has(loadedPage.nextCursor)) {
      loadedPage.nextCursor = undefined
      loadedPage.coverage = 'partial'
      state.error = copy('来源重复返回分页游标，已停止加载。请刷新后重试。', 'The source repeated a pagination cursor. Loading stopped; refresh to retry.')
    }
  }
  catch (caught) {
    if (!current())
      return
    state.stale = Boolean(state.result)
    state.failedCursor = cursor
    state.error = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (current())
      state.loading = false
  }
}

async function loadMore(block: WorkbenchIntegrationView['blocks'][number]): Promise<void> {
  await invoke(block, undefined, true)
}

async function retry(block: WorkbenchIntegrationView['blocks'][number]): Promise<void> {
  await invoke(block, undefined, Boolean(stateFor(block.id).failedCursor))
}

async function search(block: WorkbenchIntegrationView['blocks'][number]): Promise<void> {
  await invoke(block, { keyword: searches.value[block.id]?.trim() ?? '' })
}

async function loadBlocks(includeConfiguration = false): Promise<void> {
  const currentView = view.value
  if (!currentView)
    return
  const generation = contextGeneration
  const previousAccount = currentSession()?.cacheKey
  await Promise.all(currentView.blocks
    .filter(block => block.type === 'connection-status')
    .map(block => invoke(block)))
  if (generation !== contextGeneration || currentView !== view.value)
    return
  if (previousAccount && previousAccount !== currentSession()?.cacheKey) {
    for (const block of currentView.blocks.filter(block => block.type !== 'connection-status'))
      delete states[block.id]
  }
  await Promise.all(currentView.blocks.map(block => restoreFilters(block)))
  if (generation !== contextGeneration) return
  await Promise.all(currentView.blocks
    .filter(block => block.type === 'entity-list' || (includeConfiguration && block.type === 'configuration-manager'))
    .map(block => invoke(block)))
}

async function refresh(): Promise<void> {
  await loadBlocks()
}

watch(
  [() => props.integrationId, () => view.value?.id, () => view.value?.scope, () => inspectedProjectId.value, () => locale.value, () => JSON.stringify(view.value?.blocks.map(block => [block.id, block.actionId, block.input]))],
  async () => {
    contextGeneration++
    for (const timer of filterTimers.values()) clearTimeout(timer)
    filterTimers.clear()
    for (const key of Object.keys(states))
      delete states[key]
    await loadBlocks(true)
  },
  { immediate: true },
)
defineExpose({ refresh: refresh })
</script>

<template>
  <component :is="embedded || !view ? 'div' : WorkbenchViewFrame" class="integration-workbench workbench-view" :class="{ embedded }" v-bind="!embedded && view ? { title: translate(view.title), icon: view.icon } : {}">
    <template v-if="!embedded && view && contribution?.provider.id === 'microsoft-todo'" #actions>
      <MicrosoftTodoOpenButton />
    </template>
    <section v-if="view" class="integration-content">
      <label v-if="view.scope === 'global-and-project'" class="integration-scope">
        <span>{{ t('integrationScope') }}</span>
        <FormSelect v-model="scopeSelection" :options="scopeOptions" :aria-label="t('integrationScope')" />
      </label>

      <aside v-if="diagnostics.length" class="integration-diagnostics" role="alert">
        <Icon name="error" />
        <div>
          <strong>{{ t('integrationNeedsAttention') }}</strong>
          <p v-for="diagnostic in diagnostics" :key="diagnostic.message">{{ diagnostic.message }}</p>
        </div>
      </aside>

      <section v-if="projectUnavailable || (requiresProject && !inspectedProjectId)" class="integration-empty">
        <Icon name="folderOpen" />
        <h2>{{ t('integrationChooseProject') }}</h2>
        <p>{{ t('integrationProjectRequired') }}</p>
      </section>

      <div v-else class="integration-blocks">
        <component :is="block.collapsible ? 'details' : 'article'" v-for="block in view.blocks" :key="block.id" class="integration-block" :class="{ 'integration-block-collapsible': block.collapsible }" :data-testid="`integration-block-${block.id}`">
          <component :is="block.collapsible ? 'summary' : 'header'" v-if="!['resource-browser', 'configuration-manager'].includes(block.type)" class="integration-block-heading">
            <Icon v-if="block.collapsible" class="integration-block-chevron" name="arrowRight" />
            <div>
              <h2>{{ actionTitle(block) }}</h2>
              <p v-if="block.description">{{ translate(block.description) }}</p>
            </div>
            <UiButton v-if="block.type !== 'entity-search' && block.type !== 'action-form'" size="compact" :disabled="stateFor(block.id).loading" @click="block.type === 'connection-status' ? refresh() : invoke(block)">
              <Icon :name="stateFor(block.id).loading ? 'loading' : 'refresh'" />
              {{ t('refresh') }}
            </UiButton>
          </component>

          <p v-if="blockNeedsProject(block)" class="integration-empty-copy">{{ t('integrationProjectRequired') }}</p>
          <p v-if="needsConnection(block)" class="integration-empty-copy" role="status">{{ copy('请先连接账号，完成后会自动读取事项。', 'Connect your account first. Items will load when authorization completes.') }}</p>

          <IntegrationResourceBrowser
            v-if="block.type === 'resource-browser' && contribution"
            :integration-id="integrationId" :contribution="contribution" :input="block.input"
            :project-id="view.scope === 'global' ? undefined : inspectedProjectId || undefined"
          />
          <IntegrationActionForm
            v-if="block.type === 'action-form' && contribution && !blockNeedsProject(block)"
            :key="`${integrationId}:${inspectedProjectId}:${locale}:${block.id}`"
            :integration-id="integrationId" :block="block"
            :action="contribution.actions.find(action => action.id === block.actionId)!"
            :project-id="view.scope === 'global' ? undefined : inspectedProjectId || undefined"
            :project-title="store.projects.find(project => project.id === inspectedProjectId)?.name"
            :translate="translate" @completed="stateFor(block.id).result = $event"
          />

          <form v-if="block.type === 'entity-search'" class="integration-search" @submit.prevent="search(block)">
            <Icon name="search" />
            <input v-model="searches[block.id]" type="search" :placeholder="t('integrationSearchPlaceholder')" :aria-label="actionTitle(block)">
            <UiButton type="submit" size="compact" :disabled="stateFor(block.id).loading">
              <Icon v-if="stateFor(block.id).loading" name="loading" />
              {{ t('search') }}
            </UiButton>
          </form>

          <p v-if="stateFor(block.id).error" class="integration-error" role="alert">{{ translate(stateFor(block.id).error) }}</p>

          <p v-if="entityPage(stateFor(block.id).result) && (stateFor(block.id).stale || entityPage(stateFor(block.id).result)?.cache)" class="integration-cache-notice" role="status">
            {{ pageProgress(block.id) }}
            <time v-if="stateFor(block.id).fetchedAt" :datetime="stateFor(block.id).fetchedAt">{{ copy('最近成功读取', 'Last successful read') }}: {{ new Date(stateFor(block.id).fetchedAt!).toLocaleString(locale) }}</time>
          </p>

          <div v-if="connectionStatus(stateFor(block.id).result)" class="integration-connection" :class="{ connected: connectionStatus(stateFor(block.id).result)?.connected }">
            <span class="integration-connection-mark"><Icon :name="connectionStatus(stateFor(block.id).result)?.connected ? 'check' : 'link'" /></span>
            <div class="integration-connection-body">
              <div class="integration-connection-title">
                <strong>{{ connectionStatus(stateFor(block.id).result)?.session?.expiresAt && Date.parse(connectionStatus(stateFor(block.id).result)!.session!.expiresAt!) <= now ? copy('授权已到期', 'Authorization expired') : connectionStatus(stateFor(block.id).result)?.connected ? t('integrationConnected') : t('integrationDisconnected') }}</strong>
                <Badge v-if="connectionStatus(stateFor(block.id).result)?.accountLabel" :variant="connectionStatus(stateFor(block.id).result)?.connected ? 'success' : 'secondary'">{{ connectionStatus(stateFor(block.id).result)?.accountLabel }}</Badge>
              </div>
              <p v-if="connectionStatus(stateFor(block.id).result)?.message">{{ translate(connectionStatus(stateFor(block.id).result)?.message ?? '') }}</p>
            </div>
          </div>

          <ConfigurationManager
            v-if="configurationPage(stateFor(block.id).result) && contribution"
            :page="configurationPage(stateFor(block.id).result)!"
            :contribution="contribution"
            :project-id="view.scope === 'global' ? undefined : inspectedProjectId || undefined"
            @updated="stateFor(block.id).result = $event"
          />

          <p v-if="connectionStatus(stateFor(block.id).result)?.session" class="integration-session" role="status">
            <span>{{ sessionHint(connectionStatus(stateFor(block.id).result)!) }}</span>
            <time v-if="connectionStatus(stateFor(block.id).result)?.session?.expiresAt" :datetime="connectionStatus(stateFor(block.id).result)?.session?.expiresAt">{{ copy('访问凭据到期', 'Access expires') }}: {{ new Date(connectionStatus(stateFor(block.id).result)!.session!.expiresAt!).toLocaleString(locale) }}</time>
            <time v-if="connectionStatus(stateFor(block.id).result)?.session?.renewalExpiresAt" :datetime="connectionStatus(stateFor(block.id).result)?.session?.renewalExpiresAt">{{ copy('续期授权到期', 'Renewal expires') }}: {{ new Date(connectionStatus(stateFor(block.id).result)!.session!.renewalExpiresAt!).toLocaleString(locale) }}</time>
          </p>

          <IntegrationConnectionSetup
            v-if="connectionStatus(stateFor(block.id).result)"
            :key="`${integrationId}:${viewId}:${inspectedProjectId}:${locale}:${currentSession()?.cacheKey ?? ''}`"
            :status="connectionStatus(stateFor(block.id).result)!"
            :integration-id="integrationId"
            :action-id="contribution?.actions.find(action => action.operation === 'connection.update')?.id"
            :project-id="view.scope === 'global' ? undefined : inspectedProjectId || undefined"
            :translate="translate" @updated="refresh"
          />

          <IntegrationEntityList
            v-else-if="entityPage(stateFor(block.id).result)"
            :read-only="listReadOnly(block.id)"
            :filter-state="stateFor(block.id).filters"
            @filters-changed="saveFilters(block.id, $event)"
            :items="entityPage(stateFor(block.id).result)!.items"
            :status-filter="block.statusFilter"
            :assignee-filter="block.assigneeFilter"
            :current-user="entityPage(stateFor(block.id).result)!.currentUser"
            :status-actions="statusActionsFor(block)"
            :work-item-actions="workItemActionsFor(block)"
            :key="`${integrationId}:${viewId}:${inspectedProjectId}:${locale}:${currentSession()?.cacheKey ?? ''}`"
            :loading="stateFor(block.id).loading"
            :configuration-action-id="contribution?.actions.find(action => action.operation === 'configuration.list' && action.id === block.actionId) ? contribution.actions.find(action => action.operation === 'configuration.update')?.id : undefined"
            @configuration-updated="stateFor(block.id).result = $event"
            :source-context="{ integrationId, actionId: block.actionId, projectId: view.scope === 'global' ? undefined : inspectedProjectId || undefined }"
            @updated="applyEntityUpdate(block.id, $event)"
          />

          <p v-else-if="stateFor(block.id).loading" class="integration-loading"><Icon name="loading" /> {{ t('loading') }}</p>

          <footer v-if="entityPage(stateFor(block.id).result) && ['entity-list', 'entity-search'].includes(block.type)" class="integration-page-progress" :data-testid="`integration-pagination-${block.id}`">
            <div role="status" aria-live="polite">
              <span>{{ pageProgress(block.id) }}</span>
              <time v-if="stateFor(block.id).fetchedAt" :datetime="stateFor(block.id).fetchedAt">{{ copy('最近成功读取', 'Last successful read') }}: {{ new Date(stateFor(block.id).fetchedAt!).toLocaleString(locale) }}</time>
            </div>
            <UiButton v-if="stateFor(block.id).error" size="compact" :disabled="stateFor(block.id).loading" @click="retry(block)">{{ copy('重试', 'Retry') }}</UiButton>
            <UiButton v-else-if="entityPage(stateFor(block.id).result)?.nextCursor" size="compact" :disabled="stateFor(block.id).loading" @click="loadMore(block)">
              <Icon v-if="stateFor(block.id).loading" name="loading" />
              {{ copy('加载更多', 'Load more') }}
            </UiButton>
          </footer>
          <UiButton v-else-if="stateFor(block.id).error && readBlock(block)" class="integration-retry" size="compact" :disabled="stateFor(block.id).loading" @click="retry(block)">{{ copy('重试', 'Retry') }}</UiButton>
        </component>
      </div>
    </section>

    <section v-else class="integration-empty">
      <Icon name="plugins" />
      <h1>{{ t('integrationUnavailable') }}</h1>
      <p>{{ t('integrationUnavailableDescription') }}</p>
    </section>
  </component>
</template>

<style scoped>
.integration-workbench { --integration-card-radius: var(--panel-radius); }
.integration-content { min-width: 0; }
.integration-page-progress { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); padding: var(--integration-row-padding-block) var(--integration-row-padding-inline); border-top: 1px solid var(--integration-card-border); color: var(--muted); font-size: var(--font-size-caption); }
.integration-page-progress > div { display: grid; min-width: 0; gap: var(--space-1); }
.integration-page-progress time { overflow-wrap: anywhere; }
.integration-page-progress > button { flex-shrink: 0; }
.integration-retry { margin: 0 var(--integration-row-padding-inline) var(--integration-row-padding-block); }
.integration-scope { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); font-size: var(--font-size-body); color: var(--muted); }
.integration-scope > span { flex: none; }
.integration-scope :deep([data-slot='select-trigger']) { width: auto; max-width: min(280px, calc(100% - 72px)); }
.integration-blocks { display: grid; gap: var(--space-3); }
.integration-block { min-width: 0; overflow: hidden; border: 1px solid var(--integration-card-border); border-radius: var(--integration-card-radius); background: var(--integration-card-background); }
.integration-block-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); padding: var(--integration-row-padding-block) var(--integration-row-padding-inline); border-bottom: 1px solid var(--integration-card-border); background: var(--surface-subtle); }
.integration-block-heading > div { min-width: 0; }
.integration-block-heading > button { flex-shrink: 0; white-space: nowrap; }
.integration-block-collapsible > summary { justify-content: flex-start; align-items: center; gap: var(--space-2); border-bottom: 0; cursor: pointer; list-style: none; }
.integration-block-collapsible > summary::-webkit-details-marker { display: none; }
.integration-block-collapsible > summary:hover { background: var(--surface-muted); }
.integration-block-collapsible > summary:focus-visible { outline: var(--control-focus-width) solid var(--focus-ring); outline-offset: calc(-1 * var(--control-focus-width)); border-radius: var(--integration-card-radius); }
.integration-block-collapsible[open] > summary { border-bottom: 1px solid var(--integration-card-border); }
.integration-block-chevron { width: 14px; height: 14px; color: var(--muted); transition: transform var(--motion-duration-fast) ease; }
.integration-block-collapsible[open] .integration-block-chevron { transform: rotate(90deg); }
.integration-block h2 { margin: 0; font-size: var(--font-size-emphasis); font-weight: 600; }
.integration-block-heading p { margin: 2px 0 0; color: var(--muted); font-size: var(--font-size-caption); line-height: var(--line-height-caption); }
.integration-search { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); margin: var(--integration-row-padding-block) var(--integration-row-padding-inline); padding: var(--space-1) var(--space-2); border: 1px solid var(--border-strong); border-radius: var(--control-radius); background: var(--surface); transition: border-color var(--motion-duration-fast), box-shadow var(--motion-duration-fast); }
.integration-search > .app-icon { width: 16px; height: 16px; color: var(--muted); }
.integration-search input { min-width: 0; min-height: var(--control-height-compact); border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: var(--font-size-body); }
.integration-search:focus-within { border-color: var(--focus-ring); box-shadow: 0 0 0 var(--control-focus-width) color-mix(in srgb, var(--focus-ring) 16%, transparent); }
.integration-cache-notice { display: grid; gap: var(--space-1); margin: 0; padding: var(--space-2) var(--integration-row-padding-inline); color: var(--text-secondary); background: var(--surface-subtle); border-bottom: 1px solid var(--integration-card-border); font-size: var(--font-size-caption); }
.integration-session { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); padding: 0 var(--integration-row-padding-inline) var(--space-3); margin: 0; color: var(--muted); font-size: var(--font-size-caption); }
.integration-connection { display: flex; align-items: flex-start; gap: var(--integration-row-gap); padding: var(--integration-row-padding-block) var(--integration-row-padding-inline); }
.integration-connection-mark { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: var(--radius-pill); color: var(--integration-status-neutral); background: color-mix(in srgb, var(--integration-status-neutral) var(--integration-status-tint), var(--surface)); }
.integration-connection-mark .app-icon { width: 15px; height: 15px; }
.integration-connection.connected .integration-connection-mark { color: var(--integration-status-connected); background: color-mix(in srgb, var(--integration-status-connected) var(--integration-status-tint), var(--surface)); }
.integration-connection-body { display: grid; min-width: 0; gap: var(--space-1); }
.integration-connection-title { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.integration-connection-title strong { color: var(--text); font-size: var(--font-size-emphasis); font-weight: 600; }
.integration-connection p { margin: 0; color: var(--muted); font-size: var(--font-size-body); line-height: var(--line-height-body); }
.integration-error { display: flex; align-items: flex-start; gap: var(--space-2); margin: var(--integration-row-gap) var(--integration-row-padding-inline) var(--space-4); padding: var(--space-2) var(--integration-row-padding-inline); border: 1px solid color-mix(in srgb, var(--integration-status-attention) 32%, var(--border)); border-radius: var(--integration-card-radius); background: var(--danger-soft); color: var(--integration-status-attention); font-size: var(--font-size-body); }
.integration-loading, .integration-empty-copy { margin: 0; padding: var(--integration-row-padding-block) var(--integration-row-padding-inline); color: var(--muted); font-size: var(--font-size-body); }
.integration-loading { display: flex; align-items: center; gap: var(--space-2); }
.integration-loading .app-icon { width: 15px; height: 15px; }
.integration-empty-copy { padding: var(--space-6) var(--integration-row-padding-inline); font-size: var(--font-size-emphasis); text-align: center; }
.integration-diagnostics { display: flex; gap: var(--space-3); margin-bottom: var(--space-3); padding: var(--space-3) var(--space-4); border: 1px solid color-mix(in srgb, var(--integration-status-attention) 35%, var(--border)); border-radius: var(--integration-card-radius); color: var(--integration-status-attention); background: color-mix(in srgb, var(--integration-status-attention) 6%, var(--surface)); }
.integration-diagnostics .app-icon { flex: none; width: 18px; height: 18px; }
.integration-diagnostics p { margin: 3px 0 0; font-size: var(--font-size-body); }
.integration-empty { display: grid; min-height: 320px; place-items: center; align-content: center; gap: var(--space-2); padding: var(--space-6); color: var(--muted); text-align: center; }
.integration-empty .app-icon { width: 28px; height: 28px; }
.integration-empty h1, .integration-empty h2, .integration-empty p { margin: 0; }
.integration-empty h1, .integration-empty h2 { color: var(--text); font-size: var(--font-size-heading-sm); }
.integration-blocks, .integration-connection div { min-width: 0; }
.integration-connection p { overflow-wrap: anywhere; }
@media (max-width: 760px) { .integration-search input { font-size: 16px; } }
</style>
