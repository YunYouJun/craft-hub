<script setup lang="ts">
import type { HostDiagnosticProviderSnapshot, WorkbenchDiagnostic, WorkbenchDiagnosticKind, WorkbenchDiagnosticTarget } from 'craft-hub'
import { computed, onMounted } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import { Button as UiButton } from './components/ui/button'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const emit = defineEmits<{ openTarget: [target: WorkbenchDiagnosticTarget] }>()
const store = useWorkbenchStore()
const { t } = useI18n()

const diagnostics = computed(() => store.workbenchDiagnostics.diagnostics)
const total = computed(() => store.workbenchDiagnostics.summary.errors + store.workbenchDiagnostics.summary.warnings)
const providers = computed(() => store.workbenchDiagnostics.providers ?? [])
const reportsComplete = computed(() => providers.value.every(provider => provider.state === 'ready'))
const groups = computed(() => [...diagnostics.value.reduce((result, diagnostic) => {
  const entries = result.get(diagnostic.kind) ?? []
  entries.push(diagnostic)
  result.set(diagnostic.kind, entries)
  return result
}, new Map<WorkbenchDiagnosticKind, WorkbenchDiagnostic[]>())])

onMounted(() => {
  if (!store.workbenchDiagnostics.checkedAt && !store.workbenchDiagnosticsLoading)
    void store.loadWorkbenchDiagnostics()
})

function kindLabel(kind: WorkbenchDiagnosticKind): string {
  switch (kind) {
    case 'host-plugin': return t('diagnosticKind_hostPlugin')
    case 'host-provider': return t('diagnosticKind_hostProvider')
    case 'integration': return t('diagnosticKind_integration')
    case 'marketplace-plugin': return t('diagnosticKind_marketplacePlugin')
    case 'marketplace-source': return t('diagnosticKind_marketplaceSource')
    case 'project-config': return t('diagnosticKind_projectConfig')
    case 'settings': return t('diagnosticKind_settings')
    case 'user-config': return t('diagnosticKind_userConfig')
  }
}

function providerStateLabel(provider: HostDiagnosticProviderSnapshot): string {
  return t(`diagnosticProviderState_${provider.state}`)
}

function diagnosticMessage(diagnostic: WorkbenchDiagnostic): string {
  return diagnostic.kind === 'host-provider' && diagnostic.message === 'Diagnostic provider could not complete. Refresh to retry.'
    ? t('diagnosticProviderFailed')
    : diagnostic.message
}

function openLabel(target: WorkbenchDiagnosticTarget): string {
  if (target.type === 'marketplace')
    return t('openMarketplace')
  if (target.type === 'settings')
    return t('openSettings')
  if (target.type === 'project')
    return t('openProject')
  return t('openIntegration')
}
</script>

