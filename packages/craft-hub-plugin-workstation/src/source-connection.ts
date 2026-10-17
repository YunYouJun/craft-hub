import type { EnvironmentSourceProvider } from 'craft-hub'
import type { WorkstationSetupOptions } from './setup-guide'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, rmdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import { EnvironmentSourceError, getCraftHubDataDir } from 'craft-hub'
import { gitAuthentication } from './git-authentication'
import { resolveLocalExecutable } from './local-executable'

type Run = (command: string, args: string[], environment: NodeJS.ProcessEnv, signal: AbortSignal, input?: string) => Promise<string>
const identity = (repository: string): string => repository.replace(/\/$/, '').replace(/\.git$/, '')
async function fingerprint(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file).catch((error) => {
    if (error.code === 'ENOENT')
      return ''
    throw error
  })).digest('hex')
}

/** Fixed child execution with cancellation, bounded output and sanitized errors; shell strings never cross this seam. */
export const sourceProcess: Run = async (command, args, environment, signal, input) => {
  signal.throwIfAborted()
  const executable = resolveLocalExecutable(command)
  return new Promise((resolve, reject) => {
    const child = spawn(executable.command, args, { shell: false, detached: process.platform !== 'win32', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], env: { ...executable.env, ...environment } })
    let output = ''
    let diagnostic = ''
    let expired = false
    let escalation: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, signal)
        else child.kill(signal)
      }
      catch {}
    }
    const stop = (): void => {
      kill('SIGTERM')
      escalation ??= setTimeout(kill, 1500, 'SIGKILL')
      escalation.unref()
    }
    const timeout = setTimeout(() => {
      expired = true
      stop()
    }, 120000)
    signal.addEventListener('abort', stop, { once: true })
    child.stdout?.on('data', (data) => {
      output += data
      if (output.length > 8 * 1024 * 1024) {
        expired = true
        stop()
      }
    })
    child.stderr?.on('data', (data) => {
      diagnostic = (diagnostic + data).slice(-65536)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
    child.on('error', () => {
      clearTimeout(timeout)
      clearTimeout(escalation)
      signal.removeEventListener('abort', stop)
      reject(new EnvironmentSourceError(503, 'unavailable'))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      clearTimeout(escalation)
      signal.removeEventListener('abort', stop)
      if (signal.aborted)
        return reject(signal.reason)
      if (code === 0 && !expired)
        return resolve(output)
      const authentication = !expired && /authentication failed|could not read (?:username|password)|terminal prompts disabled|access denied|http basic|returned error: (?:401|403)|repository not found/i.test(diagnostic)
      reject(new EnvironmentSourceError(503, authentication ? 'authentication-required' : 'unavailable'))
    })
  })
}

