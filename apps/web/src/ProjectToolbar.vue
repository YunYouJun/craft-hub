<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ToolbarButton, ToolbarRoot, ToolbarSeparator } from 'reka-ui'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import EditorLauncher from './EditorLauncher.vue'
import GitIntegrationDialog from './GitIntegrationDialog.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { projectAccentStyle } from './project-visuals'
import ProjectSwitcher from './ProjectSwitcher.vue'
import { useWorkbenchStore } from './store'

const terminalStorageKey = 'craft-hub-terminal-application'
const store = useWorkbenchStore()
const { t } = useI18n()
const applications = ref<string[]>([])
const selectedApplication = ref(window.localStorage.getItem(terminalStorageKey) ?? '')
const openError = ref('')
const codexMenuOpen = ref(false)
const trustDialogOpen = ref(false)
const gitIntegrationOpen = ref(false)
const desktopActions = computed(() => window.craftHubDesktop)
const projectConfigDiagnostic = computed(() => store.selectedProjectDiagnostics[0])
const openDirectoryLabel = computed(() => t(desktopActions.value?.platform === 'darwin' ? 'openProjectInFinder' : 'openProjectInFileManager'))
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
  if (task.actionResult?.outcome === 'proposed')
    return t('agentDescriptionProposalReady')
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

function openProjectInEditor(): Promise<void> {
  const project = store.selectedProject
  return openTarget(project ? () => desktopActions.value?.openProjectInEditor?.(project.id) ?? Promise.resolve() : undefined)
}

function openProjectDirectory(): Promise<void> {
  const project = store.selectedProject
  return openTarget(project ? () => desktopActions.value?.openProjectDirectory?.(project.id) ?? Promise.resolve() : undefined)
}

function openProjectConfigDiagnostic(): Promise<void> {
  const project = store.selectedProject
  const diagnostic = projectConfigDiagnostic.value
  return openTarget(project && diagnostic
    ? () => desktopActions.value?.openProjectEvidenceInEditor?.(project.id, diagnostic.targetPath, diagnostic.line, diagnostic.column) ?? Promise.resolve()
    : undefined)
}

function reviewProjectTrust(): void {
  if (store.selectedProject?.trust === 'untrusted')
    trustDialogOpen.value = true
}

async function trustProject(): Promise<void> {
  if (await store.trustProject())
    trustDialogOpen.value = false
}

