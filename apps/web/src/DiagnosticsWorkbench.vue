<script setup lang="ts">
import type { WorkbenchDiagnostic, WorkbenchDiagnosticKind, WorkbenchDiagnosticTarget } from 'craft-hub'
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
    case 'integration': return t('diagnosticKind_integration')
    case 'marketplace-plugin': return t('diagnosticKind_marketplacePlugin')
    case 'marketplace-source': return t('diagnosticKind_marketplaceSource')
    case 'project-config': return t('diagnosticKind_projectConfig')
    case 'settings': return t('diagnosticKind_settings')
    case 'user-config': return t('diagnosticKind_userConfig')
  }
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

      <section v-else-if="!total" class="diagnostics-state diagnostics-clear" data-testid="diagnostics-clear">
        <span><Icon name="check" /></span>
        <h2>{{ t('diagnosticsClear') }}</h2>
        <p>{{ t('diagnosticsClearDescription') }}</p>
      </section>

      <template v-else>
        <div class="diagnostics-summary" data-testid="diagnostics-summary">
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
              <p>{{ diagnostic.message }}</p>
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
.diagnostics-summary { display: flex; gap: 18px; margin-bottom: 22px; border-bottom: 1px solid var(--border); padding-bottom: 14px; color: var(--muted); font-size: var(--font-size-body); font-variant-numeric: tabular-nums; }
.diagnostics-group + .diagnostics-group { margin-top: 28px; }
.diagnostics-group > header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 5px; padding: 0 2px 8px; }
.diagnostics-group h2 { margin: 0; color: var(--text); font-size: var(--page-section-title-size); }
.diagnostics-group > header small { display: grid; min-width: 19px; height: 19px; place-items: center; border-radius: 10px; background: var(--surface-muted); color: var(--muted); font-size: 10px; }
.diagnostic-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: start; gap: 12px; border-top: 1px solid var(--border); padding: 14px 2px; }
.diagnostic-icon { display: grid; width: 24px; height: 24px; place-items: center; color: var(--warning); }
.diagnostic-row[data-severity='error'] .diagnostic-icon { color: var(--danger); }
.diagnostic-icon .app-icon { width: 17px; height: 17px; }
.diagnostic-copy { display: grid; min-width: 0; gap: 3px; }
.diagnostic-copy strong { overflow: hidden; color: var(--text); font-size: var(--font-size-emphasis); text-overflow: ellipsis; white-space: nowrap; }
.diagnostic-copy p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-body); line-height: 1.55; overflow-wrap: anywhere; }
.diagnostic-copy small { overflow: hidden; color: var(--muted); font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
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
