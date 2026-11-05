<script setup lang="ts">
import type { CommandCapability, ProjectSpaceCategory, ProjectSpaceIssue, ProjectSpaceSnapshot } from 'craft-hub'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t, locale } = useI18n()
const panelElement = ref<HTMLElement>()
const snapshot = ref<ProjectSpaceSnapshot>()
const loading = ref(false)
const error = ref('')
const cancelled = ref(false)
let controller: AbortController | undefined
let requestVersion = 0
const categoryKeys = {
  dependencies: 'projectSpaceDependencies', build: 'projectSpaceBuild', cache: 'projectSpaceCache', git: 'projectSpaceGit', other: 'projectSpaceOther',
} as const satisfies Record<ProjectSpaceCategory, string>
const reasonKeys = {
  'entry-limit': 'projectSpaceEntryLimit', 'time-limit': 'projectSpaceTimeLimit', 'depth-limit': 'projectSpaceDepthLimit',
  'unreadable': 'projectSpaceUnreadable', 'changed': 'projectSpaceChanged', 'different-volume': 'projectSpaceDifferentVolume',
} as const satisfies Record<ProjectSpaceIssue['reason'], string>
const maintenanceCommands = computed(() => store.capabilities.filter((capability): capability is CommandCapability => capability.kind === 'command'
  && /(?:^|[:/\s._-])(?:clean|cleanup)(?:$|[:/\s._-])/i.test(capability.name)))

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`
}

function cancel(): void {
  requestVersion++
  controller?.abort()
  controller = undefined
  loading.value = false
}

async function analyze(): Promise<void> {
  const project = store.selectedProject
  if (!project || !store.hostEnvironment.capabilities.localProjectDirectories || loading.value)
    return
  cancel()
  const version = requestVersion
  const requestController = new AbortController()
  controller = requestController
  loading.value = true
  error.value = ''
  cancelled.value = false
  try {
    const result = await api.projectSpace(project.id, requestController.signal)
    if (version === requestVersion && store.selectedProject?.id === project.id && result.projectId === project.id)
      snapshot.value = result
  }
  catch (caught) {
    if (version === requestVersion)
      error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      controller = undefined
    }
  }
}

function cancelScan(): void {
  cancel()
  cancelled.value = true
}

function review(command: CommandCapability): void {
  const detailPanel = panelElement.value?.closest<HTMLElement>('.detail-panel')
  store.selectCapability(command.id, command.package?.root === false ? command.package.relativePath : '')
  if (detailPanel)
    detailPanel.scrollTop = 0
}

watch([() => store.selectedProject?.id, () => store.hostEnvironment.kind], () => {
  cancel()
  snapshot.value = undefined
  error.value = ''
  cancelled.value = false
}, { flush: 'sync' })
onBeforeUnmount(cancel)
</script>

<template>
  <section ref="panelElement" class="overview-section project-space" data-testid="project-space-panel">
    <div class="space-heading">
      <h3><Icon name="chart" /> {{ t('projectSpaceTitle') }}</h3>
      <UiButton v-if="loading" size="compact" variant="ghost" @click="cancelScan"><Icon name="stop" /> {{ t('cancel') }}</UiButton>
      <UiButton v-else-if="store.hostEnvironment.capabilities.localProjectDirectories" size="compact" variant="secondary" data-testid="analyze-project-space" @click="analyze">
        <Icon :name="snapshot ? 'refresh' : 'chart'" /> {{ t(snapshot ? 'projectSpaceRescan' : 'projectSpaceAnalyze') }}
      </UiButton>
    </div>
    <p class="space-description">{{ t('projectSpaceDescription') }}</p>
    <p v-if="!store.hostEnvironment.capabilities.localProjectDirectories" class="space-notice">{{ t('projectSpaceUnavailable') }}</p>
    <p v-if="loading" role="status" class="space-notice"><Icon name="loading" /> {{ t('projectSpaceScanning') }}</p>
    <p v-if="cancelled" role="status" class="space-notice">{{ t('projectSpaceCancelled') }}</p>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>

    <div v-if="snapshot" class="space-report" :aria-busy="loading" data-testid="project-space-report">
      <div class="space-total">
        <div><span>{{ t('projectSpaceMeasured') }}</span><strong>{{ formatBytes(snapshot.totalBytes) }}</strong></div>
        <p>{{ t('projectSpaceFiles', { count: String(snapshot.fileCount) }) }}<br><time :datetime="snapshot.checkedAt">{{ new Date(snapshot.checkedAt).toLocaleString(locale) }}</time></p>
      </div>
      <p v-if="snapshot.status === 'partial'" class="space-notice space-partial" role="status">{{ t('projectSpacePartial') }}</p>
      <div class="space-categories">
        <div v-for="category in snapshot.categories" :key="category.category" class="space-category">
          <span>{{ t(categoryKeys[category.category]) }}</span><strong>{{ formatBytes(category.bytes) }}</strong>
          <div class="space-bar" aria-hidden="true"><span :style="{ width: `${snapshot.totalBytes ? category.bytes / snapshot.totalBytes * 100 : 0}%` }" /></div>
        </div>
      </div>
      <div v-if="snapshot.entries.length" class="space-entries">
        <h4>{{ t('projectSpaceLargest') }}</h4>
        <ul>
          <li v-for="entry in snapshot.entries" :key="entry.path">
            <Icon :name="entry.kind === 'directory' ? 'folder' : 'docs'" />
            <code :title="entry.path">{{ entry.path }}</code>
            <span v-if="entry.incomplete" class="space-entry-partial">{{ t('projectSpaceIncomplete') }}</span>
            <strong>{{ formatBytes(entry.bytes) }}</strong>
          </li>
        </ul>
        <p v-if="snapshot.omittedEntries">{{ t('projectSpaceOmittedEntries', { count: String(snapshot.omittedEntries) }) }}</p>
      </div>
      <p v-else-if="snapshot.status === 'complete'" class="space-notice">{{ t('projectSpaceEmpty') }}</p>
      <details v-if="snapshot.issues.length" class="space-issues">
        <summary>{{ t('projectSpaceIssues') }}</summary>
        <ul><li v-for="(issue, index) in snapshot.issues" :key="index"><code>{{ issue.path }}</code> · {{ t(reasonKeys[issue.reason]) }}</li></ul>
        <p v-if="snapshot.omittedIssues">{{ t('projectSpaceOmittedIssues', { count: String(snapshot.omittedIssues) }) }}</p>
      </details>
      <p class="space-footnote">{{ t('projectSpaceAccounting', { links: String(snapshot.skippedSymlinks), duplicates: String(snapshot.duplicateFiles) }) }}</p>
    </div>

    <div class="space-maintenance">
      <h4>{{ t('projectSpaceMaintenance') }}</h4>
      <p>{{ t('projectSpaceMaintenanceHint') }}</p>
      <div v-if="maintenanceCommands.length" class="space-commands">
        <UiButton v-for="command in maintenanceCommands" :key="command.id" variant="ghost" class="space-command" :data-testid="`maintenance-command-${command.id}`" @click="review(command)">
          <Icon name="terminal" />
          <span><strong>{{ command.name }}</strong><small>{{ command.package?.relativePath ?? '.' }} · {{ command.source }}</small></span>
          <span class="space-review-label">{{ t('projectSpaceReview') }} <Icon name="arrowRight" /></span>
        </UiButton>
      </div>
      <p v-else class="space-notice">{{ t('projectSpaceNoCommands') }}</p>
    </div>
    <p class="space-footnote">{{ t('projectSpaceAugma') }}</p>
  </section>
</template>

<style scoped>
.project-space { min-width: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.space-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; }
.space-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--font-size-emphasis); }
.project-space p { margin: 0; line-height: 1.6; }
.space-description, .space-maintenance > p { color: var(--text-secondary); font-size: var(--font-size-control); }
.space-notice, .space-footnote, .space-entries > p, .space-issues { color: var(--muted); font-size: var(--font-size-caption); }
.space-notice .app-icon { vertical-align: middle; }
.space-partial, .space-entry-partial { color: var(--warning); }
.space-report { display: grid; gap: 14px; padding-block: 5px; }
.space-total { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 10px; }
.space-total > div { display: grid; gap: 3px; }
.space-total span, .space-total p { color: var(--muted); font-size: var(--font-size-caption); }
.space-total strong { font-size: 28px; font-weight: 600; letter-spacing: -.6px; }
.space-total p { text-align: end; }
.space-categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 12px; }
.space-category { display: grid; gap: 5px; min-width: 0; }
.space-category > span { color: var(--text-secondary); font-size: var(--font-size-caption); }
.space-category strong { font-size: var(--font-size-control); font-weight: 500; }
.space-bar { height: 4px; overflow: hidden; border-radius: 3px; background: var(--surface-hover); }
.space-bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
.project-space h4 { margin: 0; font-size: var(--font-size-control); font-weight: 600; }
.space-entries { display: grid; gap: 7px; }
.project-space ul { margin: 0; padding: 0; list-style: none; }
.space-entries li { display: flex; align-items: center; gap: 7px; padding-block: 7px; border-bottom: 1px solid var(--border); font-size: var(--font-size-caption); }
.space-entries li > .app-icon { flex: none; color: var(--muted); }
.space-entries code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-entries li strong { flex: none; font-weight: 500; font-variant-numeric: tabular-nums; }
.space-entry-partial { flex: none; font-size: 11px; }
.space-issues summary { cursor: pointer; }
.space-issues li { padding-top: 5px; overflow-wrap: anywhere; }
.space-maintenance { display: grid; gap: 7px; padding-top: 12px; border-top: 1px solid var(--border); }
.space-commands { display: grid; min-width: 0; }
.space-command.ui-button { width: 100%; min-width: 0; height: auto; justify-content: flex-start; padding: 8px; text-align: start; }
.space-command > span:not(.app-icon) { display: grid; min-width: 0; gap: 3px; }
.space-command strong, .space-command small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-command strong { font-size: var(--font-size-control); font-weight: 500; }
.space-command small { color: var(--muted); font-size: var(--font-size-caption); font-weight: 400; }
.space-command .space-review-label { display: flex !important; align-items: center; flex: none; margin-left: auto; color: var(--muted); font-size: var(--font-size-caption); }
</style>
