import type { OwnerScopeService } from './owner-scopes'
import type { TeamGitSyncConfigurationReceipt, TeamGitSyncService } from './team-git-sync'
import type { OwnerScope } from './types'
import type { OwnerScopeWorkspaceData, WorkspaceService } from './workspaces'

/** Input required to create one isolated, Git-backed Team. */
export interface CreateTeamInput {
  name: string
  repositoryPath: string
  directory?: string
}

/** Recoverable effects and retained shared data after deleting one Team. */
export interface TeamDeletionResult {
  team: OwnerScope
  deletedWorkspaceCount: number
  deletedGroupCount: number
  retainedSnapshotPath?: string
}

/** Raised when a Team lifecycle request does not satisfy a user-facing invariant. */
export class TeamLifecycleValidationError extends Error {}

/** Own the complete Team lifecycle behind one transactional interface. */
export class TeamManager {
  constructor(
    private readonly ownerScopes: OwnerScopeService,
    private readonly gitSync: TeamGitSyncService,
    private readonly workspaces: WorkspaceService,
  ) {}

  /** Create a Team only when its Git target and initial snapshot are ready. */
  async create(input: CreateTeamInput): Promise<OwnerScope> {
    const team = await this.ownerScopes.createTeam(input.name)
    try {
      await this.gitSync.configure(team.id, input)
      await this.gitSync.synchronize(team.id)
      return team
    }
    catch (error) {
      const cleanupErrors: unknown[] = []
      try {
        await this.gitSync.removeConfiguration(team.id)
      }
      catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      try {
        await this.ownerScopes.deleteTeam(team.id)
      }
      catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (cleanupErrors.length)
        throw new AggregateError([error, ...cleanupErrors], 'Failed to create Team and roll back its local state')
      throw error
    }
  }

  /** Rename a Team without changing its stable id or Git target. */
  async rename(ownerScopeId: string, name: string): Promise<OwnerScope> {
    return this.ownerScopes.renameTeam(ownerScopeId, name)
  }

  /** Delete local Team state after an exact-name confirmation, retaining its shared Git snapshot. */
  async delete(ownerScopeId: string, confirmationName: string): Promise<TeamDeletionResult> {
    const team = await this.ownerScopes.get(ownerScopeId)
    if (team.kind !== 'team')
      throw new TeamLifecycleValidationError('Personal owner scope cannot be deleted')
    if (confirmationName.trim() !== team.name)
      throw new TeamLifecycleValidationError(`Type the Team name exactly to delete it: ${team.name}`)

    let workspaceData: OwnerScopeWorkspaceData | undefined
    let gitReceipt: TeamGitSyncConfigurationReceipt | undefined
    try {
      workspaceData = await this.workspaces.deleteOwnerScopeData(ownerScopeId)
      gitReceipt = await this.gitSync.removeConfiguration(ownerScopeId)
      await this.ownerScopes.deleteTeam(ownerScopeId)
      return {
        team,
        deletedWorkspaceCount: workspaceData.snapshot.workspaces.length,
        deletedGroupCount: workspaceData.snapshot.groups.length,
        retainedSnapshotPath: gitReceipt.snapshotPath,
      }
    }
    catch (error) {
      const rollbackErrors: unknown[] = []
      if (gitReceipt) {
        try {
          await this.gitSync.restoreConfiguration(ownerScopeId, gitReceipt)
        }
        catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (workspaceData) {
        try {
          await this.workspaces.restoreOwnerScopeData(ownerScopeId, workspaceData)
        }
        catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      if (rollbackErrors.length)
        throw new AggregateError([error, ...rollbackErrors], 'Failed to delete Team and completely restore its local state')
      throw error
    }
  }
}
