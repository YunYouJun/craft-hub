import type { FSWatcher } from 'chokidar'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { watch } from 'chokidar'
import { z } from 'zod'
import { craftHubVersion } from './version'

/** File name used for editable global settings. */
export const settingsFileName = 'settings.json'
/** File name used for the generated settings schema. */
export const settingsSchemaFileName = 'settings.schema.json'
/** Current portable settings export format. */
export const settingsExportFormatVersion = 1

const localeSchema = z.enum(['en', 'zh-CN'])
const themeSchema = z.enum(['system', 'light', 'dark'])
const localPathSchema = z.string().trim().max(4096).refine(value => !value.includes('\0'), 'Local path cannot contain NUL')
const shortcutsSchema = z.record(z.string(), z.string().trim().min(1).max(64))
const codexReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const codexSettingSchema = z.object({
  model: z.string().trim().min(1).max(128).refine(value => !value.includes('\0'), 'Codex model cannot contain NUL').optional(),
  reasoningEffort: codexReasoningEffortSchema.optional(),
}).strict()
const editorIdSchema = z.enum(['vscode', 'cursor', 'custom'])
const customEditorSchema = z.object({
  name: z.string().trim().min(1).max(64),
  command: z.string().trim().min(1).max(1024).refine(value => !value.includes('\0'), 'Editor command cannot contain NUL'),
  args: z.array(z.string().max(4096).refine(value => !value.includes('\0'), 'Editor argument cannot contain NUL')).max(32),
}).strict().refine(value => value.args.some(argument => argument.includes('{path}')), {
  message: 'Custom editor arguments must include {path}',
  path: ['args'],
})
const editorSettingSchema = z.object({
  default: editorIdSchema,
  custom: customEditorSchema.optional(),
}).strict().refine(value => value.default !== 'custom' || value.custom, {
  message: 'Custom editor configuration is required when it is the default',
  path: ['custom'],
})
const coreSettingsSchema = z.object({
  'workbench.codex': codexSettingSchema.optional(),
  'workbench.editor': editorSettingSchema.optional(),
  'workbench.locale': localeSchema.optional(),
  'workbench.repositoriesRoot': localPathSchema.optional(),
  'workbench.theme': themeSchema.optional(),
  'workbench.shortcuts': shortcutsSchema.optional(),
}).strict()

const exportEnvelopeSchema = z.object({
  $schema: z.string().optional(),
  formatVersion: z.literal(settingsExportFormatVersion),
  exportMode: z.enum(['minimal', 'full']),
  exportedAt: z.string(),
  applicationVersion: z.string(),
  settings: z.record(z.string(), z.unknown()),
}).strict()

/** Locale supported by the core workbench. */
export type WorkbenchLocale = z.infer<typeof localeSchema>
/** Theme preference supported by the core workbench. */
export type WorkbenchTheme = z.infer<typeof themeSchema>
/** Reasoning effort values supported by the bundled Codex SDK. */
export type WorkbenchCodexReasoningEffort = z.infer<typeof codexReasoningEffortSchema>
/** Optional overrides for Craft Hub-managed Codex tasks. */
export type WorkbenchCodexSetting = z.infer<typeof codexSettingSchema>
/** Stable identifiers for built-in and user-defined editor launchers. */
export type WorkbenchEditorId = z.infer<typeof editorIdSchema>
/** A shell-free custom editor command and its arguments. */
export type WorkbenchCustomEditor = z.infer<typeof customEditorSchema>
/** Editor launcher preference shared by projects and workspaces. */
export type WorkbenchEditorSetting = z.infer<typeof editorSettingSchema>
/** Breadth of settings included in a portable export. */
export type SettingsExportMode = 'minimal' | 'full'
/** Strategy used when importing settings. */
export type SettingsImportStrategy = 'merge' | 'replace'

/** Effective core settings. */
export interface CraftHubSettings {
  /** Empty values inherit the user's Codex configuration. */
  'workbench.codex': WorkbenchCodexSetting
  'workbench.editor': WorkbenchEditorSetting
  'workbench.locale': WorkbenchLocale
  /** Optional local starting directory for repository and project folder pickers. */
  'workbench.repositoriesRoot': string
  /** Keyboard shortcuts keyed by stable workbench action identifier. */
  'workbench.shortcuts': Record<string, string>
  'workbench.theme': WorkbenchTheme
}

