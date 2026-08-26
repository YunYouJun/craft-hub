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

/** Preview or result of initializing project-owned metadata. */
export interface ProjectConfigInitializationResult {
  projectId: string
  targetPath: '.craft-hub/project.yaml'
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
}

/** Workspace manifest augmented with local resolution metadata. */
export interface WorkspaceRecord extends WorkspaceManifest {
  revision: string
  members: ResolvedWorkspaceMember[]
}

/** Portable workspace ordering catalog. */
export interface WorkspaceCatalog {
  schemaVersion: 1
  workspaceOrder: string[]
}

/** Portable workspace state that intentionally excludes machine-local bindings and UI state. */
/** Allowlisted portable workspace snapshot. */
export interface PortableWorkspaceSnapshot {
  schemaVersion: 1
  workspaces: WorkspaceManifest[]
  workspaceOrder: string[]
}

/** Machine-local workspace navigation state. */
/** Machine-local workspace UI state. */
export interface WorkspaceUiState {
  expandedWorkspaceIds: string[]
  selectedWorkspaceId?: string
  selectedProjectId?: string
}

/** Human-readable source label for a capability. */
export type CapabilitySource = string

/** Structured command invocation discovered from a project. */
export interface CommandInvocation {
  command: string
  args: string[]
  cwd: string
  requiredEnv: string[]
}

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
  invocation: CommandInvocation
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
  targetPath: '.craft-hub/project.yaml'
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
