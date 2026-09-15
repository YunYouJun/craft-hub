import type { CraftHubRuntime } from '../runtime'
import type { AgentTaskRecord } from '../types'
import type { DeliveryLocalExecutor, DeliveryLocalTask } from './receiver'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DeliveryError } from './types'

const exec = promisify(execFile)
export const deliveryLocalTaskId = (requestId: string): string => createHash('sha256').update(`delivery:${requestId}`).digest('hex')
const summary = (task: AgentTaskRecord): DeliveryLocalTask => ({ id: task.id, status: task.status, summary: task.status === 'completed' ? task.finalResponse : task.error })

/** Reuses the host's agent provider and project trust. Bindings are explicitly configured locally. */
export function createDeliveryLocalExecutor(runtime: CraftHubRuntime, bindings: Record<string, string>): DeliveryLocalExecutor {
  const inspect = (task: AgentTaskRecord): DeliveryLocalTask => task.status === 'running' && !runtime.agentTasks.isActive(task.id)
    ? { id: task.id, status: 'needs_attention', summary: 'The original provider is no longer attached; inspect the local task before retrying' }
    : summary(task)
  return {
    capabilities: { worktree: true, followup: runtime.agentTasks.supportsFollowup() },
    async start(request) {
      if (runtime.hostEnvironment.kind !== 'local')
        throw new DeliveryError(403, 'Execution requires a local host')
      const projectId = Object.hasOwn(bindings, request.projectId) ? bindings[request.projectId] : undefined
      if (!projectId)
        throw new DeliveryError(403, 'Project is not bound on this device')
      const project = await runtime.projects.get(projectId)
      if (project.trust !== 'trusted')
        throw new DeliveryError(403, 'Trust the registered project on this device first')
      const taskId = deliveryLocalTaskId(request.id)
      const previous = await runtime.agentTasks.get(taskId)
      if (previous)
        return inspect(previous)
      let worktreePath: string | undefined
      const parent = request.continuation && request.parentId ? await runtime.agentTasks.get(deliveryLocalTaskId(request.parentId)) : undefined
      if (request.continuation && (!parent?.executionDirectory || !parent.externalThreadId || parent.status === 'running'))
        throw new DeliveryError(409, 'Inspect the original task before continuing it')
      if (parent) {
        worktreePath = parent.executionDirectory
      }
      else if (request.mode === 'worktree') {
        const root = join(runtime.store.dataDir, 'delivery-worktrees')
        await mkdir(root, { recursive: true, mode: 0o700 })
        worktreePath = join(await realpath(root), taskId)
        // A deterministic branch and destination make an interrupted creation discoverable.
        const existing = await exec('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: project.path, timeout: 15000, maxBuffer: 1024 * 1024 })
        if (!existing.stdout.split('\0').includes(`worktree ${worktreePath}`))
          await exec('git', ['worktree', 'add', '-b', `codex/task-${taskId.slice(0, 16)}`, worktreePath, 'HEAD'], { cwd: project.path, timeout: 60000, maxBuffer: 1024 * 1024 })
      }
      const task = await runtime.agentTasks.start({ projectIds: [projectId], primaryProjectId: projectId, prompt: request.prompt, sandboxMode: 'workspace-write' }, { taskId, worktreePath, resumeTaskId: parent?.id })
      return summary(task)
    },
    async find(requestId) {
      const task = await runtime.agentTasks.get(deliveryLocalTaskId(requestId))
      return task ? inspect(task) : undefined
    },
    async get(taskId) {
      const task = await runtime.agentTasks.get(taskId)
      return task ? inspect(task) : undefined
    },
    async cancel(taskId) {
      await runtime.agentTasks.cancel(taskId)
    },
  }
}
