/** Local execution trust assigned to a registered project. */
export type TrustState = 'trusted' | 'untrusted'

/** Supported project accent colors. */
export const projectAccentColors = ['blue', 'cyan', 'green', 'orange', 'pink', 'purple', 'red', 'yellow'] as const
/** Project accent color name. */
export type ProjectAccentColor = typeof projectAccentColors[number]

/** Persisted local project registration. */
export interface ProjectRecord {
  id: string
  name: string
  path: string
  icon?: string
  iconWarning?: string
  color?: ProjectAccentColor
  trust: TrustState
  addedAt: string
}

/** User-editable visual metadata for a project. */
export interface ProjectVisualInput {
  icon?: string
  color?: ProjectAccentColor
}

/** Project configuration initialization operation. */
export type ProjectConfigInitializationMode = 'preview' | 'apply'

/** Supported repository-owned project configuration paths. */
export type ProjectConfigPath = '.craft-hub/project.jsonc'

/** Preview or result of initializing project-owned metadata. */
export interface ProjectConfigInitializationResult {
  projectId: string
  targetPath: ProjectConfigPath
  path: string
  content: string
  revision: string
  trust: TrustState
  exists: boolean
  mode: ProjectConfigInitializationMode
  outcome: 'preview' | 'created' | 'unchanged'
}

/** Portable member reference stored in a workspace manifest. */
export interface WorkspaceMember {
  project: string
  /** Optional display name scoped to this workspace. */
  label?: string
  pinned?: boolean
  discoveryHint?: string
}

/** Portable, user-owned workspace declaration. Machine paths never belong here. */
/** Portable, repository-independent workspace definition. */
export interface WorkspaceManifest {
  schemaVersion: 1
  id: string
  name: string
  icon?: string
  color?: ProjectAccentColor
  pinned?: boolean
  primaryProject?: string
  members: WorkspaceMember[]
}

/** Workspace member resolved against this machine's bindings. */
export interface ResolvedWorkspaceMember extends WorkspaceMember {
  projectId?: string
  resolved: boolean
  /** Machine-local path retained from an import until the project is registered. */
  path?: string
}

/** Workspace manifest augmented with local resolution metadata. */
export interface WorkspaceRecord extends WorkspaceManifest {
  revision: string
  members: ResolvedWorkspaceMember[]
  groupId?: string
}

/** User-owned, non-nesting navigation group for workspaces. */
export interface WorkspaceGroup {
  id: string
  name: string
  icon?: string
}

/** Portable workspace ordering and grouping catalog. */
export interface WorkspaceCatalog {
  schemaVersion: 1
  workspaceOrder: string[]
  groups: WorkspaceGroup[]
  workspaceGroups: Record<string, string>
}

/** Portable workspace state that intentionally excludes machine-local bindings and UI state. */
/** Allowlisted portable workspace snapshot. */
export interface PortableWorkspaceSnapshot {
  schemaVersion: 1
  workspaces: WorkspaceManifest[]
  workspaceOrder: string[]
  groups: WorkspaceGroup[]
  workspaceGroups: Record<string, string>
}

/** Machine-local workspace navigation state. */
/** Machine-local workspace UI state. */
export interface WorkspaceUiState {
  expandedWorkspaceIds: string[]
  selectedWorkspaceId?: string
  selectedProjectId?: string
}

/** Non-fatal problem found while importing an external workspace document. */
export interface WorkspaceImportDiagnostic {
  path: string
  message: string
}

/** One machine-local folder that would become an imported workspace member. */
export interface WorkspaceImportMemberPreview {
  name: string
  path: string
  projectId?: string
  status: 'registered' | 'available' | 'missing'
}

/** One external workspace document validated for a pending import. */
export interface WorkspaceImportWorkspacePreview {
  name: string
  path: string
  members: WorkspaceImportMemberPreview[]
}

/** Read-only validation result for an external workspace import. */
export interface WorkspaceImportPreview {
  format: 'vscode-workspace'
  sourceDirectory: string
  groupName: string
  workspaces: WorkspaceImportWorkspacePreview[]
  diagnostics: WorkspaceImportDiagnostic[]
  conflicts: string[]
  revision: string
  canImport: boolean
}

/** Post-write verification for a completed workspace import. */
export interface WorkspaceImportValidation {
  valid: boolean
  issues: string[]
  workspaceCount: number
  memberCount: number
  resolvedMemberCount: number
  unresolvedMemberCount: number
}

/** Result of a user-initiated, one-time external workspace import. */
export interface WorkspaceImportResult {
  format: 'vscode-workspace'
  sourceDirectory: string
  sourceRevision: string
  group: WorkspaceGroup
  workspaces: WorkspaceRecord[]
  diagnostics: WorkspaceImportDiagnostic[]
  validation: WorkspaceImportValidation
}

/** Human-readable source label for a capability. */
export type CapabilitySource = string

/** Stable category inferred from a command's script or target name. */
export type CommandCategory = 'build' | 'deploy' | 'develop' | 'other' | 'preview' | 'quality' | 'test'

/** Package boundary that declared one project command. */
export interface CommandPackage {
  /** Package name declared in package.json, when present. */
  name?: string
  /** Human-readable package summary declared in package.json, when present. */
  description?: string
  /** Project-relative package directory. The project root is represented by '.'. */
  relativePath: string
  root: boolean
}

