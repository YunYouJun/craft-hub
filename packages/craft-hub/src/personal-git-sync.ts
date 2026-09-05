import type { CraftHubSettingsService, SettingsExportEnvelope } from './settings'
import type { PortableWorkspaceSnapshot } from './types'
import type { WorkspaceService } from './workspaces'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { PersonalConfigRepository } from './personal-config-repository'
import { settingsExportFormatVersion } from './settings'

const execFileAsync = promisify(execFile)

export interface PersonalGitSyncTarget {
  repositoryPath: string
  directory: string
}

export type PersonalGitSyncState = 'unconfigured' | 'clean' | 'local-ahead' | 'repository-ahead' | 'conflict'

export interface PersonalGitSyncStatus {
  state: PersonalGitSyncState
  target?: PersonalGitSyncTarget
  snapshotPath?: string
  localRevision?: string
  repositoryRevision?: string
  workingTreeChanged?: boolean
}

export type PersonalGitSyncResolution = 'auto' | 'use-local' | 'use-repository'

interface PersonalGitSyncConfiguration {
  directory?: string
  /** Removed after migrating early-alpha state to PersonalConfigRepository. */
  target?: PersonalGitSyncTarget
  schemaVersion: 1
  lastRevision?: string
}

interface PersonalPortableSnapshot {
  schemaVersion: 1
  settings: SettingsExportEnvelope
  workspaces: PortableWorkspaceSnapshot
}

/** Synchronize allowlisted Personal configuration through a user-selected local Git checkout. */
export class PersonalGitSyncService {
  private readonly configurationPath: string
  private readonly repository: PersonalConfigRepository

  constructor(
    dataDir: string,
    private readonly settings: CraftHubSettingsService,
    private readonly workspaces: WorkspaceService,
    repository?: PersonalConfigRepository,
  ) {
    this.configurationPath = join(dataDir, 'personal-git-sync.json')
    this.repository = repository ?? new PersonalConfigRepository(dataDir)
  }

  /** Select a local Git checkout without copying credentials or repository metadata. */
  async configure(input: { repositoryPath: string, directory?: string }): Promise<PersonalGitSyncStatus> {
    if (!input.repositoryPath.trim())
      throw new Error('Git repository path is required')
    const directory = normalizeDirectory(input.directory ?? '.craft-hub')
    const current = await this.configuration()
    const previousRepository = await this.repository.status()
    const selectedRepository = await this.repository.configure(input.repositoryPath)
    const repositoryPath = selectedRepository.repositoryPath
    const target = { repositoryPath, directory }
    await this.safeSnapshotPath(target)
    await this.saveConfiguration({
      schemaVersion: 1,
      directory,
      lastRevision: previousRepository.repositoryPath === repositoryPath && current.directory === directory
        ? current.lastRevision
        : undefined,
    })
    return this.status()
  }

  /** Inspect semantic divergence without changing files or running network Git operations. */
  async status(): Promise<PersonalGitSyncStatus> {
    const configuration = await this.configuration()
    const repository = await this.repository.status()
    if (!configuration.directory || !repository.repositoryPath)
      return { state: 'unconfigured' }
    const target = { repositoryPath: repository.repositoryPath, directory: configuration.directory }
    const local = await this.localSnapshot()
    const localRevision = snapshotRevision(local)
    const snapshotPath = await this.safeSnapshotPath(target)
    const repositorySnapshot = await readSnapshot(snapshotPath)
    const repositoryRevision = repositorySnapshot ? snapshotRevision(repositorySnapshot) : undefined
    return {
      state: syncState(localRevision, repositoryRevision, configuration.lastRevision),
      target,
      snapshotPath,
      localRevision,
      repositoryRevision,
      workingTreeChanged: await gitPathChanged(target, snapshotPath),
    }
  }

