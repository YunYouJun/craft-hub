import type { ProjectRegistry } from './projects'
import type { CraftHubStore } from './store'
import type { AgentActionId, AgentActionResult, AgentTaskRecord } from './types'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { assertCommandWorkingDirectory } from './path-security'

/** Input accepted by a host-provided agent task adapter. */
export interface StartAgentTaskInput {
  prompt: string
  projectIds: string[]
  primaryProjectId: string
  /** Project-relative package selected as the task working directory. */
  primaryProjectRelativePath?: string
  capabilityId?: string
  actionId?: AgentActionId
  workspaceId?: string
  parentTaskId?: string
  /** Least filesystem access the host adapter should grant to this task. */
  sandboxMode?: 'read-only' | 'workspace-write'
}

/** Optional work to perform after an agent task completes. */
export interface StartAgentTaskOptions {
  onCompleted?: (result: AgentTaskProviderResult, task: AgentTaskRecord) => Promise<AgentActionResult>
  /** Host-owned idempotency identity. It is not accepted from ordinary task HTTP input. */
  taskId?: string
  /** Host-prepared Git worktree belonging to the trusted primary repository. */
  worktreePath?: string
  /** Resume a finished task through a provider that supports its original external thread. */
  resumeTaskId?: string
}

/** Fully resolved input passed to an agent task adapter. */
export interface AgentTaskProviderInput extends StartAgentTaskInput {
  resumeThreadId?: string
  taskId: string
  projectPaths: string[]
  primaryProjectPath: string
  primaryWorkingDirectory: string
  signal: AbortSignal
  onThread: (threadId: string) => Promise<void>
  /** Persist one human-readable progress chunk for the local task UI. */
  onOutput: (chunk: string) => Promise<void>
}

/** Result returned by an agent task adapter. */
export interface AgentTaskProviderResult {
  finalResponse: string
}

/** Vendor-neutral adapter seam for running an external agent task. */
export interface AgentTaskProvider {
  id: string
  supportsResume?: boolean
  run: (input: AgentTaskProviderInput) => Promise<AgentTaskProviderResult>
}

const unavailableAgentTaskProvider: AgentTaskProvider = {
  id: 'unavailable',
  run: async () => {
    throw new Error('This Craft Hub host does not provide an agent task adapter')
  },
}

const maxAgentTaskOutputBytes = 512 * 1024
const truncatedOutputMarker = Buffer.from('\n\n[Craft Hub truncated earlier agent output]\n\n')

