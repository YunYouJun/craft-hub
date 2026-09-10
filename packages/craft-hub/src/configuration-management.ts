/** Display-only configuration contract. Providers own file parsing, plans, backups and recovery. */
export interface ConfigurationManagementPage {
  configuration: true
  items: ConfigurationManagementItem[]
  preview?: { planId: string, changes: { path: string, direction: string, before: string, after: string, deletion: boolean }[] }
  history?: { planId: string, state: string, createdAt?: string, paths?: string[], error?: string }[]
  repositories?: { id: string, root: string, branch?: string, revision?: string, ahead?: number | null, behind?: number | null, outgoing?: string[], outgoingChanges?: string[], outgoingDiff?: string, workingDiff?: string, dirty?: boolean, diverged?: boolean, error?: string, paths?: { path: string, status: string }[] }[]
  message?: string
}

export interface ConfigurationManagementItem {
  id: string
  title: string
  kind: string
  owner: string
  origin: string
  localPath: string
  sourcePath?: string
  status: string
  revision: string
  local: string
  source: string
  fields: string[]
  management?: string
}
