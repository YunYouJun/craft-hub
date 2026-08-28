<script setup lang="ts">
import type { AgentTaskRecord, CommandInputCondition, CommandInputDefinition, CommandInputValues, CommandInvocation, SkillCapability, SkillInputDefinition } from 'craft-hub'
import { resolveSkillInputSelections } from 'craft-hub/skill-inputs'
import { buildSkillInvocationPrompt } from 'craft-hub/skill-prompts'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import AgentTaskOutput from './AgentTaskOutput.vue'
import { Button as UiButton } from './components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import TrustRunDialog from './TrustRunDialog.vue'

const TerminalOutput = defineAsyncComponent(() => import('./TerminalOutput.vue'))
const SkillContentPreview = defineAsyncComponent(() => import('./SkillContentPreview.vue'))

const store = useWorkbenchStore()
const { locale, t } = useI18n()
const openError = ref('')
const sourcePath = computed(() => {
  const capability = store.activeCapability
  if (!capability)
    return undefined
  return capability.kind === 'command' ? capability.sourcePath : capability.path
})
const sourceLocation = computed(() => {
  const capability = store.activeCapability
  return capability?.kind === 'command' && capability.sourceLine
    ? `${sourcePath.value}:${capability.sourceLine}`
    : sourcePath.value
})
const desktopActions = computed(() => window.craftHubDesktop)
const sourceEditorName = computed(() => {
  const editor = store.settings?.settings['workbench.editor']
  if (!editor || editor.default === 'vscode')
    return 'VS Code'
  if (editor.default === 'codebuddy')
    return 'CodeBuddy'
  if (editor.default === 'cursor')
    return 'Cursor'
  return editor.custom?.name ?? t('editor')
})
const openSourceLabel = computed(() => t('openSourceInEditor', { editor: sourceEditorName.value }))
const commandInputs = computed(() => store.activeCapability?.kind === 'command' ? store.activeCapability.inputs ?? [] : [])
const skillInputs = computed(() => store.activeCapability?.kind === 'skill' ? store.activeCapability.inputs ?? [] : [])
const inputValues = ref<CommandInputValues>({})
const skillInputValues = ref<CommandInputValues>({})
const resolvedInvocation = ref<CommandInvocation>()
const previewError = ref('')
const trustRunOpen = ref(false)
const skillSupplementalRequest = ref('')
const skillTaskId = ref('')
const skillTaskStarting = ref(false)
const skillNotice = ref('')
const skillInvocation = ref<'codex-app' | 'background'>('codex-app')
const skillInputError = computed(() => {
  const skill = store.activeCapability
  if (skill?.kind !== 'skill')
    return ''
  try {
    resolveSkillInputSelections(skill, skillInputValues.value)
    return ''
  }
  catch (caught) {
    return caught instanceof Error ? caught.message : String(caught)
  }
})
const skillCanSubmit = computed(() => {
  const skill = store.activeCapability
  if (skill?.kind !== 'skill' || skillInputError.value)
    return false
  return Boolean(skillSupplementalRequest.value.trim()) || resolveSkillInputSelections(skill, skillInputValues.value).length > 0
})
const recentRuns = computed(() => store.runs
  .filter(item => item.projectId === store.activeProject?.id && item.status !== 'running')
  .slice(0, 8))
const runTitle = computed(() => store.run
  ? [store.run.command, ...store.run.args].join(' ')
  : store.activeCapability?.name ?? '')
const skillDescription = computed(() => {
  const capability = store.activeCapability
  const description = capability?.kind === 'skill' ? capability.description?.trim() ?? '' : ''
  const useWhenMarker = /\bUse when\b[:：]?\s*/i.exec(description)
  if (!useWhenMarker)
    return { summary: description, useWhen: '' }

  return {
    summary: description.slice(0, useWhenMarker.index).trim(),
    useWhen: description.slice(useWhenMarker.index + useWhenMarker[0].length).trim(),
  }
})
let previewSequence = 0

const skillTask = computed(() => {
  const capability = store.activeCapability
  const project = store.activeProject
  if (capability?.kind !== 'skill' || !project)
    return undefined
  return store.agentTasks.find(task => task.id === skillTaskId.value)
    ?? store.agentTasks.find(task => task.capabilityId === capability.id && task.primaryProjectId === project.id)
})

function conditionMatches(condition: CommandInputCondition | undefined, values: CommandInputValues): boolean {
  return condition === undefined || values[condition.input] === condition.equals
}

function inputVisible(input: CommandInputDefinition): boolean {
  return conditionMatches(input.visibleWhen, inputValues.value)
}

function inputRequired(input: CommandInputDefinition): boolean {
  return input.required === true || (input.requiredWhen !== undefined && conditionMatches(input.requiredWhen, inputValues.value))
}

function skillInputVisible(input: SkillInputDefinition): boolean {
  return conditionMatches(input.visibleWhen, skillInputValues.value)
}

function skillInputRequired(input: SkillInputDefinition): boolean {
  return input.required === true || (input.requiredWhen !== undefined && conditionMatches(input.requiredWhen, skillInputValues.value))
}

