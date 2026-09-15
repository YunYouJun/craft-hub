import type { AgentTaskProviderInput } from '../src/agent-tasks'
import type { DeliveryRequest } from '../src/delivery'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeliveryLocalExecutor, DeliveryReceiver } from '../src/delivery'
import { CraftHubRuntime } from '../src/runtime'

const roots: string[] = []
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'delivery-receiver-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
const request = (): DeliveryRequest => ({ id: 'request', deliveryId: 'link', requesterId: 'owner', executorId: 'owner', deviceId: 'device', projectId: 'remote-project', prompt: 'Implement this change', mode: 'worktree', status: 'dispatched', reportSequence: 0, createdAt: 1, updatedAt: 1 })
describe('delivery receiver', () => {
  it('acknowledges before starting and recovers the same task after a restart', async () => {
    const root = await directory()
    const remote = request()
    const order: string[] = []
    const task = { id: 'local', status: 'running' as const }
    const executor = { capabilities: { worktree: true, followup: false }, start: vi.fn(async () => {
      order.push('start')
      return task
    }), find: vi.fn(async () => task), get: vi.fn(async () => task), cancel: vi.fn() }
    const transport = { poll: async () => [structuredClone(remote)], report: async (input: {
      status: DeliveryRequest['status']
      sequence: number
    }) => {
      order.push(input.status)
      Object.assign(remote, { status: input.status, reportSequence: input.sequence })
      return structuredClone(remote)
    } }
    const first = new DeliveryReceiver(join(root, 'receiver.sqlite'), transport, executor)
    await first.tick()
    first.close()
    const restarted = new DeliveryReceiver(join(root, 'receiver.sqlite'), transport, executor)
    await restarted.tick()
    restarted.close()
    expect(order.slice(0, 3)).toEqual(['starting', 'start', 'running'])
    expect(executor.start).toHaveBeenCalledTimes(1)
    expect(remote.reportSequence).toBe(3)
  })
  it('does not start code after a lost acknowledgement or a concurrent journal claim', async () => {
    const root = await directory()
    const remote = request()
    const executor = { capabilities: { worktree: true, followup: false }, start: vi.fn(), find: vi.fn(async () => undefined), get: vi.fn(), cancel: vi.fn() }
    const transport = { poll: async () => [structuredClone(remote)], report: vi.fn(async () => {
      throw new Error('Response lost')
    }) }
    const a = new DeliveryReceiver(join(root, 'receiver.sqlite'), transport, executor)
    const b = new DeliveryReceiver(join(root, 'receiver.sqlite'), transport, executor)
    await Promise.allSettled([a.tick(), b.tick()])
    a.close()
    b.close()
    const restarted = new DeliveryReceiver(join(root, 'receiver.sqlite'), transport, executor)
    await expect(restarted.tick()).rejects.toThrow('Response lost')
    restarted.close()
    expect(executor.start).not.toHaveBeenCalled()
  })
  it('keeps an actual provider in its registered Git worktree and enforces local trust', async () => {
    const root = await directory()
    const repository = join(root, 'repository')
    await mkdir(repository)
    execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' })
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-m', 'chore: initialize fixture'], { cwd: repository, stdio: 'ignore' })
    const run = vi.fn(async (input: AgentTaskProviderInput) => {
      await input.onThread('original-thread')
      return { finalResponse: 'Verified' }
    })
    const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config'), agentTaskProvider: { id: 'fixture', supportsResume: true, run } })
    try {
      const project = await runtime.projects.add(repository)
      const executor = createDeliveryLocalExecutor(runtime, { 'remote-project': project.id })
      await expect(executor.start(request())).rejects.toThrow('Trust')
      expect(run).not.toHaveBeenCalled()
      await runtime.projects.setTrust(project.id, 'trusted')
      const task = await executor.start(request())
      await vi.waitFor(async () => expect((await executor.get(task.id))?.status).toBe('completed'))
      await executor.start(request())
      expect(run).toHaveBeenCalledTimes(1)
      const input = run.mock.calls[0]!
      expect(input[0].primaryWorkingDirectory).toContain('delivery-worktrees')
      expect(input[0].primaryWorkingDirectory).not.toBe(repository)
      const next = await executor.start({ ...request(), id: 'continuation', parentId: 'request', continuation: true, prompt: 'Add a second test' })
      await vi.waitFor(async () => expect((await executor.get(next.id))?.status).toBe('completed'))
      expect(run).toHaveBeenCalledTimes(2)
      expect(run.mock.calls[1]?.[0]).toMatchObject({ resumeThreadId: 'original-thread', primaryWorkingDirectory: input[0].primaryWorkingDirectory })
      const foreign = join(root, 'foreign')
      await mkdir(foreign)
      await expect(runtime.agentTasks.start({ projectIds: [project.id], primaryProjectId: project.id, prompt: 'bad path' }, { worktreePath: foreign })).rejects.toThrow('not a worktree')
    }
    finally {
      await runtime.close()
    }
  })
})
