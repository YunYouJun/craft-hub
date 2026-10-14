<script setup lang="ts">
import { copyText } from './clipboard'
import type { AgentConnectionStatus } from 'craft-hub'
import { computed, onMounted, ref } from 'vue'
import { api } from './api'
import { FormSelect } from './components/ui/select'
import { SettingsRow, SettingsSection, SettingsStatus } from './components/ui/settings'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const { t } = useI18n()
const store = useWorkbenchStore()
const status = ref<AgentConnectionStatus>()
const selected = ref<string[]>([])
const integrations = ref(false)
const busy = ref(false)
const error = ref('')
const copied = ref(false)
const format = ref('json')
const configuration = computed(() => {
  const config = status.value?.mcpConfig
  if (!config)
    return ''
  const server = config.mcpServers['craft-hub']!
  return format.value === 'codex'
    ? `[mcp_servers.craft-hub]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}`
    : JSON.stringify(config, null, 2)
})

async function refresh(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    if (store.hostEnvironment.kind === 'hosted') {
      status.value = { available: false, enabled: false, projectIds: [], integrationRead: false }
      return
    }
    status.value = await api.agentConnection()
    selected.value = [...status.value.projectIds]
    integrations.value = status.value.integrationRead
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { busy.value = false }
}
async function update(enabled: boolean): Promise<void> {
  busy.value = true
  error.value = ''
  copied.value = false
  try {
    status.value = await api.updateAgentConnection({ enabled, projectIds: selected.value, integrationRead: integrations.value })
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { busy.value = false }
}
async function copyConfig(): Promise<void> {
  try {
    await copyText(configuration.value)
    copied.value = true
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
onMounted(refresh)
</script>

<template>
  <div class="agent-connection" :aria-busy="busy">
    <SettingsSection :title="t('agentConnection')" :description="t('agentConnectionDescription')">
      <SettingsStatus v-if="status && !status.available" :title="t('agentConnectionLocalOnly')" />
      <SettingsStatus v-else-if="status" :title="status.enabled ? t('agentConnectionEnabled') : t('agentConnectionDisabled')" :tone="status.enabled ? 'success' : 'neutral'" role="status">
        <template #actions>
          <UiButton size="compact" variant="primary" :disabled="busy || (!selected.length && !integrations)" @click="update(true)">{{ status.enabled ? t('agentConnectionReplace') : t('agentConnectionEnable') }}</UiButton>
          <UiButton v-if="status.enabled" size="compact" :disabled="busy" @click="update(false)">{{ t('agentConnectionRevoke') }}</UiButton>
          <UiButton size="compact" variant="ghost" :disabled="busy" @click="refresh">{{ t('refresh') }}</UiButton>
        </template>
      </SettingsStatus>
      <template v-if="error" #footer><p class="error-message" role="alert">{{ error }}</p></template>
    </SettingsSection>
    <template v-if="status?.available">
      <SettingsSection :title="t('agentConnectionProjects')">
        <fieldset class="connection-projects" :disabled="busy">
          <legend class="settings-description-sr-only">{{ t('agentConnectionProjects') }}</legend>
          <p v-if="!store.projects.length" class="connection-empty">{{ t('agentConnectionNoProjects') }}</p>
          <SettingsRow v-for="project in store.projects" :key="project.id" :label="project.name" :description="project.path" :control-id="`connection-project-${project.id}`">
            <template #control="{ descriptionId }">
              <input :id="`connection-project-${project.id}`" v-model="selected" type="checkbox" :value="project.id" :aria-describedby="descriptionId">
            </template>
          </SettingsRow>
          <SettingsRow :label="t('agentConnectionPlugins')" control-id="connection-integrations">
            <template #control><input id="connection-integrations" v-model="integrations" type="checkbox"></template>
          </SettingsRow>
        </fieldset>
        <template #footer>{{ t('agentConnectionReadOnly') }}</template>
      </SettingsSection>
      <SettingsSection v-if="status.mcpConfig" title="MCP" :description="t('agentConnectionSetup')">
        <template #controls><UiButton size="compact" @click="copyConfig">{{ copied ? t('agentConnectionCopied') : t('agentConnectionCopy') }}</UiButton></template>
        <SettingsRow :label="format === 'json' ? 'MCP · JSON' : 'Codex · TOML'">
          <template #control><FormSelect v-model="format" :options="[{ value: 'json', label: 'MCP · JSON' }, { value: 'codex', label: 'Codex · TOML' }]" aria-label="MCP configuration format" @update:model-value="copied = false" /></template>
          <pre>{{ configuration }}</pre>
        </SettingsRow>
        <SettingsRow :label="t('agentConnectionLastUsed')" :description="status.lastConnectedAt ? new Date(status.lastConnectedAt).toLocaleString() : t('agentConnectionNotUsed')" />
        <template #footer>
          <details><summary>{{ t('agentConnectionCheck') }}</summary><pre>{{ status.checkCommand?.map(part => `'${part.replaceAll("'", "'\\''")}'`).join(' ') }}</pre></details>
        </template>
      </SettingsSection>
    </template>
  </div>
</template>

<style scoped>
.agent-connection { min-width: 0; }
.connection-projects { min-width: 0; margin: 0; border: 0; padding: 0; }
.connection-projects :deep(.ui-settings-row + .ui-settings-row) { border-top: 1px solid var(--settings-group-border); }
.connection-empty { margin: 0; padding: var(--settings-row-padding-block) var(--settings-row-padding-inline); color: var(--muted); font-size: var(--settings-metadata-size); }
.connection-projects input[type='checkbox'] { width: auto; accent-color: var(--accent); }
pre { max-height: var(--settings-output-max-height); overflow: auto; margin: 0; border: 1px solid var(--settings-group-border); border-radius: var(--control-radius); background: var(--surface-subtle); padding: var(--space-3); color: var(--text-secondary); font: var(--settings-metadata-size)/var(--settings-metadata-line-height) var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
details { min-width: 0; width: 100%; }
details pre { margin-top: var(--space-2); }
summary { color: var(--text-secondary); cursor: pointer; }
</style>