  /** Synchronize automatically when one side changed, or resolve a divergence explicitly. */
  async synchronize(resolution: PersonalGitSyncResolution = 'auto'): Promise<PersonalGitSyncStatus> {
    const configuration = await this.configuration()
    const repository = await this.repository.status()
    if (!configuration.directory || !repository.repositoryPath)
      throw new Error('Personal Git sync is not configured')
    const target = { repositoryPath: repository.repositoryPath, directory: configuration.directory }
    const status = await this.status()
    if (status.state === 'conflict' && resolution === 'auto')
      throw new Error('Personal Git sync has diverged. Choose local or repository configuration.')
    if (status.state === 'clean')
      return status

    const useRepository = resolution === 'use-repository' || (resolution === 'auto' && status.state === 'repository-ahead')
    let revision: string
    if (useRepository) {
      const snapshot = await readSnapshot(await this.safeSnapshotPath(target))
      if (!snapshot)
        throw new Error('The selected Git repository does not contain a Personal snapshot')
      await this.applySnapshot(snapshot)
      revision = snapshotRevision(snapshot)
    }
    else {
      const snapshot = await this.localSnapshot()
      const snapshotPath = await this.safeSnapshotPath(target, true)
      await writeJsonAtomic(snapshotPath, snapshot)
      revision = snapshotRevision(snapshot)
    }
    await this.saveConfiguration({ ...configuration, lastRevision: revision })
    return this.status()
  }

  private async localSnapshot(): Promise<PersonalPortableSnapshot> {
    return {
      schemaVersion: 1,
      settings: await this.settings.export('minimal'),
      workspaces: await this.workspaces.portableSnapshot(),
    }
  }

  private async applySnapshot(snapshot: PersonalPortableSnapshot): Promise<void> {
    validateSnapshot(snapshot)
    await this.workspaces.replacePortableSnapshot(snapshot.workspaces)
    const currentSettings = await this.settings.get()
    await this.settings.import(snapshot.settings, 'merge', currentSettings.revision)
  }

  private snapshotPath(target: PersonalGitSyncTarget): string {
    return join(target.repositoryPath, target.directory, 'personal.snapshot.json')
  }

  private async safeSnapshotPath(target: PersonalGitSyncTarget, createDirectory = false): Promise<string> {
    const directory = join(target.repositoryPath, target.directory)
    if (createDirectory)
      await mkdir(directory, { recursive: true })
    const existing = await nearestExistingPath(directory)
    const [repositoryPath, resolved] = await Promise.all([realpath(target.repositoryPath), realpath(existing)])
    const location = relative(repositoryPath, resolved)
    if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))
      throw new Error('Git sync directory resolves outside the selected repository')
    return this.snapshotPath(target)
  }

  private async configuration(): Promise<PersonalGitSyncConfiguration> {
    try {
      const value = JSON.parse(await readFile(this.configurationPath, 'utf8')) as PersonalGitSyncConfiguration
      if (value.schemaVersion !== 1 || (value.directory !== undefined && typeof value.directory !== 'string'))
        throw new Error('Unsupported Personal Git sync schema')
      if (value.target) {
        const currentRepository = await this.repository.status()
        if (!currentRepository.repositoryPath)
          await this.repository.configure(value.target.repositoryPath)
        const migrated = {
          schemaVersion: 1 as const,
          directory: normalizeDirectory(value.target.directory),
          lastRevision: currentRepository.repositoryPath && currentRepository.repositoryPath !== value.target.repositoryPath
            ? undefined
            : value.lastRevision,
        }
        await this.saveConfiguration(migrated)
        return migrated
      }
      return value
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { schemaVersion: 1 }
      throw error
    }
  }

  private saveConfiguration(configuration: PersonalGitSyncConfiguration): Promise<void> {
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

async function readSnapshot(path: string): Promise<PersonalPortableSnapshot | undefined> {
  try {
    const snapshot = JSON.parse(await readFile(path, 'utf8')) as PersonalPortableSnapshot
    validateSnapshot(snapshot)
    return snapshot
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
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

function validateSnapshot(value: PersonalPortableSnapshot): void {
  if (value.schemaVersion !== 1 || value.workspaces?.schemaVersion !== 1 || !Array.isArray(value.workspaces.workspaces))
    throw new Error('Unsupported Personal Git snapshot schema')
  if (!value.settings || value.settings.formatVersion !== settingsExportFormatVersion)
    throw new Error('Personal Git snapshot settings are invalid')
}

function snapshotRevision(snapshot: PersonalPortableSnapshot): string {
  const portable = JSON.parse(JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    settings: { formatVersion: snapshot.settings.formatVersion, settings: snapshot.settings.settings },
    workspaces: snapshot.workspaces,
  })) as unknown
  return createHash('sha256').update(stableStringify(portable)).digest('hex')
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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}
