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

/** Portable Git-backed identity used to resolve a Project on one machine. */
export interface ProjectReference {
  repository: string
  subdir?: string
}

/** Non-fatal problem found while refreshing one registered project. */
export interface ProjectCatalogDiagnostic {
  projectId: string
  source: 'project-config' | 'project'
  targetPath: string
  path: string
  line?: number
  column?: number
  message: string
}

/** Registered projects plus project-local problems that did not block the catalog. */
export interface ProjectCatalogSnapshot {
  projects: ProjectRecord[]
  diagnostics: ProjectCatalogDiagnostic[]
}

/** Runtime compatibility metadata reported to local clients. */
export interface RuntimeHealth {
  status: 'ok'
  projectConfigSchemaRevision: string
}

/** User-editable visual metadata for a project. */
export interface ProjectVisualInput {
  icon?: string
  color?: ProjectAccentColor
}

/** Stable identifier for the one local-first personal owner scope. */
export const PERSONAL_OWNER_SCOPE_ID = 'personal'

/** Supported ownership modes for portable workbench configuration. */
export type OwnerScopeKind = 'personal' | 'team'

/** Exclusive owner of workspaces and workspace groups. */
export interface OwnerScope {
  id: string
  kind: OwnerScopeKind
  name: string
}

/** Machine-local owner-scope navigation state. */
export interface OwnerScopeUiState {
  activeScopeId: string
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
  /** Omitted by legacy Personal manifests and normalized when read. */
  ownerScopeId?: string
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
  ownerScopeId?: string
  revision: string
  members: ResolvedWorkspaceMember[]
  groupId?: string
}

