import type { CommandCapability, CommandRunGuard } from '../src/index'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CraftHubRuntime } from '../src/index'

const fixtures: Array<{ runtime: CraftHubRuntime, root: string }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { runtime, root } of fixtures.splice(0)) {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

async function fixture(trusted = true) {
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-reviewed-command-'))
  const path = join(root, 'project')
  await mkdir(path)
  await writeFile(join(path, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"' } }))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  fixtures.push({ runtime, root })
  const project = await runtime.addProject(path)
  if (trusted)
    await runtime.projects.setTrust(project.id, 'trusted')
  const capability = (await runtime.capabilities(project.id)).find((item): item is CommandCapability => item.kind === 'command')!
  const approval: CommandRunGuard = { projectPath: project.path, capability, expiresAt: Date.now() + 60_000 }
  return { runtime, project, capability, approval, path }
}

describe('reviewed command execution', () => {
  it('keeps discovery and preview read-only and requires trust even with an approval', async () => {
    const value = await fixture(false)
    await value.runtime.previewCommand(value.project.id, value.capability.id)
    expect(await value.runtime.runs()).toEqual([])
    await expect(value.runtime.run(value.project.id, value.capability.id, undefined, {}, value.approval)).rejects.toThrow('reviewed project or command changed')
    expect((await value.runtime.projects.get(value.project.id)).trust).toBe('untrusted')
    expect(await value.runtime.runs()).toEqual([])
    await value.runtime.projects.setTrust(value.project.id, 'trusted')
    const handle = await value.runtime.run(value.project.id, value.capability.id, undefined, {}, value.approval)
    expect((await handle.completion).status).toBe('completed')
  })

  it('rejects changed package scripts and changed input selections before recording any run', async () => {
    const value = await fixture()
    await expect(value.runtime.run(value.project.id, value.capability.id, undefined, { extra: 'unreviewed' }, value.approval)).rejects.toThrow('reviewed project or command changed')
    await writeFile(join(value.path, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(1)"' } }))
    await expect(value.runtime.run(value.project.id, value.capability.id, undefined, {}, value.approval)).rejects.toThrow('reviewed project or command changed')
    expect(await value.runtime.runs()).toEqual([])
  })

  it.each(['cancel', 'trust', 'expiry'] as const)('rechecks %s after asynchronous discovery at the execution boundary', async (change) => {
    const value = await fixture()
    const abort = new AbortController()
    value.approval.signal = abort.signal
    const capabilities = value.runtime.capabilities.bind(value.runtime)
    let count = 0
    vi.spyOn(value.runtime, 'capabilities').mockImplementation(async (projectId) => {
      const result = await capabilities(projectId)
      if (++count === 2) {
        if (change === 'cancel')
          abort.abort()
        if (change === 'trust')
          await value.runtime.projects.setTrust(projectId, 'untrusted')
        if (change === 'expiry')
          vi.spyOn(Date, 'now').mockReturnValue(value.approval.expiresAt + 1)
      }
      return result
    })
    await expect(value.runtime.run(value.project.id, value.capability.id, undefined, {}, value.approval)).rejects.toThrow(/approval|reviewed/)
    expect(count).toBe(2)
    expect(await value.runtime.runs()).toEqual([])
  })

  it('copies the review before awaiting and refuses a caller mutating it to match a changed command', async () => {
    const value = await fixture()
    const capabilities = value.runtime.capabilities.bind(value.runtime)
    vi.spyOn(value.runtime, 'capabilities').mockImplementation(async (projectId) => {
      await writeFile(join(value.path, 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.exit(1)"' } }))
      const current = await capabilities(projectId)
      value.approval.capability = current.find((item): item is CommandCapability => item.kind === 'command')!
      return current
    })
    await expect(value.runtime.run(value.project.id, value.capability.id, undefined, {}, value.approval)).rejects.toThrow('reviewed project or command changed')
    expect(await value.runtime.runs()).toEqual([])
  })
})
