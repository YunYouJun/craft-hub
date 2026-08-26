import type { CraftHubRuntime } from 'craft-hub'
import type { PersonalCloudBackend, RemoteRequest, RemoteRequestStatus } from './types'

export type RemoteApproval = (request: RemoteRequest, projectName: string, capabilityName: string) => Promise<boolean>

/** Validate a remote envelope locally and delegate execution to the existing Craft Hub runtime. */
export class RemoteRequestRunner {
  private readonly active = new Set<string>()
  private readonly finished = new Set<string>()

  constructor(
    private readonly runtime: CraftHubRuntime,
    private readonly backend: PersonalCloudBackend,
    private readonly approve: RemoteApproval,
  ) {}

  async handle(request: RemoteRequest): Promise<void> {
    if (this.active.has(request.requestId) || this.finished.has(request.requestId))
      return
    this.active.add(request.requestId)

    try {
      if (request.status !== 'claimed' || !request.claimId)
        return
      if (new Date(request.expiresAt).getTime() <= Date.now())
        return await this.reject(request, 'expired')
      const projectId = await this.runtime.workspaces.resolveProjectKey(request.projectKey)
      if (!projectId)
        return await this.reject(request, 'rejected')
      const project = await this.runtime.projects.get(projectId)
      if (project.trust !== 'trusted')
        return await this.reject(request, 'rejected')
      const capability = (await this.runtime.capabilities(projectId)).find(item => item.id === request.capabilityId)
      if (!capability || capability.kind !== 'command')
        return await this.reject(request, 'rejected')

      await this.backend.updateRequest({ requestId: request.requestId, claimId: request.claimId, status: 'awaiting_approval' })
      if (!await this.approve(request, project.name, capability.name))
        return await this.reject(request, 'rejected')

      await this.backend.updateRequest({ requestId: request.requestId, claimId: request.claimId, status: 'running' })
      const run = await (await this.runtime.run(projectId, capability.id)).completion
      await this.backend.updateRequest({
        requestId: request.requestId,
        claimId: request.claimId,
        status: runStatus(run.status),
        exitCode: run.exitCode,
        finishedAt: run.finishedAt,
      })
      this.finished.add(request.requestId)
    }
    catch {
      await this.reject(request, 'failed')
    }
    finally {
      this.active.delete(request.requestId)
    }
  }

  private async reject(request: RemoteRequest, status: Extract<RemoteRequestStatus, 'failed' | 'rejected' | 'expired'>): Promise<void> {
    if (!request.claimId)
      return
    await this.backend.updateRequest({ requestId: request.requestId, claimId: request.claimId, status, finishedAt: new Date().toISOString() })
    this.finished.add(request.requestId)
  }
}

function runStatus(status: 'completed' | 'cancelled' | 'failed' | 'running'): Extract<RemoteRequestStatus, 'succeeded' | 'cancelled' | 'failed'> {
  if (status === 'completed')
    return 'succeeded'
  if (status === 'cancelled')
    return 'cancelled'
  return 'failed'
}
