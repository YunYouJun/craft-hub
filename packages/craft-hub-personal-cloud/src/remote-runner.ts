import type { CommandInvocation, CraftHubRuntime } from 'craft-hub'
import type { PersonalCloudBackend, RemoteRequest, RemoteRequestStatus } from './types'
import { resolveCommandInvocation } from 'craft-hub'

/** Native-only review details. Never return command contents to the cloud service. */
export interface RemoteCommandReview {
  projectId: string
  projectPath: string
  capabilityId: string
  invocation: CommandInvocation
  script?: string
  expiresAt: string
}

export type RemoteApproval = (request: RemoteRequest, projectName: string, capabilityName: string, review: RemoteCommandReview, signal: AbortSignal) => Promise<boolean>

/** Validate a remote envelope locally and delegate execution to the existing Craft Hub runtime. */
export class RemoteRequestRunner {
  private readonly active = new Set<string>()
  private readonly finished = new Set<string>()

  constructor(
    private readonly runtime: CraftHubRuntime,
    private readonly backend: PersonalCloudBackend,
    private readonly approve: RemoteApproval,
    private readonly options: { signal?: AbortSignal, deviceId?: string } = {},
  ) {}

  async handle(input: RemoteRequest): Promise<void> {
    const request = structuredClone(input)
    if (this.active.has(request.requestId) || this.finished.has(request.requestId))
      return
    this.active.add(request.requestId)
    let runningAcknowledged = false

    try {
      if (request.status !== 'claimed' || !request.claimId)
        return
      const expiresAt = Date.parse(request.expiresAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now())
        return await this.reject(request, 'expired')
      if (this.options.signal?.aborted || (this.options.deviceId && request.targetDeviceId !== this.options.deviceId))
        return await this.reject(request, 'rejected')
      const projectId = await this.runtime.workspaces.resolveProjectKey(request.projectKey)
      if (!projectId)
        return await this.reject(request, 'rejected')
      const project = await this.runtime.projects.get(projectId)
      if (project.trust !== 'trusted')
        return await this.reject(request, 'rejected')
      const capability = (await this.runtime.capabilities(projectId)).find(item => item.id === request.capabilityId)
      if (!capability || capability.kind !== 'command')
        return await this.reject(request, 'rejected')
      const reviewedCapability = structuredClone(capability)
      const invocation = resolveCommandInvocation(reviewedCapability, {})

      await this.backend.updateRequest({ requestId: request.requestId, claimId: request.claimId, status: 'awaiting_approval' })
      // The backend extends an acknowledged approval lease to five minutes; never wait beyond request expiry.
      const approvalDeadline = Math.min(expiresAt, Date.now() + 5 * 60_000)
      const deadlineSignal = AbortSignal.timeout(Math.max(0, approvalDeadline - Date.now()))
      const signal = this.options.signal ? AbortSignal.any([deadlineSignal, this.options.signal]) : deadlineSignal
      const review: RemoteCommandReview = { projectId, projectPath: project.path, capabilityId: capability.id, invocation, script: capability.script, expiresAt: new Date(approvalDeadline).toISOString() }
      if (!await awaitApproval(() => this.approve(structuredClone(request), project.name, capability.name, structuredClone(review), signal), signal))
        return await this.reject(request, 'rejected')
      if (signal.aborted || approvalDeadline <= Date.now())
        return await this.reject(request, this.options.signal?.aborted ? 'rejected' : 'expired')
      if (await this.runtime.workspaces.resolveProjectKey(request.projectKey) !== projectId)
        return await this.reject(request, 'rejected')
      signal.throwIfAborted()

      await this.backend.updateRequest({ requestId: request.requestId, claimId: request.claimId, status: 'running' })
      runningAcknowledged = true
      // Retain this before entering the runtime: losing the final acknowledgement must never start it twice.
      this.finished.add(request.requestId)
      const run = await (await this.runtime.run(projectId, capability.id, undefined, {}, {
        projectPath: project.path,
        capability: reviewedCapability,
        expiresAt: approvalDeadline,
        signal,
      })).completion
      await this.backend.updateRequest({
        requestId: request.requestId,
        claimId: request.claimId,
        status: runStatus(run.status),
        exitCode: run.exitCode,
        finishedAt: run.finishedAt,
      })
    }
    catch {
      await this.reject(request, runningAcknowledged ? 'failed' : Date.parse(request.expiresAt) <= Date.now() ? 'expired' : 'rejected')
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

async function awaitApproval(approve: () => Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Remote approval cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([approve(), cancelled])
  }
  finally { signal.removeEventListener('abort', onAbort) }
}

function runStatus(status: 'completed' | 'cancelled' | 'failed' | 'running'): Extract<RemoteRequestStatus, 'succeeded' | 'cancelled' | 'failed'> {
  if (status === 'completed')
    return 'succeeded'
  if (status === 'cancelled')
    return 'cancelled'
  return 'failed'
}
