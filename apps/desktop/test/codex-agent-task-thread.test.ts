import type { AgentTaskRecord } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { openCodexThreadAfterTaskRelease, waitForAgentTaskThread } from '../src/codex-agent-task-thread.ts'

const runningTask: AgentTaskRecord = {
  id: 'task-id',
  provider: 'codex',
  projectIds: ['project-id'],
  primaryProjectId: 'project-id',
  prompt: 'Test',
  startedAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
}

describe('codex agent task thread', () => {
  it('resolves an already persisted external thread id', async () => {
    const stop = vi.fn()
    const source = {
      get: vi.fn(async () => ({ ...runningTask, externalThreadId: 'thread-id' })),
      onChanged: vi.fn(() => stop),
    }

    await expect(waitForAgentTaskThread(source, runningTask.id)).resolves.toBe('thread-id')
    expect(stop).toHaveBeenCalled()
  })

  it('resolves a later thread attachment event', async () => {
    let listener: (task: AgentTaskRecord) => void = () => {}
    const source = {
      get: vi.fn(async () => runningTask),
      onChanged: vi.fn((value: (task: AgentTaskRecord) => void) => {
        listener = value
        return () => {}
      }),
    }
    const waiting = waitForAgentTaskThread(source, runningTask.id)
    listener({ ...runningTask, externalThreadId: 'thread-id' })

    await expect(waiting).resolves.toBe('thread-id')
  })

  it('rejects when the task fails before creating a thread', async () => {
    const source = {
      get: vi.fn(async () => ({ ...runningTask, status: 'failed' as const, error: 'Codex failed' })),
      onChanged: vi.fn(() => () => {}),
    }

    await expect(waitForAgentTaskThread(source, runningTask.id)).rejects.toThrow('Codex failed')
  })

  it('opens an attached thread only after the provider releases the task', async () => {
    let listener: (task: AgentTaskRecord) => void = () => {}
    const source = {
      get: vi.fn(async () => ({ ...runningTask, externalThreadId: 'thread-id' })),
      onChanged: vi.fn((value: (task: AgentTaskRecord) => void) => {
        listener = value
        return () => {}
      }),
    }
    const openThread = vi.fn(async () => {})
    const opening = openCodexThreadAfterTaskRelease(source, runningTask.id, openThread)
    await Promise.resolve()

    expect(openThread).not.toHaveBeenCalled()
    listener({ ...runningTask, status: 'completed', externalThreadId: 'thread-id', finishedAt: '2026-01-01T00:01:00.000Z' })
    await opening

    expect(openThread).toHaveBeenCalledWith('thread-id')
  })
})
