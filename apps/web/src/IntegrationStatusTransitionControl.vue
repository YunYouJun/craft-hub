<script setup lang="ts">
import type { IntegrationEntity, IntegrationStatusTransition, IntegrationStatusTransitionPage } from 'craft-hub'
import { workItemActionInput } from 'craft-hub/work-items'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { computed, ref, useId, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import IntegrationEntityStatus from './IntegrationEntityStatus.vue'
import { useI18n } from './i18n'

const props = defineProps<{
  entity: IntegrationEntity
  integrationId: string
  projectId?: string
  transitionsActionId: string
  updateActionId: string
  trigger?: 'button' | 'status'
}>()
const emit = defineEmits<{ updated: [entity: IntegrationEntity] }>()
const { t } = useI18n()
const titleId = useId()
const descriptionId = useId()
const open = ref(false)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const transitions = ref<IntegrationStatusTransition[]>([])
const selectedId = ref('')
const fields = ref<Record<string, string>>({})
const triggerElement = ref<HTMLButtonElement>()
const interactedOutside = ref(false)
const selected = computed(() => transitions.value.find(transition => transition.id === selectedId.value))
const missingFields = computed(() => selected.value?.requiredFields.filter(name => !fields.value[name]?.trim()) ?? [])
const contextKey = computed(() => JSON.stringify([props.integrationId, props.projectId, props.transitionsActionId, props.updateActionId, entityInput()]))
let requestGeneration = 0

function entityInput(): Record<string, unknown> {
  return {
    ...workItemActionInput(props.entity),
    title: props.entity.title,
    currentStatus: props.entity.status ?? '',
  }
}

function captureTrigger(event: MouseEvent): void {
  triggerElement.value = event.currentTarget as HTMLButtonElement
}

async function setOpen(value: boolean): Promise<void> {
  if (saving.value)
    return
  open.value = value
  const generation = ++requestGeneration
  if (!value)
    return
  interactedOutside.value = false
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
    if (generation === requestGeneration && open.value)
      transitions.value = result.transitions
  }
  catch (caught) {
    if (generation === requestGeneration && open.value)
      error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (generation === requestGeneration)
      loading.value = false
  }
}

function selectTransition(value: unknown): void {
  if (typeof value !== 'string' || saving.value)
    return
  selectedId.value = value
  fields.value = {}
  error.value = ''
}

function interactOutside(event: Event): void {
  if (saving.value)
    event.preventDefault()
  else
    interactedOutside.value = true
}

function restoreTriggerFocus(event: Event): void {
  event.preventDefault()
  if (!interactedOutside.value && triggerElement.value?.isConnected)
    triggerElement.value.focus({ preventScroll: true })
}

watch(contextKey, () => {
  requestGeneration++
  open.value = false
  transitions.value = []
  selectedId.value = ''
  fields.value = {}
})

