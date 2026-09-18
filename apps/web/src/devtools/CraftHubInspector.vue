<script setup lang="ts">
import type { CapabilityDiscoveryResult } from 'craft-hub'
import type { InspectorSnapshot } from '../../devtools/types'
import { computed, onMounted, ref, watch } from 'vue'
import { inspectorTabs } from '../../devtools/navigation'
import { inspector } from './client'
import { useInspectorI18n } from './i18n'
import { useInspectorNavigation } from './navigation'

const { locale, t } = useInspectorI18n()
const tabs = computed(() => inspectorTabs.map((item, order) => ({
  id: item.id, title: t(item.id), icon: item.icon, order, navTarget: { path: `/${item.id}` },
})))
const { tab, navigate, embedded } = useInspectorNavigation(tabs)
const snapshot = ref<InspectorSnapshot>()
const selectedId = ref('')
const discovery = ref<CapabilityDiscoveryResult>()
const search = ref('')
const loading = ref(false)
const discovering = ref(false)
const error = ref('')
const discoveryError = ref('')
let discoveryRevision = 0

const projects = computed(() => snapshot.value?.catalog.projects ?? [])
const selectedProject = computed(() => projects.value.find(project => project.id === selectedId.value))
const capabilities = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (discovery.value?.capabilities ?? []).filter(item =>
    `${item.name} ${item.kind} ${item.source} ${item.kind === 'command' ? item.package?.relativePath ?? '' : item.path}`.toLowerCase().includes(query),
  )
})
const diagnostics = computed(() => snapshot.value?.diagnostics?.diagnostics ?? [])
const trustedCount = computed(() => projects.value.filter(project => project.trust === 'trusted').length)

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

async function discover() {
  const revision = ++discoveryRevision
  discovery.value = undefined
  discoveryError.value = ''
  discovering.value = Boolean(selectedId.value)
  if (!selectedId.value)
    return
  try {
    const result = await inspector.discover(selectedId.value)
    if (revision === discoveryRevision)
      discovery.value = result
  }
  catch (cause) {
    if (revision === discoveryRevision)
      discoveryError.value = message(cause)
  }
  finally {
    if (revision === discoveryRevision)
      discovering.value = false
  }
}

async function refresh() {
  if (loading.value)
    return
  loading.value = true
  error.value = ''
  try {
    snapshot.value = await inspector.snapshot()
    if (!projects.value.some(project => project.id === selectedId.value))
      selectedId.value = projects.value[0]?.id ?? ''
    else
      await discover()
  }
  catch (cause) {
    error.value = message(cause)
  }
  finally {
    loading.value = false
  }
}

function time(value: string) {
  return new Date(value).toLocaleString(locale.value)
}

function projectName(id: string) {
  return projects.value.find(project => project.id === id)?.name ?? id
}

watch(selectedId, () => {
  search.value = ''
  void discover()
})
onMounted(refresh)
</script>

