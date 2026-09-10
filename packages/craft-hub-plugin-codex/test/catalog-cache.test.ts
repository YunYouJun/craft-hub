import { describe, expect, it, vi } from 'vitest'
import { CatalogCache } from '../src/catalog-cache'

const inventory = { marketplaces: [] }

describe('installed catalog cache', () => {
  it('shares pending reads, isolates scopes, and expires from completion time', async () => {
    let now = 0
    const cache = new CatalogCache(() => now, 60)
    const load = vi.fn(async () => inventory)
    const first = cache.get('project', load)
    expect(cache.get('project', load)).toBe(first)
    await first
    await cache.get('global', load)
    now = 59
    await cache.get('project', load)
    expect(load).toHaveBeenCalledTimes(2)
    now = 60
    await cache.get('project', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('retries failures and incomplete catalogs instead of caching them', async () => {
    const cache = new CatalogCache()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ marketplaces: [], marketplaceLoadErrors: [{}] }).mockResolvedValue(inventory)
    await expect(cache.get('project', load)).rejects.toThrow('offline')
    await cache.get('project', load)
    await cache.get('project', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('evicts the least recently used scope', async () => {
    const cache = new CatalogCache(Date.now, 60000, 2)
    const load = vi.fn(async () => inventory)
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('a', load)
    await cache.get('c', load)
    await cache.get('b', load)
    expect(load).toHaveBeenCalledTimes(4)
  })
})
