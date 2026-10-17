<script setup lang="ts">
import type { LocalEnvironmentTool } from 'craft-hub'
import { computed, onMounted } from 'vue'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { SkeletonList } from './components/ui/skeleton'
import { useI18n } from './i18n'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'
import { environmentToolIcon } from './tool-icons'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const store = useWorkbenchStore()
const { t, locale } = useI18n()
const snapshot = computed(() => store.localEnvironment)
const counts = computed(() => ({
  available: snapshot.value?.tools.filter(tool => tool.status === 'available').length ?? 0,
  missing: snapshot.value?.tools.filter(tool => tool.status === 'missing').length ?? 0,
  attention: snapshot.value?.tools.filter(tool => tool.status === 'error' || tool.status === 'unsupported').length ?? 0,
}))
const checkedAt = computed(() => {
  if (!snapshot.value)
    return ''
  const date = new Date(snapshot.value.checkedAt)
  return Number.isNaN(date.getTime())
    ? snapshot.value.checkedAt
    : new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
})

onMounted(() => { void store.loadLocalEnvironment() })

function statusLabel(status: LocalEnvironmentTool['status']): string {
  switch (status) {
    case 'available': return t('environmentAvailable')
    case 'missing': return t('environmentMissing')
    case 'error': return t('environmentProbeError')
    case 'unsupported': return t('environmentUnsupported')
  }
}

function statusVariant(status: LocalEnvironmentTool['status']): 'success' | 'warning' | 'danger' | 'secondary' {
  switch (status) {
    case 'available': return 'success'
    case 'missing': return 'warning'
    case 'error': return 'danger'
    case 'unsupported': return 'secondary'
  }
}

function toolMessage(tool: LocalEnvironmentTool): string | undefined {
  switch (tool.reason) {
    case 'not-found': return t('environmentMissingNote')
    case 'platform-unsupported': return t('environmentReasonPlatformUnsupported')
    case 'shell-shim': return t('environmentReasonShellShim')
    case 'permission-denied': return t('environmentReasonPermissionDenied')
    case 'timeout': return t('environmentReasonTimeout')
    case 'output-limit': return t('environmentReasonOutputLimit')
    case 'version-unrecognized': return t('environmentReasonVersionUnrecognized')
    case 'probe-failed': return t('environmentReasonProbeFailed')
    case 'developer-tools-unavailable': return t('environmentReasonDeveloperToolsUnavailable')
    default: return tool.message
  }
}
</script>

