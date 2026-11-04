import type { ProfileLease } from './profile-lease'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { acquireProfileLease, canonicalProfilePath } from './profile-lease'
import { RuntimeAvailability } from './runtime-availability'
import { syncDirectoryAncestors } from './sync-directory'

const text = z.string().trim().min(1).max(64_000)
const targetId = z.string().min(1).max(200)
const attemptId = z.uuid()
/** The narrow P0/P1 contract. No arbitrary plugin invocation, paths or credentials. */
export const sharedCaptureRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('hello'), protocol: z.literal(1) }).strict(),
  z.object({ method: z.literal('doctor') }).strict(),
  z.object({ method: z.literal('capture.targets') }).strict(),
  z.object({ method: z.literal('capture.prepare'), text, targetId }).strict(),
  z.object({ method: z.literal('capture.commit'), attemptId, reviewId: z.uuid(), text, targetId }).strict(),
  z.object({ method: z.literal('capture.receipt'), attemptId }).strict(),
])

/** Versioned request accepted over the private broker channel. */
export type SharedCaptureRequest = z.infer<typeof sharedCaptureRequestSchema>
/** A provider declares targets and handles only reviewed text creation. */
export interface SharedCaptureProvider {
  readonly targets: readonly { id: string, title: string, revision: string }[]
  validate: (targetId: string, text: string) => void
  create: (request: { attemptId: string, targetId: string, text: string, signal: AbortSignal }) => Promise<{ remoteId: string }>
  close: () => Promise<void>
}
/** Durable delivery state; uncertain writes must never be automatically replayed. */
export interface SharedCaptureReceipt {
  attemptId: string
  status: 'dispatching' | 'succeeded' | 'failed-before-dispatch' | 'uncertain'
  remoteId?: string
}
interface Attempt extends SharedCaptureReceipt { clientId: string, fingerprint: string, targetId: string, reviewRevision: string }
interface Review { clientId: string, fingerprint: string, revision: string, expires: number }

function fingerprint(target: string, content: string): string {
  return createHash('sha256').update(JSON.stringify([target, content])).digest('hex')
}

/**
 * Single-owner capture executor. Acquires the profile before opening its journal, loads
 * providers only on demand and keeps accepted writes alive after a client disconnects.
 * The authenticated broker supplies clientId; it is not a field in the public request.
 */
export class SharedCaptureRuntime {
  readonly generation = randomUUID()
  readonly availability: RuntimeAvailability
  private provider?: Promise<SharedCaptureProvider>
  private readonly reviews = new Map<string, Review>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly aborts = new Set<AbortController>()
  private closing?: Promise<void>

  private constructor(
    readonly profileId: string,
    private readonly database: DatabaseSync,
    private readonly lease: ProfileLease,
    private readonly options: { provider: () => Promise<SharedCaptureProvider>, idleMs: number, requestMs: number, onIdle: () => void },
  ) {
    this.availability = new RuntimeAvailability(options.idleMs, options.onIdle)
  }

