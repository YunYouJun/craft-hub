<script setup lang="ts">
import type { HostExtensionStatus } from 'craft-hub'
import { onMounted, ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'

const { t } = useI18n()
const desktop = window.craftHubDesktop
const state = ref<HostExtensionStatus>({ extensions: [], diagnostics: [], restartRequired: false })
const busy = ref(false)
const error = ref('')

async function operate(operation: () => Promise<HostExtensionStatus | void | undefined> | undefined): Promise<void> {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const next = await operation()
    if (next)
      state.value = next
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    busy.value = false
  }
}

onMounted(() => operate(() => desktop?.hostExtensions?.()))
</script>

<template>
  <section class="host-extensions" :aria-label="t('hostExtensions')">
    <header>
      <p>{{ t('hostExtensionsDescription') }}</p>
      <UiButton :disabled="busy" @click="operate(() => desktop?.installHostExtension?.())">{{ t('addHostExtension') }}</UiButton>
    </header>
    <p class="host-extension-help">{{ t('hostExtensionInstallHelp') }}</p>
    <p v-if="error" role="alert" class="marketplace-error">{{ error }}</p>
    <div v-if="state.restartRequired" class="host-extension-restart" role="status">
      <span>{{ t('hostExtensionsRestartRequired') }}</span>
      <UiButton :disabled="busy" @click="operate(() => desktop?.restartForHostExtensions?.())">{{ t('restartCraftHub') }}</UiButton>
    </div>
    <p v-for="diagnostic in state.diagnostics" :key="diagnostic.pluginId" role="alert" class="marketplace-error">{{ diagnostic.pluginId }}: {{ diagnostic.message }}</p>
    <div v-if="state.extensions.length" class="plugin-list">
      <article v-for="extension in state.extensions" :key="extension.id" class="host-extension-row">
        <div>
          <strong>{{ extension.name }}</strong>
          <span class="host-extension-state">{{ t(extension.enabled ? 'hostExtensionEnabled' : 'hostExtensionDisabled') }}</span>
          <small>{{ extension.manifestPath }}</small>
        </div>
        <div class="plugin-actions">
          <UiButton size="compact" :disabled="busy" @click="operate(() => desktop?.setHostExtensionEnabled?.(extension.id, !extension.enabled))">{{ t(extension.enabled ? 'disablePlugin' : 'enablePlugin') }}</UiButton>
          <UiButton size="compact" variant="danger-secondary" :disabled="busy" @click="operate(() => desktop?.removeHostExtension?.(extension.id))">{{ t('removeHostExtension') }}</UiButton>
        </div>
      </article>
    </div>
    <p v-else class="marketplace-empty">{{ t('noHostExtensions') }}</p>
  </section>
</template>

<style scoped>
.host-extensions > header, .host-extension-restart, .host-extension-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.host-extensions > header p, .host-extension-help { color: var(--text-secondary); line-height: 1.6; }
.host-extension-help { margin-top: 0; }
.host-extension-restart { padding: var(--space-4); margin-bottom: var(--space-4); border: 1px solid var(--border); border-radius: var(--control-radius); }
.host-extension-row { padding: var(--space-4) 0; border-top: 1px solid var(--border); }
.host-extension-row > div:first-child { min-width: 0; }
.host-extension-row small { display: block; margin-top: var(--space-2); color: var(--muted); overflow-wrap: anywhere; }
.host-extension-state { margin-left: var(--space-3); color: var(--muted); font-size: var(--font-size-body); }
@media (max-width: 700px) { .host-extensions > header, .host-extension-restart, .host-extension-row { align-items: flex-start; flex-direction: column; } }
</style>
