<script setup lang="ts">
import type { CommandInputCondition, CommandInputDefinition, CommandInputValues, CommandInvocation } from 'craft-hub'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const TerminalOutput = defineAsyncComponent(() => import('./TerminalOutput.vue'))

const store = useWorkbenchStore()
const { t } = useI18n()
const openError = ref('')
const sourcePath = computed(() => {
  const capability = store.activeCapability
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
const commandInputs = computed(() => store.activeCapability?.kind === 'command' ? store.activeCapability.inputs ?? [] : [])
const inputValues = ref<CommandInputValues>({})
const resolvedInvocation = ref<CommandInvocation>()
const previewError = ref('')
let previewSequence = 0

function conditionMatches(condition: CommandInputCondition | undefined): boolean {
  return condition === undefined || inputValues.value[condition.input] === condition.equals
}

function inputVisible(input: CommandInputDefinition): boolean {
  return conditionMatches(input.visibleWhen)
}

function inputRequired(input: CommandInputDefinition): boolean {
  return input.required === true || (input.requiredWhen !== undefined && conditionMatches(input.requiredWhen))
}

function resetCommandInputs(): void {
  inputValues.value = Object.fromEntries(commandInputs.value.map(input => [input.id, input.default ?? '']))
  resolvedInvocation.value = undefined
  previewError.value = ''
}

watch(() => store.activeCapability?.id, resetCommandInputs, { immediate: true })
watch(
  [() => store.activeProject?.id, () => store.activeCapability?.id, () => ({ ...inputValues.value })],
  async () => {
    if (!commandInputs.value.length) {
      resolvedInvocation.value = undefined
      previewError.value = ''
      return
    }
    const sequence = ++previewSequence
    try {
      const preview = await store.previewSelectedCommand({ ...inputValues.value })
      if (sequence === previewSequence) {
        resolvedInvocation.value = preview
        previewError.value = ''
      }
    }
    catch (caught) {
      if (sequence === previewSequence) {
        resolvedInvocation.value = undefined
        previewError.value = caught instanceof Error ? caught.message : String(caught)
      }
    }
  },
  { deep: true, immediate: true },
)

const displayedInvocation = computed(() => {
  const capability = store.activeCapability
  if (capability?.kind !== 'command')
    return undefined
  return resolvedInvocation.value ?? capability.invocation
})

async function runCommand(): Promise<void> {
  if (previewError.value)
    return
  await store.runSelected({ ...inputValues.value })
}

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
  const project = store.activeProject
  const capability = store.activeCapability
  return openTarget(project && capability
    ? () => desktopActions.value?.openCapabilitySourceInVSCode?.(project.id, capability.id) ?? Promise.resolve()
    : undefined)
}

</script>

<template>
  <main class="detail-panel">
    <div v-if="!store.activeCapability" class="detail-empty">{{ t('selectCapability') }}</div>
    <template v-else>
      <button v-if="store.workspaceCapability" class="workspace-capability-back" type="button" @click="store.clearWorkspaceCapability">
        <Icon name="arrowRight" /> {{ t('backToWorkspace') }}
      </button>
      <header class="detail-heading">
        <span class="detail-icon"><Icon :name="store.activeCapability.kind === 'command' ? 'terminal' : 'skill'" /></span>
        <div>
          <h2>{{ store.activeCapability.name }}</h2>
          <p>{{ store.activeProject?.name }} · {{ store.activeCapability.source }}</p>
        </div>
      </header>
      <div v-if="desktopActions && store.activeProject" class="detail-actions">
        <button v-if="sourcePath" class="secondary-button compact-action" data-testid="open-source-vscode" :aria-label="t('openSourceInVSCode')" :title="t('openSourceInVSCode')" @click="openSource">
          <Icon name="source" /> {{ t('source') }}
        </button>
      </div>
      <p v-if="openError" class="error-message">{{ openError }}</p>

      <template v-if="store.activeCapability.kind === 'command'">
        <p v-if="store.activeCapability.description" class="command-description">
          {{ store.activeCapability.description }}
        </p>
        <dl class="preview-grid">
          <template v-if="sourceLocation"><dt>{{ t('sourceFile') }}</dt><dd class="source-path">{{ sourceLocation }}</dd></template>
          <dt>{{ t('command') }}</dt><dd><code>{{ displayedInvocation ? [displayedInvocation.command, ...displayedInvocation.args].join(' ') : '' }}</code></dd>
          <dt>{{ t('workingDirectory') }}</dt><dd>{{ displayedInvocation?.cwd }}</dd>
          <dt>{{ t('requiredEnvironment') }}</dt><dd>{{ displayedInvocation?.requiredEnv.join(', ') || t('none') }}</dd>
        </dl>
        <form v-if="commandInputs.length" class="command-input-form" @submit.prevent="runCommand">
          <div v-for="input in commandInputs" v-show="inputVisible(input)" :key="input.id" class="command-input-field">
            <label :for="`command-input-${input.id}`">{{ input.label ?? input.id }}<small v-if="inputRequired(input)"> *</small></label>
            <Select v-if="input.type === 'select'" v-model="inputValues[input.id]" :required="inputRequired(input)">
              <SelectTrigger :id="`command-input-${input.id}`" :aria-required="inputRequired(input)">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="option in input.options" :key="option.value" :value="option.value">
                    {{ option.label ?? option.value }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <input v-else :id="`command-input-${input.id}`" v-model.trim="inputValues[input.id]" type="text" :pattern="input.pattern" :required="inputRequired(input)">
            <small v-if="input.description" class="command-input-description">{{ input.description }}</small>
          </div>
          <p v-if="previewError" class="error-message">{{ previewError }}</p>
          <button v-if="store.activeProject?.trust === 'trusted'" class="primary-button" type="submit" :disabled="store.busy || Boolean(previewError)">
            <Icon name="play" /> {{ store.busy ? t('running') : t('runCommand') }}
          </button>
        </form>
        <button v-if="store.activeProject?.trust !== 'trusted'" class="primary-button trust-button" @click="store.trustProject">
          <Icon name="trusted" /> {{ t('trustProject') }}
        </button>
        <button v-else-if="!commandInputs.length" class="primary-button" :disabled="store.busy" @click="runCommand">
          <Icon name="play" /> {{ store.busy ? t('running') : t('runCommand') }}
        </button>
        <p v-if="store.error" class="error-message">{{ store.error }}</p>

        <section v-if="store.terminalVisible" class="run-panel">
          <div class="run-header">
            <span class="run-title"><Icon name="terminal" /> {{ t('run', { name: store.activeCapability.name }) }}</span>
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
        <p class="skill-description">{{ store.activeCapability.description }}</p>
        <div class="skill-actions">
          <button class="secondary-button" :disabled="!desktopActions" @click="openSource">{{ t('inspectSkill') }}</button>
          <button class="primary-button" disabled>{{ t('useWithAgent') }}</button>
        </div>
        <pre class="skill-content">{{ store.activeCapability.content }}</pre>
      </template>
    </template>
  </main>
</template>
