import type { ProjectRecord } from './types'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Relationship between the current source branch and the selected target branch. */
export type GitIntegrationRelation = 'already-merged' | 'diverged' | 'fast-forward' | 'same-branch' | 'unknown'

/** Relationship between a local target branch and its locally cached upstream ref. */
export type GitUpstreamState = 'ahead' | 'behind' | 'diverged' | 'missing' | 'up-to-date'

/** Stable reason that prevents a Git integration Plan from being applied. */
export type GitIntegrationBlockerCode
  = | 'detached-head'
    | 'dirty-worktree'
    | 'diverged'
    | 'git-operation-in-progress'
    | 'no-target-branch'
    | 'project-not-repository-root'
    | 'same-branch'
    | 'target-behind-upstream'
    | 'target-diverged-upstream'
    | 'target-in-other-worktree'
    | 'target-missing'

/** Stable advisory emitted by a Git integration Plan. */
export type GitIntegrationWarningCode = 'remote-not-refreshed' | 'target-ahead-upstream' | 'upstream-missing'

/** One structured blocker or warning with a fallback human-readable explanation. */
export interface GitIntegrationIssue<Code extends string = string> {
  code: Code
  message: string
}

/** One structured Git command that will be executed by an integration Plan. */
export interface GitIntegrationStep {
  kind: 'delete-source' | 'merge-source' | 'switch-target'
  command: 'git'
  args: string[]
}

/** User choices that affect Git integration planning and execution. */
export interface GitIntegrationRequest {
  /** Local target branch. Omit to use origin/HEAD, main, or master in that order. */
  targetBranch?: string
  /** Delete the source branch with `git branch -d` after a successful integration. */
  deleteSourceBranch?: boolean
}

/** Fresh, side-effect-free preview of integrating the current branch into a local target branch. */
export interface GitIntegrationPlan {
  projectId: string
  repositoryRoot: string
  sourceBranch?: string
  targetBranch?: string
  localBranches: string[]
  sourceRevision?: string
  targetRevision?: string
  targetUpstream?: string
  targetUpstreamState?: GitUpstreamState
  clean: boolean
  currentOperation?: string
  relation: GitIntegrationRelation
  deleteSourceBranch: boolean
  revision: string
  steps: GitIntegrationStep[]
  blockers: Array<GitIntegrationIssue<GitIntegrationBlockerCode>>
  warnings: Array<GitIntegrationIssue<GitIntegrationWarningCode>>
}

/** Apply request bound to the exact repository state shown in a previous Plan. */
export interface ApplyGitIntegrationRequest extends GitIntegrationRequest {
  expectedRevision: string
}

/** Result of a successfully applied local Git integration Plan. */
export interface GitIntegrationResult {
  projectId: string
  repositoryRoot: string
  sourceBranch: string
  targetBranch: string
  relation: Exclude<GitIntegrationRelation, 'diverged' | 'same-branch' | 'unknown'>
  deletedSourceBranch: boolean
  finalBranch: string
  finalRevision: string
  appliedRevision: string
  steps: GitIntegrationStep[]
}

/** Raised when repository state changed after a Git integration Plan was reviewed. */
export class GitIntegrationConflictError extends Error {
  constructor(readonly actualRevision: string) {
    super('Git repository state changed after the integration plan was reviewed')
    this.name = 'GitIntegrationConflictError'
  }
}

/** Raised when a Git integration request cannot be safely applied. */
export class GitIntegrationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitIntegrationValidationError'
  }
}

interface WorktreeEntry {
  path: string
  branch?: string
}

