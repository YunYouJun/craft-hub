import type { IntegrationDiagnostic } from './integrations'
import type { ManagedPlugin, MarketplaceSource } from './marketplace'
import type { PluginDiagnostic } from './plugins'
import type { SettingsSnapshot } from './settings'
import type { ProjectCatalogSnapshot } from './types'
import type { UserConfigStatus } from './user-config'
import { z } from 'zod'

export type WorkbenchDiagnosticKind
  = 'host-plugin'
    | 'host-provider'
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

/** One read-only check reported by a trusted host diagnostic provider. */
export interface HostDiagnosticCheck {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
  path?: string
  target?: WorkbenchDiagnosticTarget
}

/** Versioned diagnostic output; checks remain authoritative over optional counts. */
export interface HostDiagnosticReport {
  version: 1
  checkedAt: string
  checks: HostDiagnosticCheck[]
  summary?: { errors: number, warnings: number, passed: number }
  metadata?: { version?: string, platform?: string }
}

/** Trusted host seam for structured read-only checks; execution stays with its owner. */
export interface HostDiagnosticProvider {
  id: string
  title: string
  /** Never invoke this provider on a hosted API server. */
  localOnly?: boolean
  read: () => Promise<HostDiagnosticReport>
}

/** Availability and checked counts for one provider, including empty or failed reports. */
export interface HostDiagnosticProviderSnapshot {
  id: string
  title: string
  pluginId: string
  state: 'ready' | 'empty' | 'error' | 'skipped'
  checkedAt?: string
  summary?: { errors: number, warnings: number, passed: number }
  metadata?: { version?: string, platform?: string }
  message?: string
}

/** Validated checks and status used when collecting the shared diagnostic snapshot. */
export interface HostDiagnosticProviderResult {
  provider: HostDiagnosticProviderSnapshot
  checks: HostDiagnosticCheck[]
}

function boundedText(maximum: number): z.ZodString | z.ZodType<string> {
  return z.string().min(1).max(maximum).refine(value => !/\p{Cc}/u.test(value), 'Control characters are unavailable')
}
const targetIdentifier = boundedText(256)
const diagnosticTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('integration'), integrationId: targetIdentifier }),
  z.object({ type: z.literal('marketplace'), package: targetIdentifier.optional(), sourceId: targetIdentifier.optional() }),
  z.object({ type: z.literal('project'), projectId: targetIdentifier }),
  z.object({ type: z.literal('settings') }),
])
const countSchema = z.number().int().min(0).max(200)
const hostDiagnosticReportSchema = z.object({
  version: z.literal(1),
  checkedAt: z.string().max(64).datetime({ offset: true }),
  checks: z.array(z.object({
    code: boundedText(128),
    severity: z.enum(['info', 'warning', 'error']),
    message: boundedText(2000),
    path: boundedText(4096).optional(),
    target: diagnosticTargetSchema.optional(),
  })).max(200),
  summary: z.object({ errors: countSchema, warnings: countSchema, passed: countSchema }).optional(),
  metadata: z.object({ version: boundedText(128).optional(), platform: boundedText(128).optional() }).optional(),
})

/** Read independently bounded reports; failures never expose a provider exception. */
export async function readHostDiagnosticProviders(
  providers: ReadonlyArray<{ pluginId: string, provider: HostDiagnosticProvider }>,
  local: boolean,
): Promise<HostDiagnosticProviderResult[]> {
  return Promise.all(providers.map(async ({ pluginId, provider }) => {
    const identity = { id: `${pluginId}:${provider.id}`, title: provider.title, pluginId }
    if (provider.localOnly && !local)
      return { provider: { ...identity, state: 'skipped' as const }, checks: [] }
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const raw = await Promise.race([
        Promise.resolve().then(() => provider.read()),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Diagnostic provider timed out')), 15_000)
        }),
      ])
      if (raw && typeof raw === 'object' && Array.isArray(raw.checks) && raw.checks.length > 200)
        throw new Error('Too many diagnostic checks')
      const report = hostDiagnosticReportSchema.parse(raw)
      const summary = {
        errors: report.checks.filter(check => check.severity === 'error').length,
        warnings: report.checks.filter(check => check.severity === 'warning').length,
        passed: report.checks.filter(check => check.severity === 'info').length,
      }
      return {
        provider: { ...identity, state: report.checks.length ? 'ready' as const : 'empty' as const, checkedAt: report.checkedAt, summary, metadata: report.metadata },
        checks: report.checks,
      }
    }
    catch {
      return {
        provider: { ...identity, state: 'error' as const, message: 'Diagnostic provider could not complete. Refresh to retry.' },
        checks: [],
      }
    }
    finally {
      clearTimeout(timeout)
    }
  }))
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
  providerId?: string
  code?: string
}

/** Deterministic diagnostic collection returned to every Craft Hub client. */
export interface WorkbenchDiagnosticSnapshot {
  checkedAt: string
  diagnostics: WorkbenchDiagnostic[]
  summary: {
    errors: number
    warnings: number
  }
  /** Optional for compatibility with older API hosts. */
  providers?: HostDiagnosticProviderSnapshot[]
}

export interface WorkbenchDiagnosticSources {
  hostPlugins: readonly PluginDiagnostic[]
  integrations: readonly IntegrationDiagnostic[]
  marketplaceSources: readonly MarketplaceSource[]
  plugins: readonly ManagedPlugin[]
  projects: ProjectCatalogSnapshot
  settings: SettingsSnapshot
  userConfig: UserConfigStatus
  providers?: readonly HostDiagnosticProviderResult[]
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

  for (const { provider, checks } of sources.providers ?? []) {
    if (provider.state === 'error') {
      diagnostics.push({ kind: 'host-provider', severity: 'error', message: provider.message ?? 'Diagnostic provider could not complete. Refresh to retry.', subject: provider.title, providerId: provider.id })
    }
    for (const check of checks) {
      if (check.severity === 'info')
        continue
      diagnostics.push({ kind: 'host-provider', severity: check.severity, message: check.message, subject: provider.title, path: check.path, target: check.target, providerId: provider.id, code: check.code })
    }
  }

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
    providers: sources.providers?.map(result => result.provider) ?? [],
  }
}

function diagnosticKey(diagnostic: Omit<WorkbenchDiagnostic, 'id'>): string {
  const parts = [diagnostic.kind, diagnostic.subject, diagnostic.path, diagnostic.message]
  if (diagnostic.providerId)
    parts.push(diagnostic.providerId, diagnostic.code)
  return parts
    .map(value => encodeURIComponent(value ?? ''))
    .join(':')
}

function severityOrder(severity: WorkbenchDiagnostic['severity']): number {
  return severity === 'error' ? 0 : 1
}
