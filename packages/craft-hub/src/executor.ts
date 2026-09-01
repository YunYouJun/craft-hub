import type { IPty } from 'node-pty'
import type { CraftHubStore } from './store'
import type { CommandCapability, ProjectRecord, RunOutputEvent, RunRecord } from './types'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import { spawn } from 'node-pty'
import { commandInvocationSequence } from './command-inputs'
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
  const invocations = commandInvocationSequence(capability.invocation)
  await Promise.all(invocations.map(invocation => assertCommandWorkingDirectory(project.path, invocation.cwd)))

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
  let cancelled = false
  let closed = false
  let terminal: IPty | undefined
  let resolveCompletion!: (run: RunRecord) => void

  function appendOutput(text: string): void {
    const next = appendPersistedOutput(run.stdout, text)
    run.stdout = next.output
    run.truncated ||= next.truncated
    onOutput?.({ stream: 'stdout', chunk: text })
  }

  async function finish(status: RunRecord['status'], exitCode: number | null): Promise<void> {
    if (closed)
      return
    closed = true
    run.exitCode = exitCode
    run.status = status
    run.finishedAt = new Date().toISOString()
    await store.saveRun(run)
    void store.applyDefaultRunRetention().catch(() => {})
    resolveCompletion(run)
  }

  function startStep(index: number): void {
    const invocation = invocations[index]!
    if (invocations.length > 1)
      appendOutput(`\r\n[Craft Hub ${index + 1}/${invocations.length}] ${invocation.label ?? invocation.command}\r\n`)
    const parsed = process.platform === 'win32'
      ? parseCommand(invocation.command, invocation.args, {
          cwd: invocation.cwd,
          env,
          shell: false,
        })
      : invocation
    try {
      terminal = spawn(parsed.command, process.platform === 'win32' ? parsed.args.join(' ') : parsed.args, {
        cwd: invocation.cwd,
        cols: 120,
        env,
        name: 'xterm-256color',
        rows: 30,
      })
    }
    catch (error) {
      appendOutput(`\r\n${error instanceof Error ? error.message : String(error)}\r\n`)
      void finish(cancelled ? 'cancelled' : 'failed', null)
      return
    }
    terminal.onData(appendOutput)
    terminal.onExit(({ exitCode }) => {
      if (cancelled) {
        void finish('cancelled', exitCode)
        return
      }
      if (exitCode !== 0) {
        void finish('failed', exitCode)
        return
      }
      if (index + 1 < invocations.length) {
        startStep(index + 1)
        return
      }
      void finish('completed', exitCode)
    })
  }

  const completion = new Promise<RunRecord>((resolve) => {
    resolveCompletion = resolve
  })
  startStep(0)

  return {
    run,
    completion,
    cancel: () => {
      if (closed)
        return
      cancelled = true
      const activeTerminal = terminal
      activeTerminal?.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
      const forceKill = setTimeout(() => {
        if (!closed && terminal === activeTerminal)
          activeTerminal?.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
      }, 2_000)
      forceKill.unref()
    },
    resize: (columns, rows) => terminal?.resize(columns, rows),
    write: data => terminal?.write(data),
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
