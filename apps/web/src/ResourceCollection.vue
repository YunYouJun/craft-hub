<script setup lang="ts">
import type { ResourceInput, ResourcePage } from 'craft-hub'
import type { ResourceDesktopContext, ResourceDesktopSession } from './resource-desktop'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyText } from './clipboard'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import Input from './components/ui/input/Input.vue'
import { FormSelect } from './components/ui/select'
import DataTable from './components/ui/table/DataTable.vue'
import ActionToast from './components/ui/toast/ActionToast.vue'
import { useI18n } from './i18n'
import Icon from './NavigationIcon.vue'
import ResourceSecretCell from './ResourceSecretCell.vue'

const props = defineProps<{ page: ResourcePage, disabled?: boolean, nativeContext?: ResourceDesktopContext }>()
const emit = defineEmits<{ input: [input: ResourceInput], edit: [input: ResourceInput] }>()
const { locale } = useI18n()
const label = (zh: string, en: string): string => locale.value === 'zh-CN' ? zh : en
const collection = computed(() => props.page.collection!)
const fields = computed(() => props.page.forms?.find(form => form.id === collection.value.filterFormId)?.fields ?? [])
const selected = ref(new Set<string>())
const feedback = ref<{ id: number, title: string, error?: boolean }>()
const session = ref<ResourceDesktopSession>()
const nativeError = ref(false)
const pendingInput = ref(false)
const importing = ref(false)
const nativeAvailable = !!window.craftHubDesktop?.openResourceSession && !!window.craftHubDesktop.resourceCredential && !!window.craftHubDesktop.importResourceAccounts
let sessionGeneration = 0
function notify(title: string, error = false): void {
  feedback.value = { id: (feedback.value?.id ?? 0) + 1, title, error }
}
watch(() => [props.page, props.nativeContext] as const, async () => {
  const stamp = ++sessionGeneration
  session.value = undefined
  nativeError.value = false
  if (!nativeAvailable || !props.nativeContext || !props.page.browserImport)
    return
  try {
    const result = await window.craftHubDesktop!.openResourceSession!(props.nativeContext)
    if (stamp === sessionGeneration)
      session.value = result
  }
  catch {
    if (stamp === sessionGeneration)
      nativeError.value = true
  }
}, { immediate: true })
async function importAccounts(): Promise<void> {
  if (!session.value)
    return
  importing.value = true
  try {
    const result = await window.craftHubDesktop!.importResourceAccounts!(session.value.sessionId)
    if (result.imported) {
      pendingInput.value = true
      emit('input', { ...props.page.input })
      notify(label('账号已导入', 'Accounts imported'))
    }
  }
  catch { notify(label('账号导入失败，请刷新重试', 'Account import failed. Refresh and retry.'), true) }
  finally { importing.value = false }
}
const copyDocuments = computed(() => (collection.value.copyDocumentIds ?? []).flatMap(id => props.page.documents?.filter(document => document.id === id) ?? []))
const draftInput = ref<ResourceInput>({ ...props.page.input })
const hidden = computed(() => [...selected.value].filter(id => !collection.value.rows.some(row => row.id === id)).length)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => collection.value.selectedIds, (ids) => {
  selected.value = new Set(ids)
}, { immediate: true })
watch(() => props.page.input, (input) => {
  if (!timer)
    draftInput.value = { ...input }
})
watch(() => props.page, () => {
  if (!timer)
    pendingInput.value = false
})
function select(ids: Set<string>): void {
  selected.value = ids
  clearTimeout(timer)
  timer = undefined
  draftInput.value = { ...draftInput.value, selection: 'custom', [collection.value.selectionInput]: [...ids].join(',') }
  pendingInput.value = true
  emit('input', draftInput.value)
}
function toggle(id: string, checked: boolean): void {
  const ids = new Set(selected.value)
  if (checked)
    ids.add(id)
  else ids.delete(id)
  select(ids)
}
function filter(id: string, value: string | boolean, debounce = false): void {
  clearTimeout(timer)
  timer = undefined
  const input = { ...draftInput.value, [id]: value }
  draftInput.value = input
  pendingInput.value = true
  if (debounce) {
    timer = setTimeout(() => {
      timer = undefined
      emit('input', input)
    }, 300)
  }
  else {
    emit('input', input)
  }
}
async function copy(value: string): Promise<void> {
  try {
    await copyText(value)
    notify(label('已复制', 'Copied'))
  }
  catch { notify(label('复制失败，可选择文本手动复制', 'Copy failed. Select the text to copy manually.'), true) }
}
onBeforeUnmount(() => {
  sessionGeneration++
  clearTimeout(timer)
  if (session.value && window.craftHubDesktop?.closeResourceSession)
    void window.craftHubDesktop.closeResourceSession(session.value.sessionId).catch(() => {})
})
</script>

