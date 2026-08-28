import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentTaskManager, CraftHubStore, ProjectRegistry } from '../src/index'

describe('agent tasks', () => {
  it('marks a persisted running task as interrupted after the manager restarts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-agent-task-'))
    const store = new CraftHubStore(root)
    await store.saveAgentTask({
      id: 'interrupted-task',
      provider: 'codex',
      projectIds: ['project'],
      primaryProjectId: 'project',
      prompt: 'Continue the task',
      startedAt: '2026-01-01T00:00:00.000Z',
      status: 'running',
    })

    const manager = new AgentTaskManager(store, new ProjectRegistry(store), { id: 'codex', run: vi.fn() })

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'interrupted-task',
        status: 'failed',
        error: 'Task was interrupted when Craft Hub stopped',
      }),
    ])
    await expect(store.getAgentTask('interrupted-task')).resolves.toMatchObject({ status: 'failed' })
  })

  it('keeps a task running while its provider is still active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-agent-task-'))
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const store = new CraftHubStore(join(root, '.data'))
    const projects = new ProjectRegistry(store)
    const project = await projects.add(projectPath)
    await projects.setTrust(project.id, 'trusted')
    let finish!: () => void
    const providerFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run = vi.fn(async () => {
      await providerFinished
      return { finalResponse: 'Done' }
    })
    const manager = new AgentTaskManager(store, projects, {
      id: 'codex',
      run,
    })

    const task = await manager.start({ prompt: 'Continue the task', projectIds: [project.id], primaryProjectId: project.id, capabilityId: 'skill-id' })

    await expect(manager.list()).resolves.toEqual([expect.objectContaining({ id: task.id, capabilityId: 'skill-id', status: 'running' })])
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ capabilityId: 'skill-id' }))
    finish()
    await vi.waitFor(async () => expect((await store.getAgentTask(task.id))?.status).toBe('completed'))
  })

  it('persists provider output while the task is still running', async () => {
    const root = await mkdtemp(join(tmpdir(), 'craft-hub-agent-task-'))
    const projectPath = join(root, 'project')
    await mkdir(projectPath)
    const store = new CraftHubStore(join(root, '.data'))
    const projects = new ProjectRegistry(store)
    const project = await projects.add(projectPath)
    await projects.setTrust(project.id, 'trusted')
    let finish!: () => void
    const providerFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const manager = new AgentTaskManager(store, projects, {
      id: 'codex',
      run: async (input) => {
        await (input as typeof input & { onOutput: (chunk: string) => Promise<void> }).onOutput('Tests running\n')
        await providerFinished
        return { finalResponse: 'Done' }
      },
    })

    const task = await manager.start({ prompt: 'Run tests', projectIds: [project.id], primaryProjectId: project.id })

    await vi.waitFor(async () => expect((await store.getAgentTask(task.id))?.output).toBe('Tests running\n'))
    await expect(manager.get(task.id)).resolves.toMatchObject({ status: 'running', output: 'Tests running\n' })
    finish()
    await vi.waitFor(async () => expect((await store.getAgentTask(task.id))?.status).toBe('completed'))
  })
})
