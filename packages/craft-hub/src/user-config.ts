import type { FSWatcher } from 'chokidar'
import type { ParseError } from 'jsonc-parser'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { watch } from 'chokidar'
import { applyEdits, modify, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import { parse as parseYaml } from 'yaml'

export const userConfigCatalogFileName = 'config.jsonc'
export const ownerScopesFileName = 'owner-scopes.jsonc'
export const workspaceFileExtension = '.jsonc'
export const userConfigCatalogSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/user-config-v1.schema.json'
export const ownerScopesSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/owner-scopes-v1.schema.json'
export const workspaceSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/craft-hub/main/packages/craft-hub/schema/workspace-v1.schema.json'

const legacyCatalogFileName = 'config.yaml'
const legacyOwnerScopesFileName = 'owner-scopes.yaml'
const legacyWorkspaceFileExtension = '.yaml'

/** One invalid user-authored JSONC file currently served from its last valid value. */
export interface UserConfigDiagnostic {
  message: string
  path: string
}

/** Observable state for the user-editable portable configuration directory. */
export interface UserConfigStatus {
  configDir: string
  diagnostics: UserConfigDiagnostic[]
  files: string[]
  format: 'jsonc'
  migrationBackupPath?: string
}

/** Exact source content paired with its validated domain value. */
export interface UserConfigDocument<T> {
  content: string
  value: T
}

interface CachedDocument {
  content: string
  value: unknown
}

interface MigrationEntry {
  legacyPath: string
  relativeLegacyPath: string
  relativeTargetPath: string
  schemaUrl: string
  targetPath: string
}

type Validator<T> = (value: unknown) => T

/**
 * Own JSONC persistence, migration, diagnostics, and recovery for portable user configuration.
 *
 * Callers provide domain validation while this module preserves comments and last-known-good values.
 */
export class UserConfigService {
  private readonly lastGoodDir: string
  private readonly cache = new Map<string, CachedDocument>()
  private readonly diagnosticMap = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private initialization: Promise<void> | undefined
  private migrationBackupPath: string | undefined
  private watcher: FSWatcher | undefined

  constructor(readonly configDir: string, dataDir: string) {
    this.lastGoodDir = join(dataDir, 'user-config-last-good')
  }

  /** List user-authored JSONC files under one portable configuration subdirectory. */
  async list(directory = ''): Promise<string[]> {
    await this.initialize()
    const absoluteDirectory = this.path(directory)
    try {
      return (await readdir(absoluteDirectory))
        .filter(name => name.endsWith(workspaceFileExtension))
        .sort()
        .map(name => directory ? `${directory}/${name}` : name)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return []
      throw error
    }
  }

  /** Read and validate one JSONC file, retaining its last valid value after invalid external edits. */
  async read<T>(relativePath: string, validate: Validator<T>, fallback?: () => T): Promise<T> {
    return (await this.readSource(relativePath, validate, fallback)).value
  }

  /** Read validated data together with the exact JSONC used for optimistic revisions. */
  async readSource<T>(relativePath: string, validate: Validator<T>, fallback?: () => T): Promise<UserConfigDocument<T>> {
    await this.initialize()
    const path = this.path(relativePath)
    try {
      const content = await readFile(path, 'utf8')
      const value = validate(parseJsoncDocument(content, relativePath))
      const cached = this.cache.get(relativePath)
      this.cache.set(relativePath, { content, value })
      this.diagnosticMap.delete(relativePath)
      if (cached?.content !== content)
        await this.persistLastGood(relativePath, content)
      return { content, value: structuredClone(value) }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache.delete(relativePath)
        this.diagnosticMap.delete(relativePath)
        if (fallback)
          return { content: '', value: fallback() }
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      this.diagnosticMap.set(relativePath, message)
      const cached = this.cache.get(relativePath)
      if (cached)
        return { content: cached.content, value: structuredClone(cached.value) as T }
      const lastGood = await this.readLastGood(relativePath)
      if (lastGood !== undefined) {
        const value = validate(parseJsoncDocument(lastGood, relativePath))
        this.cache.set(relativePath, { content: lastGood, value })
        return { content: lastGood, value: structuredClone(value) }
      }
      throw error
    }
  }

  /** Atomically update known top-level fields while preserving comments and extension data. */
  async write<T>(relativePath: string, value: T, schemaUrl: string, keys: string[], validate: Validator<T>): Promise<void> {
    await this.initialize()
    const path = this.path(relativePath)
    let content: string | undefined
    try {
      content = await readFile(path, 'utf8')
      validate(parseJsoncDocument(content, relativePath))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(`User config ${relativePath} is invalid and was not overwritten: ${error instanceof Error ? error.message : String(error)}`)
    }
    const document = { $schema: schemaUrl, ...value as object } as Record<string, unknown>
    const next = content === undefined
      ? `${JSON.stringify(document, null, 2)}\n`
      : updateJsoncObject(content, document, ['$schema', ...keys])
    const validated = validate(parseJsoncDocument(next, relativePath))
    await writeAtomic(path, next)
    await this.persistLastGood(relativePath, next)
    this.cache.set(relativePath, { content: next, value: validated })
    this.diagnosticMap.delete(relativePath)
  }

  /** Remove one portable file and its machine-local recovery snapshot. */
  async remove(relativePath: string): Promise<void> {
    await this.initialize()
    await rm(this.path(relativePath))
    await rm(this.lastGoodPath(relativePath), { force: true })
    this.cache.delete(relativePath)
    this.diagnosticMap.delete(relativePath)
  }

  /** Return current paths and diagnostics without exposing machine-local recovery content. */
  async status(): Promise<UserConfigStatus> {
    await this.initialize()
    return {
      configDir: this.configDir,
      diagnostics: [...this.diagnosticMap.entries()]
        .map(([relativePath, message]) => ({ path: this.path(relativePath), message }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      files: [
        ...await this.list(),
        ...await this.list('workspaces'),
      ],
      format: 'jsonc',
      ...(this.migrationBackupPath ? { migrationBackupPath: this.migrationBackupPath } : {}),
    }
  }

  /** Subscribe to external changes under the portable configuration directory. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Watch JSONC files after completing the one-time YAML migration. */
  async startWatching(): Promise<void> {
    await this.initialize()
    if (this.watcher)
      return
    this.watcher = watch(this.configDir, {
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
      depth: 1,
      followSymlinks: false,
      ignoreInitial: true,
    })
    const changed = (path: string): void => {
      const relativePath = relative(this.configDir, path).replaceAll('\\', '/')
      if (relativePath === userConfigCatalogFileName || relativePath === ownerScopesFileName || (/^workspaces\/[^/]+\.jsonc$/).test(relativePath))
        this.emit()
    }
    this.watcher.on('add', changed)
    this.watcher.on('change', changed)
    this.watcher.on('unlink', changed)
    await once(this.watcher, 'ready')
  }

  /** Stop watching user configuration files. */
  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = undefined
  }

  private async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce().catch((error) => {
      this.initialization = undefined
      throw error
    })
    await this.initialization
  }

  private async initializeOnce(): Promise<void> {
    await mkdir(this.configDir, { recursive: true })
    await this.migrateLegacyYaml()
  }

  private async migrateLegacyYaml(): Promise<void> {
    const entries: MigrationEntry[] = [
      this.migrationEntry(legacyCatalogFileName, userConfigCatalogFileName, userConfigCatalogSchemaUrl),
      this.migrationEntry(legacyOwnerScopesFileName, ownerScopesFileName, ownerScopesSchemaUrl),
    ]
    try {
      const names = await readdir(this.path('workspaces'))
      entries.push(...names.filter(name => name.endsWith(legacyWorkspaceFileExtension)).map(name => this.migrationEntry(
        `workspaces/${name}`,
        `workspaces/${name.slice(0, -legacyWorkspaceFileExtension.length)}${workspaceFileExtension}`,
        workspaceSchemaUrl,
      )))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
    const existing = await filterExisting(entries)
    if (!existing.length)
      return

    const stamp = new Date().toISOString().replaceAll(':', '-')
    const backupRoot = join(dirname(this.lastGoodDir), 'migration-backups', `global-config-yaml-${stamp}`)
    const pending: Array<{ targetPath: string, temporaryPath: string }> = []
    try {
      for (const entry of existing) {
        if (await fileExists(entry.targetPath))
          continue
        const legacy = parseYaml(await readFile(entry.legacyPath, 'utf8')) as unknown
        if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy))
          throw new Error(`Legacy user config must contain an object: ${entry.relativeLegacyPath}`)
        const content = `${JSON.stringify({ $schema: entry.schemaUrl, ...legacy }, null, 2)}\n`
        parseJsoncDocument(content, entry.relativeTargetPath)
        const temporaryPath = `${entry.targetPath}.${randomUUID()}.migration`
        await mkdir(dirname(temporaryPath), { recursive: true })
        await writeFile(temporaryPath, content, 'utf8')
        pending.push({ targetPath: entry.targetPath, temporaryPath })
      }
      for (const entry of pending)
        await rename(entry.temporaryPath, entry.targetPath)
      for (const entry of existing) {
        const backupPath = join(backupRoot, entry.relativeLegacyPath)
        await mkdir(dirname(backupPath), { recursive: true })
        await rename(entry.legacyPath, backupPath)
      }
      this.migrationBackupPath = backupRoot
    }
    catch (error) {
      await Promise.all(pending.map(entry => rm(entry.temporaryPath, { force: true })))
      throw new Error(`Failed to migrate global Craft Hub YAML to JSONC: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private migrationEntry(relativeLegacyPath: string, relativeTargetPath: string, schemaUrl: string): MigrationEntry {
    return {
      legacyPath: this.path(relativeLegacyPath),
      relativeLegacyPath,
      relativeTargetPath,
      schemaUrl,
      targetPath: this.path(relativeTargetPath),
    }
  }

  private path(relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/')
    if (isAbsolute(normalized) || normalized.split('/').includes('..'))
      throw new Error('User config paths must stay inside the configured directory')
    const path = join(this.configDir, normalized)
    const location = relative(this.configDir, path)
    if (location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location))
      throw new Error('User config paths must stay inside the configured directory')
    return path
  }

  private lastGoodPath(relativePath: string): string {
    const id = createHash('sha256').update(relativePath).digest('hex')
    return join(this.lastGoodDir, `${id}.jsonc`)
  }

  private async persistLastGood(relativePath: string, content: string): Promise<void> {
    await writeAtomic(this.lastGoodPath(relativePath), content)
  }

  private async readLastGood(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(this.lastGoodPath(relativePath), 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return undefined
      throw error
    }
  }

  private emit(): void {
    for (const listener of this.listeners)
      listener()
  }
}

/** Parse JSONC with a stable, user-facing diagnostic. */
export function parseJsoncDocument(content: string, label = 'JSONC document'): unknown {
  const errors: ParseError[] = []
  const value = parseJsonc(content, errors, { allowTrailingComma: true }) as unknown
  if (errors.length)
    throw new Error(`${label}: ${errors.map(error => printParseErrorCode(error.error)).join(', ')}`)
  return value
}

function updateJsoncObject(content: string, value: Record<string, unknown>, keys: string[]): string {
  let next = content
  for (const key of keys) {
    next = applyEdits(next, modify(next, [key], value[key], {
      formattingOptions: { eol: '\n', insertSpaces: true, tabSize: 2 },
    }))
  }
  return next.endsWith('\n') ? next : `${next}\n`
}

async function filterExisting(entries: MigrationEntry[]): Promise<MigrationEntry[]> {
  const checks = await Promise.all(entries.map(async entry => ({ entry, exists: await fileExists(entry.legacyPath) })))
  return checks.filter(check => check.exists).map(check => check.entry)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw error
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}
