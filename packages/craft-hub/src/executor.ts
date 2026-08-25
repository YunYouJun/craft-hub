import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import type { CraftHubStore } from './store'
import type { CommandCapability, ProjectRecord, RunOutputEvent, RunRecord } from './types'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import process from 'node:process'

export interface RunHandle {
  run: RunRecord
  completion: Promise<RunRecord>
  cancel: () => void
}

/** Execute only a structured command capability after project trust is established. */
export function executeCommand(
  store: CraftHubStore,
  project: ProjectRecord,
  capability: CommandCapability,
  onOutput?: (event: RunOutputEvent) => void,
): RunHandle {
  if (project.trust !== 'trusted')
    throw new Error(`Project ${project.name} is untrusted. Trust it before running commands.`)
  if (capability.invocation.cwd !== project.path)
    throw new Error('Command working directory does not match its project')

  const run: RunRecord = {
    id: randomUUID(),
    projectId: project.id,
    capabilityId: capability.id,
    command: capability.invocation.command,
    args: capability.invocation.args,
    cwd: capability.invocation.cwd,
    startedAt: new Date().toISOString(),
    stdout: '',
    stderr: '',
    status: 'running',
  }
  void store.saveRun(run)

  const child: ChildProcess = spawn(run.command, run.args, {
    cwd: run.cwd,
    env: process.env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let cancelled = false
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    run.stdout += text
    onOutput?.({ stream: 'stdout', chunk: text })
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    run.stderr += text
    onOutput?.({ stream: 'stderr', chunk: text })
  })

  const completion = new Promise<RunRecord>((resolve) => {
    child.on('error', async (error) => {
      run.stderr += `${error.message}\n`
      run.status = 'failed'
      run.finishedAt = new Date().toISOString()
      await store.saveRun(run)
      resolve(run)
    })
    child.on('close', async (exitCode, signal) => {
      if (run.status === 'failed')
        return
      run.exitCode = exitCode
      run.signal = signal
      run.status = cancelled ? 'cancelled' : 'completed'
      run.finishedAt = new Date().toISOString()
      await store.saveRun(run)
      resolve(run)
    })
  })

  return {
    run,
    completion,
    cancel: () => {
      cancelled = true
      child.kill('SIGTERM')
    },
  }
}
