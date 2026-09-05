import type { IntegrationDiagnostic } from './integrations'
import type { ManagedPlugin, MarketplaceSource } from './marketplace'
import type { PluginDiagnostic } from './plugins'
import type { SettingsSnapshot } from './settings'
import type { ProjectCatalogSnapshot } from './types'
import type { UserConfigStatus } from './user-config'

export type WorkbenchDiagnosticKind
  = 'host-plugin'
    | 'integration'
    | 'marketplace-plugin'
    | 'marketplace-source'
    | 'project-config'
    | 'settings'
    | 'user-config'

export interface WorkbenchDiagnosticTarget {
  type: 'integration' | 'marketplace' | 'project' | 'settings'
  integrationId?: string
  package?: string
  projectId?: string
  sourceId?: string
}

/** One actionable problem collected from a host-owned configuration or extension seam. */
export interface WorkbenchDiagnostic {
  id: string
  kind: WorkbenchDiagnosticKind
  severity: 'error' | 'warning'
  message: string
  subject?: string
  path?: string
  line?: number
  column?: number
  target?: WorkbenchDiagnosticTarget
}

/** Deterministic diagnostic collection returned to every Craft Hub client. */
export interface WorkbenchDiagnosticSnapshot {
  checkedAt: string
  diagnostics: WorkbenchDiagnostic[]
  summary: {
    errors: number
    warnings: number
  }
}

export interface WorkbenchDiagnosticSources {
  hostPlugins: readonly PluginDiagnostic[]
  integrations: readonly IntegrationDiagnostic[]
  marketplaceSources: readonly MarketplaceSource[]
  plugins: readonly ManagedPlugin[]
  projects: ProjectCatalogSnapshot
  settings: SettingsSnapshot
  userConfig: UserConfigStatus
}

/**
 * Normalize host, Marketplace, integration, and configuration failures behind
 * one small client-facing interface. Source-specific recovery remains in the
 * owning module; diagnostics only identify the target users should inspect.
 */
export function collectWorkbenchDiagnostics(
  sources: WorkbenchDiagnosticSources,
  checkedAt = new Date().toISOString(),
): WorkbenchDiagnosticSnapshot {
  const projectNames = new Map(sources.projects.projects.map(project => [project.id, project.name]))
  const diagnostics: Array<Omit<WorkbenchDiagnostic, 'id'>> = []

  if (sources.settings.diagnostic) {
    diagnostics.push({
      kind: 'settings',
      severity: 'error',
      message: sources.settings.diagnostic,
      subject: sources.settings.path,
      path: sources.settings.path,
      target: { type: 'settings' },
    })
  }

  for (const diagnostic of sources.userConfig.diagnostics) {
    diagnostics.push({
      kind: 'user-config',
      severity: 'error',
      message: diagnostic.message,
      subject: diagnostic.path,
      path: diagnostic.path,
      target: { type: 'settings' },
    })
  }

  for (const diagnostic of sources.projects.diagnostics) {
    diagnostics.push({
      kind: 'project-config',
      severity: 'error',
      message: diagnostic.message,
      subject: projectNames.get(diagnostic.projectId) ?? diagnostic.projectId,
      path: diagnostic.targetPath,
      line: diagnostic.line,
      column: diagnostic.column,
      target: { type: 'project', projectId: diagnostic.projectId },
    })
  }

  for (const plugin of sources.plugins) {
    if (!plugin.error)
      continue
    diagnostics.push({
      kind: 'marketplace-plugin',
      severity: 'error',
      message: plugin.error,
      subject: plugin.manifest.displayName || plugin.package,
      path: plugin.packagePath,
      target: { type: 'marketplace', package: plugin.package, sourceId: plugin.sourceId },
    })
  }

  for (const source of sources.marketplaceSources) {
    if (!source.error)
      continue
    diagnostics.push({
      kind: 'marketplace-source',
      severity: source.catalog ? 'warning' : 'error',
      message: source.error,
      subject: source.name,
      target: { type: 'marketplace', sourceId: source.id },
    })
  }

  for (const diagnostic of sources.integrations) {
    const plugin = sources.plugins.find(candidate => candidate.package === diagnostic.pluginId)
    diagnostics.push({
      kind: 'integration',
      severity: 'error',
      message: diagnostic.message,
      subject: diagnostic.pluginId,
      target: plugin
        ? { type: 'marketplace', package: plugin.package, sourceId: plugin.sourceId }
        : { type: 'marketplace', package: diagnostic.pluginId },
    })
  }

  for (const diagnostic of sources.hostPlugins) {
    diagnostics.push({
      kind: 'host-plugin',
      severity: 'error',
      message: diagnostic.message,
      subject: diagnostic.pluginId,
    })
  }

  const unique = [...new Map(diagnostics.map(diagnostic => [diagnosticKey(diagnostic), diagnostic])).values()]
    .sort((left, right) => severityOrder(left.severity) - severityOrder(right.severity)
      || left.kind.localeCompare(right.kind)
      || (left.subject ?? '').localeCompare(right.subject ?? '')
      || left.message.localeCompare(right.message))
    .map(diagnostic => ({ ...diagnostic, id: diagnosticKey(diagnostic) }))

  return {
    checkedAt,
    diagnostics: unique,
    summary: {
      errors: unique.filter(diagnostic => diagnostic.severity === 'error').length,
      warnings: unique.filter(diagnostic => diagnostic.severity === 'warning').length,
    },
  }
}

function diagnosticKey(diagnostic: Omit<WorkbenchDiagnostic, 'id'>): string {
  return [diagnostic.kind, diagnostic.subject, diagnostic.path, diagnostic.message]
    .map(value => encodeURIComponent(value ?? ''))
    .join(':')
}

function severityOrder(severity: WorkbenchDiagnostic['severity']): number {
  return severity === 'error' ? 0 : 1
}