<template>
  <section class="resource-collection" :aria-label="page.title">
    <div v-if="page.browserImport" class="collection-source">
      <Button v-if="nativeAvailable && nativeContext" size="compact" :disabled="disabled || !session || importing" @click="importAccounts">
        <Icon :name="importing ? 'loading' : 'refresh'" />{{ page.browserImport.title }}
      </Button>
      <p v-else class="collection-local-note">
        {{ label('账号来源导入和密码操作可在 macOS App 中使用，密码仅保存在本机。', 'Account imports and local passwords are available in the macOS app. Passwords stay on this Mac.') }}
      </p>
      <span v-if="nativeError" role="status">{{ label('本机密码连接不可用，请刷新重试', 'Local password connection unavailable. Refresh and retry.') }}</span>
    </div>
    <div class="resource-collection-filters">
      <label v-for="field in fields" :key="field.id" class="resource-collection-filter">
        <span>{{ field.label }}</span>
        <FormSelect v-if="field.type === 'select'" :model-value="String(field.value ?? '')" :options="field.options" :aria-label="field.label" :disabled="disabled" @update:model-value="filter(field.id, $event)" />
        <Checkbox v-else-if="field.type === 'checkbox'" :model-value="field.value === true" :aria-label="field.label" :disabled="disabled" @update:model-value="filter(field.id, $event === true)" />
        <Input v-else type="search" :model-value="String(field.value ?? '')" :placeholder="field.placeholder" :aria-label="field.label" :disabled="disabled" @update:model-value="filter(field.id, $event, true)" />
      </label>
    </div>
    <div class="collection-actions">
      <Button v-for="(document, index) in copyDocuments" :key="document.id" size="compact" :variant="index ? 'secondary' : 'primary'" :disabled="disabled || pendingInput || !document.content" @click="copy(document.content)">
        <Icon name="copy" />{{ document.title }}
      </Button>
      <span class="collection-action-spacer" />
      <Button size="compact" variant="ghost" :disabled="disabled || !collection.rows.length" @click="select(new Set([...selected, ...collection.rows.map(row => row.id)]))">
        {{ label('全选当前结果', 'Select Shown') }}
      </Button>
      <Button size="compact" variant="ghost" :disabled="disabled || !selected.size" @click="select(new Set())">
        {{ label('清空选择', 'Clear Selection') }}
      </Button>
    </div>
    <div class="collection-selection">
      <span>{{ label(`当前 ${collection.rows.length} 条，已选 ${selected.size} 条`, `${collection.rows.length} shown, ${selected.size} selected`) }}</span>
      <span v-if="hidden">{{ label(`其他筛选中 ${hidden} 条`, `${hidden} outside this filter`) }}</span>
    </div>
    <DataTable :label="page.title">
      <thead>
        <tr>
          <th>{{ label('选择', 'Select') }}</th><th v-for="column in collection.columns" :key="column.id">
            {{ column.label }}
          </th><th>{{ label('操作', 'Actions') }}</th><th v-if="nativeAvailable && nativeContext">
            {{ label('本机密码', 'Local Password') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in collection.rows" :key="row.id" :data-selected="selected.has(row.id)">
          <td><Checkbox :model-value="selected.has(row.id)" :disabled="disabled" :aria-label="label(`选择 ${Object.values(row.cells)[0]}`, `Select ${Object.values(row.cells)[0]}`)" @update:model-value="toggle(row.id, $event === true)" /></td>
          <td v-for="column in collection.columns" :key="column.id" :class="{ 'collection-value': row.cells[column.id] === row.copyValue }">
            {{ row.cells[column.id] }}
          </td>
          <td>
            <div class="collection-row-actions">
              <Button size="compact" variant="ghost" :disabled="disabled || !row.copyValue" :aria-label="label('复制值', 'Copy Value')" @click="copy(row.copyValue)">
                <Icon name="copy" />
              </Button>
              <Button v-if="row.input" size="compact" variant="ghost" :disabled="disabled" :aria-label="label('编辑记录', 'Edit Record')" @click="emit('edit', row.input)">
                <Icon name="edit" />
              </Button>
            </div>
          </td>
          <td v-if="nativeAvailable && nativeContext">
            <ResourceSecretCell v-if="row.credentialKey && session" :row-id="row.id" :session="session" :disabled="disabled" :chinese="locale === 'zh-CN'" @feedback="notify" />
            <span v-else class="collection-local-note">{{ row.credentialKey ? label('正在连接…', 'Connecting…') : '—' }}</span>
          </td>
        </tr>
      </tbody>
    </DataTable>
    <p v-if="!collection.rows.length" class="collection-empty">
      {{ label('没有匹配的记录，请调整筛选或导入已有清单。', 'No matching records. Adjust filters or import your list.') }}
    </p>
    <ActionToast :message="feedback" />
  </section>
</template>

<style scoped>
.resource-collection { display: grid; gap: 12px; min-width: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.collection-source, .resource-collection-filters, .collection-actions, .collection-selection, .collection-row-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.resource-collection-filters { gap: 14px; padding-block: 4px; }
.resource-collection-filter { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--font-size-control); }
.resource-collection-filter > span { flex: none; white-space: nowrap; }
.resource-collection-filter:has(input[type='search']) { flex: 1 1 200px; }
.resource-collection-filter input[type='search'] { width: 100%; min-width: 140px; }
.resource-collection-filter :deep([data-slot='select-trigger']) { width: auto; min-width: 104px; height: var(--control-height-default); }
.collection-selection, .collection-local-note, .collection-source > span { color: var(--text-secondary); font-size: var(--font-size-control); }
.collection-action-spacer { flex: 1; }
.collection-row-actions { flex-wrap: nowrap; gap: 2px; }
.collection-row-actions .ui-button { padding-inline: 6px; }
.collection-value { font-family: ui-monospace, SFMono-Regular, monospace; font-variant-numeric: tabular-nums; }
.collection-empty { padding: 20px; text-align: center; color: var(--text-secondary); }
@media (max-width: 640px) { .collection-actions > .ui-button { flex: 1 1 auto; } .collection-action-spacer { display: none; } .resource-collection-filter { flex: 1 1 auto; } }
</style>