/** Effective settings plus persistence metadata. */
export interface SettingsSnapshot {
  diagnostic?: string
  explicitKeys: string[]
  path: string
  revision: string
  settings: CraftHubSettings
}

/** Portable settings export envelope. */
export interface SettingsExportEnvelope {
  $schema: string
  applicationVersion: string
  exportedAt: string
  exportMode: SettingsExportMode
  formatVersion: 1
  settings: Record<string, unknown>
}

/** One proposed settings import change. */
export interface SettingsChange {
  after?: unknown
  before?: unknown
  key: string
  type: 'add' | 'change' | 'remove'
}

/** Validated preview of a settings import. */
export interface SettingsImportPreview {
  changes: SettingsChange[]
  ignored: string[]
  strategy: SettingsImportStrategy
  warnings: string[]
}

/** Raised when optimistic settings concurrency fails. */
export class SettingsConflictError extends Error {
  constructor(readonly expectedRevision: string, readonly actualRevision: string) {
    super('Settings changed since they were last read')
    this.name = 'SettingsConflictError'
  }
}

/** Raised when persisted or imported settings are invalid. */
export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsValidationError'
  }
}

interface ValidatedSettingsFile {
  extensions: Record<string, unknown>
  explicit: Partial<CraftHubSettings>
}

const defaultSettings: CraftHubSettings = {
  'workbench.codex': {},
  'workbench.editor': { default: 'vscode' },
  'workbench.locale': 'en',
  'workbench.repositoriesRoot': '',
  'workbench.shortcuts': { 'workbench.showCommandPalette': 'Mod+K' },
  'workbench.theme': 'system',
}

function stableSettingsValue(explicit: Partial<CraftHubSettings>, extensions: Record<string, unknown>): Record<string, unknown> {
  return {
    $schema: `./${settingsSchemaFileName}`,
    ...explicit,
    ...Object.fromEntries(Object.entries(extensions).sort(([left], [right]) => left.localeCompare(right))),
  }
}

function revisionFor(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

function validateSettingsFile(input: unknown): ValidatedSettingsFile {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new SettingsValidationError('Settings must be a JSON object')
  const record = input as Record<string, unknown>
  const knownKeys = new Set(['workbench.codex', 'workbench.editor', 'workbench.locale', 'workbench.repositoriesRoot', 'workbench.theme', 'workbench.shortcuts'])
  const known = Object.fromEntries(Object.entries(record).filter(([key]) => knownKeys.has(key)))
  const parsed = coreSettingsSchema.parse(known)
  const extensions: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === '$schema' || knownKeys.has(key))
      continue
    if (!key.startsWith('extensions.'))
      throw new SettingsValidationError(`Unknown core setting: ${key}`)
    extensions[key] = value
  }
  return { explicit: parsed, extensions }
}

function settingsJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(coreSettingsSchema, { target: 'draft-2020-12' }) as Record<string, unknown>
  return {
    ...generated,
    $id: 'https://craft-hub.dev/schemas/settings.schema.json',
    title: 'Craft Hub user settings',
    description: 'Global Craft Hub preferences stored in the operating-system data directory.',
    properties: {
      $schema: { type: 'string', description: 'Path to this JSON Schema.' },
      ...generated.properties as Record<string, unknown>,
    },
    patternProperties: {
      '^extensions\\.[^.]+\\..+$': {},
    },
    additionalProperties: false,
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return undefined
    throw error
  }
}

/** Owns validated global settings, import/export, and external file change observation. */
export class CraftHubSettingsService {
  readonly path: string
  readonly schemaPath: string
  private readonly lastGoodPath: string
  private explicit: Partial<CraftHubSettings> = {}
  private extensions: Record<string, unknown> = {}
  private diagnostic: string | undefined
  private initialized = false
  private watcher: FSWatcher | undefined
  private readonly listeners = new Set<(snapshot: SettingsSnapshot) => void>()
  private writeTail: Promise<void> = Promise.resolve()

