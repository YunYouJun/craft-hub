<script setup lang="ts">
import type { CaptureDraft, IntegrationConnectionStatus, IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import { useLocalStorage } from '@vueuse/core'
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { captureDueInstant, localDateTime, parseQuickCapture } from './quick-capture'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean], saved: [] }>()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const formId = useId()
const text = useLocalStorage('craft-hub-capture-text', '')
const captureInput = ref<HTMLTextAreaElement>()
const preferredLists = useLocalStorage<Record<string, string>>('craft-hub-capture-lists', {})
const initialDraft = parseQuickCapture(text.value, [])
const draft = useLocalStorage<CaptureDraft>('craft-hub-capture-draft', initialDraft)
let previewFields = { title: initialDraft.title, listId: initialDraft.listId }
const connection = ref<IntegrationConnectionStatus>()
const lists = ref<Array<{ id: string, title: string }>>([])
const loading = ref(false)
const saving = ref(false)
const analyzing = ref(false)
const authorizing = ref(false)
const aiAvailable = ref(false)
const shortcutRegistered = ref<boolean>()
const error = ref('')
const saved = ref('')
const attempt = useLocalStorage('craft-hub-capture-attempt', { id: '', fingerprint: '' })
let generation = 0
let polling: ReturnType<typeof setTimeout> | undefined
const busy = computed(() => saving.value || analyzing.value || authorizing.value)
const selectedList = computed(() => lists.value.find(list => list.id === draft.value.listId))
const writable = computed(() => connection.value?.connected && connection.value.capabilities?.create)
const disabled = computed(() => busy.value || loading.value || !writable.value || !draft.value.title.trim() || !selectedList.value)

function focusInput(event: Event): void {
  event.preventDefault()
  void nextTick(() => captureInput.value?.focus())
}

function preview(): void {
  const parsed = parseQuickCapture(text.value, lists.value)
  draft.value = { ...parsed, listId: parsed.listId ?? draft.value.listId }
  previewFields = { title: draft.value.title, listId: draft.value.listId }
  saved.value = ''
  error.value = ''
}
watch(text, preview, { flush: 'sync' })
watch(draft, () => { saved.value = '' }, { deep: true, flush: 'sync' })

function schedulePoll(version: number): void {
  clearTimeout(polling)
  if (!props.open || !connection.value?.deviceAuthorization) return
  polling = setTimeout(async () => {
    try {
      const next = await api.invokeIntegrationAction<IntegrationConnectionStatus>('microsoft-todo', 'connection', { locale: locale.value })
      if (version !== generation) return
      connection.value = next
      if (next.capabilities?.create) { await load(); return }
      schedulePoll(version)
    }
    catch { if (version === generation) error.value = copy('授权状态检查失败，请点击刷新连接。', 'Authorization check failed. Refresh the connection.') }
  }, 4000)
}