<template>
  <WorkbenchViewFrame class="diagnostics-workbench" :title="t('diagnostics')" :description="t('diagnosticsDescription')" icon="builtin:check">
    <template #actions><UiButton size="compact" :disabled="store.workbenchDiagnosticsLoading" @click="store.loadWorkbenchDiagnostics()"><Icon :name="store.workbenchDiagnosticsLoading ? 'loading' : 'refresh'" />{{ t('refresh') }}</UiButton></template>
      <section v-if="store.workbenchDiagnosticsError" class="diagnostics-load-error" role="alert">
        <Icon name="error" />
        <div>
          <strong>{{ t('diagnosticsLoadFailed') }}</strong>
          <p>{{ store.workbenchDiagnosticsError }}</p>
        </div>
      </section>

      <section v-else-if="store.workbenchDiagnosticsLoading && !store.workbenchDiagnostics.checkedAt" class="diagnostics-state" aria-live="polite">
        <Icon name="loading" />
        <p>{{ t('loadingDiagnostics') }}</p>
      </section>

      <template v-else>
        <section v-if="providers.length" class="diagnostics-providers" :aria-label="t('diagnosticProviders')" data-testid="diagnostics-providers">
          <article v-for="provider in providers" :key="provider.id" class="diagnostic-provider" :data-state="provider.state">
            <header>
              <strong>{{ provider.title }}</strong>
              <span>{{ providerStateLabel(provider) }}</span>
            </header>
            <p class="diagnostic-provider-source">{{ t('diagnosticProviderSource') }}: {{ provider.pluginId }}</p>
            <p v-if="provider.metadata?.version || provider.metadata?.platform" class="diagnostic-provider-metadata">
              <span v-if="provider.metadata.version">{{ t('diagnosticProviderVersion') }}: {{ provider.metadata.version }}</span>
              <span v-if="provider.metadata.platform">{{ t('diagnosticProviderPlatform') }}: {{ provider.metadata.platform }}</span>
            </p>
            <p v-if="provider.state === 'ready' && provider.summary" class="diagnostic-provider-counts">
              <span>{{ t('diagnosticPassedCount', { count: String(provider.summary.passed) }) }}</span>
              <span>{{ t('diagnosticWarningCount', { count: String(provider.summary.warnings) }) }}</span>
              <span>{{ t('diagnosticErrorCount', { count: String(provider.summary.errors) }) }}</span>
            </p>
            <p v-if="provider.state === 'error'">{{ t('diagnosticProviderFailed') }}</p>
            <p v-if="provider.state === 'empty'">{{ t('diagnosticProviderEmpty') }}</p>
            <p v-if="provider.state === 'skipped'">{{ t('diagnosticProviderSkipped') }}</p>
            <small v-if="provider.checkedAt">{{ t('diagnosticProviderCheckedAt') }}: <time :datetime="provider.checkedAt">{{ provider.checkedAt }}</time></small>
          </article>
        </section>
        <section v-if="!total && reportsComplete" class="diagnostics-state diagnostics-clear" data-testid="diagnostics-clear">
          <span><Icon name="check" /></span>
          <h2>{{ t('diagnosticsClear') }}</h2>
          <p>{{ t('diagnosticsClearDescription') }}</p>
        </section>
        <div v-if="total" class="diagnostics-summary" data-testid="diagnostics-summary">
          <span>{{ t('diagnosticErrorCount', { count: String(store.workbenchDiagnostics.summary.errors) }) }}</span>
          <span>{{ t('diagnosticWarningCount', { count: String(store.workbenchDiagnostics.summary.warnings) }) }}</span>
        </div>
        <section v-for="group in groups" :key="group[0]" class="diagnostics-group">
          <header>
            <h2>{{ kindLabel(group[0]) }}</h2>
            <small>{{ group[1].length }}</small>
          </header>
          <article v-for="diagnostic in group[1]" :key="diagnostic.id" class="diagnostic-row" :data-severity="diagnostic.severity">
            <span class="diagnostic-icon"><Icon name="error" /></span>
            <div class="diagnostic-copy">
              <strong v-if="diagnostic.subject">{{ diagnostic.subject }}</strong>
              <p>{{ diagnosticMessage(diagnostic) }}</p>
              <small v-if="diagnostic.path">{{ diagnostic.path }}<template v-if="diagnostic.line">:{{ diagnostic.line }}<template v-if="diagnostic.column">:{{ diagnostic.column }}</template></template></small>
            </div>
            <button v-if="diagnostic.target" type="button" @click="emit('openTarget', diagnostic.target)">
              {{ openLabel(diagnostic.target) }}
              <Icon name="arrowRight" />
            </button>
          </article>
        </section>
      </template>
  </WorkbenchViewFrame>
</template>

