<script setup lang="ts">
import type { IntegrationActionResult, IntegrationConnectionStatus, IntegrationEntityPage } from 'craft-hub'
import type { WorkbenchIntegrationView } from './store'
import { computed, reactive, ref, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
import { useI18n } from './i18n'
import IntegrationEntityList from './IntegrationEntityList.vue'
import { useWorkbenchStore } from './store'
import VisualIcon from './VisualIcon.vue'

const props = withDefaults(defineProps<{ embedded?: boolean, integrationId: string, viewId: string }>(), { embedded: false })
const store = useWorkbenchStore()
const { t } = useI18n()

interface BlockState {
  loading: boolean
  error: string
  result?: IntegrationActionResult
}

const states = reactive<Record<string, BlockState>>({})
const searches = ref<Record<string, string>>({})
const view = computed(() => store.integrationViews.find(candidate => candidate.integrationId === props.integrationId && candidate.id === props.viewId))
const contribution = computed(() => store.integrationContributions.find(candidate => candidate.id === props.integrationId))
const requiresProject = computed(() => view.value?.scope === 'project')
const diagnostics = computed(() => store.integrationDiagnostics.filter(diagnostic => diagnostic.integrationId === props.integrationId))

function stateFor(blockId: string): BlockState {
  if (!states[blockId])
    states[blockId] = { loading: false, error: '' }
  return states[blockId]!
}

function actionTitle(block: WorkbenchIntegrationView['blocks'][number]): string {
  return block.title ?? contribution.value?.actions.find(action => action.id === block.actionId)?.title ?? block.id
}

function connectionStatus(result: IntegrationActionResult | undefined): IntegrationConnectionStatus | undefined {
  return result && 'connected' in result ? result : undefined
}

function entityPage(result: IntegrationActionResult | undefined): IntegrationEntityPage | undefined {
  return result && 'items' in result ? result : undefined
}

function statusActionsFor(block: WorkbenchIntegrationView['blocks'][number]): {
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
} | undefined {
  const currentContribution = contribution.value
  if (!currentContribution)
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
    projectId: view.value?.scope === 'global' ? undefined : store.selectedProjectId || undefined,
    transitionsActionId: transitions.id,
    updateActionId: update.id,
  }
}

function applyEntityUpdate(blockId: string, entity: IntegrationEntityPage['items'][number]): void {
  const page = entityPage(stateFor(blockId).result)
  if (page)
    page.items = page.items.map(item => item.id === entity.id ? entity : item)
}

async function invoke(block: WorkbenchIntegrationView['blocks'][number], extraInput: Record<string, unknown> = {}): Promise<void> {
  const currentView = view.value
  if (!currentView)
    return
  const state = stateFor(block.id)
  state.loading = true
  state.error = ''
  try {
    const projectId = currentView.scope === 'global' ? undefined : store.selectedProjectId || undefined
    if (currentView.scope === 'project' && !projectId)
      throw new Error(t('integrationProjectRequired'))
    state.result = await api.invokeIntegrationAction(
      props.integrationId,
      block.actionId,
      { ...(block.input ?? {}), ...extraInput },
      projectId,
    )
  }
  catch (caught) {
    state.result = undefined
    state.error = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    state.loading = false
  }
}

async function search(block: WorkbenchIntegrationView['blocks'][number]): Promise<void> {
  await invoke(block, { keyword: searches.value[block.id]?.trim() ?? '' })
}

watch(
  () => [view.value?.id, store.selectedProjectId],
  async () => {
    for (const key of Object.keys(states))
      delete states[key]
    const currentView = view.value
    if (!currentView)
      return
    await Promise.all(currentView.blocks
      .filter(block => block.type === 'connection-status' || block.type === 'entity-list')
      .map(block => invoke(block)))
  },
  { immediate: true },
)
</script>

