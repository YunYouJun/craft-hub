<script setup lang="ts">
import type { IntegrationEntity, IntegrationStatusTransition, IntegrationStatusTransitionPage } from 'craft-hub'
import { computed, ref } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{
  entity: IntegrationEntity
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
}>()
const emit = defineEmits<{ updated: [entity: IntegrationEntity] }>()
const { t } = useI18n()

const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const transitions = ref<IntegrationStatusTransition[]>([])
const selectedId = ref('')
const fields = ref<Record<string, string>>({})
const selected = computed(() => transitions.value.find(transition => transition.id === selectedId.value))
const missingFields = computed(() => selected.value?.requiredFields.filter(name => !fields.value[name]?.trim()) ?? [])

function entityInput(): Record<string, unknown> {
  return {
    ...props.entity.metadata,
    itemId: props.entity.id,
    title: props.entity.title,
    currentStatus: props.entity.status ?? '',
  }
}

async function show(): Promise<void> {
  open.value = true
  loading.value = true
  error.value = ''
  transitions.value = []
  selectedId.value = ''
  fields.value = {}
  try {
    const result = await api.invokeIntegrationAction<IntegrationStatusTransitionPage>(
      props.integrationId,
      props.transitionsActionId,
      entityInput(),
      props.projectId,
    )
    transitions.value = result.transitions
    selectedId.value = result.transitions[0]?.id ?? ''
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}

function selectTransition(): void {
  fields.value = {}
}

async function confirm(): Promise<void> {
  if (!selected.value || missingFields.value.length)
    return
  saving.value = true
  error.value = ''
  try {
    const result = await api.invokeIntegrationAction<IntegrationEntity>(
      props.integrationId,
      props.updateActionId,
      {
        ...entityInput(),
        transitionId: selected.value.id,
        status: selected.value.toStatus,
        fields: fields.value,
      },
      props.projectId,
      true,
    )
    emit('updated', {
      ...props.entity,
      ...result,
      metadata: result.metadata ?? props.entity.metadata,
    })
    open.value = false
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
  <UiButton class="integration-status-trigger" size="compact" :aria-label="`${t('changeWorkItemStatus')}: ${entity.title}`" @click="show">
    <Icon name="edit" />
    {{ t('changeWorkItemStatus') }}
  </UiButton>

  <DialogShell :open="open" content-class="dialog-content integration-status-dialog" data-testid="integration-status-dialog" @update:open="open = $event">
    <template #title>{{ t('statusTransitionTitle') }}</template>
    <template #description>{{ t('statusTransitionDescription') }}</template>

    <div class="integration-status-item">
      <strong>{{ entity.title }}</strong>
      <small>#{{ entity.id }}<template v-if="entity.status"> · {{ entity.status }}</template></small>
    </div>

    <p v-if="loading" class="integration-status-loading"><Icon name="loading" /> {{ t('loadingStatusTransitions') }}</p>
    <div v-else class="integration-status-body">
      <p v-if="error" class="integration-status-error" role="alert">{{ error }}</p>

      <template v-if="transitions.length">
        <label class="integration-status-field">
          <span>{{ t('statusTransitionTarget') }}</span>
          <select v-model="selectedId" data-testid="status-transition-select" @change="selectTransition">
            <option v-for="transition in transitions" :key="transition.id" :value="transition.id">
              {{ transition.title }} · {{ transition.toStatus }}
            </option>
          </select>
        </label>

        <div v-if="selected" class="integration-status-preview">
          <strong>{{ selected.fromStatus }}</strong>
          <Icon name="arrowRight" />
          <strong>{{ selected.toStatus }}</strong>
        </div>

        <fieldset v-if="selected?.requiredFields.length" class="integration-status-required">
          <legend>{{ t('statusTransitionRequiredFields') }}</legend>
          <label v-for="field in selected.requiredFields" :key="field" class="integration-status-field">
            <span>{{ field }} <b aria-hidden="true">*</b></span>
            <input v-model="fields[field]" :name="field" required>
          </label>
        </fieldset>
      </template>
      <p v-else-if="!error" class="integration-status-empty">{{ t('statusTransitionNoOptions') }}</p>

      <p class="integration-status-warning"><Icon name="error" /> {{ t('statusTransitionRemoteWarning') }}</p>
    </div>

    <footer class="dialog-actions">
      <UiButton :disabled="saving" @click="open = false">{{ t('cancel') }}</UiButton>
      <UiButton variant="warning" data-testid="confirm-status-transition" :disabled="loading || saving || !selected || missingFields.length > 0" @click="confirm">
        <Icon v-if="saving" name="loading" />
        {{ t('confirmStatusTransition') }}
      </UiButton>
    </footer>
  </DialogShell>
</template>

<style scoped>
.integration-status-trigger { flex: none; white-space: nowrap; }
.integration-status-trigger .app-icon { width: 14px; height: 14px; }
.integration-status-dialog { width: min(500px, calc(100vw - 40px)); }
.integration-status-item { display: grid; gap: 3px; margin: 17px 0; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-muted); padding: 11px 12px; }
.integration-status-item strong { overflow: hidden; font-size: var(--font-size-emphasis); text-overflow: ellipsis; white-space: nowrap; }
.integration-status-item small { color: var(--muted); font-size: var(--font-size-caption); }
.integration-status-loading { display: flex; min-height: 110px; align-items: center; justify-content: center; gap: 8px; color: var(--muted); }
.integration-status-loading .app-icon { width: 16px; height: 16px; }
.integration-status-body { display: grid; gap: 14px; }
.integration-status-error { margin: 0; border-radius: 7px; background: var(--danger-soft); padding: 9px 10px; color: var(--danger); font-size: var(--font-size-body); }
.integration-status-field { display: grid; gap: 6px; }
.integration-status-field > span, .integration-status-required legend { font-size: var(--font-size-body); font-weight: 650; }
.integration-status-field b { color: var(--danger); }
.integration-status-field select, .integration-status-field input { width: 100%; min-width: 0; height: 36px; outline: none; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--surface); padding: 0 9px; color: var(--text); font: inherit; font-size: var(--font-size-body); }
.integration-status-field select:focus-visible, .integration-status-field input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.integration-status-preview { display: flex; align-items: center; gap: 9px; border-left: 2px solid var(--accent); background: var(--accent-soft); padding: 9px 10px; font-size: var(--font-size-body); }
.integration-status-preview .app-icon { width: 15px; height: 15px; color: var(--muted); }
.integration-status-preview strong:last-child { color: var(--accent); }
.integration-status-required { display: grid; gap: 10px; margin: 0; border: 0; padding: 0; }
.integration-status-required legend { margin-bottom: 9px; color: var(--muted); font-weight: 500; }
.integration-status-empty { margin: 0; border: 1px dashed var(--border-strong); border-radius: 8px; padding: 18px; color: var(--muted); font-size: var(--font-size-body); text-align: center; }
.integration-status-warning { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--warning); font-size: var(--font-size-control); }
.integration-status-warning .app-icon { width: 15px; height: 15px; }
@media (max-width: 720px) { .integration-status-trigger { width: 32px; padding: 0; font-size: 0; } }
</style>
