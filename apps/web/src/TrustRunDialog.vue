<script setup lang="ts">
import type { CommandInputValues, CommandInvocation } from 'craft-hub'
import { commandInvocationSequence } from 'craft-hub/command-inputs'
import { defineAsyncComponent } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const ShellCommandPreview = defineAsyncComponent(() => import('./ShellCommandPreview.vue'))
const props = defineProps<{ open: boolean, invocation?: CommandInvocation, inputs: CommandInputValues, source?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { t } = useI18n()

async function trustAndRun(): Promise<void> {
  if (await store.trustAndRunSelected({ ...props.inputs }))
    emit('update:open', false)
}
</script>

<template>
  <DialogShell :open="open" content-class="trust-run-dialog" data-testid="trust-run-dialog" @update:open="emit('update:open', $event)">
    <template #title>{{ t('trustRunTitle') }}</template>
    <template #description>{{ t('trustRunDescription', { project: store.activeProject?.name ?? '' }) }}</template>
        <dl class="trust-run-summary">
          <div v-if="source"><dt>{{ t('sourceFile') }}</dt><dd>{{ source }}</dd></div>
          <div>
            <dt>{{ t('command') }}</dt>
            <dd v-if="invocation" class="command-sequence-preview">
              <div v-for="(step, index) in commandInvocationSequence(invocation)" :key="`${index}:${step.command}`">
                <small v-if="commandInvocationSequence(invocation).length > 1">{{ index + 1 }}. {{ step.label ?? step.command }}</small>
                <ShellCommandPreview :command="[step.command, ...step.args].join(' ')" compact />
              </div>
            </dd>
          </div>
          <div><dt>{{ t('workingDirectory') }}</dt><dd>{{ invocation?.cwd }}</dd></div>
          <div><dt>{{ t('requiredEnvironment') }}</dt><dd>{{ invocation?.requiredEnv.join(', ') || t('none') }}</dd></div>
        </dl>
        <p class="trust-scope-note"><Icon name="untrusted" /> <span><strong>{{ t('projectTrustScope') }}</strong>{{ t('projectTrustScopeDescription') }}</span></p>
        <p v-if="store.error" class="error-message" role="alert">{{ store.error }}</p>
        <footer>
          <UiButton :disabled="store.busy" @click="emit('update:open', false)">{{ t('cancel') }}</UiButton>
          <UiButton data-testid="trust-and-run" variant="primary" :disabled="store.busy || !invocation" @click="trustAndRun"><Icon name="play" /> {{ store.busy ? t('allowingExecution') : t('trustAndRun') }}</UiButton>
        </footer>
  </DialogShell>
</template>