/** Plan and apply conservative local Git branch integrations for trusted projects. */
export class GitIntegration {
  /** Inspect current Git state without changing refs, the index, or working-tree files. */
  async plan(project: ProjectRecord, request: GitIntegrationRequest = {}): Promise<GitIntegrationPlan> {
    const repositoryRoot = await repositoryRootFor(project.path)
    const [registeredPath, rootPath] = await Promise.all([realpath(project.path), realpath(repositoryRoot)])
    const [sourceBranch, status, localBranches, currentOperation, worktrees] = await Promise.all([
      gitMaybe(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      git(repositoryRoot, ['status', '--porcelain=v1', '-z']),
      localBranchNames(repositoryRoot),
      activeGitOperation(repositoryRoot),
      git(repositoryRoot, ['worktree', 'list', '--porcelain']).then(parseWorktrees),
    ])
    const clean = status.length === 0
    const deleteSourceBranch = request.deleteSourceBranch !== false
    const defaultTarget = await defaultTargetBranch(repositoryRoot, localBranches)
    const targetBranch = request.targetBranch?.trim() || defaultTarget
    const blockers: Array<GitIntegrationIssue<GitIntegrationBlockerCode>> = []
    const warnings: Array<GitIntegrationIssue<GitIntegrationWarningCode>> = []

    if (registeredPath !== rootPath) {
      blockers.push(issue('project-not-repository-root', `Registered project must be the Git worktree root: ${repositoryRoot}`))
    }
    if (!sourceBranch)
      blockers.push(issue('detached-head', 'Git HEAD is detached; switch to a local source branch first.'))
    if (!clean)
      blockers.push(issue('dirty-worktree', 'Git worktree has uncommitted changes.'))
    if (currentOperation)
      blockers.push(issue('git-operation-in-progress', `Git operation is already in progress: ${currentOperation}`))
    if (!targetBranch)
      blockers.push(issue('no-target-branch', 'No local target branch could be inferred.'))
    else if (!localBranches.includes(targetBranch))
      blockers.push(issue('target-missing', `Local target branch does not exist: ${targetBranch}`))
    if (sourceBranch && targetBranch && sourceBranch === targetBranch)
      blockers.push(issue('same-branch', `Current branch is already the target branch: ${targetBranch}`))

    const targetWorktree = targetBranch
      ? await otherWorktreeForBranch(worktrees, targetBranch, repositoryRoot)
      : undefined
    if (targetWorktree) {
      blockers.push(issue('target-in-other-worktree', `Target branch is checked out in another worktree: ${targetWorktree}`))
    }

    const sourceRevision = sourceBranch
      ? await gitMaybe(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${sourceBranch}`])
      : undefined
    const targetRevision = targetBranch && localBranches.includes(targetBranch)
      ? await gitMaybe(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${targetBranch}`])
      : undefined
    const relation = sourceBranch && targetBranch && sourceRevision && targetRevision
      ? await branchRelation(repositoryRoot, sourceBranch, targetBranch)
      : 'unknown'

    if (relation === 'diverged')
      blockers.push(issue('diverged', 'Source and target branches have diverged; only fast-forward integration is supported.'))

    const upstream = targetBranch && targetRevision
      ? await targetUpstream(repositoryRoot, targetBranch, targetRevision)
      : {}
    if (upstream.name) {
      warnings.push(issue('remote-not-refreshed', 'Remote state uses local tracking refs; Craft Hub does not fetch or push.'))
      if (upstream.state === 'behind')
        blockers.push(issue('target-behind-upstream', `Target branch is behind ${upstream.name}; update it before integrating.`))
      else if (upstream.state === 'diverged')
        blockers.push(issue('target-diverged-upstream', `Target branch has diverged from ${upstream.name}.`))
      else if (upstream.state === 'ahead')
        warnings.push(issue('target-ahead-upstream', `Target branch is ahead of ${upstream.name}; this workflow will not push.`))
      else if (upstream.state === 'missing')
        warnings.push(issue('upstream-missing', `Locally configured upstream ref is unavailable: ${upstream.name}`))
    }

    const steps = blockers.length || !sourceBranch || !targetBranch
      ? []
      : integrationSteps(sourceBranch, targetBranch, relation, deleteSourceBranch)
    const revision = integrationRevision({
      clean,
      currentOperation,
      deleteSourceBranch,
      relation,
      repositoryRoot,
      sourceBranch,
      sourceRevision,
      status,
      targetBranch,
      targetRevision,
      targetUpstream: upstream.name,
      targetUpstreamState: upstream.state,
      worktrees,
    })

    return {
      projectId: project.id,
      repositoryRoot,
      sourceBranch,
      targetBranch,
      localBranches,
      sourceRevision,
      targetRevision,
      targetUpstream: upstream.name,
      targetUpstreamState: upstream.state,
      clean,
      currentOperation,
      relation,
      deleteSourceBranch,
      revision,
      steps,
      blockers,
      warnings,
    }
  }

  /** Recheck a reviewed Plan and apply its local Git steps to a trusted project. */
  async apply(project: ProjectRecord, request: ApplyGitIntegrationRequest): Promise<GitIntegrationResult> {
    if (project.trust !== 'trusted')
      throw new GitIntegrationValidationError(`Project is untrusted: ${project.name}`)
    if (!request.expectedRevision)
      throw new GitIntegrationValidationError('expectedRevision is required')

    const plan = await this.plan(project, request)
    if (plan.revision !== request.expectedRevision)
      throw new GitIntegrationConflictError(plan.revision)
    if (plan.blockers.length)
      throw new GitIntegrationValidationError(`Git integration is blocked: ${plan.blockers.map(blocker => blocker.message).join(' ')}`)
    if (!plan.sourceBranch || !plan.targetBranch || (plan.relation !== 'already-merged' && plan.relation !== 'fast-forward'))
      throw new GitIntegrationValidationError('Git integration Plan is incomplete')

    for (const step of plan.steps)
      await git(plan.repositoryRoot, step.args)

    const [finalBranch, finalRevision] = await Promise.all([
      git(plan.repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
      git(plan.repositoryRoot, ['rev-parse', '--verify', 'HEAD']),
    ])
    return {
      projectId: project.id,
      repositoryRoot: plan.repositoryRoot,
      sourceBranch: plan.sourceBranch,
      targetBranch: plan.targetBranch,
      relation: plan.relation,
      deletedSourceBranch: plan.deleteSourceBranch,
      finalBranch,
      finalRevision,
      appliedRevision: plan.revision,
      steps: plan.steps,
    }
  }
}

function issue<Code extends string>(code: Code, message: string): GitIntegrationIssue<Code> {
  return { code, message }
}

async function repositoryRootFor(path: string): Promise<string> {
  try {
    return await git(path, ['rev-parse', '--show-toplevel'])
  }
  catch {
    throw new GitIntegrationValidationError(`Not a Git repository: ${path}`)
  }
}

async function localBranchNames(cwd: string): Promise<string[]> {
  const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  return output.split('\n').map(value => value.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))
}