function resetCapabilityInputs(): void {
  inputValues.value = Object.fromEntries(commandInputs.value.map(input => [input.id, input.default ?? '']))
  skillInputValues.value = Object.fromEntries(skillInputs.value.map(input => [input.id, input.default ?? '']))
  resolvedInvocation.value = undefined
  previewError.value = ''
}

watch(() => store.activeCapability?.id, () => {
  resetCapabilityInputs()
  skillSupplementalRequest.value = ''
  skillTaskId.value = ''
  skillNotice.value = ''
  skillInvocation.value = 'codex-app'
}, { immediate: true })
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
    ? () => desktopActions.value?.openCapabilitySourceInEditor?.(project.id, capability.id) ?? Promise.resolve()
    : undefined)
}

async function invokeSkill(): Promise<void> {
  const project = store.activeProject
  const skill = store.activeCapability
  const supplementalRequest = skillSupplementalRequest.value.trim()
  if (!project || skill?.kind !== 'skill' || !skillCanSubmit.value)
    return
  skillTaskStarting.value = true
  skillNotice.value = ''
  openError.value = ''
  try {
    const prompt = buildSkillInvocationPrompt({
      skill,
      inputs: resolveSkillInputSelections(skill, skillInputValues.value),
      supplementalRequest,
      locale: locale.value,
    })
    if (skillInvocation.value === 'codex-app') {
      if (!desktopActions.value?.startProjectInCodex)
        throw new Error(t('codexAppUnavailable'))
      await desktopActions.value.startProjectInCodex(project.id, prompt)
      skillNotice.value = t('codexPromptCopied')
    }
    else {
      const task: AgentTaskRecord = await store.startAgentTask(prompt, [project.id], project.id, undefined, skill.id)
      skillTaskId.value = task.id
      skillNotice.value = t('skillAgentStarted')
    }
  }
  catch (caught) {
    openError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    skillTaskStarting.value = false
  }
}

