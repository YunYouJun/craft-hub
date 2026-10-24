import type { RemoteApproval } from '../src/remote-runner'
import type { PersonalCloudBackend, RemoteRequest, RemoteRequestUpdate } from '../src/types'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteRequestRunner } from '../src/remote-runner'

const fixtures: Array<{ runtime: CraftHubRuntime, root: string }> = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const { runtime, root } of fixtures.splice(0)) {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(trusted = true) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-cloud-runner-'))
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { hello: 'node -e "process.exit(0)"' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  fixtures.push({ runtime, root })
  const project = await runtime.addProject(projectPath)
  if (trusted)
    await runtime.projects.setTrust(project.id, 'trusted')
  const workspace = await runtime.workspaces.create('Remote')
  await runtime.workspaces.addProject(workspace.id, project.id)
  const capability = (await runtime.capabilities(project.id)).find(item => item.kind === 'command')!
  const updates: RemoteRequestUpdate[] = []
  const backend: PersonalCloudBackend = {
    synchronize: vi.fn(async documents => ({ documents, conflicts: [], accepted: [] })),
    claimRequests: vi.fn(async () => []),
    heartbeat: vi.fn(async () => {}),
    updateRequest: vi.fn(async update => void updates.push(update)),
  }
  const request: RemoteRequest = {
    requestId: 'request-1',
    targetDeviceId: 'device-1',
    projectKey: 'project',
    capabilityId: capability.id,
    status: 'claimed',
    claimId: 'claim-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  return { backend, request, runtime, updates, project, projectPath }
}

describe('remote request runner', () => {
  it('delegates a valid request to the existing runtime exactly once', async () => {
    const value = await fixture()
    const run = vi.spyOn(value.runtime, 'run')
    const runner = new RemoteRequestRunner(value.runtime, value.backend, vi.fn(async () => true))

    await runner.handle(value.request)
    await runner.handle(value.request)

    expect(run).toHaveBeenCalledTimes(1)
    expect(value.updates.map(update => update.status)).toEqual(['awaiting_approval', 'running', 'succeeded'])
    expect(value.updates.at(-1)).not.toHaveProperty('stdout')
    expect(value.updates.at(-1)).not.toHaveProperty('stderr')
  })

  it('rejects an untrusted project before approval or execution', async () => {
    const value = await fixture(false)
    const approve = vi.fn(async () => true)
    const run = vi.spyOn(value.runtime, 'run')
    await new RemoteRequestRunner(value.runtime, value.backend, approve).handle(value.request)

    expect(approve).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(value.updates.map(update => update.status)).toEqual(['rejected'])
  })

  it('allows a leased request to retry when status delivery failed before execution', async () => {
    const value = await fixture()
    const update = vi.mocked(value.backend.updateRequest)
    update.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'))
    const run = vi.spyOn(value.runtime, 'run')
    const runner = new RemoteRequestRunner(value.runtime, value.backend, vi.fn(async () => true))

    await expect(runner.handle(value.request)).rejects.toThrow('still offline')
    await runner.handle(value.request)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['invalid-expiry', 'wrong-device'] as const)('rejects %s before asking for approval', async (kind) => {
    const value = await fixture()
    const approve = vi.fn(async () => true)
    if (kind === 'invalid-expiry')
      value.request.expiresAt = 'invalid'
    const run = vi.spyOn(value.runtime, 'run')
    await new RemoteRequestRunner(value.runtime, value.backend, approve, { deviceId: 'another-device' }).handle(value.request)
    expect(approve).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('releases a cancelled approval without waiting for a dialog and ignores its later acceptance', async () => {
    const value = await fixture()
    const abort = new AbortController()
    let finish!: (accepted: boolean) => void
    const approve = vi.fn(async () => new Promise<boolean>((resolve) => {
      finish = resolve
    }))
    const run = vi.spyOn(value.runtime, 'run')
    const task = new RemoteRequestRunner(value.runtime, value.backend, approve, { signal: abort.signal }).handle(value.request)
    await vi.waitFor(() => expect(approve).toHaveBeenCalledOnce())
    abort.abort()
    await task
    finish(true)
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    expect(value.updates.at(-1)?.status).toBe('rejected')
  })

  it.each(['script', 'trust', 'expiry'] as const)('refuses %s changes while the local approval is open', async (change) => {
    const value = await fixture()
    const approve = vi.fn<RemoteApproval>(async (_request, _projectName, _capabilityName, review) => {
      expect(review.projectId).toBe(value.project.id)
      expect(review.invocation.cwd).toBe(value.project.path)
      if (change === 'script')
        await writeFile(join(value.projectPath, 'package.json'), JSON.stringify({ scripts: { hello: 'node -e "process.exit(1)"' } }))
      if (change === 'trust')
        await value.runtime.projects.setTrust(value.project.id, 'untrusted')
      if (change === 'expiry') {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.parse(value.request.expiresAt) + 1)
      }
      return true
    })
    await new RemoteRequestRunner(value.runtime, value.backend, approve).handle(value.request)
    expect(await value.runtime.runs()).toEqual([])
    expect(value.updates.at(-1)?.status).toBe(change === 'expiry' ? 'expired' : 'failed')
  })

  it('never repeats execution when both the completion and failure acknowledgements are lost', async () => {
    const value = await fixture()
    vi.mocked(value.backend.updateRequest).mockImplementation(async (update) => {
      if (update.status === 'succeeded' || update.status === 'failed')
        throw new Error('offline after execution')
      value.updates.push(update)
    })
    const run = vi.spyOn(value.runtime, 'run')
    const runner = new RemoteRequestRunner(value.runtime, value.backend, async () => true)
    await expect(runner.handle(value.request)).rejects.toThrow('offline after execution')
    await runner.handle(value.request)
    expect(run).toHaveBeenCalledOnce()
    expect(await value.runtime.runs()).toHaveLength(1)
  })
})
