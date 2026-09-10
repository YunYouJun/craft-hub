<script setup lang="ts">
import type { IntegrationActionResult, ResourcePage, ResolvedIntegrationContribution } from 'craft-hub'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import Icon from './NavigationIcon.vue'
import IntegrationActionForm from './IntegrationActionForm.vue'
import IntegrationEntityList from './IntegrationEntityList.vue'
import { useWorkbenchStore } from './store'
import MarkdownPreview from './MarkdownPreview.vue'
import { useI18n } from './i18n'

const props = defineProps<{ integrationId: string, contribution: ResolvedIntegrationContribution, input?: Record<string, unknown>, projectId?: string }>()
const { t } = useI18n()
const store = useWorkbenchStore()
const activeProjectId = ref(props.projectId)
const scopeTitle = computed(() => {
  const project = store.projects.find(project => project.id === activeProjectId.value)
  return project ? `${project.name} · ${project.path} · ${page.value?.title ?? ''}` : page.value?.title
})
const preview = ref<Record<string, boolean>>({})
async function importProject(path: string): Promise<void> {
  try {
    await store.addProject(path)
    await read({}, false, store.selectedProjectId || undefined)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}
function selectEntity(id: string): void {
  const link = page.value?.links?.find(link => link.entityId === id)
  if (link)
    void read(link.input, false, link.projectId ?? activeProjectId.value)
}
async function copy(content: string): Promise<void> {
  try { await navigator.clipboard.writeText(content) }
  catch (caught) { error.value = String(caught) }
}
const page = ref<ResourcePage>()
const formEpoch = ref(0)
const error = ref('')
const loading = ref(false)
const activeInput = ref<Record<string, unknown>>(props.input ?? {})
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
const actions = computed(() => ({
  read: props.contribution.actions.find(action => action.operation === 'resources.read'),
  update: props.contribution.actions.find(action => action.operation === 'resources.update'),
  execute: props.contribution.actions.find(action => action.operation === 'resources.execute'),
}))
function schedule(): void {
  clearTimeout(timer)
  if (page.value?.refreshAfterMs)
    timer = setTimeout(() => { void read(activeInput.value, true) }, Math.max(1500, page.value.refreshAfterMs))
}
function completed(result: IntegrationActionResult): void {
  revision++
  loading.value = false
  error.value = ''
  accept(result)
}
function accept(result: IntegrationActionResult, background = false): void {
  if ('kind' in result && result.kind === 'resource-page') {
    if (!background)
      formEpoch.value++
    page.value = result
    activeInput.value = result.input
    schedule()
  }
}
async function read(input: Record<string, unknown>, background = false, projectId = activeProjectId.value): Promise<void> {
  if (!actions.value.read)
    return
  activeProjectId.value = projectId
  const current = ++revision
  clearTimeout(timer)
  if (!background)
    loading.value = true
  error.value = ''
  try {
    const result = await api.invokeIntegrationAction(props.integrationId, actions.value.read.id, input, projectId)
    if (current === revision)
      accept(result, background)
  }
  catch (caught) {
    if (current === revision)
      error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (current === revision)
      loading.value = false
  }
}
function download(document: NonNullable<ResourcePage['documents']>[number]): void {
  const url = URL.createObjectURL(new Blob([document.content], { type: 'text/plain;charset=utf-8' }))
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = document.filename ?? `${document.id}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}
watch(() => [props.integrationId, props.projectId, props.input], () => { page.value = undefined; void read(props.input ?? {}, false, props.projectId) }, { immediate: true })
onBeforeUnmount(() => { revision++; clearTimeout(timer) })
</script>

<template>
  <section class="resource-browser" :aria-busy="loading">
    <p v-if="error" role="alert">{{ error }}</p>
    <header class="resource-header">
      <div class="resource-heading">
        <h2 v-if="page">{{ page.title }}</h2>
        <p v-if="page?.description">{{ page.description }}</p>
      </div>
      <nav class="resource-toolbar">
        <UiButton size="compact" variant="ghost" :disabled="loading" @click="read(props.input ?? {}, false, props.projectId)"><Icon name="home" />{{ t('resourceHome') }}</UiButton>
        <UiButton size="compact" :disabled="loading" @click="read(activeInput)"><Icon :name="loading ? 'loading' : 'refresh'" />{{ t('refresh') }}</UiButton>
      </nav>
    </header>
    <template v-if="page">
      <aside v-if="activeProjectId && store.projects.find(project => project.id === activeProjectId)?.trust !== 'trusted'" class="resource-trust">
        <Icon name="untrusted" />
        <p>{{ t('resourceTrustDescription') }}</p>
        <UiButton size="compact" @click="store.trustProjectById(activeProjectId)">{{ t('resourceTrustProject') }}</UiButton>
        <p v-if="store.error" role="alert">{{ store.error }}</p>
      </aside>
      <section v-if="page.projectSuggestions?.length" class="resource-suggestions">
        <p>{{ t('resourceImportProjects') }}</p>
        <UiButton v-for="project in page.projectSuggestions" :key="project.path" size="compact" :title="project.path" @click="importProject(project.path)"><Icon name="folderOpen" />{{ project.title }}</UiButton>
      </section>
      <nav v-if="page.links?.some(link => !link.entityId)" class="resource-links">
        <UiButton v-for="(link, index) in page.links.filter(link => !link.entityId)" :key="index" size="compact" :disabled="loading" @click="read(link.input, false, link.projectId ?? activeProjectId)">{{ link.title }}<Icon name="arrowRight" /></UiButton>
      </nav>
      <IntegrationEntityList v-if="page.entities" :items="page.entities" :selectable="page.links?.some(link => link.entityId)" @selected="selectEntity($event.id)" />
      <details v-for="document in page.documents" :key="document.id" class="resource-disclosure" open>
        <summary><Icon name="arrowRight" />{{ document.title }}</summary>
        <div class="resource-disclosure-body">
          <nav class="resource-document-actions">
            <UiButton size="compact" variant="ghost" @click="copy(document.content)"><Icon name="copy" />{{ t('resourceCopy') }}</UiButton>
            <UiButton size="compact" variant="ghost" @click="download(document)">{{ t('resourceDownload') }}</UiButton>
            <UiButton v-if="document.filename?.endsWith('.md')" size="compact" variant="ghost" @click="preview[document.id] = !preview[document.id]">{{ t('resourcePreview') }}</UiButton>
          </nav>
          <MarkdownPreview v-if="preview[document.id]" :content="document.content" :readme-path="document.filename ?? 'document.md'" />
          <div v-else :class="{ comparison: document.compareWith !== undefined }">
            <pre>{{ document.content }}</pre>
            <pre v-if="document.compareWith !== undefined">{{ document.compareWith }}</pre>
          </div>
        </div>
      </details>
      <details v-for="form in page.forms" :key="`${JSON.stringify(page.input)}:${form.id}:${formEpoch}`" class="resource-form resource-disclosure">
        <summary><Icon name="arrowRight" />{{ form.title }}</summary>
        <div class="resource-disclosure-body">
          <p v-if="form.description">{{ form.description }}</p>
          <IntegrationActionForm
            v-if="actions[form.effect]"
            :key="`${JSON.stringify(page.input)}:${form.id}:${formEpoch}`" :integration-id="integrationId" :project-id="activeProjectId"
            :block="{ id: form.id, type: 'action-form', actionId: actions[form.effect]!.id, input: form.input, fields: form.fields }"
            :project-title="scopeTitle"
            :action="{ ...actions[form.effect]!, title: form.title }" :translate="value => value"
            @completed="completed"
          />
        </div>
      </details>
    </template>
    <p v-else-if="loading">{{ t('loading') }}</p>
  </section>
</template>

<style scoped>
.resource-browser { display: grid; gap: 12px; padding: 12px; min-width: 0; font-size: var(--font-size-body); overflow-wrap: anywhere; }
.resource-browser h2, .resource-browser p { margin: 0; }
.resource-browser h2 { font-size: var(--font-size-emphasis); font-weight: 600; line-height: 1.5; }
.resource-heading p, .resource-trust p, .resource-disclosure-body > p { color: var(--muted); font-size: var(--font-size-body); line-height: 1.6; }
.resource-heading p { margin-top: 4px; }
.resource-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.resource-heading { min-width: 0; }
.resource-toolbar { flex: none; }
nav, .resource-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }
.resource-links { padding-block: 2px; }
.resource-links .ui-button { justify-content: space-between; gap: 12px; }
.resource-links .app-icon { color: var(--muted); }
.resource-suggestions > p { flex-basis: 100%; color: var(--muted); }
.resource-trust { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px; border-radius: var(--control-radius); background: var(--surface-muted); }
.resource-trust > .app-icon { flex: none; width: 16px; height: 16px; color: var(--warning); }
.resource-trust > p { flex: 1; min-width: 160px; }
.resource-trust > p[role='alert'] { flex-basis: 100%; color: var(--danger); }
.resource-disclosure { min-width: 0; border: 1px solid var(--border); border-radius: var(--control-radius); }
.resource-disclosure summary { display: flex; align-items: center; gap: 7px; padding: 10px; cursor: pointer; font-weight: 500; list-style: none; }
.resource-disclosure summary::-webkit-details-marker { display: none; }
.resource-disclosure summary > .app-icon { width: 14px; height: 14px; flex: none; color: var(--muted); }
.resource-disclosure[open] > summary > .app-icon { transform: rotate(90deg); }
.resource-disclosure summary:hover { background: var(--surface-muted); }
.resource-disclosure summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; border-radius: var(--control-radius); }
.resource-disclosure-body { min-width: 0; padding: 10px; border-top: 1px solid var(--border); }
.resource-document-actions { margin-bottom: 8px; }
pre { margin: 0; max-height: 55vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-body); line-height: 1.6; background: var(--surface-muted); border-radius: var(--control-radius); padding: 12px; scrollbar-width: thin; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
[role=alert] { color: var(--danger); }
@media(max-width: 760px) { .comparison { grid-template-columns: 1fr; } .resource-header { flex-wrap: wrap; } .resource-trust > .ui-button { margin-left: 24px; } }
.resource-browser :deep(.integration-action-form) { padding: 10px 0 0; }
.resource-browser :deep(.integration-empty-copy) { padding: 4px 0; font-size: var(--font-size-body); }
</style>