/** Non-fatal issue encountered while discovering project capabilities. */
export interface CapabilityDiscoveryDiagnostic {
  message: string
  path: string
  source: 'pnpm-workspace' | 'project'
}

/** Capabilities and non-fatal diagnostics produced by one discovery pass. */
export interface CapabilityDiscoveryResult {
  capabilities: Capability[]
  diagnostics: CapabilityDiscoveryDiagnostic[]
  /** Package boundaries found in a workspace, including packages without commands. */
  packages?: CommandPackage[]
}

/** Structured command invocation discovered from a project. */
export interface CommandInvocation {
  command: string
  args: string[]
  cwd: string
  requiredEnv: string[]
}

/** Conditional visibility or requiredness for one command input. */
export interface CommandInputCondition {
  input: string
  equals: string
}

/** One allowed value for a select command input. */
export interface CommandInputOption {
  value: string
  label?: string
}

/** Project-owned form input that is resolved into structured command arguments. */
export interface CommandInputDefinition {
  id: string
  type: 'select' | 'text'
  label?: string
  description?: string
  options?: CommandInputOption[]
  default?: string
  required?: boolean
  requiredWhen?: CommandInputCondition
  visibleWhen?: CommandInputCondition
  pattern?: string
  flag: string
  argumentStyle?: 'equals' | 'separate'
}

/** User-provided values for a parameterized command capability. */
export type CommandInputValues = Record<string, string>

/** Executable command capability. */
export interface CommandCapability {
  id: string
  kind: 'command'
  name: string
  description?: string
  source: CapabilitySource
  /** Absolute path to the file that declared this command, when known. */
  sourcePath?: string
  /** One-based line where this command is declared, when known. */
  sourceLine?: number
  /** Built-in commands are categorized; third-party providers may omit this for compatibility. */
  category?: CommandCategory
  /** Built-in commands declare their package boundary; third-party providers may omit it. */
  package?: CommandPackage
  invocation: CommandInvocation
  inputs?: CommandInputDefinition[]
  /** Separator inserted before resolved inputs for package-manager script invocations. */
  inputArgSeparator?: '--'
}

/** Agent-readable skill capability. */
export interface SkillCapability {
  id: string
  kind: 'skill'
  name: string
  description?: string
  source: CapabilitySource
  path: string
  contentHash: string
  content: string
}

/** Capability discovered for a project. */
export type Capability = CommandCapability | SkillCapability

/** Stable semantic reference used by machine-local capability pins. */
export interface CapabilityReference {
  id: string
  kind: Capability['kind']
  name: string
  source: CapabilitySource
  /** Project-relative command package path used to disambiguate monorepo scripts. */
  packageRelativePath?: string
}

/** Ordered capability pins for one project. */
export interface CapabilityPins {
  projectId: string
  capabilityIds: string[]
}

/** Persisted structured-command execution record. */
export interface RunRecord {
  id: string
  projectId: string
  capabilityId: string
  capabilitySource?: CapabilitySource
  command: string
  args: string[]
  cwd: string
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stdout: string
  stderr: string
  pinned?: boolean
  truncated?: boolean
  status: 'running' | 'completed' | 'cancelled' | 'failed'
}

/** Preview of runs selected by a cleanup policy. */
export interface RunCleanupPreview {
  count: number
  bytes: number
}

/** Result returned after persisted run cleanup. */
export interface RunCleanupResult extends RunCleanupPreview {
  deletedIds: string[]
}

/** Retention filters for persisted run cleanup. */
export interface RunCleanupOptions {
  projectIds?: string[]
  includeAllUnpinned?: boolean
  olderThan?: string
  maxBytes?: number
  preview?: boolean
}

/** Persisted external agent task record. */
export interface AgentTaskRecord {
  id: string
  provider: string
  actionId?: AgentActionId
  actionResult?: AgentActionResult
  workspaceId?: string
  projectIds: string[]
  primaryProjectId: string
  prompt: string
  externalThreadId?: string
  parentTaskId?: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'completed' | 'cancelled' | 'failed'
  finalResponse?: string
  error?: string
}

/** Identifier of a built-in agent workflow. */
export type AgentActionId = 'improve-project-config'

/** Post-run result recorded for a built-in agent workflow. */
export interface AgentActionResult {
  outcome: 'updated' | 'unchanged' | 'needs-attention'
  updatedCommandCount?: number
  message?: string
}

/** Current applicability and execution state of a built-in agent workflow. */
export interface AgentActionSummary {
  commandFingerprint: string
  id: AgentActionId
  missingCommandCount: number
  runningTaskId?: string
  targetPath: ProjectConfigPath
}

/** Aggregate command execution state for one project. */
/** Aggregate active and most recent run state for one project. */
export interface ProjectRunSummary {
  projectId: string
  running: number
  lastStatus?: Exclude<RunRecord['status'], 'running'>
  lastFinishedAt?: string
}

/** One live output chunk emitted by a running command. */
export interface RunOutputEvent {
  stream: 'stdout' | 'stderr'
  chunk: string
}

/** Server-sent event emitted for run lifecycle or output changes. */
export type RunStreamEvent
  = | { type: 'start', run: RunRecord }
    | { type: 'output', stream: RunOutputEvent['stream'], chunk: string }
    | { type: 'complete', run: RunRecord }
