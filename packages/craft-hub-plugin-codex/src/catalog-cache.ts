interface Entry {
  value?: unknown
  expiresAt: number
  pending: Promise<unknown>
}

/** Bounded, scope-specific catalog cache; configuration snapshots are never cached. */
export class CatalogCache {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now, private readonly ttlMs = 60000, private readonly capacity = 8) {}

  /** Local configuration writes reuse display metadata, including after its refresh TTL. */
  peek(scope: string): unknown {
    return this.entries.get(scope)?.value
  }

  get(scope: string, load: () => Promise<unknown>): Promise<unknown> {
    const current = this.entries.get(scope)
    if (current && current.expiresAt > this.now()) {
      this.entries.delete(scope)
      this.entries.set(scope, current)
      return current.pending
    }
    const entry: Entry = { value: current?.value, expiresAt: Number.POSITIVE_INFINITY, pending: Promise.resolve() }
    entry.pending = Promise.resolve().then(load).then((value) => {
      entry.value = value
      entry.expiresAt = this.now() + this.ttlMs
      // Failed/incomplete catalogs must be retried immediately.
      if (hasCatalogErrors(value) && this.entries.get(scope) === entry)
        this.entries.delete(scope)
      return value
    }).catch((error: unknown) => {
      if (this.entries.get(scope) === entry)
        this.entries.delete(scope)
      throw error
    })
    this.entries.delete(scope)
    this.entries.set(scope, entry)
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!)
    return entry.pending
  }
}

function hasCatalogErrors(value: unknown): boolean {
  if (!value || typeof value !== 'object')
    return true
  const inventory = value as { marketplaces?: unknown, marketplaceLoadErrors?: unknown[] }
  return !Array.isArray(inventory.marketplaces) || Boolean(inventory.marketplaceLoadErrors?.length)
}