  /** Construct only for explicit activity; callers must close even on failed acceptance. */
  static async open(options: {
    dataDir: string
    configDir: string
    provider: () => Promise<SharedCaptureProvider>
    idleMs?: number
    requestMs?: number
    onIdle: () => void
  }): Promise<SharedCaptureRuntime> {
    const dataDir = await canonicalProfilePath(options.dataDir)
    const configDir = await canonicalProfilePath(options.configDir)
    const lease = await acquireProfileLease([dataDir, configDir], 'runtime-owner')
    let database: DatabaseSync | undefined
    try {
      const firstCreated = await mkdir(dataDir, { recursive: true, mode: 0o700 })
      const path = join(dataDir, 'capture-attempts.sqlite')
      database = new DatabaseSync(path)
      await chmod(path, 0o600)
      // EXTRA also flushes journal directory changes before external dispatch; no credentials/content.
      database.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=EXTRA; CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, record TEXT NOT NULL)')
      await syncDirectoryAncestors(dataDir, firstCreated ? dirname(firstCreated) : dataDir)
      for (const row of database.prepare('SELECT id, record FROM attempts').all()) {
        const record = JSON.parse(String(row.record)) as Attempt
        if (record.status === 'dispatching') {
          record.status = 'uncertain'
          database.prepare('UPDATE attempts SET record=? WHERE id=?').run(JSON.stringify(record), String(row.id))
        }
      }
      const profileId = createHash('sha256').update(JSON.stringify([process.getuid?.(), dataDir, configDir])).digest('hex')
      return new SharedCaptureRuntime(profileId, database, lease, { ...options, idleMs: options.idleMs ?? 30_000, requestMs: options.requestMs ?? 30_000 })
    }
    catch (error) {
      database?.close()
      lease.release()
      throw error
    }
  }

  /** Parse and execute one bounded request. Rejected requests cannot dispatch a provider write. */
  request(clientId: string, input: unknown): Promise<unknown> {
    if (!clientId || clientId.length > 200)
      return Promise.reject(new Error('Invalid authenticated client'))
    const command = sharedCaptureRequestSchema.parse(input)
    const release = this.availability.acquire('operation')
    const pending = this.execute(clientId, command).finally(() => {
      release()
      this.pending.delete(pending)
    })
    this.pending.add(pending)
    return pending
  }

  /** Bounded dispatches settle before transports and the final ownership lease are released. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.availability.drain()
      try {
        await Promise.allSettled([...this.pending])
        const provider = await this.provider?.catch(() => undefined)
        await provider?.close()
      }
      finally {
        this.reviews.clear()
        this.database.close()
        this.lease.release()
        this.availability.stop()
      }
    })()
  }

  /** Parent loss or termination cancels transports but preserves ambiguous delivery. */
  abort(): void {
    this.availability.drain()
    for (const controller of this.aborts)
      controller.abort()
  }

  private read(id: string): Attempt | undefined {
    const row = this.database.prepare('SELECT record FROM attempts WHERE id=?').get(id)
    return row ? JSON.parse(String(row.record)) as Attempt : undefined
  }

  private save(record: Attempt): void {
    this.database.prepare('INSERT INTO attempts (id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(record.attemptId, JSON.stringify(record))
  }

  private receipt(record: Attempt): SharedCaptureReceipt {
    return { attemptId: record.attemptId, status: record.status, ...(record.remoteId ? { remoteId: record.remoteId } : {}) }
  }

  private async loadProvider(): Promise<SharedCaptureProvider> {
    const load = Promise.resolve().then(() => this.options.provider())
    let expired = false
    let timer: ReturnType<typeof setTimeout> | undefined
    // A late-loading adapter is disposed, never exposed to a timed-out request.
    void load.then((provider) => {
      if (expired)
        void provider.close().catch(() => {})
    }, () => {})
    try {
      return await Promise.race([load, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Capture provider startup deadline')), this.options.requestMs)
      })])
    }
    catch (error) {
      expired = true
      throw error
    }
    finally {
      clearTimeout(timer)
    }
  }

  private async execute(clientId: string, command: SharedCaptureRequest): Promise<unknown> {
    if (command.method === 'hello')
      return { protocol: 1, profileId: this.profileId, generation: this.generation, pid: process.pid, capabilities: ['fixture.capture'] }
    if (command.method === 'doctor')
      return { profileId: this.profileId, generation: this.generation, pid: process.pid, ...this.availability.snapshot(), providerLoaded: Boolean(this.provider), mode: 'fixture-only' }
    if (command.method === 'capture.receipt') {
      const record = this.read(command.attemptId)
      if (!record || record.clientId !== clientId)
        throw new Error('Capture attempt not found')
      return this.receipt(record)
    }
    const hash = 'text' in command ? fingerprint(command.targetId, command.text) : ''
    if (command.method === 'capture.commit') {
      const existing = this.read(command.attemptId)
      if (existing) {
        if (existing.clientId !== clientId || existing.fingerprint !== hash)
          throw new Error('Capture attempt identity conflict')
        return this.receipt(existing)
      }
    }
    const provider = await (this.provider ??= this.loadProvider())
    if (this.availability.snapshot().phase !== 'ready')
      throw new Error('Runtime stopped before dispatch')
    if (command.method === 'capture.targets')
      return provider.targets
    const target = provider.targets.find(target => target.id === command.targetId)
    if (!target)
      throw new Error('Unknown capture target')
    if (command.method === 'capture.prepare') {
      for (const [id, review] of this.reviews) {
        if (review.expires <= Date.now())
          this.reviews.delete(id)
      }
      if (this.reviews.size >= 1024)
        throw new Error('Too many outstanding capture reviews')
      provider.validate(command.targetId, command.text)
      const reviewId = randomUUID()
      this.reviews.set(reviewId, { clientId, fingerprint: hash, revision: target.revision, expires: Date.now() + 5 * 60_000 })
      return { reviewId, text: command.text, targetId: target.id, targetTitle: target.title, revision: target.revision }
    }
    // A provider load above can yield. Recheck after it to merge simultaneous same-id commits.
    const concurrent = this.read(command.attemptId)
    if (concurrent) {
      if (concurrent.clientId !== clientId || concurrent.fingerprint !== hash)
        throw new Error('Capture attempt identity conflict')
      return this.receipt(concurrent)
    }
    const review = this.reviews.get(command.reviewId)
    if (!review || review.clientId !== clientId || review.fingerprint !== hash || review.revision !== target.revision || review.expires <= Date.now())
      throw new Error('Capture review changed or expired')
    this.reviews.delete(command.reviewId)
    const record: Attempt = { attemptId: command.attemptId, clientId, fingerprint: hash, targetId: target.id, reviewRevision: target.revision, status: 'failed-before-dispatch' }
    try {
      provider.validate(command.targetId, command.text)
    }
    catch {
      this.save(record)
      return this.receipt(record)
    }
    record.status = 'dispatching'
    this.save(record)
    const controller = new AbortController()
    this.aborts.add(controller)
    let timer: ReturnType<typeof setTimeout> | undefined
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Capture deadline or parent loss')), { once: true })
      timer = setTimeout(() => controller.abort(), this.options.requestMs)
    })
    try {
      const result = await Promise.race([provider.create({ ...command, signal: controller.signal }), aborted])
      if (!result.remoteId || typeof result.remoteId !== 'string' || result.remoteId.length > 1000)
        throw new Error('Missing capture receipt')
      record.status = 'succeeded'
      record.remoteId = result.remoteId
    }
    catch {
      record.status = 'uncertain'
    }
    finally {
      clearTimeout(timer)
      this.aborts.delete(controller)
    }
    this.save(record)
    return this.receipt(record)
  }
}
