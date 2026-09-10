<script setup lang="ts">
import type { ConfigurationManagementPage, IntegrationActionResult, IntegrationConnectionStatus, IntegrationEntityPage } from 'craft-hub'
import type { WorkbenchIntegrationView } from './store'
import { computed, reactive, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import Icon from './NavigationIcon.vue'
import ConfigurationManager from './ConfigurationManager.vue'
import { useI18n } from './i18n'
import IntegrationResourceBrowser from './IntegrationResourceBrowser.vue'
import IntegrationActionForm from './IntegrationActionForm.vue'
import IntegrationConnectionSetup from './IntegrationConnectionSetup.vue'
import IntegrationEntityList from './IntegrationEntityList.vue'
import { useWorkbenchStore } from './store'
import WorkbenchViewHeader from './WorkbenchViewHeader.vue'

const props = withDefaults(defineProps<{ embedded?: boolean, integrationId: string, viewId: string }>(), { embedded: false })
const store = useWorkbenchStore()
const { t, locale } = useI18n()

interface BlockState {
  loading: boolean
  error: string
  result?: IntegrationActionResult
}

const states = reactive<Record<string, BlockState>>({})
const searches = ref<Record<string, string>>({})
const inspectedProjectId = ref(store.selectedProjectId || '')
watch(() => store.selectedProjectId, value => { inspectedProjectId.value = value || '' })
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
    projectId: view.value?.scope === 'global' ? undefined : inspectedProjectId.value || undefined,
    transitionsActionId: transitions.id,
    updateActionId: update.id,
  }
}

