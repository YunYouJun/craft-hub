<script setup lang="ts">
import type { AgentTaskRecord, CommandInputConditions, CommandInputDefinition, CommandInputValues, CommandInvocation, ReleasePlan, SkillCapability, SkillInputDefinition } from 'craft-hub'
import { commandInvocationSequence } from 'craft-hub/command-inputs'
import { resolveSkillInputSelections } from 'craft-hub/skill-inputs'
import { buildSkillInvocationPrompt } from 'craft-hub/skill-prompts'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import AgentTaskOutput from './AgentTaskOutput.vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { FormSelect } from './components/ui/select'
import { commandInputInitialValues, rememberCommandInputValues } from './command-input-history'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import TrustRunDialog from './TrustRunDialog.vue'

const TerminalOutput = defineAsyncComponent(() => import('./TerminalOutput.vue'))
const SkillContentPreview = defineAsyncComponent(() => import('./SkillContentPreview.vue'))
const ShellCommandPreview = defineAsyncComponent(() => import('./ShellCommandPreview.vue'))
const ProjectOverviewPanel = defineAsyncComponent(() => import('./ProjectOverviewPanel.vue'))

withDefaults(defineProps<{
  packageDrawerContent?: boolean
}>(), {
  packageDrawerContent: false,
})

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
  if (editor.default === 'cursor')
    return 'Cursor'
  return editor.custom?.name ?? t('editor')
})
const openSourceLabel = computed(() => t('openSourceInEditor', { editor: sourceEditorName.value }))
const openWorkingDirectoryLabel = computed(() => t(desktopActions.value?.platform === 'darwin' ? 'openWorkingDirectoryInFinder' : 'openWorkingDirectoryInFileManager'))
const commandInputs = computed(() => store.activeCapability?.kind === 'command' ? store.activeCapability.inputs ?? [] : [])
const skillInputs = computed(() => store.activeCapability?.kind === 'skill' ? store.activeCapability.inputs ?? [] : [])
const inputValues = ref<CommandInputValues>({})
const skillInputValues = ref<CommandInputValues>({})
const resolvedInvocation = ref<CommandInvocation>()
const previewError = ref('')
const trustRunOpen = ref(false)
const releasePlan = ref<ReleasePlan>()
const releasePlanLoading = ref(false)
const releasePlanError = ref('')
const releaseConfirmationOpen = ref(false)
const skillSupplementalRequest = ref('')
const skillTaskId = ref('')
const skillTaskStarting = ref(false)
const skillNotice = ref('')
const skillInvocation = ref<'codex-app' | 'background'>('codex-app')
const skillContentExpanded = ref(false)
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

function conditionMatches(condition: CommandInputConditions | undefined, values: CommandInputValues): boolean {
  if (condition === undefined)
    return true
  const conditions = Array.isArray(condition) ? condition : [condition]
  return conditions.every(item => values[item.input] === item.equals)
}

function inputVisible(input: CommandInputDefinition): boolean {
  return conditionMatches(input.visibleWhen, inputValues.value)
}

function inputRequired(input: CommandInputDefinition): boolean {
  return input.required === true || (input.requiredWhen !== undefined && conditionMatches(input.requiredWhen, inputValues.value))
}

function releaseEffectText(effect: string): string {
  if (effect === 'Update workspace package versions.')
    return t('releaseEffectVersions')
  if (effect === 'Create a release commit and Git tag.')
    return t('releaseEffectGitTag')
  if (effect.startsWith('Push the tag so '))
    return t('releaseEffectWorkflow', { workflow: releasePlan.value?.workflowPath ?? '' })
  return effect
}

function releaseIssueText(issue: string): string {
  if (issue === 'Git worktree has uncommitted changes.')
    return t('releaseIssueDirty')
  if (issue === 'No publication workflow is associated with this release command.')
    return t('releaseIssueNoWorkflow')
  const branchMatch = /^Release must run from branch (.+); current branch is (.+)\.$/.exec(issue)
  if (branchMatch)
    return t('releaseIssueBranch', { required: branchMatch[1]!, current: branchMatch[2]! })
  const workflowMatch = /^Release workflow does not exist: (.+)$/.exec(issue)
  if (workflowMatch)
    return t('releaseIssueWorkflowMissing', { workflow: workflowMatch[1]! })
  const semverMatch = /^Invalid SemVer release: (.+)$/.exec(issue)
  if (semverMatch)
    return t('releaseIssueInvalidSemver', { version: semverMatch[1]! })
  return issue
}

function updateBooleanInput(input: CommandInputDefinition, event: Event): void {
  inputValues.value[input.id] = (event.target as HTMLInputElement).checked ? 'true' : 'false'
}

function skillInputVisible(input: SkillInputDefinition): boolean {
  return conditionMatches(input.visibleWhen, skillInputValues.value)
}

