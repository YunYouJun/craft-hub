import type { CommandCapability, ProjectRecord, ReleasePlan } from './types'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Computes a fresh, side-effect-free release preflight for a release capability. */
export class ReleasePlanner {
  async plan(project: ProjectRecord, capability: CommandCapability): Promise<ReleasePlan> {
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

    if (capability.operation.requiresCleanGit && !clean)
      blockers.push('Git worktree has uncommitted changes.')
    if (capability.operation.requiredBranch && branch !== capability.operation.requiredBranch)
      blockers.push(`Release must run from branch ${capability.operation.requiredBranch}; current branch is ${branch || 'detached HEAD'}.`)
    if (workflowPath && !workflowExists)
      blockers.push(`Release workflow does not exist: ${workflowPath}`)
    if (!workflowPath)
      warnings.push('No publication workflow is associated with this release command.')

    return {
      capabilityId: capability.id,
      branch: branch || undefined,
      clean,
      currentVersion,
      proposedTag: currentVersion ? `v${currentVersion}` : undefined,
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