function appendAgentTaskOutput(current: string, chunk: string): { output: string, truncated: boolean } {
  const combined = Buffer.concat([Buffer.from(current), Buffer.from(chunk)])
  if (combined.length <= maxAgentTaskOutputBytes)
    return { output: combined.toString('utf8'), truncated: false }
  const tailLength = maxAgentTaskOutputBytes - truncatedOutputMarker.length
  return {
    output: Buffer.concat([truncatedOutputMarker, combined.subarray(combined.length - tailLength)]).toString('utf8'),
    truncated: true,
  }
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

  /** Availability of the adapter owned by this host; it never implies a remote device connection. */
  availability(): { id: string, available: boolean } {
    return { id: this.provider.id, available: this.provider !== unavailableAgentTaskProvider }
  }

  /** Distinguish a live local provider from a persisted task after a host restart. */
  isActive(id: string): boolean {
    return this.active.has(id)
  }

  supportsFollowup(): boolean {
    return this.provider.supportsResume === true
  }

  async list(): Promise<AgentTaskRecord[]> {
    const tasks = await this.store.listAgentTasks()
    await Promise.all(tasks.map(async (task) => {
      if (task.status !== 'running' || this.active.has(task.id))
        return
      task.status = 'failed'
      task.error = 'Task was interrupted when Craft Hub stopped'
      task.finishedAt = new Date().toISOString()
      await this.store.saveAgentTask(task)
      this.emit(task)
    }))
    return tasks
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
    const resumed = options.resumeTaskId ? await this.store.getAgentTask(options.resumeTaskId) : undefined
    if (options.resumeTaskId && (!this.supportsFollowup() || !resumed?.externalThreadId || !resumed.executionDirectory || resumed.status === 'running' || this.active.has(resumed.id) || resumed.primaryProjectId !== primary.id || resumed.provider !== this.provider.id || resumed.error === 'Task was interrupted when Craft Hub stopped'))
      throw new Error('The original task cannot be safely resumed; inspect it in the original client')
    let executionRoot = primary.path
    if (options.worktreePath) {
      const prepared = await realpath(options.worktreePath)
      const { stdout } = await promisify(execFile)('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: primary.path, timeout: 15000, maxBuffer: 1024 * 1024 })
      if (!stdout.split('\0').includes(`worktree ${prepared}`))
        throw new Error('The execution directory is not a worktree of the trusted primary project')
      executionRoot = prepared
    }
    const primaryWorkingDirectory = resolve(executionRoot, input.primaryProjectRelativePath ?? '.')
    await assertCommandWorkingDirectory(executionRoot, primaryWorkingDirectory)
    if (resumed && (await realpath(primaryWorkingDirectory) !== await realpath(resumed.executionDirectory!) || JSON.stringify([...resumed.projectIds].sort()) !== JSON.stringify([...input.projectIds].sort())))
      throw new Error('A continuation must retain the original task workspace')
    if (!this.availability().available)
      throw new Error('This host has no agent executor. Open the desktop workbench or configure a host agent adapter.')
    if (options.taskId && !/^[a-f0-9]{64}$/.test(options.taskId))
      throw new Error('Invalid host task identity')
    const taskId = options.taskId ?? randomUUID()
    const existing = options.taskId ? await this.store.getAgentTask(taskId) : undefined
    if (existing) {
      if (existing.primaryProjectId !== input.primaryProjectId || existing.prompt !== input.prompt || JSON.stringify([...existing.projectIds].sort()) !== JSON.stringify([...input.projectIds].sort()) || existing.executionDirectory !== primaryWorkingDirectory)
        throw new Error('Task identity belongs to a different request')
      return existing
    }
    if (this.active.has(taskId))
      throw new Error('This task is already starting')
    const task: AgentTaskRecord = {
      id: taskId,
      provider: this.provider.id,
      capabilityId: input.capabilityId,
      actionId: input.actionId,
      workspaceId: input.workspaceId,
      projectIds: [...input.projectIds],
      primaryProjectId: input.primaryProjectId,
      primaryProjectRelativePath: input.primaryProjectRelativePath,
      executionDirectory: primaryWorkingDirectory,
      prompt: input.prompt,
      parentTaskId: input.parentTaskId,
      startedAt: new Date().toISOString(),
      status: 'running',
    }
    const controller = new AbortController()
    this.active.set(task.id, controller)
    try {
      await this.store.saveAgentTask(task)
    }
    catch (error) {
      this.active.delete(task.id)
      throw error
    }
    this.emit(task)
    void this.provider.run({
      ...input,
      resumeThreadId: resumed?.externalThreadId,
      taskId: task.id,
      projectPaths: projects.map(project => project.id === primary.id ? executionRoot : project.path),
      primaryProjectPath: executionRoot,
      primaryWorkingDirectory,
      signal: controller.signal,
      onThread: async (threadId) => {
        task.externalThreadId = threadId
        await this.store.saveAgentTask(task)
        this.emit(task)
      },
      onOutput: async (chunk) => {
        if (!chunk)
          return
        const appended = appendAgentTaskOutput(task.output ?? '', chunk)
        task.output = appended.output
        task.outputTruncated = task.outputTruncated || appended.truncated || undefined
        await this.store.saveAgentTask(task)
        this.emit(task)
      },
    }).then(async (result) => {
      if (options.onCompleted) {
        try {
          task.actionResult = await options.onCompleted(result, task)
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

  /** Read one persisted task without exposing the store to workflow modules. */
  async get(id: string): Promise<AgentTaskRecord | undefined> {
    return this.store.getAgentTask(id)
  }

  /** Persist and publish a workflow-owned action result update. */
  async setActionResult(id: string, result: AgentActionResult): Promise<AgentTaskRecord> {
    const task = await this.store.getAgentTask(id)
    if (!task)
      throw new Error(`Unknown agent task: ${id}`)
    task.actionResult = result
    await this.store.saveAgentTask(task)
    this.emit(task)
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
