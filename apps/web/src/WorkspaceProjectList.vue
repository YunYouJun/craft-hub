<script setup lang="ts">
import type { Capability, ProjectRecord, WorkspaceRecord } from 'craft-hub'
import { computed, ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

interface WorkspaceProjectRow {
  capabilities: Capability[]
  label: string
  member: WorkspaceRecord['members'][number]
  primary: boolean
  project: ProjectRecord
}

const store = useWorkbenchStore()
const { t } = useI18n()
const adding = ref(false)

const workspace = computed(() => store.selectedWorkspace)
const rows = computed<WorkspaceProjectRow[]>(() => {
  if (!workspace.value)
    return []
  return workspace.value.members
    .map((member, index) => {
      const project = store.projects.find(item => item.id === member.projectId)
      if (!project)
        return undefined
      const capabilityIds = store.capabilityPinsByProject[project.id] ?? []
      return {
        project,
        member,
        label: member.label || project.name,
        primary: member.project === workspace.value?.primaryProject,
        capabilities: capabilityIds
          .map(id => store.paletteItems.find(item => item.project.id === project.id && item.capability.id === id)?.capability)
          .filter((capability): capability is Capability => Boolean(capability)),
        index,
      }
    })
    .filter((row): row is WorkspaceProjectRow & { index: number } => Boolean(row))
    .sort((left, right) => Number(right.primary) - Number(left.primary) || left.index - right.index)
})

function status(project: ProjectRecord): { icon: 'error' | 'refresh', label: string, extra: number } | undefined {
  const summary = store.projectRunSummary(project.id)
  const running = store.isProjectStarting(project.id) || Boolean(summary?.running)
  const failed = summary?.lastStatus === 'failed'
  const cancelled = summary?.lastStatus === 'cancelled'
  const diagnostics = store.capabilityDiagnosticsByProject[project.id]?.length ?? 0
  const issueCount = Number(failed || cancelled) + Number(diagnostics > 0)
  if (running) {
    return {
      icon: 'refresh',
      label: store.isProjectStarting(project.id) ? t('startingCommand') : t('runningCommands', { count: String(summary?.running ?? 1) }),
      extra: issueCount,
    }
  }
  if (failed)
    return { icon: 'error', label: t('commandFailed'), extra: issueCount - 1 }
  if (cancelled)
    return { icon: 'error', label: t('commandCancelled'), extra: issueCount - 1 }
  if (diagnostics)
    return { icon: 'error', label: t('configurationIssues', { count: String(diagnostics) }), extra: issueCount - 1 }
  return undefined
}

function openCapability(projectId: string, capabilityId: string): void {
  store.selectWorkspaceCapability(projectId, capabilityId)
}

async function addProject(): Promise<void> {
  if (!workspace.value)
    return
  const path = window.craftHubDesktop?.selectProjectDirectory
    ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
    : window.prompt(t('projectPath'))
  if (!path)
    return
  adding.value = true
  try {
    await store.addProjectPathToWorkspace(workspace.value.id, path)
  }
  finally {
    adding.value = false
  }
}

async function retry(): Promise<void> {
  await Promise.all([store.loadWorkspaces(), store.refreshProjects(undefined, false)])
}
</script>

<template>
  <section class="capability-panel workspace-project-panel">
    <div class="panel-heading">
      <div>
        <h2>{{ t('workspaceProjectsPanel') }}</h2>
        <small v-if="workspace">{{ t('workspaceProjectCount', { count: String(workspace.members.length) }) }}</small>
      </div>
    </div>

    <div v-if="store.workspaceLoading && !workspace" class="workspace-project-loading" aria-live="polite">
      <span v-for="index in 3" :key="index" />
    </div>
    <div v-else-if="store.workspaceError && !workspace" class="workspace-project-error">
      <Icon name="error" />
      <p>{{ t('workspaceLoadFailed', { message: store.workspaceError }) }}</p>
      <UiButton @click="retry">{{ t('retry') }}</UiButton>
    </div>
    <div v-else-if="workspace && !workspace.members.length" class="workspace-project-empty">
      <Icon name="workspace" />
      <p>{{ t('workspaceEmpty') }}</p>
      <UiButton :disabled="adding" @click="addProject">
        <Icon name="plus" /> {{ adding ? t('adding') : t('addProject') }}
      </UiButton>
    </div>
    <div v-else class="workspace-project-summary-list">
      <article v-for="row in rows" :key="row.project.id" class="workspace-project-summary">
        <button class="workspace-project-open" type="button" @click="store.selectProject(row.project.id)">
          <span class="workspace-project-icon"><Icon name="folder" /></span>
          <span class="workspace-project-copy">
            <span>
              <strong :title="row.member.label ? row.project.name : undefined">{{ row.label }}</strong>
              <small v-if="row.primary" class="workspace-project-primary">{{ t('primary') }}</small>
            </span>
            <small v-if="status(row.project)" class="workspace-project-status" :class="status(row.project)?.icon">
              <Icon :name="status(row.project)!.icon" :class="{ 'refresh-icon': status(row.project)?.icon === 'refresh' }" />
              {{ status(row.project)?.label }}
              <span v-if="status(row.project)!.extra > 0">· {{ t('additionalIssues', { count: String(status(row.project)!.extra) }) }}</span>
            </small>
          </span>
          <Icon name="arrowRight" />
        </button>
        <div v-if="row.capabilities.length" class="workspace-capability-shortcuts" :aria-label="t('pinnedCapabilitiesForProject', { name: row.label })">
          <button
            v-for="capability in row.capabilities.slice(0, 2)"
            :key="capability.id"
            class="workspace-capability-shortcut"
            type="button"
            :aria-label="t('openWorkspaceCapability', { capability: capability.name, project: row.label })"
            @click="openCapability(row.project.id, capability.id)"
          >
            <Icon :name="capability.kind === 'command' ? 'terminal' : 'skill'" />
            <span>{{ capability.name }}</span>
          </button>
          <button v-if="row.capabilities.length > 2" class="workspace-capability-more" type="button" @click="store.selectProject(row.project.id)">
            {{ t('moreCapabilities', { count: String(row.capabilities.length - 2) }) }}
          </button>
        </div>
      </article>

      <article v-for="member in workspace?.members.filter(item => !item.resolved)" :key="member.project" class="workspace-project-summary unresolved">
        <div class="workspace-project-open" aria-disabled="true">
          <span class="workspace-project-icon"><Icon :name="member.path ? 'folder' : 'error'" /></span>
          <span class="workspace-project-copy"><strong>{{ member.label || member.project }}</strong><small class="workspace-project-status">{{ t(member.path ? 'availableProject' : 'unresolved') }}</small></span>
        </div>
      </article>
    </div>
  </section>
</template>
