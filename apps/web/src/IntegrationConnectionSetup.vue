<script setup lang="ts">
import { Input } from './components/ui/input'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import { Button as UiButton } from './components/ui/button'
import type { IntegrationConnectionStatus } from 'craft-hub'
import { onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { api } from './api'
import { useI18n } from './i18n'

const props = defineProps<{ status: IntegrationConnectionStatus, integrationId: string, actionId?: string, projectId?: string, translate: (value: string) => string }>()
const emit = defineEmits<{ updated: [] }>()
const { locale, t } = useI18n()
const connectionFormId = useId()
const values = reactive<Record<string, Record<string, string>>>({})
const saving = ref(false)
const error = ref('')
const authorizationUrl = ref('')
let active = true
let authorizationRefresh: ReturnType<typeof setInterval> | undefined
let authorizationDeadline: ReturnType<typeof setTimeout> | undefined
function stopWaiting(): void {
  clearInterval(authorizationRefresh)
  clearTimeout(authorizationDeadline)
  authorizationRefresh = undefined
  authorizationDeadline = undefined
}
watch(() => props.status.connected, (connected) => {
  if (connected) {
    authorizationUrl.value = ''
    stopWaiting()
  }
})
onBeforeUnmount(() => { active = false; stopWaiting() })

function safeUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  }
  catch { return undefined }
}

async function submit(form: NonNullable<IntegrationConnectionStatus['forms']>[number]): Promise<void> {
  if (!props.actionId || saving.value)
    return
  saving.value = true
  error.value = ''
  const openExternal = window.craftHubDesktop?.openExternalUrl
  const popup = form.id === 'oauth' && !openExternal ? window.open('about:blank', '_blank') : null
  if (popup)
    popup.opener = null
  try {
    const input = Object.fromEntries(form.fields.map(field => [field.id, values[form.id]?.[field.id] ?? field.value ?? '']))
    const result = await api.invokeIntegrationAction(props.integrationId, props.actionId, { ...input, method: form.id, locale: locale.value }, props.projectId, true)
    if (!active) {
      popup?.close()
      return
    }
    if ('connected' in result && result.authorizationUrl) {
      authorizationUrl.value = safeUrl(result.authorizationUrl) ?? ''
      if (authorizationUrl.value) {
        if (popup)
          popup.location.href = authorizationUrl.value
        else if (openExternal)
          await openExternal(authorizationUrl.value)
        stopWaiting()
        authorizationRefresh = setInterval(() => emit('updated'), 2000)
        authorizationDeadline = setTimeout(stopWaiting, 10 * 60 * 1000)
      }
      else {
        popup?.close()
      }
    }
    else {
      popup?.close()
      authorizationUrl.value = ''
      emit('updated')
    }
  }
  catch (caught) {
    popup?.close()
    if (active)
      error.value = props.translate(caught instanceof Error ? caught.message : String(caught))
  }
  finally {
    // Secrets must not remain in the rendered form after either success or failure.
    for (const field of form.fields) {
      if (field.type === 'password' && values[form.id])
        values[form.id]![field.id] = ''
    }
    saving.value = false
  }
}
</script>

<template>
  <div class="connection-setup">
    <p v-for="link in status.links" :key="link.url"><a v-if="safeUrl(link.url)" :href="safeUrl(link.url)" target="_blank" rel="noopener noreferrer">{{ translate(link.title) }} ↗</a></p>
    <template v-if="actionId">
      <details v-for="form in status.forms" :key="form.id" :open="!status.connected && form.id === 'oauth'">
        <summary>{{ translate(form.title) }}</summary>
        <form @submit.prevent="submit(form)">
          <p v-if="form.description">{{ translate(form.description) }}</p>
          <FieldGroup><Field v-for="field in form.fields" :key="field.id" :data-disabled="saving">
            <FieldLabel :for="`${connectionFormId}-${form.id}-${field.id}`">{{ translate(field.label) }}</FieldLabel>
            <Input :id="`${connectionFormId}-${form.id}-${field.id}`"
              :type="field.type" :required="field.required" :model-value="values[form.id]?.[field.id] ?? field.value ?? ''"
              :placeholder="field.placeholder" :autocomplete="field.type === 'password' ? 'new-password' : 'off'" :disabled="saving"
              @update:model-value="(values[form.id] ??= {})[field.id] = $event"
            />
          </Field></FieldGroup>
          <UiButton type="submit" :disabled="saving">{{ translate(form.submitLabel) }}</UiButton>
        </form>
      </details>
    </template>
    <p v-if="authorizationUrl" role="status"><a :href="authorizationUrl" target="_blank" rel="noopener noreferrer">{{ t('integrationContinueAuthorization') }} ↗</a> · {{ t('integrationReturnRefresh') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.connection-setup { display: grid; gap: 10px; padding: 0 18px 16px; font-size: 13px; }
.connection-setup p { margin: 0; color: var(--muted); }
.connection-setup a { color: var(--accent); }
.connection-setup summary { cursor: pointer; padding: 8px 0; font-weight: 500; }
.connection-setup form { display: grid; gap: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
.connection-setup [role='alert'] { color: var(--danger); }
</style>
