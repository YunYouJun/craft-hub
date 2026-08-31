import type { CraftHubStore } from './store'
import type { CommandCapability, ProjectRecord, RunOutputEvent, RunRecord } from './types'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import { spawn } from 'node-pty'
import { assertCommandWorkingDirectory } from './path-security'

interface ParsedCommand {
  args: string[]
  command: string
}

type ParseCommand = (command: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv, shell: false }) => ParsedCommand

const parseCommand = (createRequire(import.meta.url)('cross-spawn') as { _parse: ParseCommand })._parse

const persistedOutputLimit = 10 * 1024 * 1024
const persistedOutputHead = persistedOutputLimit / 2
const persistedOutputTail = persistedOutputLimit - persistedOutputHead

export interface RunHandle {
  run: RunRecord
  completion: Promise<RunRecord>
  cancel: () => void
  resize: (columns: number, rows: number) => void
  write: (data: string) => void
}

/** Execute only a structured command capability after project trust is established. */
export async function executeCommand(
  store: CraftHubStore,
  project: ProjectRecord,
  capability: CommandCapability,
  onOutput?: (event: RunOutputEvent) => void,
  persistedInvocation = capability.invocation,
): Promise<RunHandle> {
  if (project.trust !== 'trusted')
    throw new Error(`Project ${project.name} is untrusted. Trust it before running commands.`)
  await assertCommandWorkingDirectory(project.path, capability.invocation.cwd)

  const run: RunRecord = {
    id: randomUUID(),
    projectId: project.id,
    capabilityId: capability.id,
    capabilitySource: capability.source,
    command: persistedInvocation.command,
    args: persistedInvocation.args,
    cwd: persistedInvocation.cwd,
    startedAt: new Date().toISOString(),
    stdout: '',
    stderr: '',
    status: 'running',
  }
  void store.saveRun(run)

  const env = commandEnvironment()
  const parsed = process.platform === 'win32'
    ? parseCommand(capability.invocation.command, capability.invocation.args, {
        cwd: capability.invocation.cwd,
        env,
        shell: false,
      })
    : capability.invocation
  const terminal = spawn(parsed.command, process.platform === 'win32' ? parsed.args.join(' ') : parsed.args, {
    cwd: capability.invocation.cwd,
    cols: 120,
    env,
    name: 'xterm-256color',
    rows: 30,
  })
  let cancelled = false
  let closed = false
  terminal.onData((text) => {
    const next = appendPersistedOutput(run.stdout, text)
    run.stdout = next.output
    run.truncated ||= next.truncated
    onOutput?.({ stream: 'stdout', chunk: text })
  })

  const completion = new Promise<RunRecord>((resolve) => {
    terminal.onExit(async ({ exitCode }) => {
      closed = true
      run.exitCode = exitCode
      run.status = cancelled ? 'cancelled' : exitCode === 0 ? 'completed' : 'failed'
      run.finishedAt = new Date().toISOString()
      await store.saveRun(run)
      void store.applyDefaultRunRetention().catch(() => {})
      resolve(run)
    })
  })

  return {
    run,
    completion,
    cancel: () => {
      if (closed)
        return
      cancelled = true
      terminal.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
      const forceKill = setTimeout(() => {
        if (!closed)
          terminal.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
      }, 2_000)
      forceKill.unref()
    },
    resize: (columns, rows) => terminal.resize(columns, rows),
    write: data => terminal.write(data),
  }
}

function commandEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = env.HOME ?? env.USERPROFILE
  const configuredPath = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const userToolPaths = [
    env.PNPM_HOME,
    home && process.platform === 'darwin' ? join(home, 'Library', 'pnpm') : undefined,
    home ? join(home, '.local', 'bin') : undefined,
    home ? join(home, '.local', 'share', 'pnpm') : undefined,
    home ? join(home, '.local', 'share', 'fnm', 'aliases', 'default', 'bin') : undefined,
    home ? join(home, '.volta', 'bin') : undefined,
    home ? join(home, '.nvm', 'current', 'bin') : undefined,
    home ? join(home, '.asdf', 'shims') : undefined,
    process.platform === 'darwin' ? '/opt/homebrew/bin' : undefined,
    process.platform === 'darwin' ? '/opt/homebrew/sbin' : undefined,
    process.platform === 'win32' ? undefined : '/usr/local/bin',
  ].filter((path): path is string => typeof path === 'string' && existsSync(path))

  return {
    ...env,
    PATH: [...new Set([...configuredPath, ...userToolPaths])].join(delimiter),
  }
}

function appendPersistedOutput(current: string, chunk: string): { output: string, truncated: boolean } {
  const combined = current + chunk
  if (Buffer.byteLength(combined, 'utf8') <= persistedOutputLimit)
    return { output: combined, truncated: false }
  const buffer = Buffer.from(combined)
  const marker = Buffer.from('\n\n[Craft Hub truncated persisted output]\n\n')
  const output = Buffer.concat([
    buffer.subarray(0, persistedOutputHead),
    marker,
    buffer.subarray(Math.max(persistedOutputHead, buffer.length - persistedOutputTail)),
  ]).toString('utf8')
  return { output, truncated: true }
}
