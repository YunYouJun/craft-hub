<script setup lang="ts">
import type { IntegrationEntity, ProjectRecord, WorkItemProjectSnapshot, WorkItemProjectTarget } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { workItemContainerKey, workItemSourceKey } from 'craft-hub/work-items'
import { computed, onUnmounted, ref, useId, watch } from 'vue'
import { api, ApiRequestError } from './api'
import { copyText } from './clipboard'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import { FormSelect } from './components/ui/select'
import { Textarea } from './components/ui/textarea'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { workHandoffText } from './personal-workbench'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean, initialProjectId?: string, projects?: ProjectRecord[], work?: { source: HomeWorkSource, item: IntegrationEntity } }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const formId = useId()
const noProjectValue = '__craft_hub_no_project__'
const projectSelection = ref('')
const projectId = computed(() => projectSelection.value === noProjectValue ? '' : projectSelection.value)
const objective = ref('')
const previewOpen = ref(false)
const copied = ref(false)
const error = ref('')
const notice = ref('')
const snapshot = ref<WorkItemProjectSnapshot>()
const bindingLoading = ref(false)
const saving = ref(false)
const scope = ref<'item' | 'container'>('item')
let generation = 0
const projects = computed(() => props.projects ?? store.projects)
const projectOptions = computed(() => [
  { value: noProjectValue, label: copy('无需项目', 'No project needed') },
  ...projects.value.map(candidate => ({ value: candidate.id, label: `${candidate.name} · ${candidate.path}` })),
])
const scopeOptions = computed(() => [
  { value: 'item', label: copy('仅此事项', 'This item') },
  { value: 'container', label: copy('此列表或资源范围', 'This list or container') },
])
const project = computed(() => projects.value.find(project => project.id === projectId.value))
const tools = computed(() => store.settings?.settings['workbench.home'].tools.filter(tool => tool.launch) ?? [])
const text = computed(() => workHandoffText({ locale: locale.value, project: project.value, work: props.work, objective: objective.value }))
const sourceRef = computed(() => props.work?.item.sourceRef)
const containerRef = computed(() => {
  if (!sourceRef.value)
    return undefined
  const { itemId: _itemId, ...container } = sourceRef.value
  return container
})
const target = computed<WorkItemProjectTarget | undefined>(() => sourceRef.value && containerRef.value
  ? scope.value === 'item' ? { type: 'item', ref: sourceRef.value } : { type: 'container', ref: containerRef.value }
  : undefined)
const binding = computed(() => {
  if (!sourceRef.value || !containerRef.value)
    return undefined
  const associations = snapshot.value?.associations ?? []
  return associations.find(entry => entry.target.type === 'item' && workItemSourceKey(entry.target.ref) === workItemSourceKey(sourceRef.value!))
    ?? associations.find(entry => entry.target.type === 'container' && workItemContainerKey(entry.target.ref) === workItemContainerKey(containerRef.value!))
})
const bindingMessage = computed(() => binding.value?.resolution.status === 'unavailable'
  ? copy('已关联的项目不可用，请重新选择或清除关联。', 'The linked project is unavailable. Select another project or clear the link.')
  : binding.value?.projectId === null
    ? copy('此事项已明确设置为无需项目。', 'This work is explicitly linked to no project.')
    : binding.value ? copy('已恢复保存的项目关联。', 'Saved project link restored.') : '')

async function loadBinding(restoreSelection = true): Promise<void> {
  if (!sourceRef.value)
    return
  const current = generation
  const selectedBeforeRead = projectSelection.value
  bindingLoading.value = true
  try {
    const result = await api.workItemProjects()
    if (generation !== current)
      return
    snapshot.value = result
    if (restoreSelection && projectSelection.value === selectedBeforeRead && binding.value) {
      if (binding.value.projectId === null)
        projectSelection.value = noProjectValue
      else if (binding.value.resolution.status === 'unavailable')
        projectSelection.value = ''
      else if (binding.value.resolution.status === 'available' && projects.value.some(project => project.id === binding.value?.projectId))
        projectSelection.value = binding.value.projectId
    }
  }
  catch { if (generation === current) error.value = copy('项目关联未载入，请重试。', 'Project links could not be loaded. Retry.') }
  finally { if (generation === current) bindingLoading.value = false }
}

