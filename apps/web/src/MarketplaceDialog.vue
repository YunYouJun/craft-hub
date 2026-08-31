<script setup lang="ts">
import type { CatalogPluginV1, InstalledPlugin, MarketplaceSource, MarketplaceSourcePreview } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ open: boolean, importCatalogUrl?: string }>()
const { t } = useI18n()
type CatalogItem = CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }

const activeTab = ref<'discover' | 'installed' | 'sources'>('discover')
const catalog = ref<CatalogItem[]>([])
const installed = ref<InstalledPlugin[]>([])
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

watch(() => props.open, (open) => {
  if (open)
    void load()
}, { immediate: true })

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

async function togglePlugin(plugin: InstalledPlugin): Promise<void> {
  await operate(`toggle:${plugin.package}`, async () => {
    await api.setPluginEnabled(plugin.package, !plugin.enabled)
  })
}

async function rollback(plugin: InstalledPlugin): Promise<void> {
  await operate(`rollback:${plugin.package}`, async () => {
    await api.rollbackPlugin(plugin.package)
  })
}

async function removePlugin(plugin: InstalledPlugin): Promise<void> {
  if (!window.confirm(t('confirmPluginRemoval', { package: plugin.package })))
    return
  await operate(`remove:${plugin.package}`, async () => {
    await api.removePlugin(plugin.package)
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

function installedIconKey(plugin: InstalledPlugin): string {
  return `${plugin.sourceId}:${plugin.package}:${plugin.version}`
}

function visibleIcon(key: string, icon: string | undefined): string | undefined {
  return icon && !failedIcons.value.has(key) ? icon : undefined
}

function installedIcon(plugin: InstalledPlugin): string | undefined {
  return catalog.value.find(item => item.sourceId === plugin.sourceId && item.package === plugin.package && item.version === plugin.version)?.icon
    ?? (plugin.manifest.icon?.startsWith('https://') ? plugin.manifest.icon : undefined)
}

function markIconFailed(key: string): void {
  failedIcons.value = new Set([...failedIcons.value, key])
}
</script>

<template>
  <section v-if="open" class="marketplace-page" role="region" :aria-label="t('pluginMarketplace')">
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
              <div class="plugin-mark">
                <img v-if="visibleIcon(catalogIconKey(plugin), plugin.icon)" data-testid="plugin-icon" :src="visibleIcon(catalogIconKey(plugin), plugin.icon)" alt="" referrerpolicy="no-referrer" @error="markIconFailed(catalogIconKey(plugin))">
                <Icon v-else name="plugins" />
              </div>
              <div class="plugin-copy">
                <div class="plugin-title"><strong>{{ plugin.displayName }}</strong><code>{{ plugin.package }}</code></div>
                <p>{{ plugin.description }}</p>
                <dl><div><dt>{{ t('pluginPublisher') }}</dt><dd>{{ plugin.publisher }}</dd></div><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div><dt>{{ t('pluginSource') }}</dt><dd>{{ plugin.sourceName }}</dd></div></dl>
                <p class="permission-copy">{{ t('pluginPermissions') }} · {{ plugin.permissions.join(', ') || t('none') }}</p>
              </div>
              <UiButton size="compact" variant="primary" :disabled="busy !== '' || (catalogPluginInstalled(plugin) && !plugin.requiresPlugins.length)" @click="install(plugin)">
                {{ busy === `install:${plugin.package}` ? t('installingPlugin') : catalogPluginInstalled(plugin) ? t('repairPluginBundle') : installedPackages.has(plugin.package) ? t('updatePlugin') : t('installPlugin') }}
              </UiButton>
            </article>
          </div>
          <p v-else class="marketplace-empty">{{ t('noPluginsFound') }}</p>
        </section>

        <section v-else-if="activeTab === 'installed'" class="marketplace-view">
          <div v-if="installed.length" class="plugin-list">
            <article v-for="plugin in installed" :key="plugin.package" class="plugin-row installed-plugin-row">
              <div class="plugin-mark" :class="{ disabled: !plugin.enabled }">
                <img v-if="visibleIcon(installedIconKey(plugin), installedIcon(plugin))" data-testid="installed-plugin-icon" :src="visibleIcon(installedIconKey(plugin), installedIcon(plugin))" alt="" referrerpolicy="no-referrer" @error="markIconFailed(installedIconKey(plugin))">
                <Icon v-else name="plugins" />
              </div>
              <div class="plugin-copy">
                <div class="plugin-title"><strong>{{ plugin.manifest.displayName }}</strong><code>{{ plugin.package }}</code></div>
                <p>{{ plugin.manifest.description }}</p>
                <dl><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div><dt>{{ t('pluginSource') }}</dt><dd>{{ plugin.sourceId }}</dd></div><div><dt>{{ t('pluginPermissions') }}</dt><dd>{{ plugin.manifest.permissions.join(', ') || t('none') }}</dd></div></dl>
              </div>
              <div class="plugin-actions">
                <UiButton size="compact" :disabled="busy !== ''" @click="togglePlugin(plugin)">{{ t(plugin.enabled ? 'disablePlugin' : 'enablePlugin') }}</UiButton>
                <UiButton size="compact" :disabled="busy !== '' || !plugin.previousVersion" @click="rollback(plugin)">{{ t('rollbackPlugin') }}</UiButton>
                <UiButton size="compact" variant="danger-secondary" :disabled="busy !== ''" @click="removePlugin(plugin)">{{ t('uninstallPlugin') }}</UiButton>
              </div>
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
  </section>
</template>
