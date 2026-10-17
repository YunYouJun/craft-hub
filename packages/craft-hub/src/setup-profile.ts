import type { ConfigurationManagementPage } from './configuration-management'
import type { SoftwareCatalogSnapshot } from './software-catalog'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { softwareMetadataSchema } from './software-catalog'

const identifier = z.string().trim().min(1).max(256).refine(value => !/(?:^|:)(?:[/\\]|[a-z]:)/i.test(value) && !/[\r\n\0]/.test(value), 'Use a portable identifier')
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
const softwareSelection = z.object({ sourceId: identifier, softwareId: identifier }).strict()
const configurationSelection = z.object({ integrationId: identifier, itemId: identifier }).strict()
const softwareReference = softwareSelection.extend({
  title: softwareMetadataSchema.shape.title,
  url: softwareMetadataSchema.shape.url,
  installation: softwareMetadataSchema.shape.installation,
}).strict()
const configurationReference = configurationSelection.extend({
  title: z.string().min(1).max(256),
  kind: z.enum(['terminal', 'mcp', 'skill', 'instructions']),
  origin: z.enum(['public', 'private']),
  sourceDigest: revisionSchema,
}).strict()
const softwareKey = (value: z.infer<typeof softwareSelection>): string => JSON.stringify([value.sourceId, value.softwareId])
const configurationKey = (value: z.infer<typeof configurationSelection>): string => JSON.stringify([value.integrationId, value.itemId])
const unique = <T>(values: T[], key: (value: T) => string): boolean => new Set(values.map(key)).size === values.length

/** Desired software and managed source references; configuration contents and machine state stay local. */
export const setupProfileSchema = z.object({
  version: z.literal(1),
  platform: z.literal('darwin'),
  name: z.string().trim().min(1).max(80),
  software: z.array(softwareReference).max(50).refine(values => unique(values, softwareKey), 'Duplicate software selection'),
  configurations: z.array(configurationReference).max(100).refine(values => unique(values, configurationKey), 'Duplicate configuration selection'),
}).strict().refine(profile => profile.software.length + profile.configurations.length > 0, 'Select software or managed configuration')

/** All changes require the current local revision; importing never executes the profile. */
export const setupProfileCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), revision: revisionSchema, name: z.string().trim().min(1).max(80), software: z.array(softwareSelection).max(50), configurations: z.array(configurationSelection).max(100) }).strict(),
  z.object({ operation: z.literal('import'), revision: revisionSchema, profile: setupProfileSchema }).strict(),
  z.object({ operation: z.literal('review') }).strict(),
  z.object({ operation: z.literal('inventory') }).strict(),
])

/** One portable desired environment, independently of any host's observations. */
export type SetupProfile = z.infer<typeof setupProfileSchema>
/** Validated local profile operation, without an execution command surface. */
export type SetupProfileCommand = z.infer<typeof setupProfileCommandSchema>
/** Revision used to prevent replacing another client's saved choices. */
export interface SetupProfileSnapshot { version: 1, revision: string, profile: SetupProfile | null }
/** Selectable catalog reference with its latest bounded local observation. */
export interface SetupProfileSoftware { reference: SetupProfile['software'][number], status: 'detected' | 'not-detected' | 'unknown', canInstall: boolean }
/** Selectable global source reference and its existing review destination. */
export interface SetupProfileConfiguration { reference: SetupProfile['configurations'][number], status: string, href: string }
/** Read-only source inventory; unavailable providers retain their identities. */
export interface SetupProfileInventory {
  software: SetupProfileSoftware[]
  configurations: SetupProfileConfiguration[]
  unavailableIntegrations: string[]
}
/** Unknown or changed observations never establish target readiness. */
export type SetupProfileResolution = 'ready' | 'missing' | 'review' | 'changed' | 'unavailable' | 'unknown'
/** Current comparison and navigation only; actual plans remain provider-owned. */
export interface SetupProfileReview {
  snapshot: SetupProfileSnapshot
  software: { reference: SetupProfile['software'][number], state: SetupProfileResolution, canInstall: boolean }[]
  configurations: { reference: SetupProfile['configurations'][number], state: SetupProfileResolution, href?: string }[]
}
/** Host-resolved global configuration source; omission of page records a failed read. */
export interface SetupConfigurationSource { integrationId: string, href: string, page?: ConfigurationManagementPage }

const fileQueues = new Map<string, Promise<unknown>>()

/** Controlled persistence and selection failures, without leaking provider output. */
export class SetupProfileError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

/** Save portable intent and compare it with fresh target observations; providers retain every write. */
export class SetupProfileService {
  private readonly path: string

  constructor(dataDir: string, private readonly software: () => Promise<SoftwareCatalogSnapshot>, private readonly configurations: () => Promise<SetupConfigurationSource[]>, private readonly local = true) {
    this.path = join(dataDir, 'setup-profile.v1.json')
  }

  /** Read the one locally saved profile without inspecting tools or contacting sources. */
  async snapshot(): Promise<SetupProfileSnapshot> {
    this.assertLocal()
    let profile: SetupProfile | null = null
    try {
      const file = await open(this.path, 'r')
      try {
        if ((await file.stat()).size > 256 * 1024)
          throw new Error('Oversized profile')
        profile = setupProfileSchema.parse(JSON.parse(await file.readFile('utf8')))
      }
      finally { await file.close() }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new SetupProfileError(409, 'The saved environment profile is invalid. Preserve it and repair it before saving.')
    }
    return { version: 1, revision: digest(profile), profile }
  }

