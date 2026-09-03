<script setup lang="ts">
import type { RunRecord } from 'craft-hub'
import type { Component } from 'vue'
import { markRaw, onMounted, ref, shallowRef } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { loadTerminalOutputComponent } from './terminal-output-loader'

const props = defineProps<{
  commandLabel: string
  run: RunRecord
}>()
const { t } = useI18n()
const terminalComponent = shallowRef<Component>()
const loadError = ref('')
const loading = ref(false)
let loadSequence = 0

async function loadTerminal(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  loadError.value = ''
  try {
    const component = await loadTerminalOutputComponent()
    if (sequence === loadSequence)
      terminalComponent.value = markRaw(component)
  }
  catch (caught) {
    if (sequence === loadSequence)
      loadError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (sequence === loadSequence)
      loading.value = false
  }
}

onMounted(loadTerminal)
</script>

<template>
  <component :is="terminalComponent" v-if="terminalComponent" v-bind="props" />
  <div v-else-if="loadError" class="terminal-load-state terminal-load-error" role="alert" data-testid="terminal-load-error">
    <Icon name="error" />
    <div>
      <strong>{{ t('terminalLoadFailed') }}</strong>
      <p>{{ loadError }}</p>
      <UiButton data-testid="retry-terminal-load" @click="loadTerminal">
        <Icon name="refresh" /> {{ t('retry') }}
      </UiButton>
    </div>
  </div>
  <div v-else-if="loading" class="terminal-load-state" data-testid="terminal-loading">
    {{ t('terminalLoading') }}
  </div>
</template>
