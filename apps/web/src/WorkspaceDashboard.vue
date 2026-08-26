<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const prompt = ref('')
const selectedProjectIds = ref<string[]>([])
const primaryProjectId = ref('')
const openingCodex = ref(false)
const startingInBackground = ref(false)
const taskMenuOpen = ref(false)
const error = ref('')
const notice = ref('')

const workspace = computed(() => store.selectedWorkspace)
const projects = computed(() => workspace.value ? store.workspaceProjects(workspace.value) : [])
const tasks = computed(() => store.agentTasks.filter(task => task.workspaceId === workspace.value?.id))

watch(workspace, (value) => {
  const trusted = value
    ? store.workspaceProjects(value).filter(project => project.trust === 'trusted').map(project => project.id)
    : []
  selectedProjectIds.value = trusted
  primaryProjectId.value = value?.members.find(member => member.project === value.primaryProject)?.projectId
    ?? trusted[0]
    ?? ''
}, { immediate: true })

watch(selectedProjectIds, (ids) => {
  if (!ids.includes(primaryProjectId.value))
    primaryProjectId.value = ids[0] ?? ''
})

async function startInCodex(): Promise<void> {
  if (!workspace.value || !primaryProjectId.value || !prompt.value.trim())
    return
  openingCodex.value = true
  error.value = ''
  notice.value = ''
  try {
    const value = prompt.value.trim()
    const primaryProject = projects.value.find(project => project.id === primaryProjectId.value)
    if (!primaryProject)
      throw new Error('Primary project is unavailable')
    if (window.craftHubDesktop?.startProjectInCodex) {
      await window.craftHubDesktop.startProjectInCodex(primaryProject.id, value)
    }
    else {
      await navigator.clipboard.writeText(value)
      const query = new URLSearchParams({ path: primaryProject.path })
      window.location.href = `codex://threads/new?${query}`
    }
    prompt.value = ''
    notice.value = t('codexPromptCopied')
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    openingCodex.value = false
  }
}

async function startInBackground(): Promise<void> {
  if (!workspace.value || !primaryProjectId.value || !prompt.value.trim())
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
      <span class="detail-icon"><Icon name="hub" /></span>
      <div><h2>{{ workspace.name }}</h2><p>{{ t('codexTaskCount', { projects: String(projects.length), tasks: String(tasks.length) }) }}</p></div>
    </header>

    <section class="workspace-summary">
      <h3>{{ t('projects') }}</h3>
      <div v-for="project in projects" :key="project.id" class="workspace-member-card">
        <label>
          <input v-model="selectedProjectIds" type="checkbox" :value="project.id" :disabled="project.trust !== 'trusted'">
          <strong :title="workspace.members.find(member => member.projectId === project.id)?.label ? project.name : undefined">{{ workspace.members.find(member => member.projectId === project.id)?.label || project.name }}</strong>
          <small>{{ project.trust }}</small>
        </label>
        <label class="primary-choice">
          <input v-model="primaryProjectId" type="radio" name="primary-project" :value="project.id" :disabled="!selectedProjectIds.includes(project.id)" @change="savePrimary">
          {{ t('primary') }}
        </label>
      </div>
      <div v-for="member in workspace.members.filter(item => !item.resolved)" :key="member.project" class="workspace-member-card unresolved">
        <span><Icon name="error" /> {{ member.project }}</span><small>{{ t('locateBeforeTask') }}</small>
      </div>
    </section>

    <form class="agent-task-form" @submit.prevent="startInCodex">
      <h3>{{ t('newCodexTask') }}</h3>
      <textarea v-model="prompt" rows="4" :placeholder="t('codexTaskPrompt')" />
      <p class="permission-note">{{ t('codexTaskLaunchHint') }}</p>
      <p v-if="error" class="error-message">{{ error }}</p>
      <p v-if="notice" class="success-message">{{ notice }}</p>
      <div class="agent-task-split-action">
        <button class="primary-button" type="submit" data-testid="start-in-codex" :disabled="openingCodex || startingInBackground || !prompt.trim() || !primaryProjectId">
          <Icon name="codex" /> {{ openingCodex ? t('openingCodex') : t('startInCodex') }}
        </button>
        <details :open="taskMenuOpen" class="agent-task-action-menu" @toggle="taskMenuOpen = ($event.target as HTMLDetailsElement).open">
          <summary role="button" :aria-expanded="taskMenuOpen" :aria-label="t('moreCodexTaskActions')" :title="t('moreCodexTaskActions')"><Icon name="arrowDown" /></summary>
          <div>
            <button type="button" data-testid="start-in-background" :disabled="openingCodex || startingInBackground || !prompt.trim() || !primaryProjectId || !selectedProjectIds.length" @click="startInBackground">
              <Icon name="refresh" /> {{ startingInBackground ? t('startingTask') : t('runInCraftHubBackground') }}
            </button>
            <small>{{ t('codexTaskPermission') }}</small>
          </div>
        </details>
      </div>
    </form>

    <section class="agent-task-list">
      <h3>{{ t('recentTasks') }}</h3>
      <article v-for="task in tasks" :key="task.id" class="agent-task-card">
        <div><strong>{{ task.prompt }}</strong><small>{{ task.status }} · {{ new Date(task.startedAt).toLocaleString() }}</small></div>
        <button v-if="task.externalThreadId" class="secondary-button" @click="openThread(task.externalThreadId)"><Icon name="codex" /> {{ t('openInCodex') }}</button>
        <p v-if="task.finalResponse">{{ task.finalResponse }}</p>
        <p v-if="task.error" class="error-message">{{ task.error }}</p>
      </article>
      <p v-if="!tasks.length" class="empty">{{ t('noCodexTasks') }}</p>
    </section>
  </main>
</template>
