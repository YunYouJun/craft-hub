import type { CommandRunGuard } from './command-run-guard'
import type { Capability, CommandCapability, CommandInputValues, CommandInvocation, ProjectRecord } from './types'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { resolveCommandInvocation } from './command-inputs'

/** A short-lived command review whose executable declaration and input are retained by the runtime. */
export interface CommandReview {
  reviewId: string
  project: ProjectRecord
  capability: CommandCapability
  invocation: CommandInvocation
  expiresAt: string
}

/** Review conflicts require a fresh explicit review; no submitted input is included in the error. */
export class CommandReviewError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'CommandReviewError'
  }
}

interface Host {
  project: (id: string) => Promise<ProjectRecord>
  capabilities: (id: string) => Promise<Capability[]>
  trust: (id: string, expectedPath: string, assertActive: () => void) => Promise<ProjectRecord>
}

interface StoredReview {
  owner: string
  projectId: string
  inputs: CommandInputValues
  review: CommandReview
  bytes: number
  timer: ReturnType<typeof setTimeout>
}

const lifetime = 5 * 60_000

/** Read-only preparation and one-use consumption preserve the shared runtime's final spawn guard. */
export class CommandReviewService {
  private readonly reviews = new Map<string, StoredReview>()
  constructor(private readonly host: Host, private readonly now: () => number = Date.now) {}

  /** Resolve a command without granting trust, loading a terminal addon or starting a process. */
  async prepare(owner: string, projectId: string, capabilityId: string, inputs: CommandInputValues): Promise<CommandReview> {
    const project = await this.host.project(projectId)
    const capability = (await this.host.capabilities(projectId)).find(item => item.id === capabilityId)
    if (!capability || capability.kind !== 'command')
      throw new CommandReviewError(409, 'The command is no longer available; review the project again')
    if (capability.operation?.kind === 'release')
      throw new CommandReviewError(409, 'Release commands require the full release review')
    if (capability.availability?.available === false)
      throw new CommandReviewError(409, 'The command is currently unavailable')
    const review: CommandReview = {
      reviewId: randomUUID(),
      project: structuredClone(project),
      capability: structuredClone(capability),
      invocation: resolveCommandInvocation(capability, inputs),
      expiresAt: new Date(this.now() + lifetime).toISOString(),
    }
    const bytes = Buffer.byteLength(JSON.stringify({ inputs, review }))
    if (bytes > 1_048_576)
      throw new CommandReviewError(413, 'The command review is too large')
    for (const [id, stored] of this.reviews) {
      if (Date.parse(stored.review.expiresAt) <= this.now())
        this.drop(id)
    }
    const owned = [...this.reviews].filter(([, stored]) => stored.owner === owner)
    while (owned.length >= 8)
      this.drop(owned.shift()![0])
    while (this.reviews.size >= 64 || [...this.reviews.values()].reduce((total, item) => total + item.bytes, bytes) > 8_388_608)
      this.drop(this.reviews.keys().next().value!)
    const timer = setTimeout(() => this.drop(review.reviewId), lifetime)
    timer.unref()
    this.reviews.set(review.reviewId, { owner, projectId, inputs: structuredClone(inputs), review, bytes, timer })
    return structuredClone(review)
  }

  /** Validate the reviewed declaration before a separate, explicit project-trust decision. */
  async trust(owner: string, projectId: string, reviewId: string): Promise<ProjectRecord> {
    const stored = this.get(owner, projectId, reviewId)
    await this.validate(stored)
    // Validation awaits discovery; cancellation or expiry during that read must still win.
    this.get(owner, projectId, reviewId)
    return this.host.trust(projectId, stored.review.project.path, () => {
      this.get(owner, projectId, reviewId)
    })
  }

  /** Consume synchronously before awaiting discovery; concurrent or replayed confirmations cannot start another run. */
  async consume(owner: string, projectId: string, reviewId: string, capabilityId: string, inputs: CommandInputValues): Promise<CommandRunGuard> {
    const stored = this.get(owner, projectId, reviewId)
    this.drop(reviewId)
    if (stored.review.capability.id !== capabilityId || !isDeepStrictEqual(stored.inputs, inputs))
      throw new CommandReviewError(409, 'The command input changed; review it again')
    await this.validate(stored)
    return {
      projectPath: stored.review.project.path,
      capability: structuredClone(stored.review.capability),
      inputs: structuredClone(stored.inputs),
      expiresAt: Date.parse(stored.review.expiresAt),
    }
  }

  /** Cancel only a review owned by this caller and project; cancellation never stops an already started run. */
  cancel(owner: string, projectId: string, reviewId: string): void {
    this.get(owner, projectId, reviewId)
    this.drop(reviewId)
  }

  /** Drop ephemeral inputs and expiry timers when the runtime closes. */
  close(): void {
    for (const id of this.reviews.keys())
      this.drop(id)
  }

  private get(owner: string, projectId: string, reviewId: string): StoredReview {
    const stored = this.reviews.get(reviewId)
    if (!stored || stored.owner !== owner || stored.projectId !== projectId || Date.parse(stored.review.expiresAt) <= this.now())
      throw new CommandReviewError(409, 'The command review expired, was cancelled or was already used')
    return stored
  }

  private async validate(stored: StoredReview): Promise<void> {
    const project = await this.host.project(stored.projectId)
    const capability = (await this.host.capabilities(stored.projectId)).find(item => item.id === stored.review.capability.id)
    if (Date.parse(stored.review.expiresAt) <= this.now() || project.path !== stored.review.project.path || !isDeepStrictEqual(capability, stored.review.capability))
      throw new CommandReviewError(409, 'The reviewed project or command changed; review it again')
  }

  private drop(id: string): void {
    const stored = this.reviews.get(id)
    if (stored)
      clearTimeout(stored.timer)
    this.reviews.delete(id)
  }
}
