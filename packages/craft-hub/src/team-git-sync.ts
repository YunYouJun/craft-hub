import type { OwnerScopeService } from './owner-scopes'
import type { PersonalGitSyncResolution, PersonalGitSyncState, PersonalGitSyncTarget } from './personal-git-sync'
import type { OwnerScope, PortableWorkspaceSnapshot } from './types'
import type { WorkspaceService } from './workspaces'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface TeamGitSyncStatus {
  ownerScopeId: string
  state: PersonalGitSyncState
  target?: PersonalGitSyncTarget
  snapshotPath?: string
  localRevision?: string
  repositoryRevision?: string
  workingTreeChanged?: boolean
}

interface TeamGitSyncEntry {
  target: PersonalGitSyncTarget
  lastRevision?: string
}

/** Recoverable local configuration removed during Team lifecycle cleanup. */
export interface TeamGitSyncConfigurationReceipt {
  entry?: TeamGitSyncEntry
  snapshotPath?: string
}

interface TeamGitSyncConfiguration {
  schemaVersion: 1
  teams: Record<string, TeamGitSyncEntry>
}

interface TeamPortableSnapshot {
  schemaVersion: 1
  ownerScope: OwnerScope
  workspaces: PortableWorkspaceSnapshot
}

/** Synchronize each Team's portable workspaces through its selected local Git checkout. */
export class TeamGitSyncService {
  private readonly configurationPath: string

  constructor(
    dataDir: string,
    private readonly ownerScopes: OwnerScopeService,
    private readonly workspaces: WorkspaceService,
  ) {
    this.configurationPath = join(dataDir, 'team-git-sync.json')
  }

  /** Select a Team Git target without treating the repository as the Team identity. */
  async configure(ownerScopeId: string, input: { repositoryPath: string, directory?: string }): Promise<TeamGitSyncStatus> {
    await this.team(ownerScopeId)
    if (!input.repositoryPath.trim())
      throw new Error('Git repository path is required')
    const repositoryPath = await gitRoot(resolve(input.repositoryPath))
    const directory = normalizeDirectory(input.directory ?? `.craft-hub/teams/${ownerScopeId}`)
    const target = { repositoryPath, directory }
    await this.safeSnapshotPath(ownerScopeId, target)
    const configuration = await this.configuration()
    const current = configuration.teams[ownerScopeId]
    configuration.teams[ownerScopeId] = {
      target,
      lastRevision: current?.target.repositoryPath === repositoryPath && current.target.directory === directory
        ? current.lastRevision
        : undefined,
    }
    await this.saveConfiguration(configuration)
    return this.status(ownerScopeId)
  }

  /** Inspect one Team's semantic divergence without running network Git operations. */
  async status(ownerScopeId: string): Promise<TeamGitSyncStatus> {
    await this.team(ownerScopeId)
    const entry = (await this.configuration()).teams[ownerScopeId]
    if (!entry)
      return { ownerScopeId, state: 'unconfigured' }
    const local = await this.localSnapshot(ownerScopeId)
    const localRevision = snapshotRevision(local)
    const snapshotPath = await this.safeSnapshotPath(ownerScopeId, entry.target)
    const repository = await readSnapshot(snapshotPath, ownerScopeId)
    const repositoryRevision = repository ? snapshotRevision(repository) : undefined
    return {
      ownerScopeId,
      state: syncState(localRevision, repositoryRevision, entry.lastRevision),
      target: entry.target,
      snapshotPath,
      localRevision,
      repositoryRevision,
      workingTreeChanged: await gitPathChanged(entry.target, snapshotPath),
    }
  }

  /** Synchronize one Team automatically or resolve an explicit divergence. */
  async synchronize(ownerScopeId: string, resolution: PersonalGitSyncResolution = 'auto'): Promise<TeamGitSyncStatus> {
    const configuration = await this.configuration()
    const entry = configuration.teams[ownerScopeId]
    if (!entry)
      throw new Error(`Team Git sync is not configured: ${ownerScopeId}`)
    const status = await this.status(ownerScopeId)
    if (status.state === 'conflict' && resolution === 'auto')
      throw new Error('Team Git sync has diverged. Choose local or repository configuration.')
    if (status.state === 'clean')
      return status

    const useRepository = resolution === 'use-repository' || (resolution === 'auto' && status.state === 'repository-ahead')
    let revision: string
    if (useRepository) {
      const snapshot = await readSnapshot(await this.safeSnapshotPath(ownerScopeId, entry.target), ownerScopeId)
      if (!snapshot)
        throw new Error('The selected Git repository does not contain this Team snapshot')
      await this.workspaces.replacePortableSnapshot(snapshot.workspaces, ownerScopeId)
      revision = snapshotRevision(snapshot)
    }
    else {
      const snapshot = await this.localSnapshot(ownerScopeId)
      const snapshotPath = await this.safeSnapshotPath(ownerScopeId, entry.target, true)
      await writeJsonAtomic(snapshotPath, snapshot)
      revision = snapshotRevision(snapshot)
    }
    configuration.teams[ownerScopeId] = { ...entry, lastRevision: revision }
    await this.saveConfiguration(configuration)
    return this.status(ownerScopeId)
  }