<style scoped>
.diagnostic-row > button { display: inline-flex; min-height: var(--control-height-compact); flex: none; align-items: center; justify-content: center; gap: var(--space-2); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); padding: 0 11px; color: var(--text-secondary); font: inherit; font-size: var(--font-size-body); }
.diagnostic-row > button:hover { border-color: var(--border-strong); background: var(--surface-hover); color: var(--text); }
.diagnostic-row > button .app-icon { width: 15px; height: 15px; }
.diagnostics-summary { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-bottom: var(--page-section-gap); color: var(--muted); font-size: var(--font-size-body); font-variant-numeric: tabular-nums; }
.diagnostics-providers { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: var(--space-4); margin-bottom: var(--page-section-gap); }
.diagnostic-provider { display: grid; align-content: start; gap: var(--space-2); min-width: 0; border: 1px solid var(--border); border-radius: var(--panel-radius); padding: var(--space-4); background: var(--surface); }
.diagnostic-provider header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-2); }
.diagnostic-provider header strong { color: var(--text); overflow-wrap: anywhere; }
.diagnostic-provider header span, .diagnostic-provider small { color: var(--muted); font-size: var(--font-size-caption); }
.diagnostic-provider[data-state='error'] header span { color: var(--danger); }
.diagnostic-provider p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-body); line-height: 1.5; overflow-wrap: anywhere; }
.diagnostic-provider small { overflow-wrap: anywhere; }
.diagnostic-provider-metadata, .diagnostic-provider-counts { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.diagnostic-provider .diagnostic-provider-source { color: var(--muted); }
.diagnostics-group { border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); padding: var(--space-4); }
.diagnostics-group + .diagnostics-group { margin-top: 28px; }
.diagnostics-group > header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 5px; padding: 0 2px 8px; }
.diagnostics-group h2 { margin: 0; color: var(--text); font-size: var(--page-section-title-size); }
.diagnostics-group > header small { display: grid; min-width: 22px; height: 22px; place-items: center; border-radius: var(--radius-pill); background: var(--surface-muted); color: var(--muted); font-size: var(--font-size-caption); }
.diagnostic-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: start; gap: 12px; border-top: 1px solid var(--border); padding: 14px 2px; }
.diagnostic-icon { display: grid; width: 24px; height: 24px; place-items: center; color: var(--warning); }
.diagnostic-row[data-severity='error'] .diagnostic-icon { color: var(--danger); }
.diagnostic-icon .app-icon { width: 17px; height: 17px; }
.diagnostic-copy { display: grid; min-width: 0; gap: 3px; }
.diagnostic-copy strong { overflow: hidden; color: var(--text); font-size: var(--font-size-emphasis); text-overflow: ellipsis; white-space: nowrap; }
.diagnostic-copy p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-body); line-height: 1.55; overflow-wrap: anywhere; }
.diagnostic-copy small { overflow-wrap: anywhere; color: var(--muted); font-family: var(--font-mono); font-size: var(--font-size-caption); line-height: 1.5; }
.diagnostics-state { display: grid; min-height: 360px; place-items: center; align-content: center; gap: 9px; color: var(--muted); text-align: center; }
.diagnostics-state > .app-icon { width: 26px; height: 26px; }
.diagnostics-state h2, .diagnostics-state p { margin: 0; }
.diagnostics-state h2 { color: var(--text); font-size: 17px; }
.diagnostics-clear > span { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--success) 12%, var(--surface)); color: var(--success); }
.diagnostics-clear > span .app-icon { width: 22px; height: 22px; }
.diagnostics-load-error { display: flex; align-items: flex-start; gap: 11px; border-top: 1px solid var(--border); padding: 16px 2px; color: var(--danger); }
.diagnostics-load-error > .app-icon { width: 18px; height: 18px; }
.diagnostics-load-error div { display: grid; gap: 4px; color: var(--text); }
.diagnostics-load-error p { margin: 0; color: var(--muted); font-size: var(--font-size-body); }
@media (max-width: 720px) { .diagnostic-row { grid-template-columns: 24px minmax(0, 1fr); } .diagnostic-row > button { grid-column: 2; justify-self: start; } }
</style>
