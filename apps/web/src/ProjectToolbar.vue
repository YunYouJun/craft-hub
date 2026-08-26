<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ToolbarButton, ToolbarRoot, ToolbarSeparator } from 'reka-ui'
import { Icon } from './icons'
import { useI18n } from './i18n'
import ProjectIcon from './ProjectIcon.vue'
import { projectAccentStyle } from './project-visuals'
import { useWorkbenchStore } from './store'

const terminalStorageKey = 'craft-hub-terminal-application'
const store = useWorkbenchStore()
const { t } = useI18n()
const applications = ref<string[]>([])
const selectedApplication = ref(window.localStorage.getItem(terminalStorageKey) ?? '')
const openError = ref('')
const codexMenuOpen = ref(false)
const desktopActions = computed(() => window.craftHubDesktop)
const terminalLabel = computed(() => selectedApplication.value === 'iTerm' ? 'iTerm2' : selectedApplication.value)
const actionTask = computed(() => store.agentTasks.find(task => task.actionId === 'improve-project-config'
  && task.projectIds.includes(store.selectedProjectId)))
const actionStatus = computed(() => {
  const task = actionTask.value
  if (!task)
    return ''
  if (task.status === 'running')
    return t('agentActionRunning')
  if (task.status === 'failed')
    return t('agentActionFailed', { message: task.error ?? '' })
  if (task.actionResult?.outcome === 'updated')
    return t('agentActionUpdated', { count: String(task.actionResult.updatedCommandCount ?? 0) })
  if (task.actionResult?.outcome === 'needs-attention')
    return t('agentActionNeedsAttention')
  if (task.status === 'completed')
    return t('agentActionUnchanged')
  return ''
})

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

function openProjectInVSCode(): Promise<void> {
  const project = store.selectedProject
  return openTarget(project ? () => desktopActions.value?.openProjectInVSCode?.(project.id) ?? Promise.resolve() : undefined)
}

function openProjectInCodex(): Promise<void> {
  const project = store.selectedProject
  return openTarget(project ? () => desktopActions.value?.openProjectInCodex?.(project.id) ?? Promise.resolve() : undefined)
}

async function openThread(threadId: string): Promise<void> {
  if (window.craftHubDesktop?.openCodexThread)
    await window.craftHubDesktop.openCodexThread(threadId)
  else
    window.location.href = `codex://threads/${threadId}`
}

function openAgentAction(): void {
  codexMenuOpen.value = false
  store.agentActionDialogOpen = true
}

function openProjectInTerminal(): Promise<void> {
  const project = store.selectedProject
  const application = selectedApplication.value
  return openTarget(project && application
    ? () => desktopActions.value?.openProjectInTerminal?.(project.id, application) ?? Promise.resolve()
    : undefined)
}

watch(selectedApplication, (application) => {
  if (application)
    window.localStorage.setItem(terminalStorageKey, application)
})

onMounted(async () => {
  applications.value = await desktopActions.value?.listTerminalApplications?.() ?? []
  if (!applications.value.includes(selectedApplication.value))
    selectedApplication.value = applications.value[0] ?? ''
})
</script>

<template>
  <header v-if="store.selectedProject" class="project-toolbar" :style="projectAccentStyle(store.selectedProject.color)">
    <div class="project-toolbar-context">
      <ProjectIcon :project="store.selectedProject" />
      <span class="project-toolbar-copy">
        <strong>{{ store.selectedProject.name }}</strong>
        <small>{{ store.selectedProject.path }}</small>
      </span>
      <span class="trust-state" :class="store.selectedProject.trust">
        <Icon :name="store.selectedProject.trust" /> {{ t(store.selectedProject.trust === 'trusted' ? 'trusted' : 'untrusted') }}
      </span>
      <span v-if="store.selectedProject.iconWarning" class="project-visual-warning" :title="store.selectedProject.iconWarning" :aria-label="t('projectVisualWarning')">
        <Icon name="error" />
      </span>
    </div>
    <ToolbarRoot class="project-toolbar-actions" loop :aria-label="t('project', { name: store.selectedProject.name })">
      <ToolbarButton v-if="desktopActions" class="secondary-button icon-action tooltip-action vscode-action" data-testid="open-project-vscode" :aria-label="t('openProjectInVSCode')" :data-tooltip="t('openProjectInVSCode')" :title="t('openProjectInVSCode')" @click="openProjectInVSCode">
        <Icon name="vscode" />
      </ToolbarButton>
      <ToolbarSeparator v-if="desktopActions" class="toolbar-separator" />
      <div class="codex-split-action">
        <ToolbarButton v-if="desktopActions" class="secondary-button icon-action tooltip-action codex-action" data-testid="open-project-codex" :aria-label="t('openProjectInCodex')" :data-tooltip="t('openProjectInCodex')" :title="t('openProjectInCodex')" @click="openProjectInCodex">
          <Icon name="codex" />
        </ToolbarButton>
        <button v-else class="secondary-button codex-configure-action" data-testid="configure-project-codex" @click="openAgentAction"><Icon name="codex" /> {{ t('configureWithCodex') }}</button>
        <details v-if="desktopActions" :open="codexMenuOpen" class="codex-action-menu" @toggle="codexMenuOpen = ($event.target as HTMLDetailsElement).open">
          <summary :aria-label="t('configureWithCodex')" :title="t('configureWithCodex')"><Icon name="arrowDown" /></summary>
          <div><button type="button" @click="openAgentAction"><Icon name="codex" /> {{ t('configureWithCodex') }}</button></div>
        </details>
      </div>
      <ToolbarSeparator v-if="desktopActions" class="toolbar-separator" />
      <div v-if="desktopActions && applications.length" class="terminal-picker">
        <ToolbarButton class="terminal-launch" data-testid="open-project-terminal" :aria-label="t('openProjectInTerminalApp', { name: terminalLabel })" :title="t('openProjectInTerminalApp', { name: terminalLabel })" @click="openProjectInTerminal">
          <Icon name="terminalApp" />
        </ToolbarButton>
        <select v-model="selectedApplication" data-testid="terminal-application" :aria-label="t('terminalApplication')" :title="t('terminalApplication')">
          <option v-for="application in applications" :key="application" :value="application">
            {{ application === 'iTerm' ? 'iTerm2' : application }}
          </option>
        </select>
      </div>
      <span v-else-if="desktopActions" class="terminal-unavailable" :title="t('terminalApplicationUnavailable')"><Icon name="terminalApp" /></span>
    </ToolbarRoot>
    <div v-if="actionStatus" class="project-agent-action-status" :class="actionTask?.status">
      <span><Icon :name="actionTask?.status === 'failed' || actionTask?.actionResult?.outcome === 'needs-attention' ? 'error' : actionTask?.status === 'running' ? 'refresh' : 'check'" /> {{ actionStatus }}</span>
      <button v-if="actionTask?.externalThreadId" class="secondary-button" @click="openThread(actionTask.externalThreadId)">{{ t('openInCodex') }}</button>
    </div>
    <p v-if="openError" class="project-toolbar-error">{{ openError }}</p>
  </header>
</template>
