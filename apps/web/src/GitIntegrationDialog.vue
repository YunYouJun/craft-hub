<script setup lang="ts">
import type { GitIntegrationBlockerCode, GitIntegrationIssue, GitIntegrationPlan, GitIntegrationResult, GitIntegrationWarningCode } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { api, ApiRequestError } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{
  open: boolean
  projectId: string
  projectName: string
  trusted: boolean
}>()
const emit = defineEmits<{
  'complete': [result: GitIntegrationResult]
  'update:open': [value: boolean]
}>()
const store = useWorkbenchStore()
const { t } = useI18n()
const plan = ref<GitIntegrationPlan>()
const result = ref<GitIntegrationResult>()
const targetBranch = ref('')
const deleteSourceBranch = ref(true)
const loading = ref(false)
const applying = ref(false)
const error = ref('')
let planSequence = 0

const canApply = computed(() => Boolean(plan.value && !plan.value.blockers.length && plan.value.steps.length))
const actionLabel = computed(() => {
  if (applying.value)
    return t('gitIntegrationApplying')
  if (!props.trusted)
    return t('gitIntegrationTrustAndApply')
  if (plan.value?.relation === 'already-merged')
    return deleteSourceBranch.value ? t('gitIntegrationSwitchAndClean') : t('gitIntegrationSwitch')
  return deleteSourceBranch.value ? t('gitIntegrationMergeAndClean') : t('gitIntegrationMerge')
})

watch(() => props.open, (open) => {
  if (open) {
    targetBranch.value = ''
    deleteSourceBranch.value = true
    result.value = undefined
    void loadPlan()
  }
  else {
    planSequence++
    error.value = ''
  }
}, { immediate: true })

watch(() => props.projectId, () => {
  if (props.open)
    void loadPlan()
})

