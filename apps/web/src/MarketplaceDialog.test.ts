// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CatalogPluginV1, InstalledPlugin, MarketplaceSource, MarketplaceSourcePreview } from 'craft-hub'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api } from './api'
import MarketplaceDialog from './MarketplaceDialog.vue'
import { createWorkbenchRouter } from './router'

const packageName = '@acme/craft-hub-plugin-suite'
const icon = 'https://plugins.acme.example/.well-known/craft-hub/plugins/v1/assets/acme-suite.svg'
const catalogUrl = 'https://craft-hub.yunyoujun.cn/.well-known/craft-hub/plugins/v1/catalog.json'
const builtinSource: MarketplaceSource = {
  id: 'craft-hub',
  name: 'Craft Hub',
  kind: 'builtin',
  catalogUrl,
  enabled: true,
  catalog: { schemaVersion: 1, id: 'craft-hub', name: 'Craft Hub', plugins: [] },
}
const catalogPlugin: CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: 'managed' } = {
  package: packageName,
  version: '0.1.0',
  displayName: 'Acme Suite',
  description: 'Acme solution pack.',
  slug: 'acme-suite',
  icon,
  publisher: 'Acme',
  integrity: 'sha512-dGVzdA==',
  permissions: [],
  categories: ['developer-tools'],
  status: 'active',
  includesPlugins: [],
  requiresPlugins: [],
  sourceId: 'acme',
  sourceName: 'Acme',
  sourceKind: 'managed',
}
const installedPlugin: InstalledPlugin = {
  package: packageName,
  version: '0.1.0',
  sourceId: 'acme',
  installedAt: '2026-08-31T00:00:00.000Z',
  enabled: true,
  packagePath: '/plugins/acme-suite',
  manifest: {
    schemaVersion: 1,
    id: packageName,
    displayName: 'Acme Suite',
    icon: 'assets/icon.svg',
    craftHub: {},
    includesPlugins: [],
    requiresPlugins: [],
    projectFiles: [],
    permissions: [],
    contributes: { commands: [], commandPresets: [], commandTemplates: [], packageQuickActions: [], packageLinks: [], packageToolGroups: [], skills: [], projectTemplates: [], integrations: [] },
  },
}

const sourcePreview: MarketplaceSourcePreview = {
  name: 'Acme Plugins',
  catalogUrl: 'https://plugins.acme.example/.well-known/craft-hub/plugins/v1/catalog.json',
  finalCatalogUrl: 'https://plugins.acme.example/.well-known/craft-hub/plugins/v1/catalog.json',
  registry: 'https://registry.npmjs.org/',
  catalog: {
    schemaVersion: 1,
    id: 'acme',
    name: 'Acme Plugins',
    plugins: [catalogPlugin],
  },
}

async function mountMarketplace(props: { open: boolean, importCatalogUrl?: string } = { open: true }, attachTo?: Element) {
  const router = createWorkbenchRouter(createMemoryHistory())
  await router.push('/marketplace')
  await router.isReady()
  return mount(MarketplaceDialog, { attachTo, props, global: { plugins: [router] } })
}