async function load(): Promise<void> {
  const version = ++generation
  clearTimeout(polling)
  loading.value = true
  error.value = ''
  try {
    const status = await api.invokeIntegrationAction<IntegrationConnectionStatus>('microsoft-todo', 'connection', { locale: locale.value })
    if (version !== generation) return
    connection.value = status
    lists.value = []
    if (status.connected) {
      const page = await api.invokeIntegrationAction<IntegrationEntityPage>('microsoft-todo', 'tasks', { locale: locale.value })
      if (version !== generation) return
      lists.value = page.collections ?? []
      const parsed = parseQuickCapture(text.value, lists.value)
      if (parsed.listId) {
        // Newly loaded lists can resolve a typed hashtag, while reviewed fields keep their edits.
        if (draft.value.title === previewFields.title) {
          draft.value.title = parsed.title
          previewFields.title = parsed.title
        }
        if (draft.value.listId === previewFields.listId) {
          draft.value.listId = parsed.listId
          previewFields.listId = parsed.listId
        }
      }
      const account = status.accountLabel ?? ''
      const preferred = preferredLists.value[account]
      if (!lists.value.some(list => list.id === draft.value.listId)) {
        draft.value.listId = lists.value.find(list => list.id === preferred)?.id ?? lists.value.find(list => /^(任务|Tasks|收件箱|Inbox)$/i.test(list.title))?.id ?? lists.value[0]?.id ?? null
        previewFields.listId = draft.value.listId
      }

    }
    schedulePoll(version)
  }
  catch { if (version === generation) error.value = copy('无法读取微软连接或列表，请刷新重试。', 'Could not read the Microsoft connection or lists. Refresh to retry.') }
  finally { if (version === generation) loading.value = false }
}
async function authorize(): Promise<void> {
  if (busy.value) return
  authorizing.value = true
  error.value = ''
  const version = generation
  try {
    const result = await api.invokeIntegrationAction<IntegrationConnectionStatus>('microsoft-todo', 'connect', { method: 'enable-write', locale: locale.value }, undefined, true)
    if (version !== generation) return
    connection.value = result
    if (result.capabilities?.create) await load()
    else schedulePoll(version)
  }
  catch { error.value = copy('授权未能启动，请检查系统提示后重试。', 'Authorization could not start. Check system prompts and retry.') }
  finally { authorizing.value = false }
}
async function analyze(): Promise<void> {
  if (!text.value.trim() || busy.value) return
  analyzing.value = true
  error.value = ''
  const version = generation
  try {
    const result = await api.parseCapture({ text: text.value, localNow: localDateTime(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, lists: lists.value, locale: locale.value })
    if (version === generation) draft.value = { ...result, listId: result.listId ?? draft.value.listId }
  }
  catch { error.value = copy('AI 理解暂不可用。已保留草稿，你可以编辑后直接保存。', 'AI is unavailable. Your draft is preserved; edit it and save directly.') }
  finally { analyzing.value = false }
}
async function save(): Promise<void> {
  if (disabled.value) return
  saving.value = true
  error.value = ''
  try {
    const dueAt = captureDueInstant(draft.value.dueLocal ?? '')
    const accountId = connection.value!.accountLabel!
    const payload = { accountId, listId: draft.value.listId, title: draft.value.title, notes: draft.value.notes, important: draft.value.important, ...(dueAt ? { dueDate: draft.value.dueLocal!.slice(0, 10), ...(draft.value.remind ? { reminderAt: dueAt } : {}) } : {}) }
    const fingerprint = JSON.stringify(payload)
    if (attempt.value.fingerprint !== fingerprint || !attempt.value.id)
      attempt.value = { id: crypto.randomUUID(), fingerprint }
    const item = await api.invokeIntegrationAction<IntegrationEntity>('microsoft-todo', 'create', { ...payload, requestId: attempt.value.id }, undefined, true)
    attempt.value = { id: '', fingerprint: '' }
    preferredLists.value = { ...preferredLists.value, [accountId]: draft.value.listId! }
    const listTitle = selectedList.value!.title
    text.value = ''
    draft.value = { ...parseQuickCapture('', lists.value), listId: draft.value.listId }
    saved.value = copy(`已保存到「${listTitle}」：${item.title}`, `Saved to ${listTitle}: ${item.title}`)
    emit('saved')
  }
  catch (caught) {
    error.value = caught instanceof Error && caught.message === 'Invalid local date'
      ? copy('截止时间无效，请调整后保存。', 'Invalid due date. Adjust it before saving.')
      : copy('保存未确认，草稿已保留。请刷新连接，并检查微软列表是否已有该事项；重试同一草稿不会重复提交。', 'Save was not confirmed; your draft is preserved. Refresh the connection and check the source. Retrying the same draft will not duplicate it.')
  }
  finally { saving.value = false }
}
watch(() => props.open, (open) => {
  if (open) {
    void load()
    void api.workAssistantStatus().then(status => aiAvailable.value = status.available).catch(() => { aiAvailable.value = false })
    void window.craftHubDesktop?.quickCaptureStatus?.().then(status => shortcutRegistered.value = status.registered)
  }
  else { generation++; clearTimeout(polling) }
}, { immediate: true })
onUnmounted(() => { generation++; clearTimeout(polling) })
</script>

<template>
  <DialogShell :open="open" layout="panel" content-class="dialog-content capture-dialog" @open-auto-focus="focusInput" @update:open="value => { if (!busy) emit('update:open', value) }">
    <template #title>{{ copy('快速记录', 'Quick capture') }}</template>
    <template #description>{{ copy('记录想法，存入 Microsoft To Do', 'Capture a thought in Microsoft To Do') }}</template>
    <template #header-actions><UiButton variant="ghost" size="icon" :disabled="busy" :aria-label="copy('关闭快速记录', 'Close quick capture')" @click="emit('update:open', false)"><Icon name="close" /></UiButton></template>
    <form :id="formId" class="capture-form" @submit.prevent="save">
      <div class="capture-connection"><span :class="{ connected: connection?.connected }"><Icon :name="connection?.connected ? 'check' : 'pending'" />{{ connection?.connected ? writable ? copy('已连接 · 可新增', 'Connected · Can create') : copy('已连接 · 只读', 'Connected · Read only') : copy('尚未连接', 'Not connected') }}</span><UiButton variant="ghost" size="icon" :disabled="busy || loading" :aria-label="copy('刷新连接', 'Refresh connection')" :title="copy('刷新连接', 'Refresh connection')" @click="load"><Icon :name="loading ? 'loading' : 'refresh'" /></UiButton></div>
      <div v-if="!writable && !loading" class="capture-authorization">
        <p>{{ copy('首次记录需要微软新增待办权限。', 'Task creation permission is required for your first capture.') }}</p>
        <UiButton variant="secondary" :disabled="busy" @click="authorize">{{ authorizing ? copy('正在连接…', 'Connecting…') : copy('授权新增待办', 'Authorize task creation') }}</UiButton>
        <p v-if="connection?.deviceAuthorization"><a :href="connection.deviceAuthorization.verificationUrl" target="_blank" rel="noopener noreferrer">{{ copy('打开微软授权页面', 'Open Microsoft authorization') }}</a> · <strong>{{ connection.deviceAuthorization.userCode }}</strong><br>{{ copy('输入此代码；授权完成后会自动更新。', 'Enter this code; the status updates automatically after authorization.') }}</p>
      </div>
      <label class="capture-label capture-composer"><span>{{ copy('记点什么', 'What is on your mind?') }}</span><textarea ref="captureInput" v-model="text" :disabled="busy" rows="2" :placeholder="copy('明天下午三点跟进发布 #任务 !重要', 'Tomorrow 15:00 follow up on release #Tasks !important')" @keydown.meta.enter.prevent="save" @keydown.ctrl.enter.prevent="save" /></label>
      <div class="capture-tools"><span>{{ copy('识别日期、#列表、!重要', 'Dates, #list, !important') }}</span><UiButton variant="ghost" size="compact" :disabled="busy || !aiAvailable || !text.trim() || loading" @click="analyze"><Icon :name="analyzing ? 'loading' : 'skill'" />{{ analyzing ? copy('正在理解…', 'Understanding…') : copy('AI 理解', 'Understand with AI') }}</UiButton></div>
      <div class="capture-preview">
        <h3>{{ copy('保存预览', 'Review before saving') }}</h3>
        <label class="capture-label capture-title">{{ copy('标题', 'Title') }}<input v-model="draft.title" :disabled="busy" maxlength="500" required></label>
        <div class="capture-fields"><label class="capture-label"><span><Icon name="list" />{{ copy('微软列表', 'Microsoft list') }}</span><select v-model="draft.listId" :disabled="busy || loading"><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.title }}</option></select></label><label class="capture-label"><span><Icon name="calendar" />{{ copy('日期与时间', 'Date and time') }}</span><input :value="draft.dueLocal ?? ''" type="datetime-local" :disabled="busy" @input="draft.dueLocal = ($event.target as HTMLInputElement).value || null"></label></div>
        <div class="capture-toggles">
          <label class="capture-important" :class="{ selected: draft.important }"><input v-model="draft.important" type="checkbox" :disabled="busy"><Icon :name="draft.important ? 'starFilled' : 'star'" />{{ copy('重要', 'Important') }}</label>
          <label v-if="draft.dueLocal" class="capture-important" :class="{ selected: draft.remind }"><input v-model="draft.remind" type="checkbox" :disabled="busy"><Icon name="calendar" />{{ copy('到时提醒', 'Remind me') }}</label>
        </div>
        <p v-if="draft.dueLocal" class="capture-hint">{{ copy('截止日期按天保存；提醒保留具体时间。', 'Due dates use a calendar day; reminders keep the exact time.') }}</p>
        <details class="capture-notes" :open="!!draft.notes"><summary><Icon name="docs" />{{ copy('备注', 'Notes') }}<Icon name="arrowDown" /></summary><label class="capture-label"><textarea v-model="draft.notes" :aria-label="copy('备注', 'Notes')" :disabled="busy" rows="2" /></label></details>
        <p v-for="warning in draft.warnings" :key="warning" class="capture-warning">{{ warning }}</p>
      </div>
      <p v-if="loading" role="status">{{ copy('正在读取微软列表…', 'Loading Microsoft lists…') }}</p>
      <p v-if="error" role="alert" class="capture-warning">{{ error }}</p>
      <p v-if="saved" role="status" class="capture-success">{{ saved }}</p>
      <p v-if="shortcutRegistered === false" class="capture-warning">{{ copy('全局快捷键被其他应用占用，可从首页打开快速记录。', 'The global shortcut is unavailable. Use Quick capture on Home.') }}</p>

    </form>
          <template #footer><div class="capture-actions"><span>{{ copy('⌘ / Ctrl + Enter 保存', '⌘ / Ctrl + Enter to save') }}</span><UiButton variant="primary" type="submit" :form="formId" :disabled="disabled">{{ saving ? copy('正在保存…', 'Saving…') : copy('保存到微软 To Do', 'Save to Microsoft To Do') }}</UiButton></div></template>
  </DialogShell>
