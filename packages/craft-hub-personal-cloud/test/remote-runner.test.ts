import type { PersonalCloudBackend, RemoteRequest, RemoteRequestUpdate } from '../src/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CraftHubRuntime } from 'craft-hub'
import { describe, expect, it, vi } from 'vitest'
import { RemoteRequestRunner } from '../src/remote-runner'

async function fixture(trusted = true) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-cloud-runner-'))
  const projectPath = join(root, 'project')
  await mkdir(projectPath)
  await writeFile(join(projectPath, 'package.json'), JSON.stringify({ scripts: { hello: 'node -e "process.exit(0)"' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
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
  return { backend, request, runtime, updates }
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
    await value.runtime.close()
  })

  it('rejects an untrusted project before approval or execution', async () => {
    const value = await fixture(false)
    const approve = vi.fn(async () => true)
    const run = vi.spyOn(value.runtime, 'run')
    await new RemoteRequestRunner(value.runtime, value.backend, approve).handle(value.request)

    expect(approve).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(value.updates.map(update => update.status)).toEqual(['rejected'])
    await value.runtime.close()
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
    await value.runtime.close()
  })
})