<template>
  <main class="inspector">
    <header class="inspector-header">
      <div>
        <p class="eyebrow">
          {{ t('development') }}
        </p>
        <h1>Craft Hub Inspector</h1>
        <p class="muted">
          {{ t('subtitle') }}
        </p>
      </div>
      <div class="header-actions">
        <select v-model="locale" class="language-picker" :aria-label="t('language')">
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
        <button class="refresh" :disabled="loading" @click="refresh">
        {{ t(loading ? 'refreshing' : 'refresh') }}
        </button>
      </div>
    </header>

    <div v-if="error" class="notice error" role="alert">
      <strong>{{ t('refreshFailed') }}</strong>
      <p>{{ error }}</p>
      <p>{{ t('refreshHint') }}</p>
    </div>
    <div v-if="snapshot?.errors.length" class="notice error" role="alert">
      <strong>{{ t('partialFailure') }}</strong>
      <p v-for="failure in snapshot.errors" :key="failure.section">
        {{ failure.section === 'Runtime' ? t('runtime') : failure.section === 'Projects' ? t('projects') : failure.section === 'Diagnostics' ? t('diagnostics') : failure.section === 'Runs' ? t('runs') : failure.section }}: {{ failure.message }}
      </p>
      <p>{{ t('startRuntime') }} <code>pnpm dev:web</code> {{ t('or') }} <code>pnpm dev</code>{{ t('thenRefresh') }}</p>
    </div>

    <section class="metrics" :aria-label="t('runtimeOverview')">
      <div class="metric">
        <span>{{ t('runtime') }}</span>
        <strong class="runtime-state" :class="{ healthy: snapshot?.health?.status === 'ok' }">{{ t(snapshot?.health ? 'connected' : loading ? 'connecting' : 'unavailable') }}</strong>
        <small>{{ snapshot?.health?.distribution.name ?? t('localHost') }}</small>
      </div>
      <div class="metric">
        <span>{{ t('projects') }}</span><strong>{{ projects.length }}</strong><small>{{ t('trustCounts', { trusted: trustedCount, untrusted: projects.length - trustedCount }) }}</small>
      </div>
      <div class="metric">
        <span>{{ t('diagnostics') }}</span><strong>{{ diagnostics.length }}</strong><small>{{ t('diagnosticCounts', { errors: snapshot?.diagnostics?.summary.errors ?? 0, warnings: snapshot?.diagnostics?.summary.warnings ?? 0 }) }}</small>
      </div>
    </section>

    <nav v-if="!embedded" class="tabs" :aria-label="t('sections')">
      <button v-for="item in tabs" :key="item.id" :aria-current="tab === item.id ? 'page' : undefined" @click="navigate(item.id)">
        {{ item.title }}
      </button>
    </nav>

    <section v-if="tab === 'projects'" :aria-label="t('projectInspection')">
      <div class="toolbar">
        <label class="project-picker">{{ t('project') }}
          <select v-model="selectedId" :disabled="!projects.length" :aria-label="t('project')">
            <option v-if="!projects.length" value="">{{ t('noProjects') }}</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          </select>
        </label>
        <span v-if="selectedProject" class="badge" :class="selectedProject.trust">{{ t(selectedProject.trust) }}</span>
      </div>
      <template v-if="selectedProject">
        <p class="project-path"><code>{{ selectedProject.path }}</code></p>
        <div class="capability-toolbar">
          <h2>{{ t('capabilities') }} <span class="muted">{{ capabilities.length }}</span></h2>
          <input v-model="search" type="search" :aria-label="t('filter')" :placeholder="t('filterHint')">
        </div>
        <p v-if="discovering" class="empty" role="status">{{ t('discovering') }}</p>
        <div v-else-if="discoveryError" class="notice error" role="alert">
          <p>{{ discoveryError }}</p>
          <button @click="discover">{{ t('retryDiscovery') }}</button>
        </div>
        <template v-else>
          <div v-if="discovery?.diagnostics.length" class="notice">
            <p v-for="(diagnostic, index) in discovery.diagnostics" :key="index">{{ diagnostic.source }}: {{ diagnostic.message }} <code>{{ diagnostic.path }}</code></p>
          </div>
          <div v-if="capabilities.length" class="capabilities">
            <details v-for="capability in capabilities" :key="capability.id" class="capability">
              <summary>
                <span class="capability-name">{{ capability.name }}</span>
                <span class="badge">{{ t(capability.kind) }}</span>
                <span class="source">{{ capability.source }}<template v-if="capability.kind === 'command' && capability.package"> · {{ capability.package.relativePath }}</template></span>
              </summary>
              <div class="capability-detail">
                <p v-if="capability.description">{{ capability.description }}</p>
                <template v-if="capability.kind === 'command'">
                  <pre>{{ [capability.invocation.command, ...capability.invocation.args].join(' ') }}</pre>
                  <p><span class="muted">{{ t('cwd') }}</span> <code>{{ capability.invocation.cwd }}</code></p>
                  <p v-if="capability.availability?.diagnostic" class="warning">{{ capability.availability.diagnostic }}</p>
                </template>
                <p v-else><code>{{ capability.path }}</code></p>
                <p class="muted">ID: {{ capability.id }}</p>
              </div>
            </details>
          </div>
          <p v-else class="empty">{{ t(search ? 'noMatches' : 'noCapabilities') }}</p>
        </template>
      </template>
      <p v-else class="empty">{{ t('registerProject') }}</p>
      <div v-if="snapshot?.catalog.diagnostics.length" class="notice">
        <p v-for="(diagnostic, index) in snapshot.catalog.diagnostics" :key="index">{{ projectName(diagnostic.projectId) }}: {{ diagnostic.message }}</p>
      </div>
    </section>

    <section v-else-if="tab === 'diagnostics'" :aria-label="t('workbenchDiagnostics')">
      <h2>{{ t('workbenchDiagnostics') }}</h2>
      <p class="muted">{{ t('diagnosticsHint') }}</p>
      <article v-for="diagnostic in diagnostics" :key="diagnostic.id" class="diagnostic">
        <div class="diagnostic-title"><span class="badge" :class="diagnostic.severity">{{ t(diagnostic.severity) }}</span><strong>{{ diagnostic.subject ?? diagnostic.kind }}</strong><span class="muted">{{ diagnostic.kind }}</span></div>
        <p>{{ diagnostic.message }}</p>
        <code v-if="diagnostic.path">{{ diagnostic.path }}{{ diagnostic.line ? `:${diagnostic.line}` : '' }}</code>
      </article>
      <p v-if="!diagnostics.length" class="empty">{{ t(snapshot?.diagnostics ? 'noDiagnostics' : 'diagnosticsUnavailable') }}</p>
    </section>

    <section v-else :aria-label="t('recentRuns')">
      <h2>{{ t('recentRuns') }}</h2>
      <p class="muted">{{ t('runsHint') }}</p>
      <div v-if="snapshot?.runs.length" class="table-scroll">
        <table>
          <thead><tr><th>{{ t('commandProject') }}</th><th>{{ t('status') }}</th><th>{{ t('started') }}</th><th>{{ t('exit') }}</th></tr></thead>
          <tbody>
            <tr v-for="run in snapshot.runs" :key="run.id">
              <td><code>{{ [run.command, ...run.args].join(' ') }}</code><small>{{ projectName(run.projectId) }}</small></td>
              <td><span class="badge" :class="run.status">{{ t(run.status) }}</span></td>
              <td class="time">{{ time(run.startedAt) }}</td><td>{{ run.exitCode ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">{{ t('noRuns') }}</p>
    </section>

    <footer>
      <span>{{ t('readOnly') }}</span>
      <span v-if="snapshot">{{ t('lastFetched', { time: time(snapshot.checkedAt) }) }}</span>
    </footer>
  </main>
</template>