<template>
  <WorkbenchViewFrame class="environment-workbench" :title="locale === 'zh-CN' ? '本机检测' : 'Machine checks'" :description="t('localEnvironmentDescription')" icon="builtin:terminal">
    <template #actions>
      <UiButton size="compact" :disabled="store.localEnvironmentLoading" data-testid="refresh-environment" @click="store.loadLocalEnvironment()">
        <Icon :name="store.localEnvironmentLoading ? 'loading' : 'refresh'" />{{ t('refresh') }}
      </UiButton>
    </template>
    <p class="environment-scope">{{ t('environmentScopeNote') }}</p>

    <Alert v-if="store.localEnvironmentError" variant="danger" class="environment-error" data-testid="environment-error">
      <strong>{{ t('environmentLoadFailed') }}</strong>
      <p>{{ store.localEnvironmentError }}</p>
      <p v-if="snapshot" data-testid="environment-stale">{{ t('environmentStale') }}</p>
      <UiButton size="compact" :disabled="store.localEnvironmentLoading" @click="store.loadLocalEnvironment()">{{ t('retry') }}</UiButton>
    </Alert>

    <section v-if="store.localEnvironmentAccess === 'hosted'" class="environment-state" data-testid="environment-hosted">
      <Icon name="cloud" />
      <p>{{ t('environmentHosted') }}</p>
    </section>
    <div v-else-if="store.localEnvironmentLoading && !snapshot" class="daily-surface" data-testid="environment-loading"><SkeletonList :label="t('environmentLoading')" :rows="5" icon /></div>
    <template v-else-if="snapshot">
      <p v-if="store.localEnvironmentLoading" class="environment-updating" aria-live="polite">{{ t('environmentUpdating') }}</p>
      <div class="environment-summary motion-reveal" data-testid="environment-summary">
        <span>{{ t('environmentAvailableCount', { count: String(counts.available) }) }}</span>
        <span>{{ t('environmentMissingCount', { count: String(counts.missing) }) }}</span>
        <span>{{ t('environmentAttentionCount', { count: String(counts.attention) }) }}</span>
        <time :datetime="snapshot.checkedAt">{{ t('environmentCheckedAt') }}: {{ checkedAt }}</time>
      </div>
      <section class="environment-details motion-reveal">
        <details class="environment-runtime" data-testid="environment-runtime">
          <summary>
            <div class="environment-runtime-heading">
              <h2><Icon name="nodejs" /><span>{{ t('environmentRuntime') }}</span></h2>
              <code class="environment-runtime-meta">{{ snapshot.runtime.version }} · {{ snapshot.runtime.arch }}</code>
            </div>
            <Icon name="arrowDown" class="environment-disclosure-chevron" />
          </summary>
          <div class="environment-runtime-content">
            <p>{{ t('environmentRuntimeNote') }}</p>
            <dl>
              <div><dt>Node.js</dt><dd><code>{{ snapshot.runtime.version }} · {{ snapshot.runtime.arch }}</code></dd></div>
              <div><dt>{{ t('environmentExecutable') }}</dt><dd><code>{{ snapshot.runtime.executablePath }}</code></dd></div>
              <div><dt>{{ t('environmentHost') }}</dt><dd><code>{{ snapshot.host.platform }} · {{ snapshot.host.arch }} · {{ snapshot.host.osRelease }}</code></dd></div>
            </dl>
          </div>
        </details>
        <details class="environment-search" data-testid="environment-search-directories">
          <summary>
            <span class="environment-search-label">{{ t('environmentSearchDirectories') }}<span class="environment-directory-count">{{ snapshot.searchDirectories.length }}</span></span>
            <Icon name="arrowDown" class="environment-disclosure-chevron" />
          </summary>
          <ul><li v-for="directory in snapshot.searchDirectories" :key="directory"><code>{{ directory }}</code></li></ul>
        </details>
      </section>
      <section class="environment-tools" :aria-label="t('environmentTools')">
        <header class="environment-tools-header"><h2>{{ t('environmentTools') }}</h2></header>
        <article v-for="tool in snapshot.tools" :key="tool.id" class="environment-tool" :data-testid="`environment-tool-${tool.id}`" :data-status="tool.status">
          <header><h2><Icon :name="environmentToolIcon(tool.id)" />{{ tool.name }}</h2><div class="environment-tool-meta"><p v-if="tool.version" class="environment-version"><code>{{ tool.version }}</code></p><Badge :variant="statusVariant(tool.status)">{{ statusLabel(tool.status) }}</Badge></div></header>
          <div class="environment-tool-details">
            <p v-if="!tool.version && tool.status === 'available'" class="environment-note">{{ t('environmentVersionUnavailable') }}</p>
            <p v-if="tool.status === 'missing'" class="environment-note">{{ t('environmentMissingNote') }}</p>
            <p v-if="tool.status !== 'missing' && toolMessage(tool)" class="environment-note">{{ toolMessage(tool) }}</p>
            <dl v-if="tool.executablePath">
              <div><dt>{{ t('environmentExecutable') }}</dt><dd><code>{{ tool.executablePath }}</code></dd></div>
              <div v-if="tool.resolvedPath && tool.resolvedPath !== tool.executablePath"><dt>{{ t('environmentResolvedPath') }}</dt><dd><code>{{ tool.resolvedPath }}</code></dd></div>
            </dl>
            <small v-if="tool.source" class="environment-source">{{ t(tool.source === 'path' ? 'environmentPathSource' : 'environmentCommonSource') }}</small>
          </div>
        </article>
      </section>
    </template>
  </WorkbenchViewFrame>
</template>