describe('marketplace dialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows catalog-provided branding in discover and installed views', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])

    const wrapper = await mountMarketplace()
    await flushPromises()

    expect(wrapper.get('[data-testid="plugin-icon"]').attributes('src')).toBe(icon)
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('[data-testid="installed-plugin-icon"]').attributes('src')).toBe(icon)
  })

  it('opens a versioned plugin detail route from the catalog summary', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({
      package: packageName,
      version: '0.1.0',
      sourceId: 'acme',
      origin: 'marketplace',
      manifest: installedPlugin.manifest,
      document: { status: 'found', path: 'README.md', content: '# Acme Suite' },
    })

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.plugin-summary-link').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="plugin-detail"]').text()).toContain('Acme Suite')
    expect(wrapper.get('[data-testid="plugin-detail"] .markdown-preview').text()).toContain('Acme Suite')
    expect(wrapper.vm.$route).toMatchObject({
      name: 'plugin-detail',
      params: { sourceId: 'acme', packageName },
      query: expect.objectContaining({ version: '0.1.0', from: 'marketplace' }),
    })
  })

  it('labels extension packs and expands independently managed included plugins', async () => {
    const childPackage = '@acme/craft-hub-plugin-child'
    const pack = {
      ...installedPlugin,
      manifest: {
        ...installedPlugin.manifest,
        includesPlugins: [{ package: childPackage, version: '^1.0.0' }],
      },
    }
    const child: InstalledPlugin = {
      ...installedPlugin,
      package: childPackage,
      version: '1.2.0',
      packagePath: '/plugins/acme-child',
      manifest: {
        ...installedPlugin.manifest,
        id: childPackage,
        displayName: 'Acme Child',
      },
    }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([{ ...catalogPlugin, includesPlugins: pack.manifest.includesPlugins }])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([pack, child])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({ package: childPackage, version: child.version, sourceId: 'acme', origin: 'marketplace', manifest: child.manifest, document: { status: 'missing' } })
    const remove = vi.spyOn(api, 'removePlugin').mockResolvedValue({ deleted: true })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const wrapper = await mountMarketplace()
    await flushPromises()

    expect(wrapper.get('.plugin-row .plugin-pack-count').text()).toBe('1')
    expect(wrapper.get('.plugin-row .plugin-pack-badge').text()).toBe('Extension Pack')
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    const packRow = wrapper.findAll('.installed-plugin-row').find(row => row.text().includes('Acme Suite'))!
    expect(packRow.text()).toContain('1/1 available')
    expect(packRow.text()).toContain('Remove pack')
    expect(packRow.text()).not.toContain('Disable')
    expect(packRow.get('[aria-expanded="false"]').text()).toBe('View included')

    await packRow.get('[aria-expanded="false"]').trigger('click')
    expect(packRow.get('[aria-expanded="true"]').text()).toBe('Hide included')
    expect(packRow.get('.plugin-pack-contents').text()).toContain('Acme Child')
    expect(packRow.get('.plugin-pack-contents').text()).toContain('1.2.0')
    expect(packRow.get('.plugin-pack-contents').text()).toContain('Enabled')

    await packRow.get('.plugin-pack-item').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="plugin-detail"]').text()).toContain('Acme Child')
    expect(wrapper.vm.$route).toMatchObject({ name: 'plugin-detail', params: { sourceId: 'acme', packageName: childPackage }, query: expect.objectContaining({ version: '1.2.0', parentName: 'Acme Suite' }) })
    await wrapper.get('.plugin-detail-back').trigger('click')
    await flushPromises()

    const returnedPackRow = wrapper.findAll('.installed-plugin-row').find(row => row.text().includes('Acme Suite'))!
    await returnedPackRow.findAll('button').find(button => button.text() === 'Remove pack')!.trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(packageName)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Included plugins will remain installed'))
  })

  it('loads and clearly labels a local plugin directory', async () => {
    const localPlugin = {
      ...installedPlugin,
      version: '0.2.0',
      sourceId: 'local' as const,
      origin: 'local' as const,
      linkedAt: '2026-09-01T00:00:00.000Z',
      installedAt: '2026-09-01T00:00:00.000Z',
      packagePath: '/workspace/plugin',
    }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([localPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const link = vi.spyOn(api, 'linkLocalPlugin').mockResolvedValue(localPlugin)

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')

    expect(wrapper.get('.installed-plugin-row .local-plugin-badge').text()).toBe('Local')
    expect(wrapper.get('.installed-plugin-row').text()).toContain('/workspace/plugin')
    expect(wrapper.get('.installed-plugin-row').text()).toContain('Unlink')
    expect(wrapper.get('.installed-plugin-row').text()).not.toContain('Uninstall')

    await wrapper.get('[data-testid="local-plugin-form"] input').setValue('/workspace/next-plugin')
    await wrapper.get('[data-testid="local-plugin-form"]').trigger('submit')
    await flushPromises()
    expect(link).toHaveBeenCalledWith('/workspace/next-plugin')
  })

  it('offers a reviewed manual update when the Catalog has a newer version', async () => {
    const update = { ...catalogPlugin, version: '0.2.0' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([update])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'previewPluginInstall').mockResolvedValue({
      sourceId: 'acme',
      rootPackage: packageName,
      items: [{ package: packageName, version: '0.2.0', displayName: 'Acme Suite', sourceId: 'acme', permissions: [], action: 'install', root: true }],
      permissions: [],
    })
    const install = vi.spyOn(api, 'installPlugin').mockResolvedValue({ ...installedPlugin, version: '0.2.0', previousVersion: '0.1.0' })
    vi.stubGlobal('confirm', vi.fn(() => true))

    const wrapper = await mountMarketplace()
    await flushPromises()
    const button = wrapper.get('.plugin-row > .ui-button')
    expect(button.text()).toBe('Update')
    await button.trigger('click')
    await flushPromises()

    expect(install).toHaveBeenCalledWith('acme', packageName, '0.2.0')
  })

  it('shows the built-in source identity and its online Catalog JSON location', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([builtinSource])

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(3)').trigger('click')

    expect(wrapper.get('.source-heading').text()).toContain('Craft Hub')
    expect(wrapper.get('.source-heading').text()).toContain('craft-hub')
    expect(wrapper.get('[data-testid="source-catalog-url"]').attributes()).toMatchObject({
      href: catalogUrl,
      rel: 'noreferrer',
      target: '_blank',
    })
    expect(wrapper.get('[data-testid="source-catalog-url"]').text()).toBe(catalogUrl)
  })

  it('separates source ownership from Catalog validation', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([
      { ...builtinSource, id: 'managed', kind: 'managed', name: 'Managed catalog' },
      {
        ...builtinSource,
        id: 'user:acme',
        kind: 'user',
        name: 'User catalog',
        verification: { policyId: 'enterprise', organization: 'Example Enterprise', verifiedAt: '2026-08-31T00:00:00.000Z' },
      },
    ])

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(3)').trigger('click')

    const rows = wrapper.findAll('.source-row')
    expect(rows[0]!.get('.source-kind').text()).toBe('Distribution managed')
    expect(rows[0]!.get('.source-kind').attributes('title')).toBe('Provided and managed by this Craft Hub distribution.')
    expect(rows[0]!.get('.source-validation').text()).toBe('Catalog validated')
    expect(rows[1]!.get('.source-kind').text()).toBe('User added')
    expect(rows[1]!.get('.source-kind').attributes('title')).toContain('publisher identity is not asserted')
    expect(rows[1]!.get('.source-verification').text()).toBe('Enterprise source')
    expect(rows[1]!.get('.source-verification').attributes('title')).toContain('Example Enterprise')
    expect(rows[1]!.get('.source-validation').text()).toBe('Catalog validated')
  })

  it('opens an accessible confirmation dialog after a source preview succeeds', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const verifiedPreview: MarketplaceSourcePreview = {
      ...sourcePreview,
      verification: { policyId: 'enterprise', organization: 'Example Enterprise', verifiedAt: '2026-08-31T00:00:00.000Z' },
    }
    vi.spyOn(api, 'previewMarketplaceSource').mockResolvedValue(verifiedPreview)
    const addSource = vi.spyOn(api, 'addMarketplaceSource').mockResolvedValue({
      id: 'user:acme',
      name: sourcePreview.name,
      kind: 'user',
      enabled: true,
      catalogUrl: sourcePreview.catalogUrl,
      registry: sourcePreview.registry,
      catalog: sourcePreview.catalog,
    })

    const wrapper = await mountMarketplace({ open: true, importCatalogUrl: sourcePreview.catalogUrl }, document.body)
    await flushPromises()
    expect(wrapper.findAll('.source-field-label small').map(label => label.text())).toEqual(['Auto-filled', 'Auto-filled'])
    await wrapper.get('.source-form').trigger('submit')
    await flushPromises()

    const dialog = document.body.querySelector<HTMLElement>('[data-testid="source-confirm-dialog"]')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.textContent).toContain('Acme Plugins')
    expect(dialog.textContent).toContain('Example Enterprise')
    expect(dialog.textContent).toContain(sourcePreview.catalogUrl)
    expect(dialog.textContent).toContain('Acme Suite')

    const confirmButton = dialog.querySelector<HTMLButtonElement>('[data-testid="confirm-source-import"]')!
    confirmButton.click()
    await flushPromises()
    expect(addSource).toHaveBeenCalledWith({
      name: sourcePreview.name,
      catalogUrl: sourcePreview.catalogUrl,
      registry: sourcePreview.registry,
    })
  })

  it('keeps preview failures beside the form and offers a retry', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'previewMarketplaceSource').mockRejectedValue(new Error('fetch failed'))

    const wrapper = await mountMarketplace({ open: true, importCatalogUrl: sourcePreview.catalogUrl })
    await flushPromises()
    await wrapper.get('.source-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid="source-confirm-dialog"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="source-preview-error"]').text()).toContain('fetch failed')
    expect(wrapper.get('[data-testid="retry-source-preview"]').text()).toBeTruthy()
  })
})
