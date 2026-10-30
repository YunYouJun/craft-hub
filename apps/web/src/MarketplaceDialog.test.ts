// @vitest-environment happy-dom
/// <reference lib="dom" />

import type { CatalogPluginV1, InstalledPlugin, MarketplaceSource, MarketplaceSourcePreview } from 'craft-hub'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { api } from './api'
import { useI18n } from './i18n'
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
    contributes: { commands: [], commandPresets: [], commandTemplates: [], packageQuickActions: [], packageLinks: [], packageToolGroups: [], navigationPanels: [], workbenches: [], skills: [], projectTemplates: [], integrations: [] },
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
  beforeEach(() => useI18n().setLocale('en'))
  afterEach(() => {
    window.craftHubDesktop = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the status label width reservation off the installed plugin switch', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    let finishToggle!: (value: InstalledPlugin) => void
    vi.spyOn(api, 'setPluginEnabled').mockReturnValue(new Promise((resolve) => {
      finishToggle = resolve
    }))
    const style = document.createElement('style')
    style.textContent = readFileSync(new NodeURL('./styles/marketplace.css', import.meta.url), 'utf8')
    document.head.append(style)
    const wrapper = await mountMarketplace({ open: true }, document.body)
    try {
      await flushPromises()
      await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
      const label = wrapper.get('.plugin-enable-toggle > span')
      const thumb = wrapper.get('[data-slot="switch-thumb"]')
      expect(getComputedStyle(label.element).minWidth).not.toBe('')
      expect(getComputedStyle(thumb.element).minWidth).toBe('')

      await wrapper.get('[role="switch"]').trigger('click')
      const spinner = wrapper.get('.ui-switch-spinner')
      expect(getComputedStyle(spinner.element).minWidth).toBe('')
    }
    finally {
      finishToggle({ ...installedPlugin, enabled: false })
      await flushPromises()
      wrapper.unmount()
      style.remove()
    }
  })

  it('announces initial loading without flashing empty catalog or installed states', async () => {
    let finishCatalog!: (value: Array<typeof catalogPlugin>) => void
    vi.spyOn(api, 'marketplaceCatalog').mockReturnValue(new Promise((resolve) => {
      finishCatalog = resolve
    }))
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const wrapper = await mountMarketplace()
    await flushPromises()

    expect(wrapper.get('[role="status"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[role="status"]').text()).toBe('Loading plugins…')
    expect(wrapper.find('.marketplace-empty').exists()).toBe(false)
    expect(wrapper.findAll('.plugin-row')).toHaveLength(0)
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.get('[role="status"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('.marketplace-empty').exists()).toBe(false)

    finishCatalog([catalogPlugin])
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.installed-plugin-row').text()).toContain('Acme Suite')
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Suite')
    wrapper.unmount()
  })

  it('filters installed plugins and genuine updates while combining search and clear', async () => {
    const current = { ...catalogPlugin, package: '@acme/current', displayName: 'Current plugin' }
    const available = { ...catalogPlugin, package: '@acme/available', displayName: 'Available plugin' }
    const otherSource = { ...catalogPlugin, package: '@acme/other-source', displayName: 'Other source plugin' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin, current, available, otherSource])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([
      { ...installedPlugin, version: '0.0.9' },
      { ...installedPlugin, package: current.package },
      { ...installedPlugin, package: otherSource.package, version: '0.0.9', sourceId: 'other' },
    ])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const wrapper = await mountMarketplace()
    await flushPromises()
    const filters = wrapper.get('[role="group"][aria-label="Filter plugins"]').findAll('button')
    expect(filters.map(filter => filter.text())).toEqual(['All4', 'Installed3', 'Updates1'])
    expect(wrapper.findAll('.plugin-row')).toHaveLength(4)

    await filters[1]!.trigger('click')
    expect(filters[1]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('Available plugin')
    await filters[2]!.trigger('click')
    expect(filters[2]!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Suite')

    await wrapper.get('.marketplace-search input').setValue('Current plugin')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(0)
    expect(wrapper.get('.marketplace-empty').text()).toContain('No plugins match this search.')
    await filters[0]!.trigger('click')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    expect(wrapper.get('.plugin-row').text()).toContain('Current plugin')
    await wrapper.get('.marketplace-search-clear').trigger('click')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(4)
    wrapper.unmount()
  })

  it('refreshes marketplace reads while keeping filters and source drafts', async () => {
    const catalog = vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    const installed = vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    const sources = vi.spyOn(api, 'marketplaceSources').mockResolvedValue([builtinSource])
    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-search input').setValue('Acme')
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click')
    const fields = wrapper.findAll<HTMLInputElement>('.source-fields input')
    await fields[0]!.setValue('My source draft')
    await fields[1]!.setValue('https://example.com/plugins/catalog.json')

    catalog.mockResolvedValue([{ ...catalogPlugin, description: 'Updated catalog description.' }])
    const refresh: unknown = Reflect.get(wrapper.vm, 'refresh')
    if (typeof refresh !== 'function')
      throw new TypeError('Marketplace refresh action is unavailable')
    await refresh()
    await flushPromises()

    expect(catalog).toHaveBeenCalledTimes(2)
    expect(installed).toHaveBeenCalledTimes(2)
    expect(sources).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[role="tab"]')[2]!.attributes('aria-selected')).toBe('true')
    expect(fields[0]!.element.value).toBe('My source draft')
    expect(fields[1]!.element.value).toBe('https://example.com/plugins/catalog.json')
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
    expect(wrapper.get<HTMLInputElement>('.marketplace-search input').element.value).toBe('Acme')
    expect(wrapper.get('.plugin-copy p').text()).toBe('Updated catalog description.')
    wrapper.unmount()
  })

  it('supports keyboard tab selection with one focus stop and a labelled content panel', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedPlugin])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([builtinSource])
    const wrapper = await mountMarketplace({ open: true }, document.body)
    await flushPromises()
    const tabs = wrapper.findAll('[role="tab"]')
    const tablist = wrapper.get('[role="tablist"]')
    const panel = wrapper.get('[role="tabpanel"]')
    expect(tabs).toHaveLength(3)
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    expect(tabs[0]!.attributes('aria-controls')).toBe(panel.attributes('id'))

    await tablist.trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[1]!.attributes('aria-selected')).toBe('true')
    expect(panel.attributes('aria-labelledby')).toBe(tabs[1]!.attributes('id'))
    expect(document.activeElement).toBe(tabs[1]!.element)
    expect(wrapper.find('.local-plugin-form').exists()).toBe(true)

    await tablist.trigger('keydown', { key: 'End' })
    expect(tabs[2]!.attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.source-form').exists()).toBe(true)
    await tablist.trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    await tablist.trigger('keydown', { key: 'ArrowLeft' })
    expect(tabs[2]!.attributes('aria-selected')).toBe('true')
    await tablist.trigger('keydown', { key: 'Home' })
    expect(tabs.map(tab => tab.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
    expect(document.activeElement).toBe(tabs[0]!.element)
    wrapper.unmount()
  })

  it('keeps tab navigation outside the scroll region when switching between different content lengths', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue(Array.from({ length: 18 }, (_, index) => ({
      ...catalogPlugin,
      package: `@acme/plugin-${index}`,
    })))
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const wrapper = await mountMarketplace({ open: true }, document.body)
    await flushPromises()
    const tablist = wrapper.get('[role="tablist"]')
    const scrollRegion = wrapper.get('.workbench-frame-scroll')

    expect(wrapper.findAll('.plugin-row')).toHaveLength(18)
    expect(scrollRegion.element.contains(tablist.element)).toBe(false)
    expect(scrollRegion.element.contains(wrapper.get('[role="tabpanel"]').element)).toBe(true)

    await tablist.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()

    expect(wrapper.find('.plugin-row').exists()).toBe(false)
    expect(wrapper.find('.local-plugin-form').exists()).toBe(true)
    expect(wrapper.get('[role="tablist"]').element).toBe(tablist.element)
    expect(scrollRegion.element.contains(tablist.element)).toBe(false)
    expect(document.activeElement).toBe(tablist.findAll('[role="tab"]')[1]!.element)
    wrapper.unmount()
  })

  it('includes the host extensions tab in keyboard navigation only when the host provides it', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const hostExtensions = vi.fn(async () => ({ extensions: [], diagnostics: [], restartRequired: false }))
    window.craftHubDesktop = { hostExtensions }
    const wrapper = await mountMarketplace({ open: true }, document.body)
    await flushPromises()
    expect(hostExtensions).not.toHaveBeenCalled()

    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'End' })
    await flushPromises()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(4)
    expect(tabs[3]!.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[3]!.element)
    expect(hostExtensions).toHaveBeenCalledOnce()
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    wrapper.unmount()
  })

  it('localizes plugin titles and descriptions, searches both languages, and falls back to the default title', async () => {
    const translated = { ...catalogPlugin, localizations: { 'zh-CN': { displayName: '示例工具', description: '中文插件简介' } } }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([translated])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([{ ...installedPlugin, manifest: { ...installedPlugin.manifest, localizations: translated.localizations } }])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    useI18n().setLocale('zh-CN')
    const wrapper = await mountMarketplace()
    await flushPromises()
    expect(wrapper.get('.plugin-title strong').text()).toBe('示例工具')
    expect(wrapper.get('.plugin-copy p').text()).toBe('中文插件简介')
    expect(wrapper.get('.plugin-summary-link').attributes('aria-label')).toContain('示例工具')
    const search = wrapper.get('.marketplace-search input')
    await search.setValue('示例')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    await search.setValue('Acme Suite')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('.installed-plugin-row .plugin-title strong').text()).toBe('示例工具')
    useI18n().setLocale('en')
    await flushPromises()
    expect(wrapper.get('.installed-plugin-row .plugin-title strong').text()).toBe('Acme Suite')
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
    await wrapper.get('[data-testid="installed-plugin-icon"]').trigger('error')
    expect(wrapper.find('[data-testid="installed-plugin-icon"]').exists()).toBe(false)
    expect(wrapper.find('.plugin-mark .plugins-icon').exists()).toBe(true)
  })

  it('keeps installed plugin failures compact and leaves the full message to diagnostics', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([{ ...installedPlugin, error: 'Manifest is incompatible with this host.' }])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')

    expect(wrapper.get('.plugin-error-badge').text()).toBe('Needs attention')
    expect(wrapper.get('.installed-plugin-row').text()).not.toContain('Manifest is incompatible with this host.')
  })

  it('shows a linked plugin asset in discovery, installed entries, and local details', async () => {
    const local = { ...installedPlugin, sourceId: 'local' as const, origin: 'local' as const, version: '0.1.1', linkedAt: '2026-09-01T00:00:00.000Z' }
    const asset = api.pluginIconUrl('local', packageName, local.version)
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([{ ...catalogPlugin, icon: undefined }])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([local])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({ package: packageName, version: local.version, sourceId: 'local', origin: 'local', manifest: local.manifest, document: { status: 'missing' } })

    const wrapper = await mountMarketplace()
    await flushPromises()
    expect(wrapper.get('[data-testid="plugin-icon"]').attributes('src')).toBe(asset)
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.get('[data-testid="installed-plugin-icon"]').attributes('src')).toBe(asset)
    await wrapper.get('.installed-plugin-row .plugin-summary-link').trigger('click')
    await flushPromises()
    expect(wrapper.get('.plugin-detail-icon img').attributes('src')).toBe(asset)
    await wrapper.get('.plugin-detail-icon img').trigger('error')
    expect(wrapper.find('.plugin-detail-icon img').exists()).toBe(false)
    expect(wrapper.find('.plugin-detail-icon .plugins-icon').exists()).toBe(true)
  })

  it('uses the downloaded manifest icon when an uninstalled catalog entry has no icon', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([{ ...catalogPlugin, icon: undefined }])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({ package: packageName, version: catalogPlugin.version, sourceId: 'acme', origin: 'marketplace', manifest: installedPlugin.manifest, document: { status: 'missing' } })

    const wrapper = await mountMarketplace()
    await flushPromises()
    expect(wrapper.find('[data-testid="plugin-icon"]').exists()).toBe(false)
    await wrapper.get('.plugin-summary-link').trigger('click')
    await flushPromises()
    expect(wrapper.get('.plugin-detail-icon img').attributes('src')).toBe(api.pluginIconUrl('acme', packageName, catalogPlugin.version))
  })

  it('shows one compact catalog row per plugin and keeps permissions in details', async () => {
    const installedOlder: InstalledPlugin = {
      ...installedPlugin,
      version: '0.0.9',
      manifest: { ...installedPlugin.manifest, permissions: ['remote-write'] },
    }
    const current: typeof catalogPlugin = {
      ...catalogPlugin,
      permissions: ['remote-write'],
      permissionReasons: { 'remote-write': 'Writes only after confirmation.' },
    }
    const deprecated = { ...catalogPlugin, version: '0.0.9', status: 'deprecated' as const, statusReason: 'Upgrade to 0.1.0.' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([current, deprecated])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([installedOlder])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({
      package: packageName,
      version: current.version,
      sourceId: 'acme',
      origin: 'marketplace',
      manifest: { ...installedPlugin.manifest, permissions: ['remote-write'] },
      document: { status: 'missing' },
    })

    const wrapper = await mountMarketplace()
    await flushPromises()

    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    expect(wrapper.get('.plugin-version-update').text()).toContain('0.0.9')
    expect(wrapper.get('.plugin-version-update').text()).toContain('0.1.0')
    expect(wrapper.get('.plugin-row').text()).not.toContain('remote-write')

    await wrapper.get('.plugin-summary-link').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="plugin-detail"]').text()).toContain('remote-write')
    expect(wrapper.get('[data-testid="plugin-detail"]').text()).toContain('Writes only after confirmation.')
  })

  it.each(['marketplace', 'local'] as const)('does not offer a downgrade as an upgrade for a newer %s plugin', async (origin) => {
    const active = origin === 'local'
      ? { ...installedPlugin, version: '0.1.1', sourceId: 'local' as const, origin, linkedAt: '2026-09-01T00:00:00.000Z' }
      : { ...installedPlugin, version: '0.1.1' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([active])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    vi.spyOn(api, 'pluginDocument').mockResolvedValue({ package: packageName, version: '0.1.0', sourceId: 'acme', origin: 'marketplace', manifest: installedPlugin.manifest, document: { status: 'missing' } })
    const install = vi.spyOn(api, 'previewPluginInstall')
    const wrapper = await mountMarketplace()
    await flushPromises()
    const row = wrapper.get('.plugin-row')
    expect(row.find('.plugin-version-update').exists()).toBe(false)
    expect(row.findAll('button').some(button => button.text() === 'Update')).toBe(false)
    expect(row.text()).toContain(origin === 'local' ? 'View local plugin' : 'Newer version installed')
    await wrapper.get('.plugin-summary-link').trigger('click')
    await flushPromises()
    const detail = wrapper.get('[data-testid="plugin-detail"]')
    expect(detail.text()).toContain(origin === 'local' ? 'View local plugin' : 'Newer version installed')
    if (origin === 'local') {
      await detail.findAll('button').find(button => button.text() === 'View local plugin')!.trigger('click')
      await flushPromises()
      expect(wrapper.vm.$route).toMatchObject({ params: { sourceId: 'local', packageName }, query: expect.objectContaining({ version: '0.1.1' }) })
    }
    expect(install).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([false, true])('blocks installing blocked catalog versions while preserving local navigation (linked: %s)', async (linked) => {
    const local = { ...installedPlugin, sourceId: 'local' as const, origin: 'local' as const, version: '0.2.0', linkedAt: '2026-09-01T00:00:00.000Z' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([{ ...catalogPlugin, status: 'blocked' }])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue(linked ? [local] : [])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const document = vi.spyOn(api, 'pluginDocument').mockImplementation(async (sourceId, packageName, version) => ({
      sourceId,
      package: packageName,
      version: version!,
      origin: sourceId === 'local' ? 'local' : 'marketplace',
      manifest: installedPlugin.manifest,
      document: { status: 'missing' },
    }))
    const preview = vi.spyOn(api, 'previewPluginInstall')
    const wrapper = await mountMarketplace()
    await flushPromises()

    const action = wrapper.get('.plugin-row > .ui-button')
    expect((action.element as HTMLButtonElement).disabled).toBe(!linked)
    if (linked) {
      await action.trigger('click')
      await flushPromises()
      expect(wrapper.vm.$route).toMatchObject({ params: { sourceId: 'local', packageName }, query: expect.objectContaining({ version: local.version }) })
      expect(document).toHaveBeenCalledWith('local', packageName, local.version, undefined)
      await wrapper.get('.plugin-detail-back').trigger('click')
      await flushPromises()
    }

    await wrapper.get('.plugin-summary-link').trigger('click')
    await flushPromises()
    const detailAction = wrapper.get('[data-testid="plugin-detail"] .plugin-actions .ui-button')
    expect((detailAction.element as HTMLButtonElement).disabled).toBe(!linked)
    if (linked) {
      await detailAction.trigger('click')
      await flushPromises()
      expect(wrapper.vm.$route).toMatchObject({ params: { sourceId: 'local', packageName }, query: expect.objectContaining({ version: local.version }) })
    }
    expect(preview).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('distinguishes changing sources from updating the same installed version', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([catalogPlugin])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([{ ...installedPlugin, sourceId: 'other-source' }])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const wrapper = await mountMarketplace()
    await flushPromises()
    const button = wrapper.get('.plugin-row > .ui-button')
    expect(button.text()).toBe('Install from this source')
    expect(button.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('groups extension-pack members by default while keeping them searchable', async () => {
    const childPackage = '@acme/craft-hub-plugin-child'
    const pack = { ...catalogPlugin, includesPlugins: [{ package: childPackage, version: '^1.0.0' }] }
    const child = { ...catalogPlugin, package: childPackage, version: '1.0.0', displayName: 'Acme Child', description: 'Specialized child module.' }
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([pack, child])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])

    const wrapper = await mountMarketplace()
    await flushPromises()

    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Suite')
    expect(wrapper.get('.plugin-pack-members').text()).toContain('Acme Child')
    expect(wrapper.get('.plugin-row > .ui-button').text()).toBe('Install all')
    await wrapper.get('select[aria-label="Plugin type"]').setValue('plugin')
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Child')
    await wrapper.get('select[aria-label="Plugin type"]').setValue('pack')
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Suite')
    await wrapper.get('select[aria-label="Plugin type"]').setValue('all')

    await wrapper.get('.marketplace-search input').setValue('child')
    expect(wrapper.findAll('.plugin-row')).toHaveLength(1)
    expect(wrapper.get('.plugin-row').text()).toContain('Acme Child')
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

    expect(wrapper.find('.plugin-row [data-testid="plugin-pack-icon"]').exists()).toBe(true)
    expect(wrapper.get('.plugin-row .plugin-pack-badge').text()).toBe('Plugin Pack')
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    expect(wrapper.findAll('.installed-plugin-row')).toHaveLength(1)
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
    expect(packRow.get('.plugin-pack-item-icon img').attributes('src')).toBe(api.pluginIconUrl('acme', childPackage, child.version))

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

  it('lets the desktop user choose a local plugin folder before loading it', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const selectProjectDirectory = vi.fn().mockResolvedValue('/workspace/chosen-plugin')
    window.craftHubDesktop = { platform: 'darwin', selectProjectDirectory }

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    await wrapper.get('[data-testid="local-plugin-form"] .ui-button--secondary').trigger('click')
    await flushPromises()

    expect(selectProjectDirectory).toHaveBeenCalledWith(undefined)
    expect((wrapper.get('[data-testid="local-plugin-form"] input').element as HTMLInputElement).value).toBe('/workspace/chosen-plugin')
  })

  it('opens the plugin format and authoring guide outside the desktop app', async () => {
    vi.spyOn(api, 'marketplaceCatalog').mockResolvedValue([])
    vi.spyOn(api, 'installedPlugins').mockResolvedValue([])
    vi.spyOn(api, 'marketplaceSources').mockResolvedValue([])
    const openExternalUrl = vi.fn().mockResolvedValue(undefined)
    window.craftHubDesktop = { platform: 'darwin', openExternalUrl }

    const wrapper = await mountMarketplace()
    await flushPromises()
    await wrapper.get('.marketplace-tabs button:nth-child(2)').trigger('click')
    await wrapper.get('.local-plugin-format-help button').trigger('click')

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/YunYouJun/craft-hub/blob/main/docs/guide/plugin-authoring.md')
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
