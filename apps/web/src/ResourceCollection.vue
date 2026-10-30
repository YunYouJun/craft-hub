<script setup lang="ts">
import type { ResourceInput, ResourcePage } from 'craft-hub'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyText } from './clipboard'
import Icon from './NavigationIcon.vue'
import { useI18n } from './i18n'

const props = defineProps<{ page: ResourcePage, disabled?: boolean }>()
const emit = defineEmits<{ input: [input: ResourceInput], edit: [input: ResourceInput] }>()
const { locale } = useI18n()
const label = (zh: string, en: string): string => locale.value === 'zh-CN' ? zh : en
const collection = computed(() => props.page.collection!)
const fields = computed(() => props.page.forms?.find(form => form.id === collection.value.filterFormId)?.fields ?? [])
const selected = ref(new Set<string>())
const feedback = ref('')
const draftInput = ref<ResourceInput>({ ...props.page.input })
const hidden = computed(() => [...selected.value].filter(id => !collection.value.rows.some(row => row.id === id)).length)
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => collection.value.selectedIds, ids => { selected.value = new Set(ids) }, { immediate: true })
watch(() => props.page.input, input => { if (!timer) draftInput.value = { ...input } })
function select(ids: Set<string>): void {
  selected.value = ids
  clearTimeout(timer)
  timer = undefined
  draftInput.value = { ...draftInput.value, selection: 'custom', [collection.value.selectionInput]: [...ids].join(',') }
  emit('input', draftInput.value)
}
function toggle(id: string, checked: boolean): void {
  const ids = new Set(selected.value)
  if (checked) ids.add(id)
  else ids.delete(id)
  select(ids)
}
function filter(id: string, value: string | boolean, debounce = false): void {
  clearTimeout(timer)
  timer = undefined
  const input = { ...draftInput.value, [id]: value }
  draftInput.value = input
  if (debounce) timer = setTimeout(() => { timer = undefined; emit('input', input) }, 300)
  else emit('input', input)
}
async function copy(value: string): Promise<void> {
  try { await copyText(value); feedback.value = label('已复制', 'Copied') }
  catch { feedback.value = label('复制失败，可选择文本手动复制', 'Copy failed. Select the text to copy manually.') }
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="resource-collection">
    <p v-if="page.browserImport" class="collection-local-note">{{ label('账号来源导入和密码查看、复制请在原生桌面工作台操作；密码仅保存在本机。', 'Import and password actions are available in the native desktop workbench. Passwords stay on this Mac.') }}</p>
    <div class="collection-filters">
      <label v-for="field in fields" :key="field.id">
        <span>{{ field.label }}</span>
        <select v-if="field.type === 'select'" :value="String(field.value ?? '')" :disabled="disabled" @change="filter(field.id, ($event.target as HTMLSelectElement).value)">
          <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <input v-else-if="field.type === 'checkbox'" type="checkbox" :checked="field.value === true" :disabled="disabled" @change="filter(field.id, ($event.target as HTMLInputElement).checked)">
        <input v-else type="search" :value="String(field.value ?? '')" :placeholder="field.placeholder" :disabled="disabled" @input="filter(field.id, ($event.target as HTMLInputElement).value, true)">
      </label>
    </div>
    <div class="collection-selection">
      <span>{{ label(`当前 ${collection.rows.length} 条，已选 ${selected.size} 条`, `${collection.rows.length} shown, ${selected.size} selected`) }}</span>
      <span v-if="hidden">{{ label(`其他筛选中 ${hidden} 条`, `${hidden} outside this filter`) }}</span>
      <button :disabled="disabled || !collection.rows.length" @click="select(new Set([...selected, ...collection.rows.map(row => row.id)]))">{{ label('全选当前结果', 'Select Shown') }}</button>
      <button :disabled="disabled || !selected.size" @click="select(new Set())">{{ label('清空选择', 'Clear Selection') }}</button>
    </div>
    <div class="collection-scroll">
      <table>
        <thead><tr><th>{{ label('选择', 'Select') }}</th><th v-for="column in collection.columns" :key="column.id">{{ column.label }}</th><th>{{ label('操作', 'Actions') }}</th></tr></thead>
        <tbody>
          <tr v-for="row in collection.rows" :key="row.id">
            <td><input type="checkbox" :checked="selected.has(row.id)" :disabled="disabled" :aria-label="label(`选择 ${Object.values(row.cells)[0]}`, `Select ${Object.values(row.cells)[0]}`)" @change="toggle(row.id, ($event.target as HTMLInputElement).checked)"></td>
            <td v-for="column in collection.columns" :key="column.id">{{ row.cells[column.id] }}</td>
            <td class="collection-row-actions">
              <button :disabled="disabled || !row.copyValue" :aria-label="label('复制值', 'Copy Value')" @click="copy(row.copyValue)"><Icon name="copy" /></button>
              <button v-if="row.input" :disabled="disabled" @click="emit('edit', row.input)">{{ label('编辑', 'Edit') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!collection.rows.length">{{ label('没有匹配的记录，请调整筛选或导入已有清单。', 'No matching records. Adjust filters or import your list.') }}</p>
    <p role="status" aria-live="polite">{{ feedback }}</p>
  </div>
</template>

<style scoped>
.resource-collection { display: grid; gap: 12px; min-width: 0; }
.collection-local-note { color: var(--muted); font-size: var(--font-size-control); }
.collection-filters, .collection-selection { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.collection-filters label { display: flex; align-items: center; gap: 6px; }
.collection-filters input[type='search'] { min-width: 180px; }
.collection-selection { font-size: var(--font-size-control); }
.collection-selection > span { color: var(--muted); }
.collection-scroll { overflow: auto; max-height: 540px; }
table { width: 100%; border-collapse: collapse; text-align: start; font-size: var(--font-size-body); }
th { position: sticky; top: 0; background: var(--surface); font-weight: 600; }
td, th { padding: 9px 10px; border-bottom: 1px solid var(--border); text-align: start; white-space: nowrap; }
td { user-select: text; }
.collection-row-actions { display: flex; align-items: center; gap: 8px; }
button, select, input[type='search'] { padding: 5px 8px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--text); font: inherit; }
button:disabled { opacity: .45; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button .app-icon { width: 15px; height: 15px; }
</style>
