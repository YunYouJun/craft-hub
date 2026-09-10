import { describe, expect, it } from 'vitest'
import { WorkspaceCatalogService, workspaceMarketSchema } from '../src/workspace-catalog'

const market = {
  enabled: true,
  catalog: {
    schemaVersion: 1 as const,
    id: 'example',
    name: 'Example',
    entries: [{ id: 'dev', name: 'Development', publisher: 'Maintainer', configurationUrl: 'https://git.example.com/profile/tree/main/craft-hub' }],
  },
}

describe('workspace source catalogs', () => {
  it('isolates markets with the same entry id, omits disabled markets and returns independent values', () => {
    const service = new WorkspaceCatalogService([market, { ...market, catalog: { ...market.catalog, id: 'another' } }, { ...market, enabled: false, catalog: { ...market.catalog, id: 'disabled' } }])
    const catalogs = service.list()
    expect(catalogs.map(catalog => catalog.id)).toEqual(['example', 'another'])
    catalogs[0]!.entries.length = 0
    expect(service.list()[0]!.entries).toHaveLength(1)
    expect(new WorkspaceCatalogService().list()).toEqual([])
  })

  it('rejects ambiguous identities and executable or credential data', () => {
    expect(() => new WorkspaceCatalogService([market, market])).toThrow('Duplicate')
    expect(() => workspaceMarketSchema.parse({ ...market, catalog: { ...market.catalog, entries: [...market.catalog.entries, ...market.catalog.entries] } })).toThrow('Duplicate')
    for (const extra of [{ command: 'run' }, { token: 'secret' }, { path: '/tmp/project' }]) {
      expect(() => workspaceMarketSchema.parse({ ...market, catalog: { ...market.catalog, entries: [{ ...market.catalog.entries[0], ...extra }] } })).toThrow()
    }
    for (const configurationUrl of ['file:///tmp/config', 'https://user:secret@git.example.com/config', 'javascript:alert(1)']) {
      expect(() => workspaceMarketSchema.parse({ ...market, catalog: { ...market.catalog, entries: [{ ...market.catalog.entries[0], configurationUrl }] } })).toThrow()
    }
  })
})
