<script setup lang="ts">
import type { IntegrationActionResult, IntegrationContribution, ResolvedIntegrationAction } from 'craft-hub'
import { computed, ref, useId } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Checkbox } from './components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'

const props = defineProps<{
  integrationId: string
  projectId?: string
  projectTitle?: string
  block: IntegrationContribution['views'][number]['blocks'][number]
  action: ResolvedIntegrationAction
  translate: (value: string) => string
}>()
const emit = defineEmits<{ completed: [result: IntegrationActionResult] }>()
const { t } = useI18n()
const formId = useId()
const values = ref<Record<string, string>>(Object.fromEntries((props.block.fields ?? []).map(field => [field.id, String(field.value ?? '')])))
const formElement = ref<HTMLFormElement>()
const pending = ref<Record<string, unknown>>()
function insert(id: string, value: string): void {
  const textarea = Array.from(formElement.value?.querySelectorAll('textarea') ?? []).find(element => element.dataset.fieldId === id)
  const content = values.value[id] ?? ''
  const start = textarea?.selectionStart ?? content.length
  const end = textarea?.selectionEnd ?? start
  values.value[id] = content.slice(0, start) + value + content.slice(end)
  textarea?.focus()
}
const saving = ref(false)
const error = ref('')
const missing = computed(() => props.block.fields?.some(field => field.required && !String(values.value[field.id] ?? '').trim()))

function submit(): void {
  if (missing.value || saving.value)
    return
  error.value = ''
  const input: Record<string, unknown> = { ...props.block.input }
  for (const field of props.block.fields ?? []) {
    const rawValue = String(values.value[field.id] ?? '')
    const value = field.type === 'textarea' ? rawValue : rawValue.trim()
    if (field.type === 'checkbox') {
      input[field.id] = values.value[field.id] === 'true'
      continue
    }
    if (!value && field.value === undefined)
      continue
    input[field.id] = field.type === 'number' ? Number(value) : field.type === 'string-list' ? value.split(',').map(item => item.trim()).filter(Boolean) : value
  }
  if (props.action.effectiveConfirmation !== 'never')
    pending.value = input
  else
    void invoke(input, false)
}

async function invoke(input: Record<string, unknown>, confirmed: boolean): Promise<void> {
  if (saving.value)
    return
  saving.value = true
  error.value = ''
  try {
    const result = await api.invokeIntegrationAction(props.integrationId, props.action.id, input, props.projectId, confirmed)
    emit('completed', result)
    pending.value = undefined
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <form ref="formElement" class="integration-action-form" @submit.prevent="submit">
    <FieldGroup>
      <Field v-for="field in block.fields" :key="field.id" :data-disabled="saving" :data-field-type="field.type" :orientation="field.type === 'checkbox' ? 'horizontal' : 'vertical'">
        <FieldLabel :for="`${formId}-${field.id}`">{{ translate(field.label) }}{{ field.required ? ' *' : '' }}</FieldLabel>
        <Checkbox v-if="field.type === 'checkbox'" :id="`${formId}-${field.id}`" :model-value="values[field.id] === 'true'" @update:model-value="values[field.id] = $event === true ? 'true' : 'false'" :disabled="saving" />
        <FormSelect v-else-if="field.type === 'select'" :id="`${formId}-${field.id}`" v-model="values[field.id]" :options="field.options?.map(option => ({ value: option.value, label: translate(option.label) }))" :required="field.required" :disabled="saving" />
        <Textarea v-else-if="field.type === 'textarea'" :id="`${formId}-${field.id}`" :data-field-id="field.id" v-model="values[field.id]" :required="field.required" :placeholder="translate(field.placeholder ?? '')" :disabled="saving" />
        <Input v-else :id="`${formId}-${field.id}`" v-model="values[field.id]" :type="field.type === 'number' ? 'number' : 'text'" :required="field.required" :placeholder="translate(field.placeholder ?? '')" :disabled="saving" />
        <span v-if="field.suggestions?.length" class="field-suggestions">
          <UiButton v-for="suggestion in field.suggestions" :key="suggestion.value" size="compact" :disabled="saving" @click.prevent="insert(field.id, suggestion.value)">{{ suggestion.label }}</UiButton>
        </span>
      </Field>
    </FieldGroup>
    <p v-if="error" role="alert">{{ error }}</p>
    <UiButton variant="primary" type="submit" :disabled="saving || missing">{{ translate(action.title) }}</UiButton>
  </form>
  <DialogShell :open="Boolean(pending)" @update:open="!saving && !$event && (pending = undefined)">
    <template #title>{{ translate(action.title) }}</template>
    <template #description>{{ t('integrationReviewAction') }}</template>
    <p v-if="projectTitle"><strong>{{ projectTitle }}</strong></p>
    <dl class="action-review">
      <div v-for="(value, key) in Object.fromEntries(Object.entries(pending ?? {}).filter(([id]) => block.fields?.some(field => field.id === id)))" :key="key">
        <dt>{{ translate(block.fields?.find(field => field.id === key)?.label ?? String(key)) }}</dt>
        <dd>{{ Array.isArray(value) ? value.join(', ') : value }}</dd>
      </div>
    </dl>
    <p v-if="error" role="alert">{{ error }}</p>
    <footer>
      <UiButton :disabled="saving" @click="pending = undefined">{{ t('cancel') }}</UiButton>
      <UiButton variant="primary" :disabled="saving" @click="pending && invoke(pending, true)">{{ t('integrationConfirmAction') }}</UiButton>
    </footer>
  </DialogShell>
</template>

<style scoped>
.integration-action-form { display: grid; gap: 10px; padding: 12px; }
.field-suggestions { display: flex; flex-wrap: wrap; gap: 4px; }

.action-review { max-height: 45vh; overflow: auto; display: grid; gap: 12px; }
.action-review dt { color: var(--muted); font-size: 12px; }
.action-review dd { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
footer { display: flex; justify-content: flex-end; gap: 8px; }
[role=alert] { color: var(--danger); }
@media (min-width: 761px) {
  .integration-action-form > :deep([data-slot='field-group']) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .integration-action-form :deep([data-field-type='textarea']), .integration-action-form :deep([data-field-type='checkbox']) { grid-column: 1 / -1; }
}
</style>