async function loadPlan(preserveTarget = false): Promise<void> {
  const sequence = ++planSequence
  loading.value = true
  error.value = ''
  result.value = undefined
  try {
    const next = await api.gitIntegrationPlan(props.projectId, {
      targetBranch: preserveTarget && targetBranch.value ? targetBranch.value : undefined,
      deleteSourceBranch: deleteSourceBranch.value,
    })
    if (sequence !== planSequence)
      return
    plan.value = next
    targetBranch.value = next.targetBranch ?? ''
  }
  catch (caught) {
    if (sequence === planSequence) {
      plan.value = undefined
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }
  finally {
    if (sequence === planSequence)
      loading.value = false
  }
}

function refreshPlan(): void {
  void loadPlan(true)
}

async function applyPlan(): Promise<void> {
  if (!plan.value || !canApply.value)
    return
  applying.value = true
  error.value = ''
  try {
    if (!props.trusted && !await store.trustProjectById(props.projectId))
      throw new Error(store.error || t('gitIntegrationTrustFailed'))
    const applied = await api.applyGitIntegration(props.projectId, {
      expectedRevision: plan.value.revision,
      targetBranch: plan.value.targetBranch,
      deleteSourceBranch: deleteSourceBranch.value,
    })
    result.value = applied
    emit('complete', applied)
  }
  catch (caught) {
    if (caught instanceof ApiRequestError && caught.status === 409) {
      await loadPlan(true)
      error.value = t('gitIntegrationPlanChanged')
    }
    else {
      error.value = caught instanceof Error ? caught.message : String(caught)
    }
  }
  finally {
    applying.value = false
  }
}

function relationText(value: GitIntegrationPlan['relation']): string {
  switch (value) {
    case 'already-merged': return t('gitIntegrationRelationAlreadyMerged')
    case 'fast-forward': return t('gitIntegrationRelationFastForward')
    case 'diverged': return t('gitIntegrationRelationDiverged')
    case 'same-branch': return t('gitIntegrationRelationSameBranch')
    default: return t('unknown')
  }
}

function blockerText(issue: GitIntegrationIssue<GitIntegrationBlockerCode>): string {
  switch (issue.code) {
    case 'detached-head': return t('gitIntegrationBlockerDetached')
    case 'dirty-worktree': return t('gitIntegrationBlockerDirty')
    case 'diverged': return t('gitIntegrationBlockerDiverged')
    case 'git-operation-in-progress': return t('gitIntegrationBlockerOperation', { operation: plan.value?.currentOperation ?? t('unknown') })
    case 'no-target-branch': return t('gitIntegrationBlockerNoTarget')
    case 'project-not-repository-root': return t('gitIntegrationBlockerProjectRoot')
    case 'same-branch': return t('gitIntegrationBlockerSameBranch')
    case 'target-behind-upstream': return t('gitIntegrationBlockerTargetBehind', { upstream: plan.value?.targetUpstream ?? t('unknown') })
    case 'target-diverged-upstream': return t('gitIntegrationBlockerTargetDiverged', { upstream: plan.value?.targetUpstream ?? t('unknown') })
    case 'target-in-other-worktree': return t('gitIntegrationBlockerOtherWorktree')
    case 'target-missing': return t('gitIntegrationBlockerTargetMissing', { target: plan.value?.targetBranch ?? t('unknown') })
    default: return issue.message
  }
}

function warningText(issue: GitIntegrationIssue<GitIntegrationWarningCode>): string {
  switch (issue.code) {
    case 'remote-not-refreshed': return t('gitIntegrationWarningRemote')
    case 'target-ahead-upstream': return t('gitIntegrationWarningAhead', { upstream: plan.value?.targetUpstream ?? t('unknown') })
    case 'upstream-missing': return t('gitIntegrationWarningMissingUpstream', { upstream: plan.value?.targetUpstream ?? t('unknown') })
    default: return issue.message
  }
}

function displayCommand(step: GitIntegrationPlan['steps'][number]): string {
  return [step.command, ...step.args].join(' ')
}
</script>

<template>
  <DialogShell :open="open" content-class="dialog-content git-integration-dialog" data-testid="git-integration-dialog" @update:open="emit('update:open', $event)">
    <template #title>{{ result ? t('gitIntegrationCompleteTitle') : t('gitIntegrationTitle') }}</template>
    <template #description>{{ result ? t('gitIntegrationCompleteDescription', { source: result.sourceBranch, target: result.targetBranch }) : t('gitIntegrationDescription', { project: projectName }) }}</template>

    <div v-if="loading" class="git-integration-loading"><Icon name="loading" /> {{ t('gitIntegrationChecking') }}</div>
    <template v-else-if="result">
      <div class="git-integration-success">
        <Icon name="check" />
        <span><strong>{{ result.finalBranch }}</strong><small>{{ result.deletedSourceBranch ? t('gitIntegrationSourceDeleted', { source: result.sourceBranch }) : t('gitIntegrationSourceKept', { source: result.sourceBranch }) }}</small></span>
      </div>
      <footer>
        <UiButton variant="primary" @click="emit('update:open', false)">{{ t('close') }}</UiButton>
      </footer>
    </template>
    <template v-else-if="plan">
      <dl class="git-integration-summary">
        <div><dt>{{ t('gitIntegrationSourceBranch') }}</dt><dd><code>{{ plan.sourceBranch || t('detachedHead') }}</code></dd></div>
        <div>
          <dt>{{ t('gitIntegrationTargetBranch') }}</dt>
          <dd>
            <select v-model="targetBranch" :aria-label="t('gitIntegrationTargetBranch')" data-testid="git-integration-target" :disabled="applying" @change="refreshPlan">
              <option v-for="branch in plan.localBranches" :key="branch" :value="branch">{{ branch }}</option>
            </select>
          </dd>
        </div>
        <div><dt>{{ t('gitIntegrationRelation') }}</dt><dd>{{ relationText(plan.relation) }}</dd></div>
        <div><dt>{{ t('gitIntegrationWorktree') }}</dt><dd>{{ t(plan.clean ? 'gitIntegrationClean' : 'gitIntegrationDirty') }}</dd></div>
        <div v-if="plan.targetUpstream"><dt>{{ t('gitIntegrationUpstream') }}</dt><dd><code>{{ plan.targetUpstream }}</code></dd></div>
      </dl>

      <p v-for="blocker in plan.blockers" :key="blocker.code" class="git-integration-issue blocked"><Icon name="error" /> {{ blockerText(blocker) }}</p>
      <p v-for="warning in plan.warnings" :key="warning.code" class="git-integration-issue warning"><Icon name="error" /> {{ warningText(warning) }}</p>

      <section v-if="plan.steps.length" class="git-integration-steps">
        <h3>{{ t('gitIntegrationSteps') }}</h3>
        <ol><li v-for="step in plan.steps" :key="step.kind"><code>{{ displayCommand(step) }}</code></li></ol>
      </section>

      <label class="git-integration-cleanup-option">
        <input v-model="deleteSourceBranch" type="checkbox" :disabled="applying" data-testid="git-integration-delete-source" @change="refreshPlan">
        <span><strong>{{ t('gitIntegrationDeleteSource') }}</strong><small>{{ t('gitIntegrationDeleteSourceDescription') }}</small></span>
      </label>
      <p class="git-integration-local-note"><Icon name="gitMerge" /> {{ t('gitIntegrationLocalOnly') }}</p>
      <p v-if="!trusted" class="trust-scope-note"><Icon name="untrusted" /> <span><strong>{{ t('projectTrustScope') }}</strong>{{ t('gitIntegrationTrustDescription') }}</span></p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <footer>
        <UiButton :disabled="applying" @click="emit('update:open', false)">{{ t('cancel') }}</UiButton>
        <UiButton variant="primary" data-testid="git-integration-apply" :disabled="applying || loading || !canApply" @click="applyPlan"><Icon :name="applying ? 'loading' : 'gitMerge'" /> {{ actionLabel }}</UiButton>
      </footer>
    </template>
    <template v-else>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <footer>
        <UiButton @click="emit('update:open', false)">{{ t('close') }}</UiButton>
        <UiButton :disabled="loading" @click="loadPlan()"><Icon name="refresh" /> {{ t('retry') }}</UiButton>
      </footer>
    </template>
  </DialogShell>
</template>
