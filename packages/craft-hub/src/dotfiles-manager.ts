import type { ParseError } from 'jsonc-parser'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'

export const dotfilesManifestPath = '.craft-hub/dotfiles.jsonc'
export const dotfilesManifestSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/dotfiles-v1.schema.json'
export const dotfilesOperations = ['check', 'status', 'diff'] as const

export type DotfilesOperation = typeof dotfilesOperations[number]
export type DotfilesManagerState = 'unconfigured' | 'untrusted' | 'ready' | 'unsupported-platform'

/** One shell-free command declared by a trusted local dotfiles source. */
export interface DotfilesCommand {
  args: string[]
  command: string
}

/** Versioned, repository-owned read-only dotfiles command declaration. */
export interface DotfilesManifest {
  adapter: 'command'
  extensions?: Record<string, unknown>
  name?: string
  operations: Partial<Record<DotfilesOperation, DotfilesCommand>>
  platforms?: NodeJS.Platform[]
  version: 1
}

/** Current configuration and trust state for the local dotfiles source. */
export interface DotfilesManagerStatus {
  manifest?: DotfilesManifest
  manifestPath?: string
  manifestRevision?: string
  repositoryPath?: string
  state: DotfilesManagerState
}

/** Captured output from one trusted, read-only dotfiles operation. */
export interface DotfilesOperationResult {
  args: string[]
  command: string
  durationMs: number
  error?: string
  exitCode: number | null
  operation: DotfilesOperation
  stderr: string
  stdout: string
  succeeded: boolean
  timedOut: boolean
}

interface DotfilesManagerConfiguration {
  repositoryPath?: string
  schemaVersion: 1
  trustedManifestRevision?: string
}

const manifestLimitBytes = 256 * 1024
const outputLimitBytes = 1024 * 1024
const operationTimeoutMs = 30_000

/** Configure, trust, and run read-only operations from one explicit local dotfiles checkout. */
export class DotfilesManager {
  private readonly configurationPath: string

  constructor(dataDir: string) {
    this.configurationPath = join(dataDir, 'dotfiles-manager.json')
  }

  /** Select a local Git checkout and invalidate trust when the source changes. */
  async configure(repositoryPath: string): Promise<DotfilesManagerStatus> {
    if (!repositoryPath.trim())
      throw new DotfilesValidationError('Dotfiles repository path is required')
    const root = await gitRoot(resolve(repositoryPath))
    const manifest = await readManifest(root)
    const current = await this.configuration()
    await this.saveConfiguration({
      schemaVersion: 1,
      repositoryPath: root,
      trustedManifestRevision: current.repositoryPath === root && current.trustedManifestRevision === manifest.revision
        ? current.trustedManifestRevision
        : undefined,
    })
    return this.status()
  }

  /** Inspect the selected source and invalidate effective trust after manifest changes. */
  async status(): Promise<DotfilesManagerStatus> {
    const configuration = await this.configuration()
    if (!configuration.repositoryPath)
      return { state: 'unconfigured' }
    const source = await readManifest(configuration.repositoryPath)
    const supported = !source.manifest.platforms?.length || source.manifest.platforms.includes(process.platform)
    return {
      manifest: source.manifest,
      manifestPath: source.path,
      manifestRevision: source.revision,
      repositoryPath: configuration.repositoryPath,
      state: !supported
        ? 'unsupported-platform'
        : configuration.trustedManifestRevision === source.revision ? 'ready' : 'untrusted',
    }
  }

  /** Trust the exact current manifest; later manifest edits require another review. */
  async trust(): Promise<DotfilesManagerStatus> {
    const configuration = await this.configuration()
    if (!configuration.repositoryPath)
      throw new DotfilesValidationError('Dotfiles manager is not configured')
    const source = await readManifest(configuration.repositoryPath)
    if (source.manifest.platforms?.length && !source.manifest.platforms.includes(process.platform))
      throw new DotfilesValidationError(`Dotfiles source does not support ${process.platform}`)
    await this.saveConfiguration({ ...configuration, trustedManifestRevision: source.revision })
    return this.status()
  }

  /** Run one declared operation with a fixed working directory and no shell. */
  async run(operation: DotfilesOperation): Promise<DotfilesOperationResult> {
    if (!dotfilesOperations.includes(operation))
      throw new DotfilesValidationError(`Unsupported dotfiles operation: ${operation}`)
    const status = await this.status()
    if (status.state !== 'ready' || !status.repositoryPath || !status.manifest)
      throw new DotfilesTrustError('Trust the current dotfiles manifest before running commands')
    const command = status.manifest.operations[operation]
    if (!command)
      throw new DotfilesValidationError(`Dotfiles source does not declare ${operation}`)
    return runCommand(status.repositoryPath, operation, command)
  }

  private async configuration(): Promise<DotfilesManagerConfiguration> {
    try {
      const value = JSON.parse(await readFile(this.configurationPath, 'utf8')) as DotfilesManagerConfiguration
      if (value.schemaVersion !== 1 || (value.repositoryPath !== undefined && typeof value.repositoryPath !== 'string'))
        throw new DotfilesValidationError('Unsupported dotfiles manager configuration')
      return value
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1 }
      throw error
    }
  }

  private saveConfiguration(configuration: DotfilesManagerConfiguration): Promise<void> {
    return writeJsonAtomic(this.configurationPath, configuration)
  }
}

export class DotfilesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DotfilesValidationError'
  }
}

export class DotfilesTrustError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DotfilesTrustError'
  }
}

