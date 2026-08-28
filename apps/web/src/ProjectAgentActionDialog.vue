<script setup lang="ts">
import type { ProjectDescriptionChange, ProjectDescriptionSuggestion, WorkbenchLocale } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import AgentTaskOutput from './AgentTaskOutput.vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

interface ReviewRow {
  selected: boolean
  suggestion: ProjectDescriptionSuggestion
  defaultText: string
  localeText: string
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { locale, t } = useI18n()
const targetLocale = ref<WorkbenchLocale>(locale.value)
const starting = ref(false)
const applying = ref(false)
const error = ref('')
const reviewRows = ref<ReviewRow[]>([])
const action = computed(() => store.agentActions.find(item => item.id === 'improve-project-config'))
const matchingTasks = computed(() => store.agentTasks.filter(task => task.actionId === 'improve-project-config'
  && task.projectIds.includes(store.selectedProjectId)))
const running = computed(() => matchingTasks.value.some(task => task.status === 'running'))
const runningTask = computed(() => matchingTasks.value.find(task => task.status === 'running'))
const failedTask = computed(() => matchingTasks.value.find(task => task.status === 'failed'))
const proposedTask = computed(() => matchingTasks.value.find(task => task.status === 'completed'
  && task.actionResult?.outcome === 'proposed'
  && task.actionResult.proposal))
const proposal = computed(() => proposedTask.value?.actionResult?.proposal)
const missingCount = computed(() => (action.value?.missingCommandCount ?? 0) + (action.value?.missingPackageCount ?? 0))
const selectedCount = computed(() => reviewRows.value.filter(row => row.selected).length)

function resetReview(): void {
  reviewRows.value = (proposal.value?.suggestions ?? []).map(suggestion => ({
    selected: suggestion.status === 'suggested',
    suggestion,
    defaultText: suggestion.description?.default ?? '',
    localeText: proposal.value?.locale === 'en' ? '' : suggestion.description?.[proposal.value!.locale] ?? '',
  }))
}

watch(() => props.open, async (open) => {
  if (!open)
    return
  targetLocale.value = locale.value
  error.value = ''
  await Promise.all([store.loadAgentActions(), store.loadAgentTasks()]).catch((caught) => {
    error.value = caught instanceof Error ? caught.message : String(caught)
  })
  resetReview()
}, { immediate: true })

watch(proposal, () => resetReview(), { immediate: true })

watch(targetLocale, async () => {
  if (!props.open || !store.selectedProject || proposal.value)
    return
  try {
    await store.loadAgentActions(store.selectedProject.id, targetLocale.value)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
})

async function start(): Promise<void> {
  if (!store.selectedProject || !missingCount.value || running.value)
    return
  starting.value = true
  error.value = ''
  try {
    if (store.selectedProject.trust !== 'trusted' && !await store.trustProject())
      return
    await store.startAgentAction('improve-project-config', targetLocale.value)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    starting.value = false
  }
}

async function apply(): Promise<void> {
  if (!proposedTask.value || !proposal.value || applying.value)
    return
  const changes: ProjectDescriptionChange[] = reviewRows.value
    .filter(row => row.selected && row.suggestion.status === 'suggested')
    .map(row => ({
      id: row.suggestion.id,
      target: row.suggestion.target,
      key: row.suggestion.key,
      description: {
        default: row.defaultText.trim(),
        ...(proposal.value!.locale === 'en' ? {} : { [proposal.value!.locale]: row.localeText.trim() }),
      },
    }))
  applying.value = true
  error.value = ''
  try {
    await store.applyProjectDescriptionProposal(proposedTask.value.id, changes)
    emit('update:open', false)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    applying.value = false
  }
}

async function openEvidence(suggestion: ProjectDescriptionSuggestion, index: number): Promise<void> {
  const evidence = suggestion.evidence[index]
  if (!evidence || !store.selectedProject)
    return
  if (!window.craftHubDesktop?.openProjectEvidenceInEditor) {
    error.value = t('editorEvidenceUnavailable')
    return
  }
  try {
    await window.craftHubDesktop.openProjectEvidenceInEditor(store.selectedProject.id, evidence.path, evidence.startLine)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}
</script>

<template>
  <DialogShell :open="open" :content-class="proposal ? 'agent-action-dialog agent-action-review-dialog' : 'agent-action-dialog'" @update:open="emit('update:open', $event)">
    <template #title>{{ t('improveProjectDescriptions') }}</template>
    <template #description>{{ proposal ? t('reviewProjectDescriptions') : t('improveProjectDescriptionsDescription') }}</template>

    <template v-if="proposal">
      <div class="description-review-toolbar">
        <span>{{ t('descriptionSuggestionsSelected', { selected: String(selectedCount), total: String(reviewRows.length) }) }}</span>
        <button type="button" @click="reviewRows.forEach(row => row.selected = row.suggestion.status === 'suggested')">{{ t('selectAll') }}</button>
        <button type="button" @click="reviewRows.forEach(row => row.selected = false)">{{ t('clearSelection') }}</button>
      </div>

      <div class="description-review-list">
        <article v-for="row in reviewRows" :key="row.suggestion.id" :class="{ skipped: row.suggestion.status === 'skipped' }">
          <header>
            <input v-model="row.selected" type="checkbox" :disabled="row.suggestion.status === 'skipped'">
            <span><strong>{{ row.suggestion.key }}</strong><small>{{ t(row.suggestion.target === 'command' ? 'command' : 'package') }}</small></span>
          </header>
          <template v-if="row.suggestion.status === 'suggested'">
            <label><span>English</span><textarea v-model="row.defaultText" rows="2" /></label>
            <label v-if="proposal.locale !== 'en'"><span>简体中文</span><textarea v-model="row.localeText" rows="2" /></label>
          </template>
          <p>{{ row.suggestion.reason }}</p>
          <div v-if="row.suggestion.evidence.length" class="description-evidence-list">
            <button v-for="(evidence, index) in row.suggestion.evidence" :key="`${evidence.path}:${evidence.startLine ?? 0}`" type="button" @click="openEvidence(row.suggestion, index)">
              {{ evidence.path }}<template v-if="evidence.startLine">:{{ evidence.startLine }}</template>
            </button>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <dl class="agent-action-summary">
        <div><dt>{{ t('targetConfigurationFile') }}</dt><dd><code>{{ action?.targetPath ?? '.craft-hub/project.jsonc' }}</code></dd></div>
        <div><dt>{{ t('commands') }}</dt><dd>{{ action?.missingCommandCount ?? 0 }}</dd></div>
        <div><dt>{{ t('packages') }}</dt><dd>{{ action?.missingPackageCount ?? 0 }}</dd></div>
      </dl>

      <label class="agent-action-language">
        <span>{{ t('targetLanguage') }}</span>
        <select v-model="targetLocale" :disabled="running">
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </label>

      <p class="permission-note">{{ t('descriptionGenerationNotice') }}</p>
      <p v-if="store.selectedProject?.trust !== 'trusted'" class="agent-action-trust"><Icon name="untrusted" /> {{ t('agentActionPermission') }}</p>
      <p v-if="action && missingCount === 0" class="agent-action-empty">{{ t('allProjectDescriptionsPresent') }}</p>
      <p v-if="running" class="agent-action-empty">{{ t('agentDescriptionProposalRunning') }}</p>
      <AgentTaskOutput v-if="runningTask" :task="runningTask" />
      <p v-if="failedTask" class="error-message">{{ t('agentActionFailed', { message: failedTask.error ?? '' }) }}</p>
    </template>

    <p v-if="error" class="error-message">{{ error }}</p>

    <footer>
      <UiButton @click="emit('update:open', false)">{{ t('cancel') }}</UiButton>
      <UiButton v-if="proposal" data-testid="apply-description-proposal" variant="primary" :disabled="applying || selectedCount === 0" @click="apply">
        {{ applying ? t('applyingDescriptions') : t('applySelectedDescriptions') }}
      </UiButton>
      <UiButton v-else data-testid="start-agent-action" variant="primary" :disabled="starting || running || missingCount === 0" @click="start">
        <Icon name="codex" />
        {{ starting ? t('startingTask') : store.selectedProject?.trust === 'trusted' ? t('generateDescriptionSuggestions') : t('trustAndStartAgentAction') }}
      </UiButton>
    </footer>
  </DialogShell>
</template>