/** Connect source repositories through controlled Git transport and Workstation's existing validation and private binding. */
export function workstationSourceProvider(options: WorkstationSetupOptions = {}, run: Run = sourceProcess, inspect = runConfigurationInspection): EnvironmentSourceProvider {
  const home = options.homeDirectory ?? homedir()
  const publicDirectory = options.sourceDirectory ?? join(home, 'repos/github.com/YunYouJun/workstation')
  const privateRoot = join(options.sourceDataDirectory ?? getCraftHubDataDir(), 'environment-sources/workstation')
  const invocation = options.invocation ?? { command: options.command ?? process.env.CRAFT_HUB_WORKSTATION_COMMAND ?? 'workstation', args: [], environment: {} }
  const baseEnvironment: NodeJS.ProcessEnv = { DOTFILES_HOME: home, ...invocation.environment }
  const privateConfig = baseEnvironment.WORKSTATION_PRIVATE_CONFIG ?? process.env.WORKSTATION_PRIVATE_CONFIG ?? join(home, '.config/workstation/private.json')
  return {
    id: 'workstation',
    name: 'Workstation',
    kinds: ['public', 'private'],
    connect: async (input, context) => {
      if (process.platform === 'win32' || (input.kind === 'private' && (baseEnvironment.WORKSTATION_PRIVATE_MANIFEST || process.env.WORKSTATION_PRIVATE_MANIFEST)))
        throw new EnvironmentSourceError(409, 'unavailable')
      const cli = (args: string[], environment = baseEnvironment): Promise<string> => run(invocation.command, [...invocation.args, ...args], environment, context.signal)
      const target = input.kind === 'private' ? join(privateRoot, createHash('sha256').update(identity(input.repository)).digest('hex').slice(0, 24)) : publicDirectory
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      const parent = await realpath(dirname(target))
      const destination = join(parent, basename(target))
      const staging = join(parent, `.incoming-${randomUUID()}`)
      const bindingRevision = await fingerprint(privateConfig)
      const authentication = await gitAuthentication(input.repository, context.credentials)
      const config: NodeJS.ProcessEnv = {
        ...baseEnvironment,
        ...authentication.environment,
        GIT_ALLOW_PROTOCOL: 'https',
        GIT_CONFIG_COUNT: context.credentials ? '4' : '3',
        GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: '/dev/null',
        GIT_CONFIG_KEY_1: 'http.followRedirects',
        GIT_CONFIG_VALUE_1: 'false',
        GIT_CONFIG_KEY_2: 'protocol.file.allow',
        GIT_CONFIG_VALUE_2: 'never',
        ...(context.credentials ? { GIT_CONFIG_KEY_3: 'credential.helper', GIT_CONFIG_VALUE_3: '' } : {}),
      }
      const git = (args: string[]): Promise<string> => run('git', args, config, context.signal)
      let checkout = destination
      let fresh = false
      try {
        context.phase('cloning')
        const existing = await lstat(destination).catch((error) => {
          if (error.code === 'ENOENT')
            return
          throw error
        })
        if (existing) {
          if (!existing.isDirectory() || existing.isSymbolicLink())
            throw new EnvironmentSourceError(409, 'destination-conflict')
          try {
            const root = (await git(['-C', destination, 'rev-parse', '--show-toplevel'])).trim()
            const remote = (await git(['-C', destination, 'remote', 'get-url', 'origin'])).trim()
            if (await realpath(root) !== destination || identity(remote) !== identity(input.repository))
              throw new Error('Different repository')
          }
          catch { throw new EnvironmentSourceError(409, 'destination-conflict') }
        }
        else {
          fresh = true
          checkout = staging
          await git(['clone', '--no-recurse-submodules', '--', input.repository, staging])
        }
        context.signal.throwIfAborted()
        context.phase('validating')
        if (input.kind === 'private') {
          const manifest = await lstat(join(checkout, 'config/sync-manifest.json')).catch(() => undefined)
          if (!manifest?.isFile() || manifest.isSymbolicLink() || manifest.size > 1024 * 1024)
            throw new EnvironmentSourceError(400, 'invalid-source')
        }
        // Configuration inspection remains the original tool's authority; the adapter never parses source contents.
        const inspected = await inspect(invocation, {
          ...baseEnvironment,
          DOTFILES_REPO_ROOT: input.kind === 'public' ? checkout : publicDirectory,
          ...(input.kind === 'private' ? { WORKSTATION_PRIVATE_MANIFEST: join(checkout, 'config/sync-manifest.json') } : {}),
        }, context.signal)
        if (!Array.isArray(inspected.items) || inspected.items.some((item: { id?: string, status?: string }) => ['manifest', 'mcp-scan'].includes(item.id ?? '') && item.status === 'error')
          || (input.kind === 'public' && !inspected.items.some((item: { origin?: string, source?: string, status?: string }) => item.origin === 'public' && typeof item.source === 'string' && item.source !== '(absent)' && item.status !== 'error'))) {
          throw new EnvironmentSourceError(400, 'invalid-source')
        }
        context.signal.throwIfAborted()
        if (input.kind === 'private' && await fingerprint(privateConfig) !== bindingRevision)
          throw new EnvironmentSourceError(409, 'destination-conflict')
        context.signal.throwIfAborted()
        context.phase('binding')
        if (fresh) {
          // Reserve a previously absent directory before promotion; another checkout is never replaced.
          await mkdir(destination, { mode: 0o700 })
          try {
            await rename(staging, destination)
          }
          catch (error) {
            await rmdir(destination).catch(() => {})
            throw error
          }
        }
        if (input.kind === 'private')
          await cli(['private', 'connect', '--repo', input.repository, '--target-dir', destination, '--yes'])
        return { localPath: destination }
      }
      finally {
        await authentication.close()
        if (fresh)
          await rm(staging, { recursive: true, force: true })
      }
    },
  }
}

async function runConfigurationInspection(invocation: { command: string, args: string[] }, environment: NodeJS.ProcessEnv, signal: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const result = JSON.parse(await sourceProcess(invocation.command, [...invocation.args, 'configuration'], environment, signal, '{"version":1,"operation":"inspect"}'))
    if (!result.ok || result.result?.version !== 1)
      throw new Error('Unavailable')
    return result.result
  }
  catch { throw new EnvironmentSourceError(400, 'invalid-source') }
}
