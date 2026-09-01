<script setup lang="ts">
import type { CatalogPluginV1, ManagedPlugin, MarketplaceSource, MarketplaceSourcePreview } from 'craft-hub'
import { maxSatisfying, satisfies } from 'semver'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import PluginDetail from './PluginDetail.vue'

const props = defineProps<{ open: boolean, importCatalogUrl?: string }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
type CatalogItem = CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }
type PluginTarget = Pick<CatalogItem, 'displayName' | 'package' | 'sourceId' | 'version'>

const activeTab = ref<'discover' | 'installed' | 'sources'>('discover')
const catalog = ref<CatalogItem[]>([])
const installed = ref<ManagedPlugin[]>([])
const localPluginPath = ref('')
const sources = ref<MarketplaceSource[]>([])
const query = ref('')
const busy = ref('')
const error = ref('')
const sourceName = ref('')
const catalogUrl = ref('')
const registry = ref('')
const sourcePreview = ref<MarketplaceSourcePreview>()
const sourceError = ref('')
const sourceSuccess = ref('')
const failedIcons = ref(new Set<string>())
const expandedPacks = ref(new Set<string>())
const detailOpen = computed(() => route.name === 'plugin-detail')
const detailSourceId = computed(() => String(route.params.sourceId ?? ''))
const detailPackageName = computed(() => String(route.params.packageName ?? ''))
const detailVersion = computed(() => typeof route.query.version === 'string' ? route.query.version : undefined)
const detailParentName = computed(() => typeof route.query.parentName === 'string' ? route.query.parentName : undefined)

const filteredCatalog = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  return catalog.value.filter(plugin => !normalized
    || plugin.displayName.toLowerCase().includes(normalized)
    || plugin.package.toLowerCase().includes(normalized)
    || plugin.description?.toLowerCase().includes(normalized))
})
const installedPackages = computed(() => new Set(installed.value.map(plugin => plugin.package)))
const installedByPackage = computed(() => new Map(installed.value.map(plugin => [plugin.package, plugin])))

function catalogPluginInstalled(plugin: CatalogItem): boolean {
  return installedByPackage.value.get(plugin.package)?.version === plugin.version
}

function isPluginPack(plugin: ManagedPlugin): boolean {
  return plugin.manifest.includesPlugins.length > 0
}

function togglePluginPack(plugin: ManagedPlugin): void {
  const next = new Set(expandedPacks.value)
  if (next.has(plugin.package))
    next.delete(plugin.package)
  else
    next.add(plugin.package)
  expandedPacks.value = next
}

function includedPlugin(packageName: string): ManagedPlugin | undefined {
  return installedByPackage.value.get(packageName)
}

function includedPluginName(packageName: string, sourceId: string): string {
  return includedPlugin(packageName)?.manifest.displayName
    ?? catalog.value.find(plugin => plugin.sourceId === sourceId && plugin.package === packageName)?.displayName
    ?? packageName
}

function includedPluginStatus(packageName: string): string {
  const plugin = includedPlugin(packageName)
  if (!plugin)
    return t('pluginPackMissing')
  if (plugin.error)
    return t('pluginPackError')
  return t(plugin.enabled ? 'pluginPackEnabled' : 'pluginPackDisabled')
}

function installedPackCount(plugin: ManagedPlugin): number {
  return plugin.manifest.includesPlugins.filter(item => installedByPackage.value.has(item.package)).length
}

watch(() => props.open, (open) => {
  if (open) {
    if (route.query.tab === 'discover' || route.query.tab === 'installed' || route.query.tab === 'sources')
      activeTab.value = route.query.tab
    query.value = typeof route.query.q === 'string' ? route.query.q : ''
    void load()
  }
}, { immediate: true })

watch([activeTab, query], () => {
  if (route.name !== 'marketplace')
    return
  void router.replace({ name: 'marketplace', query: { tab: activeTab.value, ...(query.value ? { q: query.value } : {}) } })
})

watch(() => props.importCatalogUrl, (value) => {
  if (!value)
    return
  activeTab.value = 'sources'
  catalogUrl.value = value
  sourceName.value ||= new URL(value).hostname
}, { immediate: true })