async function confirm(): Promise<void> {
  if (saving.value || !selected.value || missingFields.value.length)
    return
  const context = contextKey.value
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
        fields: { ...fields.value },
      },
      props.projectId,
      true,
    )
    if (context !== contextKey.value)
      return
    emit('updated', {
      ...props.entity,
      ...result,
      metadata: result.metadata ?? props.entity.metadata,
    })
    open.value = false
  }
  catch (caught) {
    if (context === contextKey.value)
      error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <PopoverRoot :open="open" :modal="false" @update:open="setOpen">
    <PopoverTrigger as-child>
      <button
        v-if="trigger === 'status'" type="button" class="integration-status-trigger integration-status-badge-trigger"
        :aria-label="`${t('changeWorkItemStatus')}: ${entity.title} · ${entity.statusLabel || entity.status}`"
        :title="t('changeWorkItemStatus')" @click="captureTrigger"
      >
        <IntegrationEntityStatus :entity="entity" />
        <Icon name="arrowDown" />
      </button>
      <UiButton v-else class="integration-status-trigger" size="compact" :aria-label="`${t('changeWorkItemStatus')}: ${entity.title}`" @click="captureTrigger">
        <Icon name="edit" />
        {{ t('changeWorkItemStatus') }}
      </UiButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="integration-status-popover" data-testid="integration-status-popover" side="bottom" align="end"
        :side-offset="6" :collision-padding="12" position-strategy="fixed"
        :aria-labelledby="titleId" :aria-describedby="descriptionId"
        @close-auto-focus="restoreTriggerFocus" @interact-outside="interactOutside" @escape-key-down="saving && $event.preventDefault()"
      >
        <header class="integration-status-heading">
          <strong :id="titleId">{{ t('statusTransitionTarget') }}</strong>
          <p :id="descriptionId" :title="entity.title">{{ entity.title }}</p>
        </header>
        <div class="integration-status-body">
          <p v-if="loading" class="integration-status-loading" role="status"><Icon name="loading" /> {{ t('loadingStatusTransitions') }}</p>
          <template v-else>
            <p v-if="error" class="integration-status-error" role="alert">{{ error }}</p>
            <RadioGroupRoot
              v-if="transitions.length" :model-value="selectedId" :aria-label="t('statusTransitionTarget')" :disabled="saving"
              class="integration-status-options" @update:model-value="selectTransition"
            >
              <RadioGroupItem
                v-for="transition in transitions" :key="transition.id" :value="transition.id" :data-transition-id="transition.id"
                class="integration-status-option" :disabled="saving"
              >
                <span>{{ transition.title }}</span>
                <Icon v-if="selectedId === transition.id" name="check" />
              </RadioGroupItem>
            </RadioGroupRoot>
            <p v-else-if="!error" class="integration-status-empty">{{ t('statusTransitionNoOptions') }}</p>
            <template v-if="selected">
              <div class="integration-status-preview">
                <span>{{ entity.statusLabel || selected.fromStatus }}</span>
                <Icon name="arrowRight" />
                <strong>{{ selected.title }}</strong>
              </div>
              <fieldset v-if="selected.requiredFields.length" class="integration-status-required" :disabled="saving">
                <legend>{{ t('statusTransitionRequiredFields') }}</legend>
                <label v-for="field in selected.requiredFields" :key="field" class="integration-status-field">
                  <span>{{ field }} <b aria-hidden="true">*</b></span>
                  <input v-model="fields[field]" :name="field" required>
                </label>
              </fieldset>
              <p class="integration-status-warning">{{ t('statusTransitionRemoteWarning') }}</p>
            </template>
          </template>
        </div>
        <footer class="integration-status-actions">
          <UiButton size="compact" :disabled="saving" @click="setOpen(false)">{{ t('cancel') }}</UiButton>
          <UiButton size="compact" variant="warning" data-testid="confirm-status-transition" :disabled="loading || saving || !selected || missingFields.length > 0" @click="confirm">
            <Icon v-if="saving" name="loading" />
            {{ t('confirmStatusTransition') }}
          </UiButton>
        </footer>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.integration-status-trigger { flex: none; white-space: nowrap; }
.integration-status-trigger .app-icon { width: 14px; height: 14px; }
.integration-status-badge-trigger { display: inline-flex; align-items: center; gap: 2px; padding: 0; border: 0; border-radius: var(--status-badge-radius); background: transparent; color: var(--muted); font: inherit; cursor: pointer; }
.integration-status-badge-trigger:hover, .integration-status-badge-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.integration-status-badge-trigger > .app-icon { width: 12px; height: 12px; }
/* Reserve the same outer size during loading, selection and validation; only the body scrolls. */
:global(.integration-status-popover) { z-index: 60; display: flex; flex-direction: column; box-sizing: border-box; width: min(320px, calc(100vw - 24px)); height: min(360px, var(--reka-popover-content-available-height, 360px)); max-height: calc(100dvh - 24px); overflow: hidden; border: 1px solid var(--menu-border); border-radius: 10px; background: var(--menu-background); color: var(--text); box-shadow: var(--menu-shadow); outline: none; animation: none; }
/* The portalled content has no Vue scope attribute; also override the shared popper scale animation. */
:global([data-reka-popper-content-wrapper] > .integration-status-popover[data-state][data-side]) { animation: none; }
.integration-status-heading { flex: none; padding: 12px; border-bottom: 1px solid var(--border); }
.integration-status-heading strong { font-size: var(--font-size-body); font-weight: 600; }
.integration-status-heading p { margin: 4px 0 0; overflow: hidden; color: var(--muted); font-size: var(--font-size-control); text-overflow: ellipsis; white-space: nowrap; }
.integration-status-body { display: flex; flex: 1; flex-direction: column; min-height: 0; gap: 10px; overflow: auto; overscroll-behavior: contain; padding: 8px; }
.integration-status-loading { display: flex; flex: 1; align-items: center; justify-content: center; gap: 8px; margin: 0; color: var(--muted); font-size: var(--font-size-body); }
.integration-status-loading .app-icon { width: 16px; height: 16px; }
.integration-status-options { display: grid; flex: none; gap: 2px; }
.integration-status-option { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 32px; border: 0; border-radius: 5px; background: transparent; padding: 6px 9px; color: var(--text); font: inherit; font-size: var(--font-size-body); text-align: start; cursor: pointer; }
.integration-status-option:hover, .integration-status-option:focus-visible { background: var(--surface-muted); outline: none; }
.integration-status-option[data-state='checked'] { color: var(--accent); background: var(--accent-soft); }
.integration-status-option:disabled { cursor: wait; }
.integration-status-option .app-icon { flex: none; width: 14px; height: 14px; }
.integration-status-error { flex: none; margin: 0; border-radius: 7px; background: var(--danger-soft); padding: 9px 10px; color: var(--danger); font-size: var(--font-size-body); overflow-wrap: anywhere; }
.integration-status-field { display: grid; gap: 6px; }
.integration-status-field > span, .integration-status-required legend { font-size: var(--font-size-body); }
.integration-status-field b { color: var(--danger); }
.integration-status-field input { box-sizing: border-box; width: 100%; min-width: 0; height: 32px; outline: none; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); padding: 0 9px; color: var(--text); font: inherit; font-size: var(--font-size-body); }
.integration-status-field input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.integration-status-preview { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; border-left: 2px solid var(--accent); background: var(--accent-soft); padding: 8px; font-size: var(--font-size-body); }
.integration-status-preview .app-icon { width: 14px; height: 14px; color: var(--muted); }
.integration-status-preview strong { color: var(--accent); }
.integration-status-required { display: grid; flex: none; gap: 8px; margin: 0; border: 0; padding: 0; }
.integration-status-required legend { margin-bottom: 8px; color: var(--muted); }
.integration-status-empty { margin: 0; padding: 12px 8px; color: var(--muted); font-size: var(--font-size-body); }
.integration-status-warning { flex: none; margin: 0; color: var(--muted); font-size: var(--font-size-caption); }
.integration-status-actions { display: flex; flex: none; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border); padding: 8px 12px; }
@media (max-width: 720px) { .integration-status-trigger:not(.integration-status-badge-trigger) { width: 32px; padding: 0; font-size: 0; } }
</style>