<style scoped>
.environment-scope, .environment-note, .environment-runtime-content > p { margin: 0; color: var(--muted); font-size: var(--font-size-control); line-height: 1.6; overflow-wrap: anywhere; }
.environment-scope { margin-bottom: var(--space-4); }
.environment-error { display: grid; justify-items: start; gap: var(--space-2); margin-bottom: var(--space-4); }
.environment-error p { margin: 0; overflow-wrap: anywhere; }
.environment-state { display: grid; min-height: 280px; place-items: center; align-content: center; gap: var(--space-3); color: var(--muted); text-align: center; }
.environment-state > .app-icon { width: 28px; height: 28px; }
.environment-state p { max-width: 460px; line-height: 1.6; }
.environment-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); margin-bottom: var(--space-5); color: var(--text-secondary); font-size: var(--font-size-control); font-variant-numeric: tabular-nums; }
.environment-summary > span { display: inline-flex; align-items: center; gap: var(--space-2); }
.environment-summary > span + span::before { content: ''; width: 3px; height: 3px; border-radius: 50%; background: var(--muted); opacity: .5; }
.environment-summary time { margin-left: auto; color: var(--muted); }
.environment-updating { color: var(--muted); font-size: var(--font-size-body); }
.environment-tools { overflow: hidden; border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.environment-tools-header { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); background: var(--surface-subtle); }
.environment-tools-header h2 { margin: 0; color: var(--text-secondary); font-size: var(--font-size-control); font-weight: 600; }
.environment-tool { min-width: 0; padding: var(--space-4); }
.environment-tool + .environment-tool { border-top: 1px solid var(--border); }
.environment-tool > header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2) var(--space-4); }
.environment-runtime h2, .environment-tool h2 { display: flex; align-items: center; gap: var(--space-3); min-width: 0; margin: 0; color: var(--text); font-size: 14px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.environment-runtime h2 > .app-icon, .environment-tool h2 > .app-icon { flex: none; width: 24px; height: 24px; }
.environment-tool-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-3); min-width: 0; margin-left: auto; }
.environment-version { margin: 0; color: var(--text-secondary); }
.environment-tool-details { display: grid; gap: var(--space-2); padding-left: 36px; }
.environment-tool-details:not(:empty) { margin-top: var(--space-2); }
.environment-runtime dl, .environment-tool dl { display: grid; gap: var(--space-1); margin: 0; font-size: var(--font-size-control); }
.environment-runtime dl > div, .environment-tool dl > div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: var(--space-3); }
.environment-runtime dt, .environment-tool dt { color: var(--muted); }
.environment-runtime dd, .environment-tool dd { margin: 0; min-width: 0; color: var(--text-secondary); }
code { font-family: var(--font-mono); font-size: var(--font-size-caption); font-weight: 400; line-height: 1.6; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.environment-source { color: var(--muted); font-size: var(--font-size-caption); }
.environment-details { margin-bottom: var(--space-5); border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.environment-search { border-top: 1px solid var(--border); color: var(--muted); font-size: var(--font-size-control); }
.environment-details summary { display: grid; grid-template-columns: minmax(0, 1fr) 18px; align-items: center; gap: var(--space-3); min-height: 48px; padding: 12px var(--space-4); color: var(--text-secondary); cursor: pointer; list-style: none; }
.environment-details summary::-webkit-details-marker { display: none; }
.environment-disclosure-chevron { width: 18px; height: 18px; justify-self: end; color: var(--muted); transition: transform var(--motion-duration-fast); }
.environment-details details[open] > summary > .environment-disclosure-chevron { transform: rotate(180deg); }
.environment-details summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--control-radius); }
.environment-runtime-heading { display: flex; min-width: 0; align-items: center; gap: var(--space-3); }
.environment-runtime summary h2 { flex: 1; color: var(--text-secondary); font-size: var(--font-size-body); }
.environment-runtime summary h2 > span { min-width: 0; }
.environment-runtime summary h2 > .app-icon { width: 20px; height: 20px; }
.environment-runtime-meta { flex: none; justify-self: start; width: fit-content; max-width: 100%; margin: 0; border: 0; border-radius: 0; padding: 0; background: transparent; color: var(--muted); }
.environment-runtime-content { display: grid; gap: var(--space-3); padding: 0 var(--space-4) var(--space-4); }
.environment-search-label { display: flex; min-width: 0; align-items: center; gap: var(--space-2); }
.environment-directory-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.environment-search ul { display: grid; gap: var(--space-2); margin: 0; padding: 0 var(--space-4) var(--space-4); list-style: none; }
@media (max-width: 760px) {
  .environment-summary { font-size: var(--font-size-body); line-height: 1.6; }
  .environment-summary time { margin-left: 0; flex-basis: 100%; font-size: var(--font-size-caption); }
  .environment-details summary { min-height: 56px; padding-block: 14px; font-size: var(--font-size-body); }
  .environment-runtime > summary { min-height: 76px; align-items: start; }
  .environment-runtime-heading { display: grid; gap: 6px; }
  .environment-runtime summary h2 { align-items: flex-start; }
  .environment-runtime > summary > .environment-disclosure-chevron { margin-top: 2px; }
  .environment-runtime-meta { margin-left: 32px; max-width: calc(100% - 32px); }
  .environment-tool-meta { flex-basis: 100%; justify-content: flex-start; padding-left: 36px; }
  .environment-runtime dl, .environment-tool dl { gap: var(--space-3); }
  .environment-runtime dl > div, .environment-tool dl > div { grid-template-columns: 1fr; gap: var(--space-1); }
}
</style>