async function load(): Promise<void> {
  error.value = ''
  try {
    const [nextCatalog, nextInstalled, nextSources] = await Promise.all([
      api.marketplaceCatalog(),
      api.installedPlugins(),
      api.marketplaceSources(),
    ])
    catalog.value = nextCatalog
    installed.value = nextInstalled
    sources.value = nextSources
    if (detailOpen.value && !detailVersion.value) {
      const version = nextInstalled.find(item => item.package === detailPackageName.value && (detailSourceId.value === 'local' ? item.origin === 'local' : item.sourceId === detailSourceId.value))?.version
        ?? nextCatalog.find(item => item.sourceId === detailSourceId.value && item.package === detailPackageName.value)?.version
      if (version)
        await router.replace({ query: { ...route.query, version } })
    }
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
}

async function install(plugin: CatalogItem): Promise<void> {
  await operate(`install:${plugin.package}`, async () => {
    const plan = await api.previewPluginInstall(plugin.sourceId, plugin.package, plugin.version)
    const changes = plan.items.filter(item => item.action !== 'none')
    const plugins = changes.map(item => `${item.displayName}@${item.version}`).join(', ') || plugin.displayName
    const permissions = plan.permissions.join(', ') || t('none')
    if (!window.confirm(t('confirmPluginBundleInstall', {
      package: plugin.package,
      version: plugin.version,
      source: plugin.sourceName,
      count: String(changes.length),
      plugins,
      permissions,
    })))
      return
    await api.installPlugin(plugin.sourceId, plugin.package, plugin.version)
  })
}

async function togglePlugin(plugin: ManagedPlugin): Promise<void> {
  await operate(`toggle:${plugin.package}`, async () => {
    await api.setPluginEnabled(plugin.package, !plugin.enabled)
  })
}

async function rollback(plugin: ManagedPlugin): Promise<void> {
  await operate(`rollback:${plugin.package}`, async () => {
    await api.rollbackPlugin(plugin.package)
  })
}

async function removePlugin(plugin: ManagedPlugin): Promise<void> {
  if (!window.confirm(t(isPluginPack(plugin) ? 'confirmPluginPackRemoval' : 'confirmPluginRemoval', { package: plugin.package })))
    return
  await operate(`remove:${plugin.package}`, async () => {
    await api.removePlugin(plugin.package)
  })
}

async function linkLocalPlugin(): Promise<void> {
  const path = localPluginPath.value.trim()
  if (!path)
    return
  await operate('link-local', async () => {
    await api.linkLocalPlugin(path)
    localPluginPath.value = ''
  })
}

async function refreshLocalPlugin(plugin: ManagedPlugin): Promise<void> {
  await operate(`refresh-local:${plugin.package}`, async () => {
    await api.refreshLocalPlugin(plugin.package)
  })
}

async function unlinkLocalPlugin(plugin: ManagedPlugin): Promise<void> {
  if (!window.confirm(t('confirmLocalPluginUnlink', { package: plugin.package })))
    return
  await operate(`unlink-local:${plugin.package}`, async () => {
    await api.unlinkLocalPlugin(plugin.package)
  })
}

async function previewSource(): Promise<void> {
  if (!sourceName.value.trim() || !catalogUrl.value.trim() || busy.value)
    return
  busy.value = 'preview-source'
  sourceError.value = ''
  sourceSuccess.value = ''
  try {
    sourcePreview.value = await api.previewMarketplaceSource({
      name: sourceName.value.trim(),
      catalogUrl: catalogUrl.value.trim(),
      registry: registry.value.trim() || undefined,
    })
  }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught)
    sourceError.value = /fetch failed/i.test(message)
      ? t('sourceNetworkFailed', { message })
      : t('sourceOperationFailed', { message })
  }
  finally {
    busy.value = ''
  }
}