function workItemActionsFor(block: WorkbenchIntegrationView['blocks'][number]) {
  const current = contribution.value
  if (!current?.actions.some(action => action.id === block.actionId && ['work-items.list', 'work-items.search'].includes(action.operation)))
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
    const projectId = currentView.scope === 'global' ? undefined : inspectedProjectId.value || undefined
    if (currentView.scope === 'project' && !projectId)
      throw new Error(t('integrationProjectRequired'))
    const callInput = { ...(block.input ?? {}), ...extraInput, ...(contribution.value?.translations || contribution.value?.actions.find(action => action.id === block.actionId)?.operation === 'configuration.list' ? { locale: locale.value } : {}) }
    if (!state.result && block.previewInput) {
      try {
        state.result = await api.invokeIntegrationAction(props.integrationId, block.actionId, { ...callInput, ...block.previewInput }, projectId)
      }
      catch {
        // The complete read remains authoritative when an optional preview fails.
      }
    }
    state.result = await api.invokeIntegrationAction(
      props.integrationId,
      block.actionId,
      callInput,
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

async function refresh(): Promise<void> {
  const currentView = view.value
  if (!currentView)
    return
  await Promise.all(currentView.blocks
    .filter(block => block.type === 'connection-status' || block.type === 'entity-list')
    .map(block => invoke(block)))
}

watch(
  [() => props.integrationId, () => view.value?.id, () => inspectedProjectId.value, () => locale.value],
  async () => {
    for (const key of Object.keys(states))
      delete states[key]
    const currentView = view.value
    if (!currentView)
      return
    await Promise.all(currentView.blocks
      .filter(block => block.type === 'connection-status' || block.type === 'entity-list' || block.type === 'configuration-manager')
      .map(block => invoke(block)))
  },
  { immediate: true },
)
</script>

<template>
  <main class="integration-workbench workbench-view" :class="{ embedded }">
    <section v-if="view" class="integration-content workbench-view-content">
      <WorkbenchViewHeader v-if="!embedded" class="integration-header" :title="translate(view.title)" :icon="view.icon" />

      <label v-if="view.scope === 'global-and-project'" class="integration-scope">
        <span>{{ t('integrationScope') }}</span>
        <select v-model="inspectedProjectId" class="ui-form-control" :aria-label="t('integrationScope')">
          <option value="">{{ t('integrationGlobalScope') }}</option>
          <option v-for="project in store.projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>

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
        <component :is="block.collapsible ? 'details' : 'article'" v-for="block in view.blocks" :key="block.id" class="integration-block" :class="{ 'integration-block-collapsible': block.collapsible }" :data-testid="`integration-block-${block.id}`">
          <component :is="block.collapsible ? 'summary' : 'header'" v-if="block.type !== 'resource-browser'" class="integration-block-heading">
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

          <div v-else-if="connectionStatus(stateFor(block.id).result)" class="integration-connection" :class="{ connected: connectionStatus(stateFor(block.id).result)?.connected }">
            <span><Icon :name="connectionStatus(stateFor(block.id).result)?.connected ? 'check' : 'error'" /></span>
            <div>
              <strong>{{ connectionStatus(stateFor(block.id).result)?.connected ? t('integrationConnected') : t('integrationDisconnected') }}</strong>
              <p v-if="connectionStatus(stateFor(block.id).result)?.accountLabel">{{ connectionStatus(stateFor(block.id).result)?.accountLabel }}</p>
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

          <IntegrationConnectionSetup
            v-if="connectionStatus(stateFor(block.id).result)"
            :key="`${integrationId}:${inspectedProjectId}:${locale}`"
            :status="connectionStatus(stateFor(block.id).result)!"
            :integration-id="integrationId"
            :action-id="contribution?.actions.find(action => action.operation === 'connection.update')?.id"
            :project-id="view.scope === 'global' ? undefined : inspectedProjectId || undefined"
            :translate="translate" @updated="refresh"
          />

          <IntegrationEntityList
            v-else-if="entityPage(stateFor(block.id).result)"
            :items="entityPage(stateFor(block.id).result)!.items"
            :status-filter="block.statusFilter"
            :assignee-filter="block.assigneeFilter"
            :current-user="entityPage(stateFor(block.id).result)!.currentUser"
            :status-actions="statusActionsFor(block)"
            :work-item-actions="workItemActionsFor(block)"
            :key="`${integrationId}:${inspectedProjectId}:${locale}`"
            :loading="stateFor(block.id).loading"
            :configuration-action-id="contribution?.actions.find(action => action.operation === 'configuration.list' && action.id === block.actionId) ? contribution.actions.find(action => action.operation === 'configuration.update')?.id : undefined"
            @configuration-updated="stateFor(block.id).result = $event"
            :source-context="{ integrationId, actionId: block.actionId, projectId: view.scope === 'global' ? undefined : inspectedProjectId || undefined }"
            @updated="applyEntityUpdate(block.id, $event)"
          />

          <p v-else-if="stateFor(block.id).loading" class="integration-loading"><Icon name="loading" /> {{ t('loading') }}</p>
        </component>
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
.integration-scope { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: var(--font-size-body); color: var(--muted); }
.integration-scope > span { flex: none; }
.integration-scope select { width: auto; max-width: min(280px, 100% - 72px); border-color: var(--border); border-radius: var(--control-radius); }
.integration-blocks { display: grid; gap: 12px; }
.integration-block { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); }
.integration-block-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.integration-block-heading > div { min-width: 0; }
.integration-block-heading > button { flex-shrink: 0; white-space: nowrap; }
.integration-block-collapsible > summary { justify-content: flex-start; align-items: center; gap: 8px; border-bottom: 0; cursor: pointer; list-style: none; }
.integration-block-collapsible > summary::-webkit-details-marker { display: none; }
.integration-block-collapsible > summary:hover { background: var(--surface-muted); }
.integration-block-collapsible > summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: var(--control-radius); }
.integration-block-collapsible[open] > summary { border-bottom: 1px solid var(--border); }
.integration-block-chevron { width: 14px; height: 14px; color: var(--muted); }
.integration-block-collapsible[open] .integration-block-chevron { transform: rotate(90deg); }
.integration-block h2 { margin: 0; font-size: var(--font-size-emphasis); font-weight: 600; }
.integration-block-heading p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.integration-search { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.integration-search > .app-icon { width: 17px; height: 17px; color: var(--muted); }
.integration-search input { min-width: 0; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; }
.integration-connection { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; color: var(--danger); }
.integration-connection.connected { color: var(--success); }
.integration-connection div { display: grid; gap: 3px; color: var(--text); }
.integration-connection p { margin: 0; color: var(--muted); font-size: 12px; }
.integration-error, .integration-loading, .integration-empty-copy { margin: 0; padding: 10px 12px; color: var(--muted); font-size: 13px; }
.integration-error { color: var(--danger); }
.integration-loading { display: flex; align-items: center; gap: 8px; }
.integration-loading .app-icon { width: 15px; height: 15px; }
.integration-diagnostics { display: flex; gap: 10px; margin-bottom: 12px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); border-radius: 10px; color: var(--danger); background: color-mix(in srgb, var(--danger) 6%, var(--surface)); }
.integration-diagnostics .app-icon { flex: none; width: 18px; height: 18px; }
.integration-diagnostics p { margin: 3px 0 0; font-size: 12px; }
.integration-empty { display: grid; min-height: 320px; place-items: center; align-content: center; gap: 8px; padding: 40px; color: var(--muted); text-align: center; }
.integration-empty .app-icon { width: 28px; height: 28px; }
.integration-empty h1, .integration-empty h2, .integration-empty p { margin: 0; }
.integration-empty h1, .integration-empty h2 { color: var(--text); font-size: 17px; }
.integration-header > div, .integration-blocks, .integration-connection div { min-width: 0; }
.integration-header p, .integration-connection p { overflow-wrap: anywhere; }
@media (max-width: 760px) { .integration-search input { font-size: 16px; } }
</style>