<template>
  <main class="integration-workbench" :class="{ embedded }">
    <section v-if="view" class="integration-content">
      <header v-if="!embedded" class="integration-header">
        <span class="integration-mark"><VisualIcon :icon="view.icon" fallback="plugins" /></span>
        <div>
          <h1>{{ view.title }}</h1>
          <p>{{ view.pluginId }} · {{ view.providerId }}@{{ view.providerVersion }}</p>
        </div>
      </header>

      <aside v-if="diagnostics.length" class="integration-diagnostics" role="alert">
        <Icon name="error" />
        <div>
          <strong>{{ t('integrationNeedsAttention') }}</strong>
          <p v-for="diagnostic in diagnostics" :key="diagnostic.message">{{ diagnostic.message }}</p>
        </div>
      </aside>

      <section v-if="requiresProject && !store.selectedProjectId" class="integration-empty">
        <Icon name="folderOpen" />
        <h2>{{ t('integrationChooseProject') }}</h2>
        <p>{{ t('integrationProjectRequired') }}</p>
      </section>

      <div v-else class="integration-blocks">
        <article v-for="block in view.blocks" :key="block.id" class="integration-block" :data-testid="`integration-block-${block.id}`">
          <header>
            <div>
              <h2>{{ actionTitle(block) }}</h2>
              <p v-if="block.description">{{ block.description }}</p>
            </div>
            <button v-if="block.type !== 'entity-search'" type="button" :disabled="stateFor(block.id).loading" @click="invoke(block)">
              <Icon :name="stateFor(block.id).loading ? 'loading' : 'refresh'" />
              {{ t('refresh') }}
            </button>
          </header>

          <form v-if="block.type === 'entity-search'" class="integration-search" @submit.prevent="search(block)">
            <Icon name="search" />
            <input v-model="searches[block.id]" type="search" :placeholder="t('integrationSearchPlaceholder')" :aria-label="actionTitle(block)">
            <button type="submit" :disabled="stateFor(block.id).loading">
              <Icon v-if="stateFor(block.id).loading" name="loading" />
              {{ t('search') }}
            </button>
          </form>

          <p v-if="stateFor(block.id).error" class="integration-error" role="alert">{{ stateFor(block.id).error }}</p>

          <div v-else-if="connectionStatus(stateFor(block.id).result)" class="integration-connection" :class="{ connected: connectionStatus(stateFor(block.id).result)?.connected }">
            <span><Icon :name="connectionStatus(stateFor(block.id).result)?.connected ? 'check' : 'error'" /></span>
            <div>
              <strong>{{ connectionStatus(stateFor(block.id).result)?.connected ? t('integrationConnected') : t('integrationDisconnected') }}</strong>
              <p v-if="connectionStatus(stateFor(block.id).result)?.accountLabel">{{ connectionStatus(stateFor(block.id).result)?.accountLabel }}</p>
              <p v-if="connectionStatus(stateFor(block.id).result)?.message">{{ connectionStatus(stateFor(block.id).result)?.message }}</p>
            </div>
          </div>

          <IntegrationEntityList
            v-else-if="entityPage(stateFor(block.id).result)"
            :items="entityPage(stateFor(block.id).result)!.items"
            :status-actions="statusActionsFor(block)"
            @updated="applyEntityUpdate(block.id, $event)"
          />

          <p v-else-if="stateFor(block.id).loading" class="integration-loading"><Icon name="loading" /> {{ t('loading') }}</p>
        </article>
      </div>
    </section>

    <section v-else class="integration-empty">
      <Icon name="plugins" />
      <h1>{{ t('integrationUnavailable') }}</h1>
      <p>{{ t('integrationUnavailableDescription') }}</p>
    </section>
  </main>
</template>

<style scoped>
.integration-workbench { flex: 1; min-width: 0; overflow: auto; background: var(--surface); }
.integration-content { width: min(980px, calc(100% - 48px)); margin: 0 auto; padding: 36px 0 72px; }
.integration-workbench.embedded { overflow: visible; background: transparent; }
.integration-workbench.embedded .integration-content { width: 100%; padding: 0; }
.integration-header { display: flex; align-items: center; gap: 14px; margin-bottom: 24px; }
.integration-header h1 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
.integration-header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.integration-mark { display: grid; width: 44px; height: 44px; place-items: center; border: 1px solid var(--border); border-radius: 13px; color: var(--accent); background: var(--surface); }
.integration-mark :deep(.visual-icon), .integration-mark :deep(.app-icon) { width: 22px; height: 22px; }
.integration-blocks { display: grid; gap: 16px; }
.integration-block { overflow: hidden; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.integration-block > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.integration-block h2 { margin: 0; font-size: 15px; }
.integration-block header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.integration-block button { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--surface); cursor: pointer; }
.integration-block button:disabled { opacity: .55; cursor: default; }
.integration-block button .app-icon { width: 14px; height: 14px; }
.integration-search { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.integration-search > .app-icon { width: 17px; height: 17px; color: var(--muted); }
.integration-search input { min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; }
.integration-connection { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px; color: var(--danger); }
.integration-connection.connected { color: var(--success); }
.integration-connection div { display: grid; gap: 3px; color: var(--text); }
.integration-connection p { margin: 0; color: var(--muted); font-size: 12px; }
.integration-error, .integration-loading, .integration-empty-copy { margin: 0; padding: 16px 18px; color: var(--muted); font-size: 13px; }
.integration-error { color: var(--danger); }
.integration-loading { display: flex; align-items: center; gap: 8px; }
.integration-loading .app-icon { width: 15px; height: 15px; }
.integration-diagnostics { display: flex; gap: 10px; margin-bottom: 16px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); border-radius: 10px; color: var(--danger); background: color-mix(in srgb, var(--danger) 6%, var(--surface)); }
.integration-diagnostics .app-icon { flex: none; width: 18px; height: 18px; }
.integration-diagnostics p { margin: 3px 0 0; font-size: 12px; }
.integration-empty { display: grid; min-height: 320px; place-items: center; align-content: center; gap: 8px; padding: 40px; color: var(--muted); text-align: center; }
.integration-empty .app-icon { width: 28px; height: 28px; }
.integration-empty h1, .integration-empty h2, .integration-empty p { margin: 0; }
.integration-empty h1, .integration-empty h2 { color: var(--text); font-size: 17px; }
@media (max-width: 720px) { .integration-content { width: min(100% - 24px, 980px); padding-top: 22px; } }
</style>