  /** Discover selectable software and managed global configuration without importing file contents. */
  async inventory(): Promise<SetupProfileInventory> {
    this.assertLocal()
    const [catalog, sources] = await Promise.all([this.software(), this.configurations()])
    const software: SetupProfileSoftware[] = catalog.sources.flatMap(source => source.items.map(item => ({
      reference: softwareReference.parse({ sourceId: source.id, softwareId: item.id, title: item.title, url: item.url, installation: item.installation }),
      status: item.status,
      canInstall: source.canManage === true && item.canInstall === true,
    })))
    const configurations: SetupProfileConfiguration[] = []
    for (const source of sources) {
      for (const item of source.page?.items ?? []) {
        if (item.owner !== 'user' || item.scope === 'project' || !item.sourcePath || !['public', 'private'].includes(item.origin)
          || item.source === '(absent)' || ['error', 'read-only', 'unmanaged'].includes(item.status)) {
          continue
        }
        const reference = configurationReference.safeParse({ integrationId: source.integrationId, itemId: item.id, title: item.title, kind: item.kind, origin: item.origin, sourceDigest: digest([item.kind, item.origin, item.source]) })
        if (reference.success)
          configurations.push({ reference: reference.data, status: item.status, href: source.href })
      }
    }
    return { software, configurations, unavailableIntegrations: sources.filter(source => !source.page).map(source => source.integrationId) }
  }

  /** Capture explicit selections from current providers; no browser-supplied metadata is trusted. */
  async save(command: Extract<SetupProfileCommand, { operation: 'save' }>): Promise<SetupProfileSnapshot> {
    this.assertLocal()
    const input = setupProfileCommandSchema.parse(command)
    if (input.operation !== 'save')
      throw new SetupProfileError(400, 'Unsupported profile operation')
    const inventory = await this.inventory()
    const software = input.software.map(selection => inventory.software.find(item => softwareKey(item.reference) === softwareKey(selection))?.reference)
    const configurations = input.configurations.map(selection => inventory.configurations.find(item => item.status === 'synced' && configurationKey(item.reference) === configurationKey(selection))?.reference)
    if (software.some(item => !item) || configurations.some(item => !item))
      throw new SetupProfileError(409, 'Refresh software and synchronize selected configuration with its source before saving.')
    const profile = setupProfileSchema.parse({ version: 1, platform: 'darwin', name: input.name, software, configurations })
    return this.persist(profile, input.revision)
  }

  /** Validate and save portable intent only; target paths, trust and configuration are untouched. */
  async import(profile: unknown, revision: string): Promise<SetupProfileSnapshot> {
    this.assertLocal()
    return this.persist(setupProfileSchema.parse(profile), revisionSchema.parse(revision))
  }

  /** Recheck the target, preserving unknown, changed and unavailable states rather than claiming readiness. */
  async review(): Promise<SetupProfileReview> {
    const [snapshot, inventory] = await Promise.all([this.snapshot(), this.inventory()])
    return {
      snapshot,
      software: (snapshot.profile?.software ?? []).map((reference) => {
        const current = inventory.software.find(item => softwareKey(item.reference) === softwareKey(reference))
        const matches = current && digest([current.reference.url, current.reference.installation]) === digest([reference.url, reference.installation])
        const state: SetupProfileResolution = !current ? 'unavailable' : !matches ? 'changed' : current.status === 'detected' ? 'ready' : current.status === 'not-detected' ? 'missing' : 'unknown'
        return { reference, state, canInstall: state === 'missing' && current?.canInstall === true }
      }),
      configurations: (snapshot.profile?.configurations ?? []).map((reference) => {
        const current = inventory.configurations.find(item => configurationKey(item.reference) === configurationKey(reference))
        const state: SetupProfileResolution = !current ? 'unavailable' : current.reference.sourceDigest !== reference.sourceDigest ? 'changed' : current.status === 'synced' ? 'ready' : 'review'
        return { reference, state, ...(current ? { href: current.href } : {}) }
      }),
    }
  }

  private assertLocal(): void {
    if (!this.local)
      throw new SetupProfileError(403, 'Environment profiles require a local workbench')
  }

  private persist(profile: SetupProfile, revision: string): Promise<SetupProfileSnapshot> {
    const previous = fileQueues.get(this.path) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(() => this.write(profile, revision))
    fileQueues.set(this.path, operation)
    void operation.finally(() => {
      if (fileQueues.get(this.path) === operation)
        fileQueues.delete(this.path)
    }).catch(() => {})
    return operation
  }

  private async write(profile: SetupProfile, revision: string): Promise<SetupProfileSnapshot> {
    const contents = `${JSON.stringify(profile, null, 2)}\n`
    if (Buffer.byteLength(contents) > 256 * 1024)
      throw new SetupProfileError(400, 'The environment profile exceeds 256 KiB. Select fewer items before saving.')
    await mkdir(dirname(this.path), { recursive: true })
    // SQLite holds only an OS lock, no profile data; process exit releases it automatically.
    const lockPath = `${this.path}.lock.sqlite`
    let lock: DatabaseSync | undefined
    try {
      lock = new DatabaseSync(lockPath)
      await chmod(lockPath, 0o600)
      lock.exec('BEGIN IMMEDIATE')
    }
    catch {
      lock?.close()
      throw new SetupProfileError(409, 'Another process is saving the environment profile, or its state directory is unavailable. Retry after checking it.')
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      if ((await this.snapshot()).revision !== revision)
        throw new SetupProfileError(409, 'The environment profile changed. Reload before saving.')
      // Write the validated shape only, never an imported document with extra machine fields.
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(contents, 'utf8')
        await file.sync()
      }
      finally { await file.close() }
      await rename(temporary, this.path)
      return { version: 1, revision: digest(profile), profile }
    }
    finally {
      try {
        await rm(temporary, { force: true })
      }
      finally { lock.close() }
    }
  }
}