</template>

<style>
.capture-dialog { --dialog-panel-width: 540px; --dialog-panel-padding: 20px; border-radius: 18px; }
.capture-dialog .dialog-panel-header { align-items: center; padding-bottom: 14px; background: var(--surface-subtle); }
.capture-dialog .dialog-panel-header h2 { font-size: 18px; letter-spacing: -.3px; }
.capture-dialog .dialog-panel-header p { font-size: 12px; }
.capture-dialog .dialog-panel-body { padding-top: 8px; }
.capture-form { display: grid; gap: 10px; }
.capture-connection, .capture-tools, .capture-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 11px; }
.capture-connection > span { display: inline-flex; gap: 5px; align-items: center; }
.capture-connection .app-icon { width: 13px; height: 13px; }
.capture-connection .ui-button--icon { width: 28px; height: 28px; }
.capture-connection .connected, .capture-success { color: var(--success); }
.capture-label { display: grid; gap: 5px; font-size: 11px; color: var(--muted); min-width: 0; }
.capture-label > span { display: inline-flex; align-items: center; gap: 5px; }
.capture-label > span .app-icon { width: 13px; height: 13px; }
.capture-label input, .capture-label textarea, .capture-label select { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); padding: 8px 10px; font: inherit; font-size: 13px; }
.capture-label input:focus-visible, .capture-label textarea:focus-visible, .capture-label select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.capture-label textarea { resize: vertical; max-height: 180px; }
.capture-composer > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.capture-composer textarea { background: var(--surface-subtle); font-size: 15px; line-height: 1.6; padding: 12px; min-height: 76px; }
.capture-tools { margin-top: -6px; }
.capture-preview { display: grid; gap: 12px; border-top: 1px solid var(--border); padding-top: 12px; }
.capture-preview h3 { margin: 0; font-size: 12px; font-weight: 600; }
.capture-fields { display: grid; grid-template-columns: 1fr 1.2fr; gap: 12px; }
.capture-toggles { display: flex; flex-wrap: wrap; gap: 8px; }
.capture-important { position: relative; display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 7px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.capture-important input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.capture-important:has(:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.capture-important:has(:disabled) { cursor: default; opacity: .5; }
.capture-important .app-icon { width: 14px; height: 14px; }
.capture-important.selected { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.capture-notes summary { display: flex; align-items: center; gap: 6px; min-height: 28px; cursor: pointer; font-size: 12px; color: var(--muted); list-style: none; }
.capture-notes summary::-webkit-details-marker { display: none; }
.capture-notes summary:focus-visible { outline: 2px solid var(--focus-ring); border-radius: 4px; }
.capture-notes summary .app-icon { width: 14px; height: 14px; }
.capture-notes summary .app-icon:last-child { margin-left: auto; }
.capture-notes[open] summary .app-icon:last-child { transform: rotate(180deg); }
.capture-hint { color: var(--muted); font-size: 11px; margin: -6px 0 0; line-height: 1.5; }
.capture-warning, .capture-success { font-size: 12px; overflow-wrap: anywhere; margin: 0; line-height: 1.6; }
.capture-warning { color: var(--warning); }
.capture-authorization { display: grid; gap: 10px; padding: 12px; background: var(--surface-subtle); border-radius: 8px; font-size: 12px; }
.capture-authorization p { margin: 0; }
.capture-actions { width: 100%; }
.capture-actions > button { flex: none; }
@media (max-width: 480px) { .capture-dialog { --dialog-panel-padding: 16px; } .capture-fields { grid-template-columns: 1fr; gap: 10px; } .capture-actions > span { display: none; } .capture-actions > button { width: 100%; } }
</style>
