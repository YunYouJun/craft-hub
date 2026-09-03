<script setup lang="ts">
import type { ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import AgentTaskOutput from './AgentTaskOutput.vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu'
import EditorLauncher from './EditorLauncher.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const desktopActions = computed(() => window.craftHubDesktop)
const prompt = ref('')
const selectedProjectIds = ref<string[]>([])
const primaryProjectId = ref('')
const openingCodex = ref(false)
const openingLauncher = ref('')
const startingInBackground = ref(false)
const taskMenuOpen = ref(false)
const error = ref('')
const notice = ref('')
const taskForm = ref<HTMLFormElement>()
const promptInput = ref<HTMLTextAreaElement>()
const pendingTrustProject = ref<ProjectRecord>()

const workspace = computed(() => store.selectedWorkspace)
const projects = computed(() => workspace.value ? store.workspaceProjects(workspace.value) : [])
const tasks = computed(() => store.agentTasks.filter(task => task.workspaceId === workspace.value?.id))
const selectedProjects = computed(() => projects.value.filter(project => selectedProjectIds.value.includes(project.id)))
const untrustedProjects = computed(() => projects.value.filter(project => project.trust !== 'trusted'))

watch(workspace, (value) => {
  const trusted = value
    ? store.workspaceProjects(value).filter(project => project.trust === 'trusted').map(project => project.id)
    : []
  selectedProjectIds.value = trusted
  primaryProjectId.value = value?.members.find(member => member.project === value.primaryProject)?.projectId
    ?? trusted[0]
    ?? ''
}, { immediate: true })

async function startInCodex(): Promise<void> {
  if (!workspace.value || !primaryProjectId.value || !prompt.value.trim())
    return
  if (window.craftHubDesktop?.startWorkspaceInCodex && !selectedProjectIds.value.includes(primaryProjectId.value)) {
    error.value = t('codexWorkspaceTrustRequired', { count: String(untrustedProjects.value.length) })
    return
  }
  openingCodex.value = true
  error.value = ''
  notice.value = ''
  try {
    const value = prompt.value.trim()
    const workspacePrompt = `Use Craft Hub workspace ${workspace.value.id}.\n\n${value}`
    const primaryProject = projects.value.find(project => project.id === primaryProjectId.value)
    if (!primaryProject)
      throw new Error('Primary project is unavailable')
    if (window.craftHubDesktop?.startWorkspaceInCodex) {
      const projectIds = [...selectedProjectIds.value]
      await window.craftHubDesktop.startWorkspaceInCodex(
        workspace.value.id,
        projectIds,
        primaryProject.id,
        workspacePrompt,
      )
      notice.value = t('codexWorkspaceTaskStarted', { count: String(projectIds.length) })
    }
    else if (window.craftHubDesktop?.startProjectInCodex) {
      await window.craftHubDesktop.startProjectInCodex(primaryProject.id, workspacePrompt)
      notice.value = t('codexPromptCopied')
    }
    else {
      await navigator.clipboard.writeText(workspacePrompt)
      const query = new URLSearchParams({ path: primaryProject.path })
      window.location.href = `codex://threads/new?${query}`
      notice.value = t('codexPromptCopied')
    }
    prompt.value = ''
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    openingCodex.value = false
  }
}

async function startInBackground(): Promise<void> {
  if (!workspace.value || !primaryProjectId.value || !selectedProjectIds.value.includes(primaryProjectId.value) || !prompt.value.trim())
    return
  taskMenuOpen.value = false
  startingInBackground.value = true
  error.value = ''
  notice.value = ''
  try {
    await store.startAgentTask(prompt.value.trim(), selectedProjectIds.value, primaryProjectId.value, workspace.value.id)
    prompt.value = ''
    notice.value = t('codexBackgroundStarted')
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    startingInBackground.value = false
  }
}

async function savePrimary(): Promise<void> {
  if (workspace.value && primaryProjectId.value)
    await store.makePrimaryProject(workspace.value, primaryProjectId.value)
}

async function registerMember(member: WorkspaceRecord['members'][number]): Promise<void> {
  if (!workspace.value)
    return
  try {
    if (member.path) {
      try {
        await store.registerWorkspaceMember(workspace.value, member.project)
        return
      }
      catch {
        // Fall through to manual location when the imported path moved.
      }
    }
    const path = window.craftHubDesktop?.selectProjectDirectory
      ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
      : window.prompt(t('projectPath'))
    if (path)
      await store.registerWorkspaceMember(workspace.value, member.project, path)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function prepareWorkspaceCodexTask(): void {
  error.value = ''
  notice.value = untrustedProjects.value.length
    ? t('codexWorkspaceTrustRequired', { count: String(untrustedProjects.value.length) })
    : t('codexWorkspaceReady', { count: String(selectedProjectIds.value.length) })
  taskForm.value?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  promptInput.value?.focus()
}

function reviewProjectTrust(project: ProjectRecord): void {
  pendingTrustProject.value = project
}

function updateTrustDialog(open: boolean): void {
  if (!open)
    pendingTrustProject.value = undefined
}

async function trustWorkspaceProject(): Promise<void> {
  const project = pendingTrustProject.value
  if (!project || !await store.trustProjectById(project.id))
    return
  if (!selectedProjectIds.value.includes(project.id))
    selectedProjectIds.value = [...selectedProjectIds.value, project.id]
  pendingTrustProject.value = undefined
  notice.value = t('codexWorkspaceReady', { count: String(selectedProjectIds.value.length) })
}

async function openWorkspaceInEditor(): Promise<void> {
  if (!workspace.value || !window.craftHubDesktop?.openWorkspaceInEditor)
    return
  openingLauncher.value = 'editor'
  error.value = ''
  try {
    await window.craftHubDesktop.openWorkspaceInEditor(workspace.value.id)
  }
  catch (caught) {
    error.value = t('openFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    openingLauncher.value = ''
  }
}

async function openWorkspaceInCodex(): Promise<void> {
  if (!workspace.value || !window.craftHubDesktop?.openWorkspaceInCodex)
    return
  openingLauncher.value = 'codex'
  error.value = ''
  try {
    await window.craftHubDesktop.openWorkspaceInCodex(workspace.value.id)
  }
  catch (caught) {
    error.value = t('openFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    openingLauncher.value = ''
  }
}

async function openThread(threadId: string): Promise<void> {
  if (window.craftHubDesktop?.openCodexThread)
    await window.craftHubDesktop.openCodexThread(threadId)
  else
    window.location.href = `codex://threads/${threadId}`
}
</script>

<template>
  <main v-if="workspace" class="workspace-dashboard">
    <header>
      <span class="detail-icon"><Icon name="workspace" /></span>
      <div><h2>{{ workspace.name }}</h2><p>{{ t('codexTaskCount', { projects: String(projects.length), tasks: String(tasks.length) }) }}</p></div>
      <div class="workspace-header-actions">
        <EditorLauncher v-if="desktopActions?.openWorkspaceInEditor" scope="workspace" :disabled="Boolean(openingLauncher)" @open="openWorkspaceInEditor" />
        <UiButton v-if="desktopActions?.openWorkspaceInCodex" size="icon" data-testid="open-workspace-codex" :disabled="Boolean(openingLauncher)" :aria-label="t('openWorkspaceInCodex')" :title="t('openWorkspaceInCodex')" @click="openWorkspaceInCodex"><Icon name="codex" /></UiButton>
        <UiButton v-if="desktopActions?.startWorkspaceInCodex" size="icon" data-testid="prepare-workspace-codex" :disabled="Boolean(openingLauncher)" :aria-label="t('prepareWorkspaceCodexTask')" :title="t('prepareWorkspaceCodexTask')" @click="prepareWorkspaceCodexTask"><Icon name="plus" /></UiButton>
      </div>
    </header>

    <section class="workspace-summary">
      <h3>{{ t('projects') }}</h3>
      <div v-for="project in projects" :key="project.id" class="workspace-member-card">
        <div class="workspace-member-selection">
          <label>
            <input v-model="selectedProjectIds" type="checkbox" :value="project.id" :disabled="project.trust !== 'trusted'">
            <strong :title="workspace.members.find(member => member.projectId === project.id)?.label ? project.name : undefined">{{ workspace.members.find(member => member.projectId === project.id)?.label || project.name }}</strong>
          </label>
          <button v-if="project.trust !== 'trusted'" type="button" class="project-trust trust-action untrusted" :aria-label="t('trustProject')" :title="t('trustProject')" @click="reviewProjectTrust(project)"><Icon name="untrusted" /></button>
          <span v-else class="project-trust trusted" :aria-label="t('trusted')" :title="t('trusted')"><Icon name="trusted" /></span>
        </div>
        <label class="primary-choice">
          <input v-model="primaryProjectId" type="radio" name="primary-project" :value="project.id" @change="savePrimary">
          {{ t('primary') }}
        </label>
      </div>
      <div v-for="member in workspace.members.filter(item => !item.resolved)" :key="member.project" class="workspace-member-card unresolved">
        <span>
          <span
            class="member-source-status"
            :class="{ available: member.path }"
            :aria-label="t(member.path ? 'availableProject' : 'unresolved')"
            :title="t(member.path ? 'availableProject' : 'unresolved')"
          ><Icon :name="member.path ? 'folder' : 'error'" /></span>
          {{ member.label || member.project }}
        </span>
        <UiButton size="icon" :aria-label="t(member.path ? 'addProject' : 'locateProject')" :title="t(member.path ? 'addProject' : 'locateProject')" @click="registerMember(member)">
          <Icon :name="member.path ? 'plus' : 'folder'" />
        </UiButton>
      </div>
    </section>

    <form ref="taskForm" class="agent-task-form" @submit.prevent="startInCodex">
      <h3>{{ t('newCodexTask') }}</h3>
      <textarea ref="promptInput" v-model="prompt" rows="4" :placeholder="t('codexTaskPrompt')" />
      <p class="permission-note">{{ t('codexTaskLaunchHint') }}</p>
      <p class="codex-root-summary">{{ t('codexSelectedRoots', { count: String(selectedProjects.length) }) }}</p>
      <ul class="codex-root-list" data-testid="codex-root-list">
        <li v-for="project in selectedProjects" :key="project.id"><code>{{ project.path }}</code><span v-if="project.id === primaryProjectId">{{ t('primary') }}</span></li>
      </ul>
      <p v-if="untrustedProjects.length" class="trust-scope-note codex-trust-warning"><Icon name="untrusted" /> <span>{{ t('codexWorkspaceTrustRequired', { count: String(untrustedProjects.length) }) }}</span></p>
      <p v-if="error" class="error-message">{{ error }}</p>
      <p v-if="notice" class="success-message">{{ notice }}</p>
      <div class="agent-task-split-action">
        <UiButton variant="primary" type="submit" data-testid="start-in-codex" :disabled="openingCodex || startingInBackground || !prompt.trim() || !primaryProjectId || (Boolean(desktopActions?.startWorkspaceInCodex) && !selectedProjectIds.includes(primaryProjectId))">
          <Icon name="codex" /> {{ openingCodex ? t('openingCodex') : t('startInCodex') }}
        </UiButton>
        <div class="agent-task-action-menu" :data-state="taskMenuOpen ? 'open' : 'closed'">
          <DropdownMenu v-model:open="taskMenuOpen">
            <DropdownMenuTrigger :aria-label="t('moreCodexTaskActions')" :title="t('moreCodexTaskActions')"><Icon name="arrowDown" /></DropdownMenuTrigger>
            <DropdownMenuContent class="agent-task-action-menu-content" align="start">
              <DropdownMenuItem data-testid="start-in-background" :disabled="openingCodex || startingInBackground || !prompt.trim() || !primaryProjectId || !selectedProjectIds.includes(primaryProjectId)" @select="startInBackground">
                <Icon name="refresh" /> {{ startingInBackground ? t('startingTask') : t('runInCraftHubBackground') }}
              </DropdownMenuItem>
              <small>{{ t('codexTaskPermission') }}</small>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </form>

    <section class="agent-task-list">
      <h3>{{ t('recentTasks') }}</h3>
      <article v-for="task in tasks" :key="task.id" class="agent-task-card">
        <div><strong>{{ task.prompt }}</strong><small>{{ task.status }} · {{ t('codexTaskRoots', { count: String(task.projectIds.length) }) }} · {{ new Date(task.startedAt).toLocaleString() }}</small></div>
        <UiButton v-if="task.externalThreadId && task.status !== 'running'" @click="openThread(task.externalThreadId)"><Icon name="codex" /> {{ t('openInCodex') }}</UiButton>
        <AgentTaskOutput :task="task" />
        <p v-if="task.finalResponse">{{ task.finalResponse }}</p>
        <p v-if="task.error" class="error-message">{{ task.error }}</p>
      </article>
      <p v-if="!tasks.length" class="empty">{{ t('noCodexTasks') }}</p>
    </section>

    <DialogShell :open="Boolean(pendingTrustProject)" content-class="workspace-trust-dialog" data-testid="workspace-trust-dialog" @update:open="updateTrustDialog">
      <template #title>{{ t('trustProjectTitle') }}</template>
      <template #description>{{ t('trustProjectDescription', { project: pendingTrustProject?.name ?? '' }) }}</template>
      <p class="trust-scope-note"><Icon name="untrusted" /> <span><strong>{{ t('projectTrustScope') }}</strong>{{ t('projectTrustScopeDescription') }}</span></p>
      <p v-if="store.error" class="error-message" role="alert">{{ store.error }}</p>
      <footer>
        <UiButton :disabled="store.busy" @click="pendingTrustProject = undefined">{{ t('cancel') }}</UiButton>
        <UiButton data-testid="trust-workspace-project-confirm" variant="warning" :disabled="store.busy" @click="trustWorkspaceProject"><Icon name="trusted" /> {{ store.busy ? t('allowingExecution') : t('trustProject') }}</UiButton>
      </footer>
    </DialogShell>
  </main>
</template>