async function addSource(): Promise<void> {
  if (!sourcePreview.value || busy.value)
    return
  busy.value = 'add-source'
  sourceError.value = ''
  sourceSuccess.value = ''
  try {
    await api.addMarketplaceSource({
      name: sourcePreview.value!.name,
      catalogUrl: sourcePreview.value!.catalogUrl,
      registry: sourcePreview.value!.registry,
    })
    const importedName = sourcePreview.value.name
    sourceName.value = ''
    catalogUrl.value = ''
    registry.value = ''
    sourcePreview.value = undefined
    await load()
    sourceSuccess.value = t('sourceImportSuccess', { name: importedName })
  }
  catch (caught) {
    sourceError.value = t('sourceOperationFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    busy.value = ''
  }
}

watch([sourceName, catalogUrl, registry], () => {
  sourcePreview.value = undefined
  sourceError.value = ''
  sourceSuccess.value = ''
})

function updateSourcePreviewOpen(open: boolean): void {
  if (!open && busy.value !== 'add-source')
    sourcePreview.value = undefined
}

async function refreshSource(source: MarketplaceSource): Promise<void> {
  await operate(`refresh:${source.id}`, async () => {
    await api.refreshMarketplaceSource(source.id)
  }, true)
}

async function removeSource(source: MarketplaceSource): Promise<void> {
  await operate(`source-remove:${source.id}`, async () => {
    await api.removeMarketplaceSource(source.id)
  }, true)
}

async function operate(key: string, operation: () => Promise<void>, sourceOperation = false): Promise<void> {
  if (busy.value)
    return
  busy.value = key
  error.value = ''
  try {
    await operation()
    await load()
  }
  catch (caught) {
    error.value = t(sourceOperation ? 'sourceOperationFailed' : 'pluginOperationFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    busy.value = ''
  }
}

function sourceKind(source: MarketplaceSource): string {
  return t(source.kind === 'builtin' ? 'sourceBuiltin' : source.kind === 'managed' ? 'sourceManaged' : 'sourceUser')
}

function sourceKindDescription(source: MarketplaceSource): string {
  return t(source.kind === 'builtin' ? 'sourceBuiltinDescription' : source.kind === 'managed' ? 'sourceManagedDescription' : 'sourceUserDescription')
}

function catalogIconKey(plugin: CatalogItem): string {
  return `${plugin.sourceId}:${plugin.package}:${plugin.version}`
}

function installedIconKey(plugin: ManagedPlugin): string {
  return `${plugin.sourceId}:${plugin.package}:${plugin.version}`
}

function visibleIcon(key: string, icon: string | undefined): string | undefined {
  return icon && !failedIcons.value.has(key) ? icon : undefined
}

function installedIcon(plugin: ManagedPlugin): string | undefined {
  return catalog.value.find(item => item.sourceId === plugin.sourceId && item.package === plugin.package && item.version === plugin.version)?.icon
    ?? (plugin.manifest.icon?.startsWith('https://') ? plugin.manifest.icon : undefined)
}

function markIconFailed(key: string): void {
  failedIcons.value = new Set([...failedIcons.value, key])
}

async function openPluginDetail(sourceId: string, packageName: string, version: string, parentName?: string): Promise<void> {
  await router.push({
    name: 'plugin-detail',
    params: { sourceId, packageName },
    query: {
      version,
      from: detailOpen.value ? 'detail' : 'marketplace',
      tab: activeTab.value,
      ...(query.value ? { q: query.value } : {}),
      ...(parentName ? { parentName } : {}),
    },
  })
}

async function closePluginDetail(): Promise<void> {
  if (route.query.from === 'detail' || route.query.from === 'marketplace') {
    router.back()
    return
  }
  await router.push({ name: 'marketplace', query: { tab: activeTab.value, ...(query.value ? { q: query.value } : {}) } })
}

function includedCatalogPlugin(parent: ManagedPlugin, packageName: string, range: string): PluginTarget | undefined {
  const local = parent.origin === 'local'
    ? installed.value.find(item => item.origin === 'local' && item.package === packageName && satisfies(item.version, range, { includePrerelease: true }))
    : undefined
  if (local) {
    return {
      package: local.package,
      version: local.version,
      displayName: local.manifest.displayName,
      sourceId: 'local',
    }
  }
  const candidates = catalog.value.filter(item => item.sourceId === parent.sourceId && item.package === packageName)
  const installedPlugin = installed.value.find(item => item.sourceId === parent.sourceId && item.package === packageName && satisfies(item.version, range, { includePrerelease: true }))
  if (installedPlugin)
    return { sourceId: installedPlugin.sourceId, package: installedPlugin.package, version: installedPlugin.version, displayName: installedPlugin.manifest.displayName }
  const version = maxSatisfying(candidates.map(item => item.version), range, { includePrerelease: true })
  return version ? candidates.find(item => item.version === version) : undefined
}

function openIncludedPlugin(parent: ManagedPlugin, packageName: string, range: string): void {
  const target = includedCatalogPlugin(parent, packageName, range)
  if (target)
    void openPluginDetail(target.sourceId, target.package, target.version, parent.manifest.displayName)
}
</script>

<template>
  <section v-if="open" class="marketplace-page" role="region" :aria-label="t('pluginMarketplace')">
    <PluginDetail
      v-if="detailOpen"
      :catalog="catalog"
      :installed="installed"
      :package-name="detailPackageName"
      :parent-name="detailParentName"
      :source-id="detailSourceId"
      :version="detailVersion"
      @back="closePluginDetail"
      @changed="load"
      @navigate="openPluginDetail"
    />
    <div v-show="!detailOpen" class="marketplace-index">
        <header class="marketplace-header">
          <div>
            <h2>{{ t('pluginMarketplace') }}</h2>
            <p>{{ t('pluginMarketplaceDescription') }}</p>
          </div>
        </header>

        <nav class="marketplace-tabs" :aria-label="t('pluginMarketplace')">
          <button :class="{ active: activeTab === 'discover' }" @click="activeTab = 'discover'">{{ t('discoverPlugins') }}</button>
          <button :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">{{ t('installedPlugins') }} <small>{{ installed.length }}</small></button>
          <button :class="{ active: activeTab === 'sources' }" @click="activeTab = 'sources'">{{ t('marketplaceSources') }}</button>
        </nav>

        <p v-if="error" class="marketplace-error" role="alert">{{ error }}</p>

        <section v-if="activeTab === 'discover'" class="marketplace-view">
          <label class="marketplace-search"><Icon name="search" /><input v-model="query" :placeholder="t('searchPlugins')"></label>
          <div v-if="filteredCatalog.length" class="plugin-list">
            <article v-for="plugin in filteredCatalog" :key="`${plugin.sourceId}:${plugin.package}:${plugin.version}`" class="plugin-row">
              <button class="plugin-summary-link" :aria-label="t('viewPluginDetails', { name: plugin.displayName })" @click="openPluginDetail(plugin.sourceId, plugin.package, plugin.version)">
                <div class="plugin-mark" :class="{ 'has-pack-count': plugin.includesPlugins.length }">
                  <img v-if="visibleIcon(catalogIconKey(plugin), plugin.icon)" data-testid="plugin-icon" :src="visibleIcon(catalogIconKey(plugin), plugin.icon)" alt="" referrerpolicy="no-referrer" @error="markIconFailed(catalogIconKey(plugin))">
                  <Icon v-else name="plugins" />
                  <span v-if="plugin.includesPlugins.length" class="plugin-pack-count" :aria-label="t('pluginPackCount', { count: String(plugin.includesPlugins.length) })">{{ plugin.includesPlugins.length }}</span>
                </div>
                <div class="plugin-copy">
                  <div class="plugin-title"><strong>{{ plugin.displayName }}</strong><span v-if="plugin.includesPlugins.length" class="plugin-pack-badge">{{ t('pluginPackBadge') }}</span><code>{{ plugin.package }}</code><span class="view-plugin-detail">{{ t('viewPluginDetailsAction') }}</span></div>
                  <p>{{ plugin.description }}</p>
                  <dl><div><dt>{{ t('pluginPublisher') }}</dt><dd>{{ plugin.publisher }}</dd></div><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div><dt>{{ t('pluginSource') }}</dt><dd>{{ plugin.sourceName }}</dd></div></dl>
                  <p class="permission-copy">{{ t('pluginPermissions') }} · {{ plugin.permissions.join(', ') || t('none') }}</p>
                </div>
              </button>
              <UiButton size="compact" variant="primary" :disabled="busy !== '' || (catalogPluginInstalled(plugin) && !plugin.requiresPlugins.length && !plugin.includesPlugins.length)" @click="install(plugin)">
                {{ busy === `install:${plugin.package}` ? t('installingPlugin') : catalogPluginInstalled(plugin) ? t('repairPluginBundle') : installedPackages.has(plugin.package) ? t('updatePlugin') : t('installPlugin') }}
              </UiButton>
            </article>
          </div>
          <p v-else class="marketplace-empty">{{ t('noPluginsFound') }}</p>
        </section>

        <section v-else-if="activeTab === 'installed'" class="marketplace-view">
          <form class="local-plugin-form" data-testid="local-plugin-form" @submit.prevent="linkLocalPlugin">
            <div>
              <h3>{{ t('loadLocalPlugin') }} <span class="local-plugin-badge">{{ t('localPluginBadge') }}</span></h3>
              <p>{{ t('loadLocalPluginDescription') }}</p>
            </div>
            <div class="local-plugin-controls">
              <input v-model="localPluginPath" :placeholder="t('localPluginPathPlaceholder')" aria-label="Local plugin path" required>
              <UiButton variant="primary" type="submit" :disabled="busy !== '' || !localPluginPath.trim()">
                {{ busy === 'link-local' ? t('loadingLocalPlugin') : t('loadLocalPluginAction') }}
              </UiButton>
            </div>
          </form>
          <div v-if="installed.length" class="plugin-list">
            <article v-for="plugin in installed" :key="plugin.package" class="plugin-row installed-plugin-row" :class="{ 'plugin-pack-row': isPluginPack(plugin) }">
              <button class="plugin-summary-link" :aria-label="t('viewPluginDetails', { name: plugin.manifest.displayName })" @click="openPluginDetail(plugin.sourceId, plugin.package, plugin.version)">
                <div class="plugin-mark" :class="{ disabled: !plugin.enabled, 'has-pack-count': isPluginPack(plugin) }">
                  <img v-if="visibleIcon(installedIconKey(plugin), installedIcon(plugin))" data-testid="installed-plugin-icon" :src="visibleIcon(installedIconKey(plugin), installedIcon(plugin))" alt="" referrerpolicy="no-referrer" @error="markIconFailed(installedIconKey(plugin))">
                  <Icon v-else name="plugins" />
                  <span v-if="isPluginPack(plugin)" class="plugin-pack-count" :aria-label="t('pluginPackCount', { count: String(plugin.manifest.includesPlugins.length) })">{{ plugin.manifest.includesPlugins.length }}</span>
                </div>
                <div class="plugin-copy">
                  <div class="plugin-title"><strong>{{ plugin.manifest.displayName }}</strong><span v-if="isPluginPack(plugin)" class="plugin-pack-badge">{{ t('pluginPackBadge') }}</span><span v-if="plugin.origin === 'local'" class="local-plugin-badge">{{ t('localPluginBadge') }}</span><code>{{ plugin.package }}</code><span class="view-plugin-detail">{{ t('viewPluginDetailsAction') }}</span></div>
                  <p>{{ plugin.manifest.description }}</p>
                  <dl><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div v-if="isPluginPack(plugin)"><dt>{{ t('pluginPackContents') }}</dt><dd>{{ t('pluginPackAvailability', { installed: String(installedPackCount(plugin)), total: String(plugin.manifest.includesPlugins.length) }) }}</dd></div><div><dt>{{ t(plugin.origin === 'local' ? 'localPluginPath' : 'pluginSource') }}</dt><dd>{{ plugin.origin === 'local' ? plugin.packagePath : plugin.sourceId }}</dd></div><div><dt>{{ t('pluginPermissions') }}</dt><dd>{{ plugin.manifest.permissions.join(', ') || t('none') }}</dd></div></dl>
                  <p v-if="plugin.error" class="local-plugin-error" role="alert">{{ plugin.error }}</p>
                </div>
              </button>
              <div class="plugin-actions">
                <UiButton v-if="isPluginPack(plugin)" size="compact" :aria-expanded="expandedPacks.has(plugin.package)" @click="togglePluginPack(plugin)">{{ t(expandedPacks.has(plugin.package) ? 'hidePluginPackContents' : 'showPluginPackContents') }}</UiButton>
                <UiButton v-else size="compact" :disabled="busy !== ''" @click="togglePlugin(plugin)">{{ t(plugin.enabled ? 'disablePlugin' : 'enablePlugin') }}</UiButton>
                <UiButton v-if="plugin.origin === 'local'" size="compact" :disabled="busy !== ''" @click="refreshLocalPlugin(plugin)">{{ t('refreshLocalPlugin') }}</UiButton>
                <UiButton v-else-if="!isPluginPack(plugin)" size="compact" :disabled="busy !== '' || !plugin.previousVersion" @click="rollback(plugin)">{{ t('rollbackPlugin') }}</UiButton>
                <UiButton v-if="plugin.origin === 'local'" size="compact" variant="danger-secondary" :disabled="busy !== ''" @click="unlinkLocalPlugin(plugin)">{{ t('unlinkLocalPlugin') }}</UiButton>
                <UiButton v-else size="compact" variant="danger-secondary" :disabled="busy !== ''" @click="removePlugin(plugin)">{{ t(isPluginPack(plugin) ? 'removePluginPack' : 'uninstallPlugin') }}</UiButton>
              </div>
              <section v-if="isPluginPack(plugin) && expandedPacks.has(plugin.package)" class="plugin-pack-contents" :aria-label="t('pluginPackContents')">
                <header><strong>{{ t('pluginPackContentsWithCount', { count: String(plugin.manifest.includesPlugins.length) }) }}</strong><span>{{ t('pluginPackIndependent') }}</span></header>
                <div class="plugin-pack-grid">
                  <button v-for="included in plugin.manifest.includesPlugins" :key="included.package" class="plugin-pack-item" :disabled="!includedCatalogPlugin(plugin, included.package, included.version)" @click="openIncludedPlugin(plugin, included.package, included.version)">
                    <div class="plugin-pack-item-icon"><Icon name="plugins" /></div>
                    <div><strong>{{ includedPluginName(included.package, plugin.sourceId) }}</strong><code>{{ included.package }}</code></div>
                    <div class="plugin-pack-item-status"><span v-if="includedPlugin(included.package)?.origin === 'local'" class="local-plugin-badge">{{ t('localPluginBadge') }}</span><span>{{ includedPlugin(included.package)?.version || included.version }}</span><span :class="{ muted: !includedPlugin(included.package)?.enabled }">{{ includedPluginStatus(included.package) }}</span></div>
                  </button>
                </div>
              </section>
            </article>
          </div>
          <p v-else class="marketplace-empty">{{ t('noInstalledPlugins') }}</p>
        </section>

        <section v-else class="marketplace-view sources-view">
          <div class="source-list">
            <article v-for="source in sources" :key="source.id" class="source-row">
              <div class="source-copy">
                <div class="source-heading">
                  <strong>{{ source.name }}</strong>
                  <span class="source-kind" :title="sourceKindDescription(source)">{{ sourceKind(source) }}</span>
                  <span v-if="source.verification" class="source-verification" :title="t('sourcePublisherVerifiedDescription', { organization: source.verification.organization })">{{ t('sourcePublisherVerified') }}</span>
                  <span v-if="source.catalog && !source.error" class="source-validation">{{ t('sourceCatalogValidated') }}</span>
                  <code>{{ source.id }}</code>
                </div>
                <dl class="source-details">
                  <div>
                    <dt>{{ t('sourceCatalogLocation') }}</dt>
                    <dd>
                      <a v-if="source.catalogUrl" data-testid="source-catalog-url" :href="source.catalogUrl" target="_blank" rel="noreferrer">{{ source.catalogUrl }}</a>
                      <span v-else>{{ t('sourceBundledCatalog') }}</span>
                    </dd>
                  </div>
                  <div v-if="source.registry">
                    <dt>{{ t('sourceRegistryLocation') }}</dt>
                    <dd>{{ source.registry }}</dd>
                  </div>
                </dl>
                <p v-if="source.error">{{ source.error }}</p>
              </div>
              <div class="plugin-actions">
                <UiButton v-if="source.catalogUrl" size="compact" :disabled="busy !== ''" @click="refreshSource(source)">{{ t('refreshSource') }}</UiButton>
                <UiButton v-if="source.kind === 'user'" size="compact" variant="danger-secondary" :disabled="busy !== ''" @click="removeSource(source)">{{ t('removeSource') }}</UiButton>
              </div>
            </article>
          </div>
          <form class="source-form" @submit.prevent="previewSource">
            <h3>{{ t('addMarketplaceSource') }}</h3>
            <div class="source-fields">
              <label>
                <span class="source-field-label">{{ t('sourceName') }} <small v-if="importCatalogUrl">{{ t('autoFilled') }}</small></span>
                <input v-model="sourceName" required>
              </label>
              <label>
                <span class="source-field-label">{{ t('catalogUrl') }} <small v-if="importCatalogUrl">{{ t('autoFilled') }}</small></span>
                <input v-model="catalogUrl" type="url" placeholder="https://…/catalog.json" required>
              </label>
              <label><span>{{ t('registryUrl') }}</span><input v-model="registry" type="url" placeholder="https://registry.npmjs.org"></label>
            </div>
            <UiButton variant="primary" type="submit" :disabled="busy !== '' || !sourceName.trim() || !catalogUrl.trim()">
              {{ busy === 'preview-source' ? t('checkingMarketplaceSource') : t('previewMarketplaceSource') }}
            </UiButton>
            <div v-if="sourceError" class="source-form-error" data-testid="source-preview-error" role="alert">
              <p>{{ sourceError }}</p>
              <UiButton data-testid="retry-source-preview" size="compact" type="button" @click="previewSource">{{ t('retry') }}</UiButton>
            </div>
            <p v-if="sourceSuccess" class="source-form-success" role="status">{{ sourceSuccess }}</p>
          </form>
        </section>

        <DialogShell
          :open="Boolean(sourcePreview)"
          content-class="dialog-content source-confirm-dialog"
          data-testid="source-confirm-dialog"
          @update:open="updateSourcePreviewOpen"
        >
          <template #title>{{ t('sourcePreviewTitle') }}</template>
          <template #description>{{ t('sourcePreviewDescription') }}</template>
          <p v-if="sourcePreview?.verification" class="source-preview-verification" role="status">
            {{ t('sourcePublisherVerifiedDescription', { organization: sourcePreview.verification.organization }) }}
          </p>
          <dl v-if="sourcePreview" class="source-preview-details">
            <div><dt>{{ t('sourceName') }}</dt><dd>{{ sourcePreview.catalog.name }}</dd></div>
            <div><dt>{{ t('sourceCatalogLocation') }}</dt><dd>{{ sourcePreview.finalCatalogUrl }}</dd></div>
            <div><dt>{{ t('sourceRegistryLocation') }}</dt><dd>{{ sourcePreview.registry || t('sourceDefaultRegistry') }}</dd></div>
          </dl>
          <section v-if="sourcePreview" class="source-preview-plugins">
            <strong>{{ t('sourcePreviewPlugins', { count: String(sourcePreview.catalog.plugins.length) }) }}</strong>
            <ul>
              <li v-for="plugin in sourcePreview.catalog.plugins" :key="`${plugin.package}:${plugin.version}`">
                <span>{{ plugin.displayName }}</span><code>{{ plugin.package }}@{{ plugin.version }}</code>
              </li>
            </ul>
          </section>
          <footer>
            <UiButton :disabled="busy === 'add-source'" @click="updateSourcePreviewOpen(false)">{{ t('cancel') }}</UiButton>
            <UiButton data-testid="confirm-source-import" variant="primary" :disabled="busy !== ''" @click="addSource">
              {{ busy === 'add-source' ? t('adding') : t('confirmMarketplaceSourceImport') }}
            </UiButton>
          </footer>
        </DialogShell>
    </div>
  </section>
</template>
