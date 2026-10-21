import type { IntegrationEntityPage } from './integrations'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { workItemFieldsSchema, workItemPageFieldsSchema } from './work-items'

const MAX_AGE = 7 * 24 * 60 * 60 * 1000
const MAX_BYTES = 8 * 1024 * 1024
const snapshotSchema = workItemPageFieldsSchema.extend({
  items: z.array(z.object({ id: z.string(), title: z.string() }).passthrough().and(workItemFieldsSchema)),
  currentUser: z.object({ id: z.string(), label: z.string().optional() }).optional(),
})

/** Small display preferences only; never persist submitted connection or action inputs. */
export const integrationFiltersSchema = z.object({
  query: z.string().max(500).default(''),
  status: z.string().max(1000).default('all'),
  assignee: z.string().max(500).default('all'),
}).strict()

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(canonical)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

async function privateWrite(path: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value)
  if (Buffer.byteLength(content) > MAX_BYTES)
    return
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, path)
  }
  finally {
    await rm(temporary, { force: true })
  }
}

async function read(path: string): Promise<unknown> {
  try {
    if ((await stat(path)).size > MAX_BYTES)
      return undefined
    return JSON.parse(await readFile(path, 'utf8'))
  }
  catch {
    return undefined
  }
}

/** Account-isolated snapshots and filters stored outside repositories and browser origins. */
export class IntegrationLocalState {
  private epochs = new Map<string, number>()
  private tails = new Map<string, Promise<void>>()

  private async mutate(directory: string, operation: () => Promise<void>): Promise<void> {
    const tail = (this.tails.get(directory) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.tails.set(directory, tail)
    try {
      await tail
    }
    finally {
      if (this.tails.get(directory) === tail)
        this.tails.delete(directory)
    }
  }

  constructor(private readonly dataDir: string) {}

  private directory(integrationId: string, accountKey: string): string {
    return join(this.dataDir, 'integration-state', hash([integrationId, accountKey]))
  }

  /** Track invalidations so an in-flight read cannot restore a snapshot after a write. */
  epoch(integrationId: string, accountKey: string): number {
    return this.epochs.get(this.directory(integrationId, accountKey)) ?? 0
  }

  /** Load a recent normalized snapshot; all cached pages are explicitly read-only. */
  async cached(integrationId: string, accountKey: string, scope: unknown, reason: 'preview' | 'offline' | 'authorization'): Promise<IntegrationEntityPage | undefined> {
    const value = await read(join(this.directory(integrationId, accountKey), `page-${hash(canonical(scope))}.json`))
    if (!value || typeof value !== 'object' || !('fetchedAt' in value) || typeof value.fetchedAt !== 'string'
      || Date.now() - Date.parse(value.fetchedAt) > MAX_AGE || !Number.isFinite(Date.parse(value.fetchedAt))
      || !snapshotSchema.safeParse(value).success) {
      return undefined
    }
    const page = value as IntegrationEntityPage
    return { ...page, items: page.items.map(item => ({ ...item, statusUpdateAvailable: false })), cache: { reason, readOnly: true } }
  }

  /** Save a successful read without coupling remote availability to local storage availability. */
  async savePage(integrationId: string, accountKey: string, scope: unknown, page: IntegrationEntityPage, epoch: number): Promise<void> {
    const directory = this.directory(integrationId, accountKey)
    await this.mutate(directory, async () => {
      if (epoch !== this.epoch(integrationId, accountKey))
        return
      await privateWrite(join(directory, `page-${hash(canonical(scope))}.json`), { ...page, cache: undefined })
      // Bound retained search variants, and discard expired snapshots.
      const entries = await readdir(directory)
      const pages = await Promise.all(entries.filter(name => name.startsWith('page-') && name.endsWith('.json')).map(async name => ({ name, modified: (await stat(join(directory, name))).mtimeMs })))
      pages.sort((a, b) => b.modified - a.modified)
      await Promise.all(pages.filter((page, index) => index >= 50 || Date.now() - page.modified > MAX_AGE).map(page => rm(join(directory, page.name), { force: true })))
    })
  }

  /** Clear snapshots after a confirmed write; filter preferences are retained. */
  async invalidate(integrationId: string, accountKey: string): Promise<void> {
    const directory = this.directory(integrationId, accountKey)
    this.epochs.set(directory, this.epoch(integrationId, accountKey) + 1)
    await this.mutate(directory, async () => {
      const entries = await readdir(directory).catch(() => [])
      await Promise.all(entries.filter(name => name.startsWith('page-') && name.endsWith('.json')).map(name => rm(join(directory, name), { force: true })))
    })
  }

  /** Read or replace one view's bounded, validated filters. */
  async filters(integrationId: string, accountKey: string, scope: unknown, value?: unknown): Promise<z.infer<typeof integrationFiltersSchema> | undefined> {
    const path = join(this.directory(integrationId, accountKey), `filters-${hash(scope)}.json`)
    if (value !== undefined) {
      const filters = integrationFiltersSchema.parse(value)
      await privateWrite(path, filters)
      return filters
    }
    const result = integrationFiltersSchema.safeParse(await read(path))
    return result.success ? result.data : undefined
  }
}