async function persist(remove = false): Promise<void> {
  if (!target.value || !snapshot.value || saving.value || (!remove && !projectSelection.value))
    return
  saving.value = true
  error.value = ''
  const current = generation
  try {
    const result = remove
      ? await api.removeWorkItemProject({ revision: snapshot.value.revision, target: target.value })
      : await api.updateWorkItemProject({ revision: snapshot.value.revision, target: target.value, projectId: projectId.value || null })
    if (generation === current) {
      snapshot.value = result
      notice.value = remove ? copy('关联已清除。', 'Project link cleared.') : copy('关联已保存。', 'Project link saved.')
      if (remove)
        projectSelection.value = binding.value?.projectId === null ? noProjectValue : binding.value?.resolution.status === 'available' ? binding.value.projectId ?? '' : ''
    }
  }
  catch (caught) {
    if (generation !== current)
      return
    if (caught instanceof ApiRequestError && caught.status === 409) {
      await loadBinding(false)
      error.value = copy('关联已被其他操作修改，已重新载入。核对后再保存。', 'Project links changed elsewhere and were reloaded. Review before saving.')
    }
    else { error.value = copy('无法保存项目关联，请检查后重试。', 'Could not save the project link. Check and retry.') }
  }
  finally { if (generation === current) saving.value = false }
}

async function copyContext(): Promise<void> {
  const current = generation
  const copiedText = text.value
  error.value = ''
  try {
    await copyText(copiedText)
    if (generation === current && text.value === copiedText)
      copied.value = true
  }
  catch {
    if (generation === current) {
      previewOpen.value = true
      error.value = copy('无法访问剪贴板，请选择下方文本手动复制。', 'Clipboard unavailable. Select the text below and copy it manually.')
    }
  }
}

