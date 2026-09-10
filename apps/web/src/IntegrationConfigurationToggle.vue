<script setup lang="ts">
import type { IntegrationEntity, IntegrationEntityPage } from 'craft-hub'
import { onBeforeUnmount, ref } from 'vue'
import { api } from './api'
import { Switch } from './components/ui/switch'
import { Tooltip } from './components/ui/tooltip'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ entity: IntegrationEntity, integrationId: string, actionId: string, projectId?: string, disabled?: boolean }>()
const emit = defineEmits<{ updated: [page: IntegrationEntityPage] }>()
const { t, locale } = useI18n()
const saving = ref(false)
const error = ref('')
let active = true
onBeforeUnmount(() => { active = false })
async function update(enabled: boolean | null): Promise<void> {
  if (saving.value || props.disabled || !props.entity.configurationToggle)
    return
  saving.value = true
  error.value = ''
  try {
    const result = await api.invokeIntegrationAction(props.integrationId, props.actionId, { id: props.entity.id, enabled, revision: props.entity.configurationToggle.revision, locale: locale.value }, props.projectId, true)
    if (!('items' in result))
      throw new Error('Invalid configuration response')
    if (active)
      emit('updated', result)
  }
  catch {
    error.value = t('integrationConfigUpdateFailed')
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div v-if="entity.configurationToggle" class="configuration-control" :aria-busy="saving">
    <Switch
      :model-value="entity.configurationToggle.enabled"
      :title="t(entity.configurationToggle.enabled ? 'integrationConfigTurnOff' : 'integrationConfigTurnOn')"
      :aria-label="`${entity.title} · ${t(entity.configurationToggle.scope === 'project' ? 'integrationConfigProject' : 'integrationConfigGlobal')}`"
      :disabled="disabled" :loading="saving" @update:model-value="update"
    />
    <span v-if="saving" role="status" class="visually-hidden">{{ t('integrationConfigSaving') }}</span>
    <div v-if="entity.configurationToggle.scope === 'project'" class="configuration-inheritance">
      <button v-if="!entity.configurationToggle.inherited" type="button" class="configuration-reset" :disabled="saving || disabled" @click="update(null)"><Icon name="link" />{{ t('integrationConfigInherit') }}</button>
      <span v-else class="configuration-inherited"><Icon name="link" />{{ t('integrationConfigInherited') }}</span>
      <Tooltip :text="t('integrationConfigInheritanceHelp')">
        <button type="button" class="configuration-help" :aria-label="t('integrationConfigInheritanceHelpLabel')"><Icon name="help" /></button>
      </Tooltip>
    </div>
    <small v-if="error" role="alert">{{ error }}</small>
  </div>
</template>

<style scoped>
.configuration-control { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); flex: 0 0 auto; min-width: 148px; font-size: var(--font-size-body); color: var(--muted); }
.configuration-inheritance { display: flex; align-items: center; gap: var(--space-1); min-height: var(--control-height-compact); white-space: nowrap; }
.configuration-help { display: inline-grid; place-items: center; flex: none; width: var(--space-6); height: var(--space-6); padding: 0; border-radius: var(--control-radius); background: transparent; color: var(--muted); }
.configuration-help:hover { background: var(--surface-hover); color: var(--text); }
.configuration-help .app-icon { width: var(--font-size-glyph); height: var(--font-size-glyph); }
.configuration-help:focus-visible, .configuration-reset:focus-visible { outline: var(--control-focus-width) solid var(--focus-ring); outline-offset: var(--control-focus-offset); }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.configuration-reset, .configuration-inherited { display: inline-flex; align-items: center; gap: var(--space-1); }
.configuration-reset .app-icon, .configuration-inherited .app-icon { width: var(--font-size-glyph); height: var(--font-size-glyph); }
.configuration-reset { border: 0; background: none; color: var(--accent); cursor: pointer; white-space: nowrap; font: inherit; padding: 0; }
.configuration-reset:disabled { cursor: not-allowed; opacity: var(--control-disabled-opacity); }
.configuration-control [role="alert"] { color: var(--danger); }
</style>