function openSkillThread(): Promise<void> {
  const threadId = skillTask.value?.externalThreadId
  return openTarget(threadId
    ? () => desktopActions.value?.openCodexThread?.(threadId) ?? Promise.resolve()
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
        <UiButton v-if="sourcePath" class="compact-action" size="compact" variant="ghost" data-testid="open-source-editor" :aria-label="openSourceLabel" :title="openSourceLabel" @click="openSource">
          <Icon name="source" /> {{ t('source') }}
        </UiButton>
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
          <div class="command-input-fields">
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
          </div>
          <p v-if="previewError" class="error-message">{{ previewError }}</p>
          <div v-if="store.activeProject?.trust === 'trusted'" class="command-input-actions">
            <UiButton variant="primary" type="submit" :disabled="store.busy || Boolean(previewError)">
              <Icon name="play" /> {{ store.busy ? t('running') : t('runCommand') }}
            </UiButton>
          </div>
        </form>
        <UiButton v-if="store.activeProject?.trust !== 'trusted'" data-testid="review-trust" variant="warning" :disabled="store.busy || Boolean(previewError)" @click="trustRunOpen = true">
          <Icon name="trusted" /> {{ t('reviewTrustAndRun') }}
        </UiButton>
        <UiButton v-else-if="!commandInputs.length" variant="primary" :disabled="store.busy" @click="runCommand">
          <Icon name="play" /> {{ store.busy ? t('running') : t('runCommand') }}
        </UiButton>
        <p v-if="store.error" class="error-message">{{ store.error }}</p>

        <section v-if="store.terminalVisible" class="run-panel">
          <div class="run-header">
            <span class="run-title"><Icon name="terminal" /> {{ t('run', { name: runTitle }) }}</span>
            <span class="run-actions">
              <button v-if="store.run && store.run.status !== 'running'" :aria-label="t(store.run.pinned ? 'unpinRun' : 'pinRun')" :title="t(store.run.pinned ? 'unpinRun' : 'pinRun')" @click="store.toggleCurrentRunPin">
                <Icon :name="store.run.pinned ? 'starFilled' : 'star'" />
              </button>
              <button v-if="store.run?.status === 'running'" data-testid="stop-terminal" :aria-label="t('stopTerminal')" :title="t('stopTerminal')" @click="store.stopRun">
                <Icon name="stop" />
              </button>
              <button class="run-close-action" data-testid="close-terminal" :disabled="store.busy" :aria-label="t('closeTerminal')" :title="t('closeTerminal')" @click="store.closeTerminal">
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
        <section v-if="recentRuns.length" class="recent-runs" data-testid="recent-runs">
          <h3>{{ t('recentRuns') }}</h3>
          <button v-for="historyRun in recentRuns" :key="historyRun.id" class="recent-run-row" @click="store.openRun(historyRun)">
            <Icon name="terminal" />
            <span><strong>{{ [historyRun.command, ...historyRun.args].join(' ') }}</strong><small>{{ new Date(historyRun.startedAt).toLocaleString() }}</small></span>
            <em :class="historyRun.status">{{ t(`runStatus_${historyRun.status}`) }}<template v-if="historyRun.exitCode !== undefined"> · {{ t('exitCode', { code: String(historyRun.exitCode) }) }}</template></em>
          </button>
        </section>
      </template>

      <template v-else>
        <section v-if="skillDescription.summary || skillDescription.useWhen" class="skill-overview" data-testid="skill-overview" :aria-labelledby="`skill-overview-title-${store.activeCapability.id}`">
          <header class="skill-overview-header">
            <Icon name="skill" />
            <h3 :id="`skill-overview-title-${store.activeCapability.id}`">{{ t('skillOverview') }}</h3>
          </header>
          <p v-if="skillDescription.summary" class="skill-overview-summary">{{ skillDescription.summary }}</p>
          <div v-if="skillDescription.useWhen" class="skill-use-when">
            <h4>{{ t('skillUseWhen') }}</h4>
            <p>{{ skillDescription.useWhen }}</p>
          </div>
        </section>
        <form class="skill-agent-form" data-testid="skill-agent-form" @submit.prevent="invokeSkill">
          <div v-if="skillInputs.length" class="skill-input-fields" data-testid="skill-input-fields">
            <div v-for="input in skillInputs" v-show="skillInputVisible(input)" :key="input.id" class="skill-input-field">
              <label :for="`skill-input-${input.id}`">{{ input.label ?? input.id }}<small v-if="skillInputRequired(input)"> *</small></label>
              <Select v-if="input.type === 'select'" v-model="skillInputValues[input.id]" :required="skillInputRequired(input)">
                <SelectTrigger :id="`skill-input-${input.id}`" :aria-required="skillInputRequired(input)" :data-testid="`skill-input-${input.id}`">
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
              <input v-else :id="`skill-input-${input.id}`" v-model.trim="skillInputValues[input.id]" type="text" :pattern="input.pattern" :required="skillInputRequired(input)">
              <small v-if="input.description" class="command-input-description">{{ input.description }}</small>
            </div>
          </div>
          <p v-if="skillInputError" class="error-message">{{ skillInputError }}</p>
          <label for="skill-agent-request">{{ t('skillSupplementalRequest') }}</label>
          <textarea id="skill-agent-request" v-model="skillSupplementalRequest" rows="4" :placeholder="t('skillSupplementalRequestPlaceholder')" />
          <div class="skill-invocation-field">
            <label for="skill-invocation">{{ t('skillInvocationMode') }}</label>
            <Select v-model="skillInvocation">
              <SelectTrigger id="skill-invocation" data-testid="skill-invocation-mode">
                <SelectValue>
                  <span class="skill-invocation-option"><Icon :name="skillInvocation === 'codex-app' ? 'codex' : 'hub'" />{{ t(skillInvocation === 'codex-app' ? 'skillInvocationCodexApp' : 'skillInvocationBackground') }}</span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="codex-app"><span class="skill-invocation-option"><Icon name="codex" />{{ t('skillInvocationCodexApp') }}</span></SelectItem>
                  <SelectItem value="background"><span class="skill-invocation-option"><Icon name="hub" />{{ t('skillInvocationBackground') }}</span></SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <small>{{ t(skillInvocation === 'codex-app' ? 'skillInvocationCodexAppDescription' : 'skillInvocationBackgroundDescription') }}</small>
          </div>
          <p class="permission-note">{{ t(skillInvocation === 'codex-app' ? 'skillAgentCodexAppPermission' : 'skillAgentPermission') }}</p>
          <p v-if="skillNotice" class="success-message">{{ skillNotice }}</p>
          <div class="skill-agent-actions">
            <UiButton
              variant="primary"
              type="submit"
              data-testid="use-skill-with-agent"
              :disabled="!desktopActions || skillTaskStarting || !skillCanSubmit || (skillInvocation === 'background' && store.activeProject?.trust !== 'trusted')"
            >
              <Icon :name="skillInvocation === 'codex-app' ? 'codex' : 'refresh'" />
              {{ skillTaskStarting ? t('skillAgentStarting') : t(skillInvocation === 'codex-app' ? 'startInCodex' : 'runInCraftHubBackground') }}
            </UiButton>
            <UiButton v-if="skillTask?.externalThreadId && skillTask.status !== 'running'" type="button" data-testid="open-skill-thread" @click="openSkillThread">
              <Icon name="codex" /> {{ t('openInCodex') }}
            </UiButton>
          </div>
          <p v-if="skillTask" class="skill-agent-status" :class="skillTask.status">
            {{ t(`runStatus_${skillTask.status}`) }}<template v-if="skillTask.error"> · {{ skillTask.error }}</template>
          </p>
          <AgentTaskOutput v-if="skillTask" :task="skillTask" />
          <p v-if="skillTask?.finalResponse" class="skill-agent-response">{{ skillTask.finalResponse }}</p>
        </form>
        <SkillContentPreview :content="store.activeCapability.content" />
      </template>
    </template>
    <TrustRunDialog v-model:open="trustRunOpen" :invocation="displayedInvocation" :inputs="inputValues" :source="sourceLocation" />
  </main>
</template>
