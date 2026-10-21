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
