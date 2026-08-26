import type { ProjectRegistry } from './projects'
import type { CraftHubStore } from './store'
import type { AgentActionId, AgentActionResult, AgentTaskRecord } from './types'
import { randomUUID } from 'node:crypto'

/** Input accepted by a host-provided agent task adapter. */
export interface StartAgentTaskInput {
  prompt: string
  projectIds: string[]
  primaryProjectId: string
  actionId?: AgentActionId
  workspaceId?: string
  parentTaskId?: string
}

/** Optional work to perform after an agent task completes. */
export interface StartAgentTaskOptions {
  onCompleted?: () => Promise<AgentActionResult>
}

/** Fully resolved input passed to an agent task adapter. */
export interface AgentTaskProviderInput extends StartAgentTaskInput {
  taskId: string
  projectPaths: string[]
  primaryProjectPath: string
  signal: AbortSignal
  onThread: (threadId: string) => Promise<void>
}

/** Result returned by an agent task adapter. */
export interface AgentTaskProviderResult {
  finalResponse: string
}

/** Vendor-neutral adapter seam for running an external agent task. */
export interface AgentTaskProvider {
  id: string
  run: (input: AgentTaskProviderInput) => Promise<AgentTaskProviderResult>
}

const unavailableAgentTaskProvider: AgentTaskProvider = {
  id: 'unavailable',
  run: async () => {
    throw new Error('This Craft Hub host does not provide an agent task adapter')
  },
}

/** Coordinate trusted, local, project-scoped agent tasks through a provider adapter. */
/** Coordinate persisted, cancellable agent tasks through a host adapter. */
export class AgentTaskManager {
  private readonly active = new Map<string, AbortController>()
  private readonly listeners = new Set<(task: AgentTaskRecord) => void>()

  constructor(
    private readonly store: CraftHubStore,
    private readonly projects: ProjectRegistry,
    private readonly provider: AgentTaskProvider = unavailableAgentTaskProvider,
  ) {}

  async list(): Promise<AgentTaskRecord[]> {
    return this.store.listAgentTasks()
  }

  async start(input: StartAgentTaskInput, options: StartAgentTaskOptions = {}): Promise<AgentTaskRecord> {
    if (!input.prompt.trim())
      throw new Error('Agent task prompt is required')
    if (!input.projectIds.length || new Set(input.projectIds).size !== input.projectIds.length)
      throw new Error('Agent task projects must be a non-empty unique list')
    if (!input.projectIds.includes(input.primaryProjectId))
      throw new Error('Primary project must be included in the task')
    const projects = await Promise.all(input.projectIds.map(id => this.projects.get(id)))
    const untrusted = projects.filter(project => project.trust !== 'trusted')
    if (untrusted.length)
      throw new Error(`Trust every selected project before starting ${this.provider.id}: ${untrusted.map(project => project.name).join(', ')}`)
    const primary = projects.find(project => project.id === input.primaryProjectId)!
    const task: AgentTaskRecord = {
      id: randomUUID(),
      provider: this.provider.id,
      actionId: input.actionId,
      workspaceId: input.workspaceId,
      projectIds: [...input.projectIds],
      primaryProjectId: input.primaryProjectId,
      prompt: input.prompt,
      parentTaskId: input.parentTaskId,
      startedAt: new Date().toISOString(),
      status: 'running',
    }
    await this.store.saveAgentTask(task)
    this.emit(task)
    const controller = new AbortController()
    this.active.set(task.id, controller)
    void this.provider.run({
      ...input,
      taskId: task.id,
      projectPaths: projects.map(project => project.path),
      primaryProjectPath: primary.path,
      signal: controller.signal,
      onThread: async (threadId) => {
        task.externalThreadId = threadId
        await this.store.saveAgentTask(task)
        this.emit(task)
      },
    }).then(async (result) => {
      if (options.onCompleted) {
        try {
          task.actionResult = await options.onCompleted()
        }
        catch (error) {
          task.actionResult = {
            outcome: 'needs-attention',
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
      task.status = 'completed'
      task.finalResponse = result.finalResponse
      task.finishedAt = new Date().toISOString()
      await this.store.saveAgentTask(task)
      this.emit(task)
    }).catch(async (error) => {
      task.status = controller.signal.aborted ? 'cancelled' : 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.finishedAt = new Date().toISOString()
      await this.store.saveAgentTask(task)
      this.emit(task)
    }).finally(() => this.active.delete(task.id))
    return task
  }

  async cancel(id: string): Promise<AgentTaskRecord> {
    const controller = this.active.get(id)
    if (!controller)
      throw new Error(`Unknown active agent task: ${id}`)
    controller.abort()
    const task = await this.store.getAgentTask(id)
    if (!task)
      throw new Error(`Unknown agent task: ${id}`)
    return task
  }

  async cancelAll(): Promise<void> {
    for (const controller of this.active.values())
      controller.abort()
  }

  onChanged(listener: (task: AgentTaskRecord) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(task: AgentTaskRecord): void {
    for (const listener of this.listeners)
      listener({ ...task })
  }
}