  /** Detach a Team from its local checkout without deleting the shared snapshot. */
  async removeConfiguration(ownerScopeId: string): Promise<TeamGitSyncConfigurationReceipt> {
    await this.team(ownerScopeId)
    const configuration = await this.configuration()
    const entry = configuration.teams[ownerScopeId]
    if (!entry)
      return {}
    const snapshotPath = await this.safeSnapshotPath(ownerScopeId, entry.target)
    delete configuration.teams[ownerScopeId]
    await this.saveConfiguration(configuration)
    return { entry, snapshotPath }
  }

  /** Restore a detached Team configuration when lifecycle cleanup rolls back. */
  async restoreConfiguration(ownerScopeId: string, receipt: TeamGitSyncConfigurationReceipt): Promise<void> {
    if (!receipt.entry)
      return
    await this.team(ownerScopeId)
    const configuration = await this.configuration()
    configuration.teams[ownerScopeId] = receipt.entry
    await this.saveConfiguration(configuration)
  }

  private async team(ownerScopeId: string): Promise<OwnerScope> {
    const scope = await this.ownerScopes.get(ownerScopeId)
    if (scope.kind !== 'team')
      throw new Error('Team Git sync requires a Team owner scope')
    return scope
  }

  private async localSnapshot(ownerScopeId: string): Promise<TeamPortableSnapshot> {
    return {
      schemaVersion: 1,
      ownerScope: await this.team(ownerScopeId),
      workspaces: await this.workspaces.portableSnapshot(ownerScopeId),
    }
  }

  private snapshotPath(ownerScopeId: string, target: PersonalGitSyncTarget): string {
    return join(target.repositoryPath, target.directory, `${ownerScopeId}.snapshot.json`)
  }

  private async safeSnapshotPath(ownerScopeId: string, target: PersonalGitSyncTarget, createDirectory = false): Promise<string> {
    const directory = join(target.repositoryPath, target.directory)
    if (createDirectory)
      await mkdir(directory, { recursive: true })
    const existing = await nearestExistingPath(directory)
    const resolved = await realpath(existing)
    const location = relative(target.repositoryPath, resolved)
    if (location === '..' || location.startsWith('../') || isAbsolute(location))
      throw new Error('Git sync directory resolves outside the selected repository')
    return this.snapshotPath(ownerScopeId, target)
  }

  private async configuration(): Promise<TeamGitSyncConfiguration> {
    try {
      const value = JSON.parse(await readFile(this.configurationPath, 'utf8')) as TeamGitSyncConfiguration
      if (value.schemaVersion !== 1 || !value.teams || typeof value.teams !== 'object')
        throw new Error('Unsupported Team Git sync schema')
      return value
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1, teams: {} }
      throw error
    }
  }

  private saveConfiguration(configuration: TeamGitSyncConfiguration): Promise<void> {
    return writeJsonAtomic(this.configurationPath, configuration)
  }
}

function syncState(localRevision: string, repositoryRevision: string | undefined, lastRevision: string | undefined): PersonalGitSyncState {
  if (localRevision === repositoryRevision)
    return 'clean'
  if (!repositoryRevision || repositoryRevision === lastRevision)
    return 'local-ahead'
  if (localRevision === lastRevision)
    return 'repository-ahead'
  return 'conflict'
}

function normalizeDirectory(value: string): string {
  const directory = value.trim().replaceAll('\\', '/').replaceAll(/^\.\//g, '').replaceAll(/\/$/g, '')
  if (!directory || isAbsolute(directory) || directory.split('/').some(part => part === '..' || part === '.git' || !part))
    throw new Error('Git sync directory must be a non-empty relative path without parent traversal')
  return directory
}

async function gitRoot(path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
    return stdout.trim()
  }
  catch {
    throw new Error(`Not a Git repository: ${path}`)
  }
}

async function gitPathChanged(target: PersonalGitSyncTarget, snapshotPath: string): Promise<boolean> {
  const path = relative(target.repositoryPath, snapshotPath)
  try {
    const { stdout } = await execFileAsync('git', ['-C', target.repositoryPath, 'status', '--porcelain', '--', path], { encoding: 'utf8' })
    return Boolean(stdout.trim())
  }
  catch {
    return false
  }
}

async function readSnapshot(path: string, ownerScopeId: string): Promise<TeamPortableSnapshot | undefined> {
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as TeamPortableSnapshot
    validateSnapshot(snapshot, ownerScopeId)
    return snapshot
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

function validateSnapshot(value: TeamPortableSnapshot, ownerScopeId: string): void {
  if (value.schemaVersion !== 1 || value.ownerScope?.kind !== 'team' || value.ownerScope.id !== ownerScopeId)
    throw new Error('Team Git snapshot identity does not match the requested Team')
  if (value.workspaces?.schemaVersion !== 1 || !Array.isArray(value.workspaces.workspaces))
    throw new Error('Unsupported Team Git snapshot schema')
}

function snapshotRevision(snapshot: TeamPortableSnapshot): string {
  return createHash('sha256').update(stableStringify(JSON.parse(JSON.stringify(snapshot)) as unknown)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function nearestExistingPath(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      await realpath(candidate)
      return candidate
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      const parent = dirname(candidate)
      if (parent === candidate)
        throw error
      candidate = parent
    }
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
