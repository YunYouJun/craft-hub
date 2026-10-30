import type { CommandCapability, ProjectRecord } from '../src/types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loads: 0, spawns: 0 }))
vi.mock('node-pty', () => {
  state.loads++
  return { spawn: () => {
    state.spawns++
    throw new Error('Fixture spawn failure')
  } }
})

it('keeps PTY unloaded during discovery and untrusted requests, and rechecks a trusted launch guard after loading', async () => {
  const { CraftHubRuntime } = await import('../src/runtime')
  const { executeCommand } = await import('../src/executor')
  const root = await mkdtemp(join(tmpdir(), 'craft-hub-lazy-executor-'))
  const runtime = new CraftHubRuntime({ dataDir: join(root, 'data'), configDir: join(root, 'config') })
  const project: ProjectRecord = { id: 'fixture', name: 'Fixture', path: root, trust: 'untrusted', addedAt: new Date().toISOString() }
  const capability: CommandCapability = { id: 'inspect', kind: 'command', name: 'Inspect', source: 'package', invocation: { command: process.execPath, args: ['--version'], cwd: root, requiredEnv: [] } }
  try {
    const registered = await runtime.projects.add(root)
    await runtime.capabilityDiscovery(registered.id)
    expect(state.loads).toBe(0)
    await expect(executeCommand(runtime.store, project, capability)).rejects.toThrow('untrusted')
    expect(state.loads).toBe(0)
    const validate = vi.fn(async () => {
      throw new Error('Trust revoked during lazy loading')
    })
    await expect(executeCommand(runtime.store, { ...project, trust: 'trusted' }, capability, undefined, undefined, { validate, assertActive: vi.fn() })).rejects.toThrow('Trust revoked')
    expect(validate).toHaveBeenCalledOnce()
    expect(state.spawns).toBe(0)
    expect(await runtime.store.listRuns()).toEqual([])
  }
  finally {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})
