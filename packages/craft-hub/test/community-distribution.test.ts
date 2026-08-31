import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { communityDistribution, pluginCatalogV1Schema } from '../src/index'

const catalogUrl = 'https://craft-hub.yunyoujun.cn/.well-known/craft-hub/plugins/v1/catalog.json'

describe('community distribution marketplace', () => {
  it('publishes the built-in Catalog at its configured online location', async () => {
    const source = communityDistribution.marketplaceSources?.find(item => item.id === 'craft-hub')
    const catalogPath = join(import.meta.dirname, '../../../docs/public/.well-known/craft-hub/plugins/v1/catalog.json')
    const publishedCatalog = pluginCatalogV1Schema.parse(JSON.parse(await readFile(catalogPath, 'utf8')))

    expect(source).toMatchObject({
      catalogUrl,
      enabled: true,
      kind: 'builtin',
    })
    expect(publishedCatalog).toEqual(source?.catalog)
  })
})
