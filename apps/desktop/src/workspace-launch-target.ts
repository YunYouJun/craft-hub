import type { CraftHubRuntime } from 'craft-hub'

export interface WorkspaceLaunchTarget {
  editorPath: string
  primaryProjectPath: string
  projectIds: string[]
}

type WorkspaceLaunchRuntime = Pick<CraftHubRuntime, 'ownerScopes' | 'projects' | 'workspaces'>

/** Resolve the local Projects used to launch one Workspace. */
export async function resolveWorkspaceLaunchTarget(
  runtime: WorkspaceLaunchRuntime,
  workspaceId: string,
  primaryProjectId?: string,
): Promise<WorkspaceLaunchTarget> {
  const { activeScopeId } = await runtime.ownerScopes.uiState()
  const workspace = await runtime.workspaces.get(workspaceId, activeScopeId)
  const resolvedMembers = workspace.members.filter(member => member.projectId)
  const primaryMember = primaryProjectId
    ? resolvedMembers.find(member => member.projectId === primaryProjectId)
    : resolvedMembers.find(member => member.project === workspace.primaryProject)
      ?? resolvedMembers[0]
  if (!primaryMember?.projectId)
    throw new Error(`Workspace has no resolved project: ${workspaceId}`)
  const primaryProjectPath = (await runtime.projects.get(primaryMember.projectId)).path
  return {
    editorPath: primaryProjectPath,
    primaryProjectPath,
    projectIds: resolvedMembers.map(member => member.projectId!),
  }
}
