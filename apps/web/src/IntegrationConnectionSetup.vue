<script setup lang="ts">
import { Input } from './components/ui/input'
import { Alert } from './components/ui/alert'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import { Button as UiButton } from './components/ui/button'
import type { IntegrationConnectionStatus } from 'craft-hub'
import { onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
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
    <p v-for="link in status.links" :key="link.url" class="connection-link-row">
      <a v-if="safeUrl(link.url)" class="connection-link" :href="safeUrl(link.url)" target="_blank" rel="noopener noreferrer">
        {{ translate(link.title) }}<Icon name="externalLink" />
      </a>
    </p>
    <template v-if="actionId">
      <details v-for="form in status.forms" :key="form.id" class="connection-disclosure" :open="!status.connected && form.id === 'oauth'">
        <summary class="connection-disclosure-summary">
          <span class="connection-disclosure-chevron"><Icon name="arrowRight" /></span>
          <span>{{ translate(form.title) }}</span>
        </summary>
        <form class="connection-form" @submit.prevent="submit(form)">
          <p v-if="form.description" class="connection-form-description">{{ translate(form.description) }}</p>
          <FieldGroup><Field v-for="field in form.fields" :key="field.id" :data-disabled="saving">
            <FieldLabel :for="`${connectionFormId}-${form.id}-${field.id}`">{{ translate(field.label) }}</FieldLabel>
            <Input :id="`${connectionFormId}-${form.id}-${field.id}`"
              :type="field.type" :required="field.required" :model-value="values[form.id]?.[field.id] ?? field.value ?? ''"
              :placeholder="field.placeholder" :autocomplete="field.type === 'password' ? 'new-password' : 'off'" :disabled="saving"
              @update:model-value="(values[form.id] ??= {})[field.id] = $event"
            />
          </Field></FieldGroup>
          <div class="connection-form-actions">
            <UiButton type="submit" :disabled="saving">{{ translate(form.submitLabel) }}</UiButton>
          </div>
        </form>
      </details>
    </template>
    <p v-if="authorizationUrl" class="connection-authorization" role="status">
      <Icon name="link" />
      <span><a :href="authorizationUrl" target="_blank" rel="noopener noreferrer">{{ t('integrationContinueAuthorization') }}</a> · {{ t('integrationReturnRefresh') }}</span>
    </p>
    <Alert v-if="error" variant="danger">{{ error }}</Alert>
  </div>
</template>

<style scoped>
.connection-setup { display: grid; gap: var(--integration-row-gap); padding: 0 var(--integration-row-padding-inline) var(--space-4); font-size: var(--font-size-body); }
.connection-setup p { margin: 0; }
.connection-link-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.connection-link { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--accent); font-weight: 500; text-decoration: none; }
.connection-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.connection-link .app-icon { width: 13px; height: 13px; }
.connection-disclosure { overflow: hidden; border: 1px solid var(--integration-card-border); border-radius: var(--integration-disclosure-radius); background: var(--integration-disclosure-background); }
.connection-disclosure-summary { display: flex; align-items: center; gap: var(--space-2); padding: var(--integration-row-padding-block) var(--integration-row-padding-inline); color: var(--text); font-size: var(--font-size-emphasis); font-weight: 500; cursor: pointer; list-style: none; }
.connection-disclosure-summary::-webkit-details-marker { display: none; }
.connection-disclosure-summary:hover { background: var(--surface-hover); }
.connection-disclosure-summary:focus-visible { outline: var(--control-focus-width) solid var(--focus-ring); outline-offset: calc(-1 * var(--control-focus-width)); }
.connection-disclosure-chevron { display: grid; place-items: center; color: var(--muted); transition: transform var(--motion-duration-fast) ease; }
.connection-disclosure-chevron .app-icon { width: 15px; height: 15px; }
.connection-disclosure[open] > .connection-disclosure-summary { border-bottom: 1px solid var(--integration-card-border); }
.connection-disclosure[open] > .connection-disclosure-summary .connection-disclosure-chevron { transform: rotate(90deg); }
.connection-form { display: grid; gap: var(--integration-row-gap); padding: var(--space-3) var(--integration-row-padding-inline); background: var(--integration-card-background); }
.connection-form-description { color: var(--muted); line-height: var(--line-height-body); }
.connection-form-actions { display: flex; justify-content: flex-start; }
.connection-authorization { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2) var(--integration-row-padding-inline); border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--border)); border-radius: var(--integration-disclosure-radius); background: var(--accent-soft); color: var(--text-secondary); }
.connection-authorization .app-icon { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--accent); }
.connection-authorization a { color: var(--accent); font-weight: 500; }
</style>
