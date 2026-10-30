import type { ManagedPlugin } from '../src/marketplace'
import type { MarketplaceCatalogItem } from '../src/marketplace-model'
import { expect, it } from 'vitest'
import { catalogPluginV1Schema, pluginManifestV1Schema } from '../src/marketplace'
import { marketplaceOverview, marketplacePackMembers, marketplacePluginAction, preferredMarketplaceCatalog } from '../src/marketplace-model'

function entry(version: string, changes: Partial<MarketplaceCatalogItem> = {}): MarketplaceCatalogItem {
  return { ...catalogPluginV1Schema.parse({ package: '@example/craft-hub-plugin-tools', version, displayName: 'Tools', publisher: 'Example', integrity: 'sha512-dGVzdA==' }), sourceId: 'one', sourceName: 'One', sourceKind: 'user', ...changes }
}
function active(version = '1.0.0', changes: Partial<ManagedPlugin> = {}): ManagedPlugin {
  return { package: '@example/craft-hub-plugin-tools', version, sourceId: 'one', enabled: true, installedAt: '2026-10-22T00:00:00Z', packagePath: '/unused', manifest: pluginManifestV1Schema.parse({ schemaVersion: 1, id: '@example/craft-hub-plugin-tools', displayName: 'Tools', contributes: {} }), ...changes }
}

it('uses exact semantic versions, active preference and independent source identity', () => {
  const catalog = [entry('1.9.0'), entry('1.10.0'), entry('2.0.0', { status: 'blocked', statusReason: 'Withdrawn' }), entry('3.0.0-beta.1', { sourceId: 'two' })]
  expect(preferredMarketplaceCatalog(catalog).map(item => [item.sourceId, item.version])).toEqual([['one', '1.10.0'], ['two', '3.0.0-beta.1']])
  expect(marketplaceOverview(catalog, [active()], []).catalog.map(item => [item.version, item.preferred, item.action])).toEqual([
    ['1.9.0', false, 'update'],
    ['1.10.0', true, 'update'],
    ['2.0.0', false, 'update'],
    ['3.0.0-beta.1', true, 'switchSource'],
  ])
})

it('preserves local overrides, repairs, disabled plugins and downgrades in every client', () => {
  const target = entry('1.0.0')
  expect(marketplacePluginAction(target)).toBe('install')
  expect(marketplacePluginAction(target, active())).toBe('installed')
  expect(marketplacePluginAction(target, active('1.0.0', { origin: 'local', sourceId: 'local' }))).toBe('local')
  expect(marketplacePluginAction(target, active('1.0.0', { sourceId: 'two' }))).toBe('switchSource')
  expect(marketplacePluginAction(target, active('2.0.0'))).toBe('newer')
  expect(marketplacePluginAction(target, active('1.0.0', { enabled: false }))).toBe('enable')
  expect(marketplacePluginAction(target, active('1.0.0', { error: 'Invalid package' }))).toBe('repair')
  expect(marketplacePluginAction({ ...target, includesPlugins: [{ package: '@example/craft-hub-plugin-child', version: '^1.0.0' }] }, active())).toBe('repair')
})

it('marks included children within the same source without hiding all versions from detail views', () => {
  const catalog = [entry('1.0.0', { includesPlugins: [{ package: '@example/craft-hub-plugin-child', version: '^1.0.0' }] }), entry('1.0.0', { package: '@example/craft-hub-plugin-child' }), entry('1.0.0', { package: '@example/craft-hub-plugin-child', sourceId: 'two' })]
  const result = marketplaceOverview(catalog, [], [])
  expect(result.catalog.map(item => item.included)).toEqual([false, true, false])
  expect(result.catalog).toHaveLength(3)
  expect(catalog.some(item => 'included' in item)).toBe(false)
})

it('resolves all pack members within their source and ranges, preferring active versions over blocked releases', () => {
  const child = '@example/craft-hub-plugin-child'
  const missing = '@example/craft-hub-plugin-missing'
  const parent = entry('1.0.0', { includesPlugins: [{ package: child, version: '^1.0.0' }, { package: missing, version: '^1.0.0' }] })
  const catalog = [parent, entry('1.2.0', { package: child, displayName: 'Child', icon: 'assets/child.svg' }), entry('1.9.0', { package: child, status: 'blocked', statusReason: 'Withdrawn' }), entry('1.8.0', { package: missing, sourceId: 'two' }), entry('2.0.0', { package: missing })]
  const members = marketplacePackMembers(parent, catalog)
  expect(members).toEqual([
    expect.objectContaining({ package: child, sourceId: 'one', version: '1.2.0', displayName: 'Child', icon: 'assets/child.svg', status: 'active', installed: false }),
    expect.objectContaining({ package: missing, range: '^1.0.0', version: undefined, status: 'missing', installed: false }),
  ])
  const installed = active('1.1.0', { package: child, enabled: false })
  const overview = marketplaceOverview(catalog, [installed], [])
  expect(overview.catalog[0]!.members[0]).toMatchObject({ package: child, version: '1.1.0', installed: true, enabled: false })
  expect(overview.installed[0]!.members).toEqual([])
  expect(installed).not.toHaveProperty('members')
  expect(marketplacePackMembers(parent, catalog, [active('1.2.0', { package: child, sourceId: 'two' })])[0]!.installed).toBe(false)
})

it('keeps blocked-only members visible and resolves local pack artwork without crossing sources', () => {
  const child = '@example/craft-hub-plugin-child'
  const parent = entry('1.0.0', { includesPlugins: [{ package: child, version: '^1.0.0' }] })
  expect(marketplacePackMembers(parent, [entry('1.0.0', { package: child, status: 'blocked', statusReason: 'Withdrawn' })])[0]).toMatchObject({ version: '1.0.0', status: 'blocked' })
  const local = active('1.1.0', { package: child, origin: 'local', sourceId: 'local', manifest: pluginManifestV1Schema.parse({ schemaVersion: 1, id: child, displayName: 'Local Child', icon: 'assets/local.svg', contributes: {} }) })
  expect(marketplacePackMembers({ ...parent, sourceId: 'local' }, [], [local])[0]).toMatchObject({ displayName: 'Local Child', icon: 'assets/local.svg', version: '1.1.0', installed: true })
})
