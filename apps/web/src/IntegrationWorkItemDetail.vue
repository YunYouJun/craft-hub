<script setup lang="ts">
import type { IntegrationEntity } from 'craft-hub'
import { computed, ref, useId } from 'vue'
import AgentTaskOutput from './AgentTaskOutput.vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import { FormSelect } from './components/ui/select'
import { Textarea } from './components/ui/textarea'
import { Icon } from './icons'
import IntegrationEntityStatus from './IntegrationEntityStatus.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ entity: IntegrationEntity, integrationId: string, detailActionId?: string, projectId?: string }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const formId = useId()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
const loading = ref(false)
const error = ref('')
const detail = ref<IntegrationEntity>()
const projectId = ref('')
const prompt = ref('')
const taskId = ref('')
const task = computed(() => store.agentTasks.find(item => item.id === taskId.value))
const projectOptions = computed(() => store.projects.map(project => ({ value: project.id, label: project.name, icon: 'folder' })))
let generation = 0

function plainText(value: string): string {
  const document = new DOMParser().parseFromString(value, 'text/html')
  document.querySelectorAll('script, style, template').forEach(element => element.remove())
  return document.body.textContent?.trim() ?? ''
}

async function show(event: MouseEvent): Promise<void> {
  if (event.currentTarget instanceof HTMLButtonElement)
    trigger.value = event.currentTarget
  const current = ++generation
  open.value = true
  loading.value = true
  error.value = ''
  taskId.value = ''
  prompt.value = ''
  detail.value = props.entity
  projectId.value = props.projectId ?? ''
  try {
    if (props.detailActionId) {
      const result = await api.invokeIntegrationAction<IntegrationEntity>(props.integrationId, props.detailActionId, { ...props.entity.metadata, itemId: props.entity.id }, props.projectId)
      if (current !== generation)
        return
      detail.value = result
    }
  }
  catch (caught) {
    if (current === generation)
      error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (current === generation) {
      const item = detail.value!
      prompt.value = [item.title, item.url, plainText(item.description ?? '')].filter(Boolean).join('\n\n')
      loading.value = false
    }
  }
}

function updateOpen(value: boolean): void {
  open.value = value
  generation++
}

function restoreFocus(event: Event): void {
  event.preventDefault()
  trigger.value?.focus()
}

async function startTask(): Promise<void> {
  if (!projectId.value || !prompt.value.trim() || loading.value)
    return
  loading.value = true
  error.value = ''
  try {
    const task = await store.startAgentTask(prompt.value, [projectId.value], projectId.value)
    taskId.value = task.id
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UiButton size="compact" @click="show">{{ t('integrationWorkItemDetails') }}</UiButton>
  <DialogShell :open="open" layout="panel" content-class="dialog-content work-item-detail" @update:open="updateOpen" @close-auto-focus="restoreFocus">
    <template #title>{{ t('integrationWorkItemTitle') }}</template>
    <template #description>{{ t('integrationWorkItemDescription') }}</template>
    <template #header-actions>
      <UiButton size="icon" variant="ghost" :aria-label="t('close')" @click="updateOpen(false)"><Icon name="close" /></UiButton>
    </template>
    <section class="work-item-summary">
      <nav v-if="(detail ?? entity).ancestors?.length" class="work-item-ancestors" :aria-label="t('integrationAncestorItems')">
        <span>{{ t('integrationAncestorItems') }}</span>
        <div v-for="(parent, index) in (detail ?? entity).ancestors" :key="index">
          <span class="app-icon i-lucide-corner-down-right" aria-hidden="true" />
          <a v-if="parent.url" :href="parent.url" target="_blank" rel="noopener noreferrer">{{ parent.title }}</a>
          <span v-else>{{ parent.title }}</span>
          <IntegrationEntityStatus :entity="parent" />
        </div>
      </nav>
      <h3>{{ detail?.title ?? entity.title }}</h3>
      <div v-if="(detail ?? entity).status || (detail ?? entity).archived || (detail ?? entity).url" class="work-item-meta">
        <IntegrationEntityStatus :entity="detail ?? entity" />
        <a v-if="(detail ?? entity).url" :href="(detail ?? entity).url" target="_blank" rel="noopener noreferrer"><Icon name="externalLink" /> {{ t('integrationWorkItemSource') }}</a>
      </div>
      <p v-if="detail?.description" class="work-item-description">{{ plainText(detail.description) }}</p>
    </section>
    <section class="work-item-handoff">
      <h3>{{ t('integrationHandoffTitle') }}</h3>
      <p class="work-item-hint">{{ t('integrationHandoffDescription') }}</p>
      <FieldGroup>
        <Field>
          <FieldLabel :for="`${formId}-project`">{{ t('integrationTaskProject') }}</FieldLabel>
          <FormSelect :id="`${formId}-project`" v-model="projectId" :options="projectOptions" :placeholder="t('integrationChooseProject')" :disabled="loading || Boolean(taskId)" required />
        </Field>
        <Field>
          <FieldLabel :for="`${formId}-prompt`">{{ t('integrationTaskPrompt') }}</FieldLabel>
          <Textarea :id="`${formId}-prompt`" v-model="prompt" :disabled="loading || Boolean(taskId)" :rows="6" required />
        </Field>
      </FieldGroup>
      <p v-if="loading" class="work-item-hint" role="status">{{ t('loading') }}</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <p v-if="taskId" role="status">{{ t('integrationTaskCreated') }} {{ taskId }}</p>
      <template v-if="task">
        <p role="status">{{ task.status }}</p>
        <p v-if="task.error" class="error-message" role="alert">{{ task.error }}</p>
        <AgentTaskOutput :task="task" />
        <pre v-if="task.finalResponse" class="work-item-response">{{ task.finalResponse }}</pre>
      </template>
    </section>
    <template #footer>
      <UiButton @click="updateOpen(false)">{{ t('close') }}</UiButton>
      <UiButton v-if="!taskId" variant="primary" :disabled="loading || !projectId || !prompt.trim()" @click="startTask"><Icon name="skill" /> {{ t('integrationStartTask') }}</UiButton>
    </template>
  </DialogShell>
</template>

<style scoped>
.work-item-ancestors { display: grid; gap: var(--space-2); margin-bottom: var(--space-3); color: var(--muted); font-size: var(--font-size-body); }
.work-item-ancestors > span { font-size: var(--font-size-control); }
.work-item-ancestors > div { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.work-item-ancestors a { color: var(--text-secondary); text-decoration: none; }
.work-item-ancestors a:hover { color: var(--accent); text-decoration: underline; }
.work-item-ancestors .app-icon { width: 14px; height: 14px; }
.work-item-summary h3 { margin: 0; font-size: var(--font-size-subheading); font-weight: 600; line-height: var(--line-height-heading-md); }
.work-item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.work-item-meta a { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); font-size: var(--font-size-control); text-decoration: none; }
.work-item-meta a:hover { color: var(--accent); text-decoration: underline; }
.work-item-meta .app-icon { width: 13px; height: 13px; }
.work-item-description { margin: var(--space-3) 0 0; color: var(--text-secondary); white-space: pre-wrap; line-height: 1.65; }
.work-item-handoff { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-4); }
.work-item-handoff h3 { margin: 0; font-size: var(--font-size-emphasis); font-weight: 600; }
.work-item-hint { margin: var(--space-1) 0 var(--space-3); color: var(--muted); }
.work-item-handoff textarea { min-height: 120px; line-height: 1.6; scrollbar-width: thin; }
.work-item-response { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--font-size-body); }
</style>
