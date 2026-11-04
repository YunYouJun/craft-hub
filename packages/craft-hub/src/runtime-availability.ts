/** Kinds of work that must keep a shared runtime alive independently of its caller. */
export type RuntimeLeaseKind = 'operation' | 'session' | 'execution' | 'authorization'

/** Server-owned activity accounting. Idle connections do not acquire leases. */
export class RuntimeAvailability {
  private timer?: ReturnType<typeof setTimeout>
  private readonly leases = new Map<symbol, RuntimeLeaseKind>()
  private phase: 'ready' | 'draining' | 'stopped' = 'ready'

  constructor(private readonly idleMs: number, private readonly onIdle: () => void) {
    if (!Number.isFinite(idleMs) || idleMs < 1)
      throw new Error('Invalid runtime idle deadline')
    this.schedule()
  }

  /** Acquire before accepting work; the release function is idempotent. */
  acquire(kind: RuntimeLeaseKind): () => void {
    if (this.phase !== 'ready')
      throw new Error('Runtime is draining')
    clearTimeout(this.timer)
    const id = Symbol(kind)
    this.leases.set(id, kind)
    return () => {
      if (this.leases.delete(id))
        this.schedule()
    }
  }

  /** Activity is useful for diagnostics, never as an authorization decision. */
  snapshot(): { phase: string, leases: Partial<Record<RuntimeLeaseKind, number>> } {
    const counts: Partial<Record<RuntimeLeaseKind, number>> = {}
    for (const kind of this.leases.values())
      counts[kind] = (counts[kind] ?? 0) + 1
    return { phase: this.phase, leases: counts }
  }

  /** Stop accepting work while already accepted operations finish. */
  drain(): void {
    clearTimeout(this.timer)
    this.phase = 'draining'
  }

  /** Clear the sole idle timer after shutdown. */
  stop(): void {
    this.drain()
    this.phase = 'stopped'
  }

  private schedule(): void {
    if (this.phase !== 'ready' || this.leases.size)
      return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.drain()
      this.onIdle()
    }, this.idleMs)
  }
}