function skillInputRequired(input: SkillInputDefinition): boolean {
  return input.required === true || (input.requiredWhen !== undefined && conditionMatches(input.requiredWhen, skillInputValues.value))
}

function resetCapabilityInputs(): void {
  const project = store.activeProject
  const capability = store.activeCapability
  inputValues.value = project && capability?.kind === 'command'
    ? commandInputInitialValues(project.id, capability, window.localStorage)
    : {}
  skillInputValues.value = Object.fromEntries(skillInputs.value.map(input => [input.id, input.default ?? '']))
  resolvedInvocation.value = undefined
  previewError.value = ''
}

watch([() => store.activeProject?.id, () => store.activeCapability?.id], () => {
  resetCapabilityInputs()
  skillSupplementalRequest.value = ''
  skillTaskId.value = ''
  skillNotice.value = ''
  skillInvocation.value = 'codex-app'
  skillContentExpanded.value = false
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
const displayedInvocations = computed(() => displayedInvocation.value
  ? commandInvocationSequence(displayedInvocation.value)
  : [])
const commandDescription = computed(() => {
  const capability = store.activeCapability
  if (capability?.kind !== 'command' || capability.description === capability.script)
    return ''
  return capability.description ?? ''
})

const isRelease = computed(() => store.activeCapability?.kind === 'command' && store.activeCapability.operation?.kind === 'release')

watch(
  [() => store.activeProject?.id, () => store.activeCapability?.id, () => ({ ...inputValues.value })],
  async ([projectId, capabilityId]) => {
    releasePlan.value = undefined
    releasePlanError.value = ''
    releaseConfirmationOpen.value = false
    if (!projectId || !capabilityId || !isRelease.value)
      return
    releasePlanLoading.value = true
    try {
      releasePlan.value = await api.releasePlan(projectId, capabilityId, { ...inputValues.value })
    }
    catch (caught) {
      releasePlanError.value = caught instanceof Error ? caught.message : String(caught)
    }
    finally {
      releasePlanLoading.value = false
    }
  },
  { immediate: true },
)

async function runCommand(): Promise<void> {
  if (previewError.value)
    return
  if (isRelease.value && !releaseConfirmationOpen.value) {
    releaseConfirmationOpen.value = true
    return
  }
  if (isRelease.value && (!releasePlan.value || releasePlan.value.blockers.length))
    return
  releaseConfirmationOpen.value = false
  const project = store.activeProject
  const capability = store.activeCapability
  if (project && capability?.kind === 'command')
    rememberCommandInputValues(project.id, capability, inputValues.value, window.localStorage)
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

function openWorkingDirectory(): Promise<void> {
  const project = store.activeProject
  const capability = store.activeCapability
  return openTarget(project && capability?.kind === 'command'
    ? () => desktopActions.value?.openCapabilityWorkingDirectory?.(project.id, capability.id) ?? Promise.resolve()
    : undefined)
}

async function invokeSkill(invocation: 'codex-app' | 'background' = 'codex-app'): Promise<void> {
  const project = store.activeProject
  const skill = store.activeCapability
  const supplementalRequest = skillSupplementalRequest.value.trim()
  if (!project || skill?.kind !== 'skill' || !skillCanSubmit.value)
    return
  skillInvocation.value = invocation
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
    <ProjectOverviewPanel v-if="store.selectedProject && (!store.activeCapability || (store.packageCapabilityDrawerOpen && !packageDrawerContent))" />
    <div v-else-if="!store.activeCapability" class="detail-empty">{{ t('selectCapability') }}</div>
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
        <p v-if="commandDescription" class="command-description">
          {{ commandDescription }}
        </p>
        <section v-if="store.activeCapability.script" class="command-script-preview" :aria-label="t('scriptDefinition')">
          <header><Icon name="terminal" /> {{ t('scriptDefinition') }}</header>
          <ShellCommandPreview :command="store.activeCapability.script" />
        </section>
        <dl class="preview-grid">
          <template v-if="sourceLocation">
            <dt>{{ t('sourceFile') }}</dt>
            <dd class="source-path">
              <button v-if="desktopActions" class="preview-path-link" type="button" data-testid="open-source-location" :aria-label="openSourceLabel" :title="openSourceLabel" @click="openSource">
                {{ sourceLocation }}
              </button>
              <template v-else>{{ sourceLocation }}</template>
            </dd>
          </template>
          <dt>{{ t('command') }}</dt>
          <dd class="command-sequence-preview">
            <div v-for="(invocation, index) in displayedInvocations" :key="`${index}:${invocation.command}`">
              <small v-if="displayedInvocations.length > 1">{{ index + 1 }}. {{ invocation.label ?? invocation.command }}</small>
              <ShellCommandPreview :command="[invocation.command, ...invocation.args].join(' ')" compact />
            </div>
          </dd>
          <dt>{{ t('workingDirectory') }}</dt>
          <dd>
            <button v-if="desktopActions" class="preview-path-link" type="button" data-testid="open-working-directory" :aria-label="openWorkingDirectoryLabel" :title="openWorkingDirectoryLabel" @click="openWorkingDirectory">
              {{ displayedInvocation?.cwd }}
            </button>
            <template v-else>{{ displayedInvocation?.cwd }}</template>
          </dd>
          <dt>{{ t('requiredEnvironment') }}</dt><dd>{{ displayedInvocation?.requiredEnv.join(', ') || t('none') }}</dd>
        </dl>
        <section v-if="isRelease" class="release-plan" data-testid="release-plan">
          <header><span><Icon name="rocket" /> {{ t('releasePlanTitle') }}</span><em v-if="releasePlan" :class="releasePlan.blockers.length ? 'blocked' : 'ready'">{{ t(releasePlan.blockers.length ? 'releaseBlocked' : 'releaseReady') }}</em></header>
          <p v-if="releasePlanLoading">{{ t('releaseChecking') }}</p>
          <p v-else-if="releasePlanError" class="error-message">{{ releasePlanError }}</p>
          <template v-else-if="releasePlan">
            <dl>
              <div><dt>{{ t('releaseVersion') }}</dt><dd>{{ releasePlan.currentVersion || t('unknown') }}<template v-if="releasePlan.proposedVersion"> → {{ releasePlan.proposedVersion }}</template><template v-if="releasePlan.proposedTag"> · {{ releasePlan.proposedTag }}</template></dd></div>
              <div><dt>{{ t('releaseBranch') }}</dt><dd>{{ releasePlan.branch || t('detachedHead') }}</dd></div>
              <div><dt>{{ t('releaseWorktree') }}</dt><dd>{{ t(releasePlan.clean ? 'releaseWorktreeClean' : 'releaseWorktreeDirty') }}</dd></div>
              <div v-if="releasePlan.workflowPath"><dt>{{ t('releaseWorkflow') }}</dt><dd><code>{{ releasePlan.workflowPath }}</code></dd></div>
            </dl>
            <h4>{{ t('releaseEffects') }}</h4>
            <ol><li v-for="effect in releasePlan.effects" :key="effect">{{ releaseEffectText(effect) }}</li></ol>
            <p v-for="blocker in releasePlan.blockers" :key="blocker" class="release-issue blocked"><Icon name="close" /> {{ releaseIssueText(blocker) }}</p>
            <p v-for="warning in releasePlan.warnings" :key="warning" class="release-issue warning"><Icon name="error" /> {{ releaseIssueText(warning) }}</p>
          </template>
        </section>
        <form v-if="commandInputs.length" class="command-input-form" @submit.prevent="runCommand">
          <div class="command-input-fields">
            <div v-for="input in commandInputs" v-show="inputVisible(input)" :key="input.id" class="command-input-field">
              <label v-if="input.type === 'boolean'" class="command-input-toggle" :for="`command-input-${input.id}`">
                <input :id="`command-input-${input.id}`" type="checkbox" :checked="inputValues[input.id] === 'true'" :required="inputRequired(input)" :aria-required="inputRequired(input)" @change="updateBooleanInput(input, $event)">
                <span>{{ input.label ?? input.id }}<small v-if="inputRequired(input)"> *</small></span>
              </label>
              <template v-else>
                <label :for="`command-input-${input.id}`">{{ input.label ?? input.id }}<small v-if="inputRequired(input)"> *</small></label>
                <FormSelect
                  v-if="input.type === 'select'"
                  :id="`command-input-${input.id}`"
                  v-model="inputValues[input.id]"
                  :options="input.options"
                  :required="inputRequired(input)"
                />
                <input v-else :id="`command-input-${input.id}`" v-model.trim="inputValues[input.id]" :type="input.private ? 'password' : 'text'" :autocomplete="input.private ? 'off' : undefined" :pattern="input.pattern" :required="inputRequired(input)">
              </template>
              <small v-if="input.description" class="command-input-description">{{ input.description }}</small>
            </div>
          </div>
          <p v-if="previewError" class="error-message">{{ previewError }}</p>
          <div v-if="store.activeProject?.trust === 'trusted'" class="command-input-actions">
            <UiButton variant="primary" type="submit" :disabled="store.busy || Boolean(previewError) || store.activeCapability.availability?.available === false">
              <Icon :name="isRelease ? 'rocket' : 'play'" /> {{ store.busy ? t('running') : t(isRelease ? 'reviewRelease' : 'runCommand') }}
            </UiButton>
          </div>
        </form>
        <UiButton v-if="store.activeProject?.trust !== 'trusted'" data-testid="review-trust" variant="warning" :disabled="store.busy || Boolean(previewError) || store.activeCapability.availability?.available === false" @click="trustRunOpen = true">
          <Icon name="trusted" /> {{ t('reviewTrustAndRun') }}
        </UiButton>
        <UiButton v-else-if="!commandInputs.length" variant="primary" :disabled="store.busy || store.activeCapability.availability?.available === false" @click="runCommand">
          <Icon :name="isRelease ? 'rocket' : 'play'" /> {{ store.busy ? t('running') : t(isRelease ? 'reviewRelease' : 'runCommand') }}
        </UiButton>
        <section v-if="isRelease && releaseConfirmationOpen" class="release-confirmation" data-testid="release-confirmation">
          <div><strong>{{ t('confirmReleaseTitle') }}</strong><p>{{ t('confirmReleaseDescription', { tag: releasePlan?.proposedTag ?? t('unknown') }) }}</p></div>
          <span>
            <UiButton @click="releaseConfirmationOpen = false">{{ t('cancel') }}</UiButton>
            <UiButton data-testid="confirm-release" variant="warning" :disabled="store.busy || !releasePlan || releasePlan.blockers.length > 0" @click="runCommand"><Icon name="rocket" /> {{ t('confirmRelease') }}</UiButton>
          </span>
        </section>
        <p v-if="store.activeCapability.availability?.available === false" class="error-message">{{ store.activeCapability.availability.diagnostic }}</p>
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
        <form class="skill-agent-form" data-testid="skill-agent-form" @submit.prevent="invokeSkill('codex-app')">
          <div v-if="skillInputs.length" class="skill-input-fields" data-testid="skill-input-fields">
            <div v-for="input in skillInputs" v-show="skillInputVisible(input)" :key="input.id" class="skill-input-field">
              <label :for="`skill-input-${input.id}`">{{ input.label ?? input.id }}<small v-if="skillInputRequired(input)"> *</small></label>
              <FormSelect
                v-if="input.type === 'select'"
                :id="`skill-input-${input.id}`"
                v-model="skillInputValues[input.id]"
                :options="input.options"
                :required="skillInputRequired(input)"
                :test-id="`skill-input-${input.id}`"
              />
              <input v-else :id="`skill-input-${input.id}`" v-model.trim="skillInputValues[input.id]" type="text" :pattern="input.pattern" :required="skillInputRequired(input)">
              <small v-if="input.description" class="command-input-description">{{ input.description }}</small>
            </div>
          </div>
          <p v-if="skillInputError" class="error-message">{{ skillInputError }}</p>
          <label for="skill-agent-request">{{ t('skillSupplementalRequest') }}</label>
          <textarea id="skill-agent-request" v-model="skillSupplementalRequest" rows="4" :placeholder="t('skillSupplementalRequestPlaceholder')" />
          <p class="permission-note">{{ t('skillInvocationChoiceDescription') }}</p>
          <p v-if="skillNotice" class="success-message">{{ skillNotice }}</p>
          <div class="skill-agent-actions">
            <UiButton
              variant="primary"
              type="submit"
              data-testid="start-skill-in-codex"
              :title="t('skillInvocationCodexAppDescription')"
              :disabled="!desktopActions?.startProjectInCodex || skillTaskStarting || !skillCanSubmit"
            >
              <Icon name="codex" />
              {{ skillTaskStarting && skillInvocation === 'codex-app' ? t('skillAgentStarting') : t('startInCodex') }}
            </UiButton>
            <UiButton
              type="button"
              data-testid="run-skill-in-background"
              :title="t('skillInvocationBackgroundDescription')"
              :disabled="!desktopActions || skillTaskStarting || !skillCanSubmit || store.activeProject?.trust !== 'trusted'"
              @click="invokeSkill('background')"
            >
              <Icon name="hub" />
              {{ skillTaskStarting && skillInvocation === 'background' ? t('skillAgentStarting') : t('runInCraftHubBackground') }}
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
        <section class="skill-source-disclosure">
          <button
            class="skill-source-toggle"
            type="button"
            data-testid="skill-content-toggle"
            :aria-expanded="skillContentExpanded"
            aria-controls="skill-source-content"
            @click="skillContentExpanded = !skillContentExpanded"
          >
            <span class="skill-source-label">
              <Icon name="docs" />
              <span><strong>SKILL.md</strong><small>{{ t('skillSourceDescription') }}</small></span>
            </span>
            <Icon name="arrowDown" />
          </button>
          <SkillContentPreview v-if="skillContentExpanded" id="skill-source-content" :content="store.activeCapability.content" />
        </section>
      </template>
    </template>
    <TrustRunDialog v-model:open="trustRunOpen" :invocation="displayedInvocation" :inputs="inputValues" :source="sourceLocation" />
  </main>
</template>