  constructor(readonly dataDir: string, readonly applicationVersion = craftHubVersion) {
    this.path = join(dataDir, settingsFileName)
    this.schemaPath = join(dataDir, settingsSchemaFileName)
    this.lastGoodPath = join(dataDir, 'settings.last-good.json')
  }

  /** Read the current effective settings and optimistic-concurrency revision. */
  async get(): Promise<SettingsSnapshot> {
    await this.initialize()
    return this.snapshot()
  }

  /** Return the editor schema written next to settings.json. */
  schema(): Record<string, unknown> {
    return settingsJsonSchema()
  }

  /** Ensure the editable settings file exists and return its absolute path. */
  async ensureFile(): Promise<string> {
    await this.initialize()
    try {
      await readFile(this.path)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      await writeJsonAtomic(this.path, stableSettingsValue(this.explicit, this.extensions))
    }
    return this.path
  }

  /** Update explicit settings after checking the caller's revision. Null resets a key to its default. */
  async update(patch: Record<string, unknown>, expectedRevision: string): Promise<SettingsSnapshot> {
    return this.enqueueWrite(async () => {
      await this.initialize()
      this.assertRevision(expectedRevision)
      const candidate = { ...this.explicit, ...this.extensions } as Record<string, unknown>
      for (const [key, value] of Object.entries(patch)) {
        if (value === null)
          delete candidate[key]
        else
          candidate[key] = value
      }
      const validated = validateSettingsFile(candidate)
      await this.persist(validated)
      return this.snapshot()
    })
  }

  /** Create a portable, versioned settings export. */
  async export(mode: SettingsExportMode): Promise<SettingsExportEnvelope> {
    await this.initialize()
    const settings = mode === 'minimal'
      ? { ...this.explicit, ...this.extensions }
      : { ...defaultSettings, ...this.explicit, ...this.extensions }
    return {
      $schema: 'https://craft-hub.dev/schemas/settings-export.schema.json',
      formatVersion: settingsExportFormatVersion,
      exportMode: mode,
      exportedAt: new Date().toISOString(),
      applicationVersion: this.applicationVersion,
      settings,
    }
  }

  /** Validate an import and describe its effect without changing settings. */
  async previewImport(document: unknown, strategy: SettingsImportStrategy): Promise<SettingsImportPreview> {
    await this.initialize()
    const envelope = exportEnvelopeSchema.parse(document)
    const imported = validateSettingsFile(envelope.settings)
    const candidate: Record<string, unknown> = strategy === 'merge'
      ? { ...this.explicit, ...this.extensions, ...imported.explicit, ...imported.extensions }
      : { ...imported.explicit, ...imported.extensions }
    const before: Record<string, unknown> = { ...this.explicit, ...this.extensions }
    const keys = [...new Set([...Object.keys(before), ...Object.keys(candidate)])].sort()
    const changes = keys.flatMap((key): SettingsChange[] => {
      if (!(key in before))
        return [{ key, type: 'add', after: candidate[key] }]
      if (!(key in candidate))
        return [{ key, type: 'remove', before: before[key] }]
      if (JSON.stringify(before[key]) !== JSON.stringify(candidate[key]))
        return [{ key, type: 'change', before: before[key], after: candidate[key] }]
      return []
    })
    const ignored = Object.keys(imported.extensions)
    return {
      strategy,
      changes,
      ignored,
      warnings: ignored.length ? ['Extension settings are preserved but are not active in this version.'] : [],
    }
  }

  /** Apply a previously previewable import atomically, backing up replace operations. */
  async import(document: unknown, strategy: SettingsImportStrategy, expectedRevision: string): Promise<SettingsSnapshot> {
    return this.enqueueWrite(async () => {
      await this.initialize()
      this.assertRevision(expectedRevision)
      const envelope = exportEnvelopeSchema.parse(document)
      const imported = validateSettingsFile(envelope.settings)
      if (strategy === 'replace')
        await this.backupCurrentFile()
      const validated = strategy === 'merge'
        ? validateSettingsFile({ ...this.explicit, ...this.extensions, ...imported.explicit, ...imported.extensions })
        : imported
      await this.persist(validated)
      return this.snapshot()
    })
  }

