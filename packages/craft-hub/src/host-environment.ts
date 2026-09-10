/** Where the workbench API runs; this never implies access to a browser user's device. */
export type HostEnvironmentKind = 'local' | 'hosted'

/** UI affordances for the current host, independent of distribution names and repository providers. */
export interface HostEnvironment {
  kind: HostEnvironmentKind
  capabilities: {
    localProjectDirectories: boolean
    localGitSync: boolean
  }
}

/** Describe implemented local directory capabilities. Remote devices are separate execution targets. */
export function describeHostEnvironment(kind: HostEnvironmentKind = 'local'): HostEnvironment {
  if (kind !== 'local' && kind !== 'hosted')
    throw new Error('Unsupported host environment')
  return { kind, capabilities: { localProjectDirectories: kind === 'local', localGitSync: kind === 'local' } }
}

/** Guard directory-oriented mutation routes; this is not a general hosted API authorization policy. */
export function isLocalDirectoryMutation(method: string, pathname: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method))
    return false
  return (method === 'POST' && ['/api/projects', '/api/workspaces/register-member'].includes(pathname))
    || /^\/api\/personal-git-sync(?:\/synchronize)?$/.test(pathname)
    || /^\/api\/owner-scopes\/[^/]+\/git-sync(?:\/synchronize)?$/.test(pathname)
    || /^\/api\/dotfiles-manager(?:\/|$)/.test(pathname)
}
