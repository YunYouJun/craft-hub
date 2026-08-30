import type { CommandCapability, CommandInputValues, ProjectRecord, ReleasePlan } from './types'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { inc, valid } from 'semver'

const execFileAsync = promisify(execFile)

/** Computes a fresh, side-effect-free release preflight for a release capability. */
export class ReleasePlanner {
  async plan(project: ProjectRecord, capability: CommandCapability, providedInputs: CommandInputValues = {}): Promise<ReleasePlan> {
    if (capability.operation?.kind !== 'release')
      throw new Error(`Command is not a release operation: ${capability.name}`)

    const cwd = capability.invocation.cwd
    const [branch, status, currentVersion] = await Promise.all([
      git(cwd, ['branch', '--show-current']),
      git(cwd, ['status', '--porcelain']),
      packageVersion(cwd),
    ])
    const clean = status.length === 0
    const workflowPath = capability.operation.workflowPath
    const workflowExists = workflowPath ? await exists(resolve(project.path, workflowPath)) : undefined
    const blockers: string[] = []
    const warnings: string[] = []
    const values = effectiveInputValues(capability, providedInputs)
    const versionInput = capability.operation.versionInput
    const requestedRelease = versionInput ? values[versionInput] : undefined
    const requestedVersion = requestedRelease === 'custom'
      ? values[capability.operation.customVersionInput ?? '']
      : requestedRelease
    const prereleaseId = capability.operation.prereleaseIdInput ? values[capability.operation.prereleaseIdInput] : undefined
    const proposedVersion = nextVersion(currentVersion, requestedVersion, prereleaseId)

    if (capability.operation.requiresCleanGit && !clean)
      blockers.push('Git worktree has uncommitted changes.')
    if (capability.operation.requiredBranch && branch !== capability.operation.requiredBranch)
      blockers.push(`Release must run from branch ${capability.operation.requiredBranch}; current branch is ${branch || 'detached HEAD'}.`)
    if (workflowPath && !workflowExists)
      blockers.push(`Release workflow does not exist: ${workflowPath}`)
    if (!workflowPath)
      warnings.push('No publication workflow is associated with this release command.')
    if (requestedVersion && !proposedVersion)
      blockers.push(`Invalid SemVer release: ${requestedVersion}`)

    return {
      capabilityId: capability.id,
      branch: branch || undefined,
      clean,
      currentVersion,
      proposedVersion,
      proposedTag: proposedVersion ? `v${proposedVersion}` : undefined,
      workflowPath,
      workflowExists,
      effects: [
        'Update workspace package versions.',
        'Create a release commit and Git tag.',
        ...(workflowPath ? [`Push the tag so ${workflowPath} can publish the packages.`] : []),
      ],
      blockers,
      warnings,
    }
  }
}

function effectiveInputValues(capability: CommandCapability, provided: CommandInputValues): CommandInputValues {
  return Object.fromEntries((capability.inputs ?? []).map(input => [input.id, provided[input.id] ?? input.default ?? '']))
}

function nextVersion(currentVersion: string | undefined, release: string | undefined, prereleaseId: string | undefined): string | undefined {
  if (!currentVersion)
    return undefined
  if (!release)
    return currentVersion
  if (release === 'prerelease')
    return inc(currentVersion, release, prereleaseId ?? 'alpha') ?? undefined
  if (release === 'major' || release === 'minor' || release === 'patch')
    return inc(currentVersion, release) ?? undefined
  return valid(release) ?? undefined
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' })
    return stdout.trim()
  }
  catch (error) {
    throw new Error(`Release preflight could not inspect Git: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function packageVersion(cwd: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  }
  catch {
    return undefined
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}