function validateManifest(input: unknown): DotfilesManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DotfilesValidationError('Dotfiles manifest must contain an object')
  const record = input as Record<string, unknown>
  const unknown = Object.keys(record).filter(key => !['$schema', 'version', 'name', 'adapter', 'platforms', 'operations', 'extensions'].includes(key))
  if (unknown.length)
    throw new DotfilesValidationError(`Dotfiles manifest contains unknown fields: ${unknown.join(', ')}`)
  if (record.version !== 1 || record.adapter !== 'command')
    throw new DotfilesValidationError('Dotfiles manifest requires version 1 and the command adapter')
  if (record.name !== undefined && (typeof record.name !== 'string' || !record.name.trim() || record.name.length > 128))
    throw new DotfilesValidationError('Dotfiles manifest name must be a non-empty string')
  if (record.platforms !== undefined && (!Array.isArray(record.platforms) || record.platforms.some(platform => !['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'].includes(String(platform)))))
    throw new DotfilesValidationError('Dotfiles manifest platforms are invalid')
  if (!record.operations || typeof record.operations !== 'object' || Array.isArray(record.operations))
    throw new DotfilesValidationError('Dotfiles manifest operations must contain check, status, or diff commands')
  const operationRecord = record.operations as Record<string, unknown>
  const unknownOperations = Object.keys(operationRecord).filter(key => !dotfilesOperations.includes(key as DotfilesOperation))
  if (unknownOperations.length)
    throw new DotfilesValidationError(`Dotfiles manifest contains unsupported operations: ${unknownOperations.join(', ')}`)
  const operations = Object.fromEntries(Object.entries(operationRecord).map(([operation, value]) => [operation, validateCommand(operation, value)]))
  if (!Object.keys(operations).length)
    throw new DotfilesValidationError('Dotfiles manifest must declare at least one operation')
  if (record.extensions !== undefined && (!record.extensions || typeof record.extensions !== 'object' || Array.isArray(record.extensions)))
    throw new DotfilesValidationError('Dotfiles manifest extensions must contain an object')
  return {
    version: 1,
    adapter: 'command',
    operations,
    ...(typeof record.name === 'string' ? { name: record.name.trim() } : {}),
    ...(Array.isArray(record.platforms) ? { platforms: record.platforms as NodeJS.Platform[] } : {}),
    ...(record.extensions ? { extensions: record.extensions as Record<string, unknown> } : {}),
  }
}

function validateCommand(operation: string, input: unknown): DotfilesCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new DotfilesValidationError(`Dotfiles ${operation} command must contain command and args`)
  const record = input as Record<string, unknown>
  if (Object.keys(record).some(key => key !== 'command' && key !== 'args'))
    throw new DotfilesValidationError(`Dotfiles ${operation} command contains unknown fields`)
  if (typeof record.command !== 'string' || !record.command.trim() || record.command.length > 1024 || record.command.includes('\0'))
    throw new DotfilesValidationError(`Dotfiles ${operation} command is invalid`)
  if (!Array.isArray(record.args) || record.args.length > 64 || record.args.some(argument => typeof argument !== 'string' || argument.length > 4096 || argument.includes('\0')))
    throw new DotfilesValidationError(`Dotfiles ${operation} args are invalid`)
  return { command: record.command.trim(), args: record.args as string[] }
}

async function readManifest(repositoryPath: string): Promise<{ manifest: DotfilesManifest, path: string, revision: string }> {
  const path = join(repositoryPath, dotfilesManifestPath)
  let resolved: string
  let content: string
  try {
    [resolved, content] = await Promise.all([realpath(path), readFile(path, 'utf8')])
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new DotfilesValidationError(`Dotfiles manifest not found: ${path}`)
    throw error
  }
  const location = relative(repositoryPath, resolved)
  if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))
    throw new DotfilesValidationError('Dotfiles manifest must stay inside the selected repository')
  if (Buffer.byteLength(content) > manifestLimitBytes)
    throw new DotfilesValidationError('Dotfiles manifest exceeds 256 KB')
  const errors: ParseError[] = []
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown
  if (errors.length)
    throw new DotfilesValidationError(`Invalid dotfiles JSONC: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}`)
  return {
    manifest: validateManifest(parsed),
    path,
    revision: createHash('sha256').update(content).digest('hex'),
  }
}

async function gitRoot(path: string): Promise<string> {
  const result = await runExecFile('git', ['-C', path, 'rev-parse', '--show-toplevel'], path, 10_000, 64 * 1024)
  if (!result.succeeded)
    throw new DotfilesValidationError(`Not a Git repository: ${path}`)
  return realpath(result.stdout.trim())
}

async function runCommand(repositoryPath: string, operation: DotfilesOperation, command: DotfilesCommand): Promise<DotfilesOperationResult> {
  const startedAt = Date.now()
  const result = await runExecFile(command.command, command.args, repositoryPath, operationTimeoutMs, outputLimitBytes)
  return {
    args: command.args,
    command: command.command,
    durationMs: Date.now() - startedAt,
    error: result.error,
    exitCode: result.exitCode,
    operation,
    stderr: result.stderr,
    stdout: result.stdout,
    succeeded: result.succeeded,
    timedOut: result.timedOut,
  }
}

function runExecFile(command: string, args: string[], cwd: string, timeout: number, maxBuffer: number): Promise<{ error?: string, exitCode: number | null, stderr: string, stdout: string, succeeded: boolean, timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, encoding: 'utf8', maxBuffer, shell: false, timeout, windowsHide: true }, (error, stdout, stderr) => {
      const failure = error as (Error & { code?: number | string, killed?: boolean, signal?: NodeJS.Signals }) | null
      const exitCode = typeof failure?.code === 'number' ? failure.code : error ? null : 0
      const timedOut = Boolean(failure?.killed && failure.signal)
      resolve({
        ...(error ? { error: error.message } : {}),
        exitCode,
        stderr: stderr ?? '',
        stdout: stdout ?? '',
        succeeded: !error,
        timedOut,
      })
    })
  })
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