  /** Subscribe to valid settings changes, including external file edits. */
  onChanged(listener: (snapshot: SettingsSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Watch the public settings file for external edits. */
  async startWatching(): Promise<void> {
    await this.initialize()
    if (this.watcher)
      return
    const watchPath = join(await realpath(this.dataDir), settingsFileName)
    this.watcher = watch(watchPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 } })
    this.watcher.on('add', () => void this.reloadFromDisk())
    this.watcher.on('change', () => void this.reloadFromDisk())
    this.watcher.on('unlink', () => void this.reloadFromDisk())
  }

  /** Stop watching the settings file. */
  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = undefined
  }

  private async initialize(): Promise<void> {
    if (this.initialized)
      return
    await mkdir(this.dataDir, { recursive: true })
    await writeJsonAtomic(this.schemaPath, settingsJsonSchema())
    try {
      const input = await readJson(this.path)
      if (input !== undefined) {
        const validated = validateSettingsFile(input)
        this.explicit = validated.explicit
        this.extensions = validated.extensions
        await writeJsonAtomic(this.lastGoodPath, stableSettingsValue(this.explicit, this.extensions))
      }
    }
    catch (error) {
      this.diagnostic = error instanceof Error ? error.message : String(error)
      const lastGood = await readJson(this.lastGoodPath)
      if (lastGood !== undefined) {
        const validated = validateSettingsFile(lastGood)
        this.explicit = validated.explicit
        this.extensions = validated.extensions
      }
    }
    this.initialized = true
  }

  private snapshot(): SettingsSnapshot {
    const raw = stableSettingsValue(this.explicit, this.extensions)
    return {
      ...(this.diagnostic ? { diagnostic: this.diagnostic } : {}),
      explicitKeys: [...Object.keys(this.explicit), ...Object.keys(this.extensions)].sort(),
      path: this.path,
      revision: revisionFor(raw),
      settings: { ...defaultSettings, ...this.explicit },
    }
  }

  private assertRevision(expectedRevision: string): void {
    if (this.diagnostic)
      throw new SettingsValidationError(`Settings file is invalid and was not overwritten: ${this.diagnostic}`)
    const actualRevision = this.snapshot().revision
    if (expectedRevision !== actualRevision)
      throw new SettingsConflictError(expectedRevision, actualRevision)
  }

  private async persist(validated: ValidatedSettingsFile): Promise<void> {
    const value = stableSettingsValue(validated.explicit, validated.extensions)
    await writeJsonAtomic(this.path, value)
    await writeJsonAtomic(this.lastGoodPath, value)
    this.explicit = validated.explicit
    this.extensions = validated.extensions
    this.diagnostic = undefined
    this.emit()
  }

  private async reloadFromDisk(): Promise<void> {
    try {
      const input = await readJson(this.path)
      const validated = input === undefined ? { explicit: {}, extensions: {} } : validateSettingsFile(input)
      const nextRevision = revisionFor(stableSettingsValue(validated.explicit, validated.extensions))
      if (nextRevision === this.snapshot().revision && !this.diagnostic)
        return
      this.explicit = validated.explicit
      this.extensions = validated.extensions
      this.diagnostic = undefined
      await writeJsonAtomic(this.lastGoodPath, stableSettingsValue(this.explicit, this.extensions))
      this.emit()
    }
    catch (error) {
      const diagnostic = error instanceof Error ? error.message : String(error)
      if (diagnostic === this.diagnostic)
        return
      this.diagnostic = diagnostic
      this.emit()
    }
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners)
      listener(snapshot)
  }

  private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeTail.then(operation)
    this.writeTail = result.then(() => {}, () => {})
    return result
  }

  private async backupCurrentFile(): Promise<void> {
    try {
      await readFile(this.path)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return
      throw error
    }
    const backupDir = join(this.dataDir, 'settings-backups')
    await mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(':', '-')
    await copyFile(this.path, join(backupDir, `settings.${stamp}.json`))
    const backups = (await readdir(backupDir)).filter(name => name.startsWith('settings.') && name.endsWith('.json')).sort().reverse()
    await Promise.all(backups.slice(5).map(name => rm(join(backupDir, basename(name)))))
  }
}