async function defaultTargetBranch(cwd: string, branches: string[]): Promise<string | undefined> {
  const remoteHead = await gitMaybe(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const remoteTarget = remoteHead?.startsWith('origin/') ? remoteHead.slice('origin/'.length) : undefined
  return [remoteTarget, 'main', 'master'].find((candidate): candidate is string => Boolean(candidate && branches.includes(candidate)))
}

async function branchRelation(cwd: string, source: string, target: string): Promise<GitIntegrationRelation> {
  if (source === target)
    return 'same-branch'
  if (await isAncestor(cwd, `refs/heads/${source}`, `refs/heads/${target}`))
    return 'already-merged'
  if (await isAncestor(cwd, `refs/heads/${target}`, `refs/heads/${source}`))
    return 'fast-forward'
  return 'diverged'
}

async function targetUpstream(cwd: string, target: string, targetRevision: string): Promise<{ name?: string, state?: GitUpstreamState }> {
  const name = await gitMaybe(cwd, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${target}`])
  if (!name)
    return {}
  const upstreamRevision = await gitMaybe(cwd, ['rev-parse', '--verify', name])
  if (!upstreamRevision)
    return { name, state: 'missing' }
  if (upstreamRevision === targetRevision)
    return { name, state: 'up-to-date' }
  if (await isAncestor(cwd, `refs/heads/${target}`, name))
    return { name, state: 'behind' }
  if (await isAncestor(cwd, name, `refs/heads/${target}`))
    return { name, state: 'ahead' }
  return { name, state: 'diverged' }
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, encoding: 'utf8' })
    return true
  }
  catch (error) {
    if (typeof (error as { code?: unknown }).code === 'number' && (error as { code: number }).code === 1)
      return false
    throw gitError(error)
  }
}

function integrationSteps(source: string, target: string, relation: GitIntegrationRelation, deleteSource: boolean): GitIntegrationStep[] {
  const steps: GitIntegrationStep[] = [
    { kind: 'switch-target', command: 'git', args: ['switch', '--', target] },
  ]
  if (relation === 'fast-forward')
    steps.push({ kind: 'merge-source', command: 'git', args: ['merge', '--ff-only', '--', source] })
  if (deleteSource)
    steps.push({ kind: 'delete-source', command: 'git', args: ['branch', '-d', '--', source] })
  return steps
}

async function activeGitOperation(cwd: string): Promise<string | undefined> {
  const markers = [
    ['merge', 'MERGE_HEAD'],
    ['rebase', 'rebase-merge'],
    ['rebase', 'rebase-apply'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['revert', 'REVERT_HEAD'],
    ['bisect', 'BISECT_LOG'],
  ] as const
  for (const [operation, marker] of markers) {
    const path = await git(cwd, ['rev-parse', '--git-path', marker])
    try {
      await access(isAbsolute(path) ? path : resolve(cwd, path))
      return operation
    }
    catch {}
  }
}

function parseWorktrees(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let entry: WorktreeEntry | undefined
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (entry)
        entries.push(entry)
      entry = { path: line.slice('worktree '.length) }
    }
    else if (entry && line.startsWith('branch refs/heads/')) {
      entry.branch = line.slice('branch refs/heads/'.length)
    }
  }
  if (entry)
    entries.push(entry)
  return entries
}

async function otherWorktreeForBranch(entries: WorktreeEntry[], branch: string, currentRoot: string): Promise<string | undefined> {
  const current = await canonicalPath(currentRoot)
  for (const entry of entries) {
    if (entry.branch === branch && await canonicalPath(entry.path) !== current)
      return entry.path
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  }
  catch {
    return resolve(path)
  }
}

function integrationRevision(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
    return stdout.trim()
  }
  catch (error) {
    throw gitError(error)
  }
}

async function gitMaybe(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args)
  }
  catch (error) {
    const code = (error as Error & { cause?: { code?: unknown } }).cause?.code
    if (typeof code === 'number' && code === 1)
      return undefined
    throw error
  }
}

function gitError(error: unknown): Error {
  const failure = error as Error & { code?: unknown, stderr?: unknown }
  const message = typeof failure.stderr === 'string' && failure.stderr.trim()
    ? failure.stderr.trim()
    : failure.message
  const wrapped = new Error(`Git command failed: ${message}`, { cause: error })
  return wrapped
}