function openProjectGitRemote(): Promise<void> {
  const project = store.selectedProject
  return openTarget(project ? () => desktopActions.value?.openProjectGitRemote?.(project.id) ?? Promise.resolve() : undefined)
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
      <ProjectSwitcher />
      <button v-if="store.selectedProject.trust === 'untrusted'" type="button" class="trust-state is-action tooltip-action untrusted" :aria-label="t('trustProject')" :data-tooltip="t('trustProject')" :title="t('trustProject')" @click="reviewProjectTrust">
        <Icon name="untrusted" />
      </button>
      <span v-else class="trust-state trusted tooltip-action" role="img" tabindex="0" :aria-label="t('trusted')" :data-tooltip="t('trusted')" :title="t('trusted')">
        <Icon :name="store.selectedProject.trust" />
      </span>
      <span v-if="store.selectedProject.iconWarning" class="project-visual-warning" :title="store.selectedProject.iconWarning" :aria-label="t('projectVisualWarning')">
        <Icon name="error" />
      </span>
    </div>
    <ToolbarRoot class="project-toolbar-actions" loop :aria-label="t('project', { name: store.selectedProject.name })">
      <ToolbarButton v-if="desktopActions" class="toolbar-action-button icon-action tooltip-action" data-testid="open-project-directory" :aria-label="openDirectoryLabel" :data-tooltip="openDirectoryLabel" :title="openDirectoryLabel" @click="openProjectDirectory">
        <Icon name="folderOpen" />
      </ToolbarButton>
      <ToolbarButton v-if="desktopActions" class="toolbar-action-button icon-action tooltip-action git-remote-action" data-testid="open-project-git-remote" :aria-label="t('openProjectGitRemote')" :data-tooltip="t('openProjectGitRemote')" :title="t('openProjectGitRemote')" @click="openProjectGitRemote">
        <Icon name="gitRepository" />
      </ToolbarButton>
      <ToolbarButton class="toolbar-action-button icon-action tooltip-action" data-testid="project-git-integration" :aria-label="t('gitIntegration')" :data-tooltip="t('gitIntegration')" :title="t('gitIntegration')" @click="gitIntegrationOpen = true">
        <Icon name="gitMerge" />
      </ToolbarButton>
      <EditorLauncher v-if="desktopActions?.openProjectInEditor" scope="project" @open="openProjectInEditor" />
      <ToolbarSeparator v-if="desktopActions" class="toolbar-separator" />
      <div class="codex-split-action">
        <ToolbarButton v-if="desktopActions" class="toolbar-action-button icon-action tooltip-action codex-action" data-testid="open-project-codex" :aria-label="t('openProjectInCodex')" :data-tooltip="t('openProjectInCodex')" :title="t('openProjectInCodex')" @click="openProjectInCodex">
          <Icon name="codex" />
        </ToolbarButton>
        <UiButton v-else class="codex-configure-action" data-testid="configure-project-codex" @click="openAgentAction"><Icon name="codex" /> {{ t('configureWithCodex') }}</UiButton>
        <div v-if="desktopActions" class="codex-action-menu" :data-state="codexMenuOpen ? 'open' : 'closed'">
          <DropdownMenu v-model:open="codexMenuOpen">
            <DropdownMenuTrigger :aria-label="t('configureWithCodex')" :title="t('configureWithCodex')"><Icon name="arrowDown" /></DropdownMenuTrigger>
            <DropdownMenuContent class="codex-action-menu-content">
              <DropdownMenuItem @select="openAgentAction"><Icon name="codex" /> {{ t('configureWithCodex') }}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
      <UiButton v-if="actionTask?.actionResult?.outcome === 'proposed'" size="compact" @click="openAgentAction">{{ t('reviewSuggestions') }}</UiButton>
      <UiButton v-if="actionTask?.externalThreadId && actionTask.status !== 'running'" size="compact" @click="openThread(actionTask.externalThreadId)">{{ t('openInCodex') }}</UiButton>
    </div>
    <div v-if="projectConfigDiagnostic" class="project-config-diagnostic" data-testid="project-config-diagnostic" role="alert">
      <span><Icon name="error" /> <strong>{{ t('projectConfigInvalid') }}</strong> {{ projectConfigDiagnostic.message }}</span>
      <UiButton v-if="desktopActions?.openProjectEvidenceInEditor" data-testid="open-project-config-diagnostic" size="compact" @click="openProjectConfigDiagnostic">{{ t('openProjectConfigInEditor') }}</UiButton>
    </div>
    <p v-if="openError" class="project-toolbar-error">{{ openError }}</p>
  </header>
  <DialogShell :open="trustDialogOpen" content-class="trust-run-dialog" data-testid="project-trust-dialog" @update:open="trustDialogOpen = $event">
    <template #title>{{ t('trustProjectTitle') }}</template>
    <template #description>{{ t('trustProjectDescription', { project: store.selectedProject?.name ?? '' }) }}</template>
    <p class="trust-scope-note"><Icon name="untrusted" /> <span><strong>{{ t('projectTrustScope') }}</strong>{{ t('projectTrustScopeDescription') }}</span></p>
    <p v-if="store.error" class="error-message" role="alert">{{ store.error }}</p>
    <footer>
      <UiButton :disabled="store.busy" @click="trustDialogOpen = false">{{ t('cancel') }}</UiButton>
      <UiButton data-testid="trust-project-confirm" variant="warning" :disabled="store.busy" @click="trustProject"><Icon name="trusted" /> {{ store.busy ? t('allowingExecution') : t('trustProject') }}</UiButton>
    </footer>
  </DialogShell>
  <GitIntegrationDialog
    v-if="store.selectedProject"
    v-model:open="gitIntegrationOpen"
    :project-id="store.selectedProject.id"
    :project-name="store.selectedProject.name"
    :trusted="store.selectedProject.trust === 'trusted'"
  />
</template>