/** User-owned, non-nesting navigation group for workspaces and standalone projects. */
export interface WorkspaceGroup {
  id: string
  name: string
  icon?: string
  /** Omitted by legacy Personal groups and normalized when read. */
  ownerScopeId?: string
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

/** Kind of project-owned description metadata Craft Hub can propose. */
export type ProjectDescriptionTarget = 'command' | 'package'

/** Source location that supports one generated project description. */
export interface ProjectDescriptionEvidence {
  path: string
  startLine?: number
  endLine?: number
  kind: 'command-definition' | 'package-manifest' | 'project-instruction' | 'readme'
  summary?: string
}

/** One deterministic gap discovered before an agent is invoked. */
export interface ProjectDescriptionItem {
  id: string
  target: ProjectDescriptionTarget
  key: string
  name: string
  packageRelativePath: string
  currentDescription?: string
  evidence: ProjectDescriptionEvidence[]
}

/** Current description gaps and the revision of the inputs used to find them. */
export interface ProjectDescriptionAudit {
  analysisRevision: string
  configRevision: string
  items: ProjectDescriptionItem[]
  missingCommandCount: number
  missingPackageCount: number
}

/** Localized text proposed by an external agent without changing repository files. */
export interface ProjectDescriptionSuggestion {
  id: string
  target: ProjectDescriptionTarget
  key: string
  status: 'suggested' | 'skipped'
  description?: Record<string, string>
  evidence: ProjectDescriptionEvidence[]
  reason: string
}

/** Persisted, reviewable output of one project-description agent task. */
export interface ProjectDescriptionProposal {
  analysisRevision: string
  configRevision: string
  locale: 'en' | 'zh-CN'
  suggestions: ProjectDescriptionSuggestion[]
}

/** User-reviewed description value accepted for deterministic application. */
export interface ProjectDescriptionChange {
  id: string
  target: ProjectDescriptionTarget
  key: string
  description: Record<string, string>
}

/** Result of atomically applying reviewed project descriptions. */
export interface ProjectDescriptionApplication {
  appliedCount: number
  previousRevision: string
  revision: string
  targetPath: ProjectConfigPath
}

/** Non-fatal issue encountered while discovering project capabilities. */
export interface CapabilityDiscoveryDiagnostic {
  message: string
  path: string
  source: 'plugin' | 'pnpm-workspace' | 'project'
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

/** Discovery-time availability of a direct executable contributed by a plugin. */
export interface CommandAvailability {
  available: boolean
  diagnostic?: string
}

/** Conditional visibility or requiredness for one command input. */
export interface CommandInputCondition {
  input: string
  equals: string
}

/** One condition or a conjunction of conditions that must all match. */
export type CommandInputConditions = CommandInputCondition | CommandInputCondition[]

/** One allowed value for a select command input. */
export interface CommandInputOption {
  value: string
  label?: string
  /** Whether selecting this option intentionally omits the input's command-line argument. */
  omitArgument?: boolean
  /** Exact structured argv contributed by this option instead of flag/value formatting. */
  arguments?: string[]
}

/** Project-owned form input that is resolved into structured command arguments. */
export interface CommandInputDefinition {
  id: string
  type: 'boolean' | 'select' | 'text'
  label?: string
  description?: string
  options?: CommandInputOption[]
  default?: string
  required?: boolean
  requiredWhen?: CommandInputConditions
  visibleWhen?: CommandInputConditions
  pattern?: string
  flag: string
  argumentStyle?: 'equals' | 'separate'
  /** Treat the current value as a private identifier and omit it from persisted run history. */
  private?: boolean
  /** Redact the resolved argument in persisted run history. */
  redactInHistory?: boolean
}

/** Project-owned form input that is added to an agent skill request as structured context. */
export interface SkillInputDefinition {
  id: string
  type: 'select' | 'text'
  label?: string
  description?: string
  options?: CommandInputOption[]
  default?: string
  required?: boolean
  requiredWhen?: CommandInputConditions
  visibleWhen?: CommandInputConditions
  pattern?: string
}

/** User-provided values for a parameterized command capability. */
export type CommandInputValues = Record<string, string>

/** Built-in high-risk operation metadata understood by the Craft Hub host. */
export interface ReleaseOperation {
  kind: 'release'
  /** Require a clean Git worktree before execution. Defaults to true. */
  requiresCleanGit: boolean
  /** Optional branch required by the repository release policy. */
  requiredBranch?: string
  /** Repository-relative automation workflow that performs publication. */
  workflowPath?: string
  /** Command input containing a SemVer release type or exact version. */
  versionInput?: string
  /** Command input containing an exact version when versionInput is "custom". */
  customVersionInput?: string
  /** Command input containing the prerelease identifier. */
  prereleaseIdInput?: string
}

/** Fresh release preflight information used by both the UI and runtime guard. */
export interface ReleasePlan {
  capabilityId: string
  branch?: string
  clean: boolean
  currentVersion?: string
  proposedVersion?: string
  proposedTag?: string
  workflowPath?: string
  workflowExists?: boolean
  effects: string[]
  blockers: string[]
  warnings: string[]
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
  /** Built-in commands are categorized; third-party providers may omit this for compatibility. */
  category?: CommandCategory
  /** Built-in commands declare their package boundary; third-party providers may omit it. */
  package?: CommandPackage
  invocation: CommandInvocation
  inputs?: CommandInputDefinition[]
  /** Separator inserted before resolved inputs for package-manager script invocations. */
  inputArgSeparator?: '--'
  availability?: CommandAvailability
  operation?: ReleaseOperation
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
  inputs?: SkillInputDefinition[]
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
  /** Capability that originated this task, when launched from a capability detail. */
  capabilityId?: string
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
  /** Local, human-readable progress emitted by the task provider. */
  output?: string
  outputTruncated?: boolean
  finalResponse?: string
  error?: string
}

/** Identifier of a built-in agent workflow. */
export type AgentActionId = 'improve-project-config'

/** Post-run result recorded for a built-in agent workflow. */
export interface AgentActionResult {
  outcome: 'proposed' | 'updated' | 'unchanged' | 'needs-attention'
  updatedCommandCount?: number
  message?: string
  proposal?: ProjectDescriptionProposal
}

/** Current applicability and execution state of a built-in agent workflow. */
export interface AgentActionSummary {
  commandFingerprint: string
  analysisRevision?: string
  configRevision?: string
  id: AgentActionId
  missingCommandCount: number
  missingPackageCount?: number
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
