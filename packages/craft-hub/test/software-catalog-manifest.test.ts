import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncSoftwareCatalog } from '../../../scripts/sync-software-catalog'
import { bundledSoftwareCatalog } from '../src/bundled-software-catalog'
import { parseSoftwareCatalogManifest } from '../src/software-catalog-manifest'
import { parseSoftwareConfig, workstationCatalogSource } from '../src/software-config'

const groups = `[{ id: 'coding', label: { en: 'Coding' }, items: [{ id: 'editor', name: { en: 'Editor' }, url: 'https://example.com/editor', cask: 'editor', app: 'Editor.app', installCommand: 'never run this' }] }]`
const source = { id: 'sample', title: 'Sample', url: 'https://example.com/catalog' }
const config = `import 'nonexistent-side-effect-module'; export const softwareGroups: SoftwareGroup[] = ${groups} as const satisfies SoftwareGroup[]; throw new Error('must not execute')`

describe('static TypeScript software catalogs', () => {
  it('reads literal groups with types, assertions and comments, without loading imports or running code', () => {
    const catalog = parseSoftwareConfig(config, source)
    expect(catalog.items[0]).toMatchObject({ id: 'editor', title: { en: 'Editor' }, installation: { kind: 'brew-cask', packageId: 'editor' } })
    expect(catalog.items[0]).not.toHaveProperty('app')
    expect(catalog.items[0]).not.toHaveProperty('installCommand')
    expect(parseSoftwareCatalogManifest(catalog)).toEqual(catalog)
    expect(parseSoftwareConfig(`${config}\n// changed comment`, source).revision).toBe(catalog.revision)
    expect(parseSoftwareConfig(config.replace('en: \'Editor\'', 'en: \'New name\''), source).revision).not.toBe(catalog.revision)
    expect(parseSoftwareCatalogManifest(bundledSoftwareCatalog)).toEqual(bundledSoftwareCatalog)
    expect(bundledSoftwareCatalog.items.find(item => item.id === 'stats')?.group.id).toBe('system-utilities')
  })

  it('preserves explicit platforms, validates them, and leaves unknown support unset', () => {
    const withPlatforms = (platforms: unknown) => config.replace('id: \'editor\',', `id: 'editor', platforms: ${JSON.stringify(platforms)},`)
    for (const platforms of [['macos'], ['windows'], ['linux'], ['macos', 'windows', 'linux']]) {
      const parsed = parseSoftwareConfig(withPlatforms(platforms), source)
      expect(parsed.items[0]!.platforms).toEqual(platforms)
      expect(parseSoftwareCatalogManifest(parsed).items[0]!.platforms).toEqual(platforms)
      expect(parsed.revision).not.toBe(parseSoftwareConfig(config, source).revision)
    }
    expect(parseSoftwareConfig(config, source).items[0]).not.toHaveProperty('platforms')
    for (const platforms of [[], ['macos', 'macos'], ['android'], ['darwin'], 'macos', null])
      expect(() => parseSoftwareConfig(withPlatforms(platforms), source)).toThrow()
  })

  it('reads native artwork and rounding metadata with a legacy favicon fallback', () => {
    const image = { macosIconUrl: 'https://example.com/mac.png', iconStyle: 'rounded', iconScale: 1.25, iconUrl: 'https://example.com/icon.png', favicon: 'https://example.com/favicon.ico' }
    const withImage = (value: object) => config.replace('id: \'editor\',', `id: 'editor', ${JSON.stringify(value).slice(1, -1)},`)
    expect(parseSoftwareConfig(withImage(image), source).items[0]).toMatchObject({ macosIconUrl: image.macosIconUrl, iconUrl: image.iconUrl, iconStyle: 'rounded', iconScale: 1.25 })
    expect(parseSoftwareConfig(withImage({ favicon: image.favicon }), source).items[0]!.iconUrl).toBe(image.favicon)
    for (const url of ['http://example.com/icon.png', 'https://user:secret@example.com/icon.png', 'data:image/svg+xml,<svg/>']) {
      expect(() => parseSoftwareConfig(withImage({ ...image, iconUrl: url }), source)).toThrow()
      expect(() => parseSoftwareConfig(withImage({ ...image, macosIconUrl: url }), source)).toThrow()
    }
    expect(() => parseSoftwareConfig(withImage({ ...image, iconStyle: 'circle' }), source)).toThrow()
    for (const iconScale of [0, 0.49, 1.51, '1.25'])
      expect(() => parseSoftwareConfig(withImage({ ...image, iconScale }), source)).toThrow()
  })

  it.each([
    'loadCatalog()',
    'import("./data")',
    'groups',
    '[...groups]',
    '[,]',
    groups.replace('id: \'editor\'', 'id: (() => { throw Error(\'must not run\') })()'),
    groups.replace('id: \'editor\'', 'get id() { return \'editor\' }'),
    groups.replace('id: \'editor\'', '[\'id\']: \'editor\''),
    groups.replace('id: \'editor\'', '...item'),
    groups.replace('id: \'editor\'', 'id'),
    groups.replace('id: \'editor\'', '__proto__: {}, id: \'editor\''),
    groups.replace('id: \'editor\'', 'id: \'editor\', id: \'duplicate\''),
    // eslint-disable-next-line no-template-curly-in-string -- parser fixture must contain unevaluated interpolation
    groups.replace('id: \'editor\'', 'id: `interpolated-${value}`'),
    groups.replace('https://example.com/editor', 'javascript:alert(1)'),
  ])('rejects unsupported or unsafe data: %s', (initializer) => {
    expect(() => parseSoftwareConfig(`export const softwareGroups = ${initializer}`, source)).toThrow()
  })

  it('rejects duplicate identifiers, missing exports, excessive depth and oversized sources', () => {
    for (const input of [
      `const softwareGroups = ${groups}`,
      `export let softwareGroups = ${groups}`,
      `export const softwareGroups = [...${groups}]`,
      `export const softwareGroups = [${'['.repeat(40)}0${']'.repeat(40)}]`,
      `export const softwareGroups = ${groups.replace('cask: \'editor\'', 'extra: undefined')}`,
      ' '.repeat(2 * 1024 * 1024 + 1),
    ]) expect(() => parseSoftwareConfig(input, source)).toThrow()
    const catalog = parseSoftwareConfig(config, source)
    expect(() => parseSoftwareCatalogManifest({ ...catalog, revision: '0'.repeat(64) })).toThrow()
    expect(() => parseSoftwareCatalogManifest({ ...catalog, items: [...catalog.items, ...catalog.items] })).toThrow()
  })

  it('supports local-only identity without inventing a website', () => {
    expect(parseSoftwareConfig(config, { id: 'local', title: 'Local catalog' }).source).toEqual({ id: 'local', title: 'Local catalog' })
  })

  it('copies the TS snapshot verbatim only after validation and preserves it on failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catalog-sync-'))
    const input = join(directory, 'software.config.ts')
    const output = join(directory, 'snapshot.ts')
    try {
      await writeFile(input, config)
      await syncSoftwareCatalog(input, output)
      await syncSoftwareCatalog(input, output)
      expect(await readFile(output, 'utf8')).toBe(config)
      expect(parseSoftwareConfig(await readFile(output, 'utf8'), workstationCatalogSource).items).toHaveLength(1)
      await writeFile(input, 'export const softwareGroups = loadCatalog()')
      await expect(syncSoftwareCatalog(input, output)).rejects.toThrow()
      expect(await readFile(output, 'utf8')).toBe(config)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
})
