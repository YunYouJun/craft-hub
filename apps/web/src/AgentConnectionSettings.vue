<script setup lang="ts">
import type { AgentConnectionStatus } from 'craft-hub'
import { computed, onMounted, ref } from 'vue'
import { api } from './api'
import { FormSelect } from './components/ui/select'
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
    await navigator.clipboard.writeText(configuration.value)
    copied.value = true
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
}
onMounted(refresh)
</script>

<template>
  <section class="agent-connection" :aria-busy="busy">
    <h3>{{ t('agentConnection') }}</h3>
    <p>{{ t('agentConnectionDescription') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="status && !status.available">{{ t('agentConnectionLocalOnly') }}</p>
    <template v-else-if="status">
      <p class="connection-state" role="status">{{ status.enabled ? t('agentConnectionEnabled') : t('agentConnectionDisabled') }}</p>
      <fieldset :disabled="busy">
        <legend>{{ t('agentConnectionProjects') }}</legend>
        <p v-if="!store.projects.length">{{ t('agentConnectionNoProjects') }}</p>
        <label v-for="project in store.projects" :key="project.id" class="connection-option">
          <input v-model="selected" type="checkbox" :value="project.id">
          <span>{{ project.name }}<small>{{ project.path }}</small></span>
        </label>
      </fieldset>
      <label class="connection-option"><input v-model="integrations" type="checkbox" :disabled="busy"><span>{{ t('agentConnectionPlugins') }}</span></label>
      <p>{{ t('agentConnectionReadOnly') }}</p>
      <nav>
        <UiButton variant="primary" :disabled="busy || (!selected.length && !integrations)" @click="update(true)">{{ status.enabled ? t('agentConnectionReplace') : t('agentConnectionEnable') }}</UiButton>
        <UiButton v-if="status.enabled" :disabled="busy" @click="update(false)">{{ t('agentConnectionRevoke') }}</UiButton>
        <UiButton variant="ghost" :disabled="busy" @click="refresh">{{ t('refresh') }}</UiButton>
      </nav>
      <template v-if="status.mcpConfig">
        <p>{{ t('agentConnectionSetup') }}</p>
        <FormSelect v-model="format" :options="[{ value: 'json', label: 'MCP · JSON' }, { value: 'codex', label: 'Codex · TOML' }]" aria-label="MCP configuration format" @update:model-value="copied = false" />
        <pre>{{ configuration }}</pre>
        <UiButton size="compact" @click="copyConfig">{{ copied ? t('agentConnectionCopied') : t('agentConnectionCopy') }}</UiButton>
        <p>{{ t('agentConnectionLastUsed') }} {{ status.lastConnectedAt ? new Date(status.lastConnectedAt).toLocaleString() : t('agentConnectionNotUsed') }}</p>
        <details><summary>{{ t('agentConnectionCheck') }}</summary><pre>{{ status.checkCommand?.map(part => `'${part.replaceAll("'", "'\\''")}'`).join(' ') }}</pre></details>
      </template>
    </template>
  </section>
</template>

<style scoped>
.agent-connection { display: grid; gap: 12px; min-width: 0; }
h3, p { margin: 0; }
p, small { color: var(--muted); line-height: 1.6; }
.connection-state { color: var(--foreground); font-weight: 600; }
fieldset { display: grid; gap: 8px; border: 1px solid var(--border); border-radius: var(--control-radius); padding: 12px; min-width: 0; }
.connection-option { display: flex; align-items: start; gap: 8px; }
.connection-option span { min-width: 0; overflow-wrap: anywhere; }
small { display: block; }
nav { display: flex; flex-wrap: wrap; gap: 8px; }
pre { background: var(--surface-muted); border: 1px solid var(--border); border-radius: var(--control-radius); padding: 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 260px; overflow: auto; }
[role='alert'] { color: var(--danger); }
</style>
