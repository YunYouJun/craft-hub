import type { AgentTaskManager } from 'craft-hub'

type AgentTaskThreadSource = Pick<AgentTaskManager, 'get' | 'onChanged'>

/** Wait until a persisted agent task is attached to its external Codex thread. */
export function waitForAgentTaskThread(
  agentTasks: AgentTaskThreadSource,
  taskId: string,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let stop = (): void => {}
    const finish = (callback: () => void): void => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      stop()
      callback()
    }
    const inspect = (task: Awaited<ReturnType<AgentTaskThreadSource['get']>>): void => {
      if (!task || task.id !== taskId)
        return
      if (task.externalThreadId) {
        finish(() => resolve(task.externalThreadId!))
        return
      }
      if (task.status !== 'running')
        finish(() => reject(new Error(task.error ?? `Codex task ended before creating a thread: ${taskId}`)))
    }
    stop = agentTasks.onChanged(inspect)
    timer = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for Codex thread: ${taskId}`)))
    }, timeoutMs)
    void agentTasks.get(taskId).then(inspect, error => finish(() => reject(error)))
  })
}

/** Open a persisted Codex thread only after its provider has released the running task. */
export async function openCodexThreadAfterTaskRelease(
  agentTasks: AgentTaskThreadSource,
  taskId: string,
  openThread: (threadId: string) => Promise<void>,
): Promise<void> {
  const threadId = await new Promise<string>((resolve, reject) => {
    let settled = false
    let stop = (): void => {}
    const finish = (callback: () => void): void => {
      if (settled)
        return
      settled = true
      stop()
      callback()
    }
    const inspect = (task: Awaited<ReturnType<AgentTaskThreadSource['get']>>): void => {
      if (!task || task.id !== taskId || task.status === 'running')
        return
      if (task.externalThreadId) {
        finish(() => resolve(task.externalThreadId!))
        return
      }
      finish(() => reject(new Error(task.error ?? `Codex task ended without creating a thread: ${taskId}`)))
    }
    stop = agentTasks.onChanged(inspect)
    void agentTasks.get(taskId).then(inspect, error => finish(() => reject(error)))
  })
  await openThread(threadId)
}
