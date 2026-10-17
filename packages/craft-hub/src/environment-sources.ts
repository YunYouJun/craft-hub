import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const identifier = z.string().regex(/^[a-z][a-z0-9.-]{0,127}$/)
const printable = (value: string): boolean => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
/** Only credential-free HTTPS locations are accepted by the interactive connection flow. */
export const environmentRepositorySchema = z.string().trim().min(1).max(2048).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash
      && url.pathname.length > 1 && !/\s/u.test(value) && printable(value)
  }
  catch { return false }
}, 'Use an HTTPS repository URL without credentials')
const kind = z.enum(['public', 'private'])
const credential = z.string().min(1).refine(printable)
const credentials = z.object({ username: credential.max(256), token: credential.max(8192) }).strict()
/** Connection requests contain repository identities and transient authentication, never commands or target paths. */
export const environmentSourceCommandSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('connect'), providerId: identifier, kind, repository: environmentRepositorySchema }).strict(),
  z.object({ operation: z.literal('authenticate'), id: z.uuid(), credentials }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
])
export type EnvironmentSourceCommand = z.infer<typeof environmentSourceCommandSchema>
export type EnvironmentSourceCredentials = z.infer<typeof credentials>
export type EnvironmentSourceKind = z.infer<typeof kind>
export type EnvironmentSourceFailure = 'authentication-required' | 'invalid-source' | 'destination-conflict' | 'unavailable'

/** Safe failures cross the UI boundary without Git output, local file contents or credential values. */
export class EnvironmentSourceError extends Error {
  constructor(readonly status: number, readonly code: EnvironmentSourceFailure, message = 'Configuration source connection is unavailable') { super(message) }
}

/** Trusted adapter owns checkout locations, source validation and binding through its original tool. */
export interface EnvironmentSourceProvider {
  id: string
  name: string
  kinds: EnvironmentSourceKind[]
  connect: (input: { kind: EnvironmentSourceKind, repository: string }, context: {
    signal: AbortSignal
    credentials?: EnvironmentSourceCredentials
    phase: (value: 'cloning' | 'validating' | 'binding') => void
  }) => Promise<{ localPath: string }>
}
/** Machine-local progress. Authentication values are never included or persisted. */
export interface EnvironmentSourceConnection {
  id: string
  providerId: string
  kind: EnvironmentSourceKind
  repository: string
  state: 'connecting' | 'authentication-required' | 'connected' | 'failed' | 'cancelled'
  phase: 'cloning' | 'validating' | 'binding'
  expiresAt: string
  error?: EnvironmentSourceFailure
  localPath?: string
}
export interface EnvironmentSourceSnapshot {
  providers: Array<Pick<EnvironmentSourceProvider, 'id' | 'name' | 'kinds'>>
  connections: EnvironmentSourceConnection[]
}
interface Job { value: EnvironmentSourceConnection, controller: AbortController, timer: ReturnType<typeof setTimeout>, pending?: Promise<void> }

/** In-memory connection sessions; restart discards transient jobs and the owning tool retains validated bindings. */
export class EnvironmentSourceService {
  private readonly jobs = new Map<string, Job>()
  constructor(private readonly providers: EnvironmentSourceProvider[], private readonly local = true) {
    if (new Set(providers.map(provider => provider.id)).size !== providers.length || providers.some(provider => !identifier.safeParse(provider.id).success || typeof provider.connect !== 'function'))
      throw new Error('Configuration source providers require unique identifiers and connect methods')
  }

  private assertLocal(): void {
    if (!this.local)
      throw new EnvironmentSourceError(403, 'unavailable', 'Source connections require a local workbench')
  }

  /** Read progress without contacting repositories or invoking credentials. */
  snapshot(): EnvironmentSourceSnapshot {
    this.assertLocal()
    return { providers: this.providers.map(({ id, name, kinds }) => ({ id, name, kinds: [...kinds] })), connections: [...this.jobs.values()].map(job => structuredClone(job.value)) }
  }

  /** Start, authenticate or cancel one explicitly requested source connection. */
  command(input: EnvironmentSourceCommand): EnvironmentSourceSnapshot {
    this.assertLocal()
    input = environmentSourceCommandSchema.parse(input)
    if (input.operation === 'connect') {
      const provider = this.providers.find(provider => provider.id === input.providerId && provider.kinds.includes(input.kind))
      if (!provider)
        throw new EnvironmentSourceError(404, 'unavailable')
      if ([...this.jobs.values()].some(job => job.value.providerId === provider.id && ['connecting', 'authentication-required'].includes(job.value.state)))
        throw new EnvironmentSourceError(409, 'unavailable', 'Finish or cancel the current connection first')
      for (const [id, job] of this.jobs) {
        if (!['connecting', 'authentication-required'].includes(job.value.state)) {
          clearTimeout(job.timer)
          this.jobs.delete(id)
        }
      }
      const id = randomUUID()
      const value: EnvironmentSourceConnection = { id, providerId: provider.id, repository: input.repository, kind: input.kind, state: 'connecting', phase: 'cloning', expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }
      const job: Job = { value, controller: new AbortController(), timer: setTimeout(() => {
        if (job.value.phase !== 'binding')
          this.cancel(job)
      }, 10 * 60 * 1000) }
      job.timer.unref()
      this.jobs.set(id, job)
      this.run(job)
    }
    else {
      const job = this.jobs.get(input.id)
      if (!job)
        throw new EnvironmentSourceError(404, 'unavailable')
      if (input.operation === 'cancel') {
        if (job.value.state === 'connecting' && job.value.phase === 'binding')
          throw new EnvironmentSourceError(409, 'unavailable', 'The source binding is being saved; check its result shortly')
        this.cancel(job)
      }
      else {
        if (job.value.state !== 'authentication-required' || Date.parse(job.value.expiresAt) <= Date.now())
          throw new EnvironmentSourceError(409, 'unavailable', 'Authentication is no longer pending')
        this.run(job, input.credentials)
      }
    }
    return this.snapshot()
  }

  private cancel(job: Job): void {
    if (!['connecting', 'authentication-required'].includes(job.value.state))
      return
    job.controller.abort()
    job.value.state = 'cancelled'
    delete job.value.error
    clearTimeout(job.timer)
  }

  private run(job: Job, credentials?: EnvironmentSourceCredentials): void {
    const provider = this.providers.find(provider => provider.id === job.value.providerId)!
    job.value.state = 'connecting'
    job.value.phase = 'cloning'
    delete job.value.error
    job.pending = (async () => {
      try {
        const result = await provider.connect({ repository: job.value.repository, kind: job.value.kind }, {
          signal: job.controller.signal,
          credentials,
          phase: (value) => { job.value.phase = value },
        })
        if (!job.controller.signal.aborted) {
          job.value.localPath = result.localPath
          job.value.state = 'connected'
        }
      }
      catch (error) {
        if (!job.controller.signal.aborted) {
          job.value.error = error instanceof EnvironmentSourceError && ['authentication-required', 'invalid-source', 'destination-conflict', 'unavailable'].includes(error.code) ? error.code : 'unavailable'
          job.value.state = job.value.error === 'authentication-required' ? 'authentication-required' : 'failed'
        }
      }
      finally {
        credentials = undefined
        if (job.value.state !== 'authentication-required')
          clearTimeout(job.timer)
      }
    })()
  }

  /** Stop pending transports and discard all transient authentication on host shutdown. */
  async close(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (job.value.phase !== 'binding')
        this.cancel(job)
      clearTimeout(job.timer)
    }
    await Promise.allSettled([...this.jobs.values()].map(job => job.pending))
    this.jobs.clear()
  }
}
