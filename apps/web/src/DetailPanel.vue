<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const TerminalOutput = defineAsyncComponent(() => import('./TerminalOutput.vue'))

const store = useWorkbenchStore()
const { t } = useI18n()
const openError = ref('')
const sourcePath = computed(() => {
  const capability = store.selectedCapability
  if (!capability)
    return undefined
  return capability.kind === 'command' ? capability.sourcePath : capability.path
})
const sourceLocation = computed(() => {
  const capability = store.selectedCapability
  return capability?.kind === 'command' && capability.sourceLine
    ? `${sourcePath.value}:${capability.sourceLine}`
    : sourcePath.value
})
const desktopActions = computed(() => window.craftHubDesktop)

async function openTarget(action: (() => Promise<void>) | undefined): Promise<void> {
  if (!action)
    return
  openError.value = ''
  try {
    await action()
  }
  catch (caught) {
    openError.value = t('openFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
}

function openSource(): Promise<void> {
  const project = store.selectedProject
  const capability = store.selectedCapability
  return openTarget(project && capability
    ? () => desktopActions.value?.openCapabilitySourceInVSCode?.(project.id, capability.id) ?? Promise.resolve()
    : undefined)
}

</script>

<template>
  <main class="detail-panel">
    <div v-if="!store.selectedCapability" class="detail-empty">{{ t('selectCapability') }}</div>
    <template v-else>
      <header class="detail-heading">
        <span class="detail-icon"><Icon :name="store.selectedCapability.kind === 'command' ? 'terminal' : 'skill'" /></span>
        <div>
          <h2>{{ store.selectedCapability.name }}</h2>
          <p>{{ store.selectedCapability.source }}</p>
        </div>
      </header>
      <div v-if="desktopActions && store.selectedProject" class="detail-actions">
        <button v-if="sourcePath" class="secondary-button compact-action" data-testid="open-source-vscode" :aria-label="t('openSourceInVSCode')" :title="t('openSourceInVSCode')" @click="openSource">
          <Icon name="source" /> {{ t('source') }}
        </button>
      </div>
      <p v-if="openError" class="error-message">{{ openError }}</p>

      <template v-if="store.selectedCapability.kind === 'command'">
        <p v-if="store.selectedCapability.description" class="command-description">
          {{ store.selectedCapability.description }}
        </p>
        <dl class="preview-grid">
          <template v-if="sourceLocation"><dt>{{ t('sourceFile') }}</dt><dd class="source-path">{{ sourceLocation }}</dd></template>
          <dt>{{ t('command') }}</dt><dd><code>{{ [store.selectedCapability.invocation.command, ...store.selectedCapability.invocation.args].join(' ') }}</code></dd>
          <dt>{{ t('workingDirectory') }}</dt><dd>{{ store.selectedCapability.invocation.cwd }}</dd>
          <dt>{{ t('requiredEnvironment') }}</dt><dd>{{ store.selectedCapability.invocation.requiredEnv.join(', ') || t('none') }}</dd>
        </dl>
        <button v-if="store.selectedProject?.trust !== 'trusted'" class="primary-button trust-button" @click="store.trustProject">
          <Icon name="trusted" /> {{ t('trustProject') }}
        </button>
        <button v-else class="primary-button" :disabled="store.busy" @click="store.runSelected">
          <Icon name="play" /> {{ store.busy ? t('running') : t('runCommand') }}
        </button>
        <p v-if="store.error" class="error-message">{{ store.error }}</p>

        <section v-if="store.terminalVisible" class="run-panel">
          <div class="run-header">
            <span class="run-title"><Icon name="terminal" /> {{ t('run', { name: store.selectedCapability.name }) }}</span>
            <span class="run-actions">
              <button v-if="store.run && store.run.status !== 'running'" :aria-label="t(store.run.pinned ? 'unpinRun' : 'pinRun')" :title="t(store.run.pinned ? 'unpinRun' : 'pinRun')" @click="store.toggleCurrentRunPin">
                <Icon :name="store.run.pinned ? 'starFilled' : 'star'" />
              </button>
              <button v-if="store.run?.status === 'running'" data-testid="stop-terminal" :aria-label="t('stopTerminal')" :title="t('stopTerminal')" @click="store.stopRun">
                <Icon name="stop" />
              </button>
              <button data-testid="close-terminal" :disabled="store.busy" :aria-label="t('closeTerminal')" :title="t('closeTerminal')" @click="store.closeTerminal">
                <Icon name="close" />
              </button>
            </span>
          </div>
          <TerminalOutput
            v-if="store.run"
            :key="store.run.id"
            :run="store.run"
            :command-label="[store.run.command, ...store.run.args].join(' ')"
          />
          <div v-else class="run-empty">{{ t('runOutputPlaceholder') }}</div>
        </section>
      </template>

      <template v-else>
        <p class="skill-description">{{ store.selectedCapability.description }}</p>
        <div class="skill-actions">
          <button class="secondary-button" :disabled="!desktopActions" @click="openSource">{{ t('inspectSkill') }}</button>
          <button class="primary-button" disabled>{{ t('useWithAgent') }}</button>
        </div>
        <pre class="skill-content">{{ store.selectedCapability.content }}</pre>
      </template>
    </template>
  </main>
</template>
