import { z } from 'zod'

/** Bounded platform operation report supplied by a trusted local execution provider. */
export const operationSupportSchema = z.object({
  state: z.enum(['available', 'unsupported', 'unavailable']),
  cliVersion: z.string().trim().min(1).max(128).optional(),
  platform: z.string().trim().min(1).max(32).optional(),
  message: z.string().max(1024).optional(),
  operations: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,79}$/), z.object({ supported: z.boolean(), reason: z.string().max(1024).optional() }).strict())
    .refine(operations => Object.keys(operations).length <= 100, 'Too many operations'),
}).strict()

/** Missing reports preserve existing providers; present reports require explicit operation support. */
export type OperationSupport = z.infer<typeof operationSupportSchema>

/** Display-only configuration contract. Providers own file parsing, plans, backups and recovery. */
export interface ConfigurationManagementPage {
  configuration: true
  items: ConfigurationManagementItem[]
  registry?: ConfigurationRepositoryRegistry
  preview?: { planId: string, changes: { path: string, direction: string, before: string, after: string, deletion: boolean }[] }
  history?: { planId: string, state: string, createdAt?: string, paths?: string[], error?: string }[]
  repositories?: { id: string, root: string, branch?: string, revision?: string, ahead?: number | null, behind?: number | null, outgoing?: string[], outgoingChanges?: string[], outgoingDiff?: string, workingDiff?: string, dirty?: boolean, diverged?: boolean, error?: string, paths?: { path: string, status: string }[] }[]
  message?: string
  /** Read-only observations; absence means this provider does not support Skills audit. */
  skillsAudit?: ConfigurationSkillsAudit
  /** Provider-declared original management entries, independent of configuration writes. */
  managementTools?: ConfigurationManagementTool[]
  operationSupport?: OperationSupport
  /** Runtime-derived UI affordances, not authority to bypass provider checks. */
  presentation?: ConfigurationManagementPresentation
}

/** Shared UI rules for native and browser clients; the provider still validates every write. */
export interface ConfigurationManagementPresentation {
  version: 1
  writableItemIds: string[]
  backupSourceIds?: Record<'personal' | 'work', string[]>
}

/** Sources eligible for a backup audience; the provider rechecks scope when registering and executing. */
export function configurationBackupSources(registry: ConfigurationRepositoryRegistry, audience: string): ConfigurationRepositoryRegistry['sources'] {
  return ['personal', 'work'].includes(audience) ? registry.sources.filter(source => source.audience === 'public' || source.audience === audience) : []
}

/** Retain existing ownership boundaries when exposing configuration resolution controls. */
export function configurationItemWritable(item: ConfigurationManagementItem, providerId: string): boolean {
  return !!item.sourcePath && !['error', 'read-only', 'ownership-conflict'].includes(item.status)
    && item.owner === 'user'
    && !['installer', 'external', 'project'].includes(item.origin)
    && (!item.manager || item.manager === providerId)
}

/** Attach a fresh projection rather than trusting presentation metadata returned by a provider. */
export function presentConfigurationManagement(page: ConfigurationManagementPage, providerId: string): ConfigurationManagementPage {
  return { ...page, presentation: {
    version: 1,
    writableItemIds: page.items.filter(item => configurationItemWritable(item, providerId)).map(item => item.id),
    ...(page.registry ? { backupSourceIds: { personal: configurationBackupSources(page.registry, 'personal').map(source => source.id), work: configurationBackupSources(page.registry, 'work').map(source => source.id) } } : {}),
  } }
}

export interface ConfigurationManagementItem {
  id: string
  title: string
  kind: string
  owner: string
  origin: string
  localPath: string
  sourceId?: string
  audience?: 'public' | 'personal' | 'work' | 'unclassified'
  resource?: string
  competingSources?: string[]
  sourcePath?: string
  status: string
  revision: string
  local: string
  source: string
  fields: string[]
  management?: string
  /** Observed client destination, not confirmation that a running client loaded this item. */
  client?: string
  scope?: 'global' | 'project'
  /** Proven managing tool, or unknown/external when ownership cannot be established. */
  manager?: string
  provenance?: { label: string, path?: string }
}

/** Display-safe, bounded Skills audit returned by a local configuration provider. */
export interface ConfigurationSkillsAudit {
  state: 'available' | 'error' | 'unsupported'
  checkedAt?: string
  summary?: { skillFileCount: number, implicitSkillCount: number, explicitOnlySkillCount: number, warningCount: number, errorCount: number }
  findings: { code: string, severity: 'warning' | 'error', message: string, paths: string[] }[]
  message?: string
}

/** An original tool can be opened through a software catalog or its public documentation. */
export interface ConfigurationManagementTool {
  id: string
  title: string
  url: string
  software?: { sourceId: string, softwareId: string }
}

/** Device-local references; provider owns validation, identity, encryption and writes. */
export interface ConfigurationRepositoryRegistry {
  version: 1
  revision: string
  sources: { id: string, name: string, root: string, kind: 'dotfiles' | 'overlay', audience: 'public' | 'personal' | 'work' | 'unclassified', manifest?: string, enabled: boolean }[]
  targets: { id: string, name: string, root?: string, directory: string, audience: 'personal' | 'work', driver: 'workstation' | 'external', sourceIds: string[], keyEnvironment?: string }[]
  ownership: Record<string, string>
}