async function openTool(toolId: string, event: MouseEvent): Promise<void> {
  if (!window.craftHubDesktop?.openWorkbenchTool || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  event.preventDefault()
  const current = generation
  error.value = ''
  try {
    const result = await window.craftHubDesktop.openWorkbenchTool(toolId)
    if (generation !== current)
      return
    notice.value = result.destination === 'application'
      ? copy('已请求打开；请在目标工具确认并粘贴上下文。', 'Application opening requested. Confirm and paste context in the target tool.')
      : copy('本机应用不可用，已使用网站入口。', 'Local application unavailable; the website destination was used.')
  }
  catch {
    if (generation === current)
      error.value = copy('无法打开应用，请使用网站入口。', 'Could not open the application. Use its website destination.')
  }
}

watch(() => [props.open, props.initialProjectId, props.work], () => {
  generation++
  if (!props.open)
    return
  projectSelection.value = props.initialProjectId ?? ''
  objective.value = ''
  previewOpen.value = false
  copied.value = false
  error.value = ''
  notice.value = ''
  snapshot.value = undefined
  bindingLoading.value = false
  saving.value = false
  scope.value = 'item'
  void loadBinding()
}, { immediate: true })
watch(text, () => { copied.value = false })
onUnmounted(() => { generation++ })
</script>

<template>
  <DialogShell :open="open" layout="panel" content-class="dialog-content home-handoff-dialog" @update:open="value => { if (!saving) emit('update:open', value) }">
    <template #title>{{ copy('准备交接', 'Prepare handoff') }}</template>
    <template #description>{{ copy('确认项目与目标，复制后在工具中继续处理。', 'Confirm the project and objective, then copy the context to continue in your tool.') }}</template>
    <div class="home-handoff-form">
      <div v-if="work" class="handoff-work-summary">
        <h3>{{ work.item.title }}</h3>
        <p class="handoff-source-summary">
          <span :title="sourceRef ? `${copy('账号', 'Account')}: ${sourceRef.accountId}` : undefined">{{ work.source.title }}</span>
          <span v-if="work.item.statusLabel">{{ work.item.statusLabel }}</span>
        </p>
      </div>
      <FieldGroup>
        <div class="handoff-project-fields">
          <Field :data-disabled="saving">
            <FieldLabel :for="`${formId}-project`">{{ copy('目标项目', 'Target project') }}</FieldLabel>
            <FormSelect :id="`${formId}-project`" v-model="projectSelection" :options="projectOptions" :placeholder="copy('选择项目', 'Choose a project')" :disabled="saving" test-id="handoff-project" />
          </Field>
          <Field v-if="sourceRef" :data-disabled="saving">
            <FieldLabel :for="`${formId}-scope`">{{ copy('关联范围', 'Link scope') }}</FieldLabel>
            <FormSelect :id="`${formId}-scope`" :model-value="scope" :options="scopeOptions" :disabled="saving" test-id="handoff-scope" @update:model-value="value => scope = value === 'container' ? 'container' : 'item'" />
          </Field>
        </div>
        <div v-if="sourceRef" class="binding-controls">
          <div class="handoff-binding-actions">
            <UiButton size="compact" :disabled="!snapshot || saving || bindingLoading || !projectSelection" @click="persist()">{{ projectSelection === noProjectValue ? copy('保存为无需项目', 'Save no project') : copy('保存项目关联', 'Save project link') }}</UiButton>
            <UiButton size="compact" variant="ghost" :disabled="!snapshot || saving || bindingLoading" @click="persist(true)">{{ copy('清除关联', 'Clear link') }}</UiButton>
            <UiButton v-if="!snapshot && !bindingLoading" size="compact" @click="loadBinding()">{{ copy('重试', 'Retry') }}</UiButton>
          </div>
          <p v-if="bindingLoading" class="home-hint" role="status">{{ copy('正在读取项目关联…', 'Loading project links…') }}</p>
          <p v-else-if="bindingMessage" class="home-hint" role="status">{{ bindingMessage }}</p>
        </div>
        <p v-else-if="work" class="home-hint">{{ copy('此来源尚未提供完整事项身份，可手动交接，项目关联暂不保存。', 'This source has no complete work-item identity. Manual handoff is available; project links cannot be saved yet.') }}</p>
        <Field>
          <FieldLabel :for="`${formId}-objective`">{{ copy('本次目标（可选）', 'Objective (optional)') }}</FieldLabel>
          <Textarea :id="`${formId}-objective`" v-model="objective" rows="3" maxlength="4000" :placeholder="copy('希望在项目中完成什么？', 'What would you like to accomplish in this project?')" />
        </Field>
      </FieldGroup>
      <details class="handoff-preview-disclosure" :open="previewOpen" @toggle="previewOpen = ($event.target as HTMLDetailsElement).open">
        <summary><Icon name="arrowRight" />{{ copy('查看交接上下文', 'View handoff context') }}</summary>
        <Field>
          <FieldLabel :for="`${formId}-preview`">{{ copy('交接预览', 'Handoff preview') }}</FieldLabel>
          <Textarea :id="`${formId}-preview`" class="home-handoff-preview" :model-value="text" readonly rows="10" />
        </Field>
      </details>
      <p v-if="error" class="home-error" role="alert">{{ error }}</p>
      <p v-if="copied" class="home-hint" role="status">{{ copy('上下文已复制；在目标工具中粘贴后再开始执行。', 'Context copied. Paste it in the target tool before starting work.') }}</p>
      <section v-if="tools.length" class="handoff-tool-section" :aria-labelledby="`${formId}-tools`">
        <h3 :id="`${formId}-tools`">{{ copy('继续处理', 'Continue in a tool') }}</h3>
        <p class="home-hint">{{ copy('在目标工具中粘贴上下文。', 'Paste the context in your chosen tool.') }}</p>
        <div class="home-handoff-tools"><a v-for="tool in tools" :key="tool.id" :href="tool.url" target="_blank" rel="noopener noreferrer" class="handoff-tool-link" @click="openTool(tool.id, $event)">{{ copy('打开', 'Open') }} {{ tool.title }}<Icon name="externalLink" /></a></div>
      </section>
      <p v-if="notice" class="home-hint" role="status">{{ notice }}</p>
    </div>
    <template #footer>
      <div class="dialog-action-pair">
        <UiButton :disabled="saving" @click="emit('update:open', false)">{{ copy('关闭', 'Close') }}</UiButton>
        <UiButton variant="primary" class="handoff-copy-action" :data-label-width="copy('复制上下文', 'Copy context')" @click="copyContext"><span>{{ copied ? copy('再次复制', 'Copy again') : copy('复制上下文', 'Copy context') }}</span></UiButton>
      </div>
    </template>
  </DialogShell>
</template>

<style scoped>
:global(.home-handoff-dialog .dialog-panel-header), :global(.home-handoff-dialog .dialog-panel-footer) { background: color-mix(in srgb, var(--surface-subtle) 94%, transparent); backdrop-filter: blur(var(--palette-backdrop-blur)); }
.dialog-action-pair > .handoff-copy-action { display: grid; }
/* Reserve the longest label through success and text enlargement without adding an accessible label. */
.handoff-copy-action::before { grid-area: 1 / 1; visibility: hidden; content: attr(data-label-width); overflow-wrap: anywhere; }
.handoff-copy-action > span { grid-area: 1 / 1; overflow-wrap: anywhere; }
.home-handoff-form { display: grid; gap: var(--space-5); }
.handoff-work-summary { display: grid; gap: var(--space-1); padding-bottom: var(--space-4); border-bottom: 1px solid var(--border); }
.handoff-work-summary h3 { margin: 0; font-size: var(--font-size-subheading); font-weight: 600; line-height: var(--line-height-heading-sm); }
.handoff-source-summary { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; color: var(--text-secondary); font-size: var(--font-size-caption); }
.handoff-source-summary span + span::before { content: '·'; margin-right: var(--space-2); }
.handoff-project-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.handoff-project-fields > :only-child { grid-column: 1 / -1; }
.binding-controls { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: center; }
.handoff-binding-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.home-hint { margin: 0; color: var(--text-secondary); font-size: var(--font-size-caption); line-height: var(--line-height-caption); }
.home-error { margin: 0; color: var(--danger); font-size: var(--font-size-caption); line-height: var(--line-height-caption); }
.handoff-preview-disclosure { min-width: 0; }
.handoff-preview-disclosure summary { display: inline-flex; align-items: center; gap: var(--control-icon-gap); width: fit-content; min-height: var(--control-height-compact); cursor: pointer; color: var(--text-secondary); font-size: var(--font-size-caption); line-height: var(--line-height-caption); }
.handoff-preview-disclosure summary .app-icon { width: var(--select-arrow-size); height: var(--select-arrow-size); }
.handoff-preview-disclosure[open] summary .app-icon { transform: rotate(90deg); }
.handoff-preview-disclosure summary:focus-visible, .handoff-tool-link:focus-visible { outline: var(--control-focus-width) solid var(--focus-ring); outline-offset: var(--control-focus-offset); border-radius: var(--control-radius); }
.handoff-preview-disclosure[open] > [data-slot='field'] { margin-top: var(--space-3); }
.handoff-tool-section { display: grid; gap: var(--space-2); padding-top: var(--space-4); border-top: 1px solid var(--border); }
.handoff-tool-section h3 { margin: 0; font-size: var(--font-size-body); font-weight: 600; line-height: var(--line-height-body); }
.home-handoff-tools { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.handoff-tool-link { display: inline-flex; align-items: center; justify-content: center; gap: var(--control-icon-gap); min-height: var(--control-height-default); padding: var(--space-1) var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); color: var(--text); font-size: var(--font-size-body); font-weight: 500; line-height: var(--line-height-body); text-decoration: none; }
.handoff-tool-link:hover { background: var(--surface-hover); color: var(--accent); }
.handoff-tool-link .app-icon { width: var(--select-arrow-size); height: var(--select-arrow-size); }
@media (max-width: 760px) {
  .handoff-project-fields { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px), (pointer: coarse) {
  .handoff-preview-disclosure summary { min-height: var(--control-height-default); }
}
</style>
