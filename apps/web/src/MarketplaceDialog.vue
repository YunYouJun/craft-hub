<script setup lang="ts">
import type { CatalogPluginV1, InstalledPlugin, MarketplaceSource } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
import { useI18n } from './i18n'

const props = defineProps<{ open: boolean }>()
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

const filteredCatalog = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  return catalog.value.filter(plugin => !normalized
    || plugin.displayName.toLowerCase().includes(normalized)
    || plugin.package.toLowerCase().includes(normalized)
    || plugin.description?.toLowerCase().includes(normalized))
})
const installedPackages = computed(() => new Set(installed.value.map(plugin => plugin.package)))

watch(() => props.open, (open) => {
  if (open)
    void load()
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
  const permissions = plugin.permissions.join(', ') || t('none')
  if (!window.confirm(t('confirmPluginInstall', { package: plugin.package, version: plugin.version, source: plugin.sourceName, permissions })))
    return
  await operate(`install:${plugin.package}`, async () => {
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

async function addSource(): Promise<void> {
  if (!sourceName.value.trim() || !catalogUrl.value.trim())
    return
  await operate('add-source', async () => {
    await api.addMarketplaceSource({
      name: sourceName.value.trim(),
      catalogUrl: catalogUrl.value.trim(),
      registry: registry.value.trim() || undefined,
    })
    sourceName.value = ''
    catalogUrl.value = ''
    registry.value = ''
  }, true)
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
              <div class="plugin-mark"><Icon name="plugins" /></div>
              <div class="plugin-copy">
                <div class="plugin-title"><strong>{{ plugin.displayName }}</strong><code>{{ plugin.package }}</code></div>
                <p>{{ plugin.description }}</p>
                <dl><div><dt>{{ t('pluginPublisher') }}</dt><dd>{{ plugin.publisher }}</dd></div><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div><dt>{{ t('pluginSource') }}</dt><dd>{{ plugin.sourceName }}</dd></div></dl>
                <p class="permission-copy">{{ t('pluginPermissions') }} · {{ plugin.permissions.join(', ') || t('none') }}</p>
              </div>
              <button class="primary-button" :disabled="busy !== '' || installedPackages.has(plugin.package)" @click="install(plugin)">
                {{ busy === `install:${plugin.package}` ? t('installingPlugin') : installedPackages.has(plugin.package) ? t('installedPlugins') : t('installPlugin') }}
              </button>
            </article>
          </div>
          <p v-else class="marketplace-empty">{{ t('noPluginsFound') }}</p>
        </section>

        <section v-else-if="activeTab === 'installed'" class="marketplace-view">
          <div v-if="installed.length" class="plugin-list">
            <article v-for="plugin in installed" :key="plugin.package" class="plugin-row installed-plugin-row">
              <div class="plugin-mark" :class="{ disabled: !plugin.enabled }"><Icon name="plugins" /></div>
              <div class="plugin-copy">
                <div class="plugin-title"><strong>{{ plugin.manifest.displayName }}</strong><code>{{ plugin.package }}</code></div>
                <p>{{ plugin.manifest.description }}</p>
                <dl><div><dt>{{ t('pluginVersion') }}</dt><dd>{{ plugin.version }}</dd></div><div><dt>{{ t('pluginSource') }}</dt><dd>{{ plugin.sourceId }}</dd></div><div><dt>{{ t('pluginPermissions') }}</dt><dd>{{ plugin.manifest.permissions.join(', ') || t('none') }}</dd></div></dl>
              </div>
              <div class="plugin-actions">
                <button class="secondary-button" :disabled="busy !== ''" @click="togglePlugin(plugin)">{{ t(plugin.enabled ? 'disablePlugin' : 'enablePlugin') }}</button>
                <button class="secondary-button" :disabled="busy !== '' || !plugin.previousVersion" @click="rollback(plugin)">{{ t('rollbackPlugin') }}</button>
                <button class="secondary-button danger-button" :disabled="busy !== ''" @click="removePlugin(plugin)">{{ t('uninstallPlugin') }}</button>
              </div>
            </article>
          </div>
          <p v-else class="marketplace-empty">{{ t('noInstalledPlugins') }}</p>
        </section>

        <section v-else class="marketplace-view sources-view">
          <div class="source-list">
            <article v-for="source in sources" :key="source.id" class="source-row">
              <div><strong>{{ source.name }}</strong><small>{{ sourceKind(source) }} · {{ source.catalogUrl || source.id }}</small><p v-if="source.error">{{ source.error }}</p></div>
              <div class="plugin-actions">
                <button v-if="source.catalogUrl" class="secondary-button" :disabled="busy !== ''" @click="refreshSource(source)">{{ t('refreshSource') }}</button>
                <button v-if="source.kind === 'user'" class="secondary-button danger-button" :disabled="busy !== ''" @click="removeSource(source)">{{ t('removeSource') }}</button>
              </div>
            </article>
          </div>
          <form class="source-form" @submit.prevent="addSource">
            <h3>{{ t('addMarketplaceSource') }}</h3>
            <div class="source-fields">
              <label><span>{{ t('sourceName') }}</span><input v-model="sourceName" required></label>
              <label><span>{{ t('catalogUrl') }}</span><input v-model="catalogUrl" type="url" placeholder="https://…/catalog.json" required></label>
              <label><span>{{ t('registryUrl') }}</span><input v-model="registry" type="url" placeholder="https://registry.npmjs.org"></label>
            </div>
            <button class="primary-button" :disabled="busy !== '' || !sourceName.trim() || !catalogUrl.trim()">{{ t('addMarketplaceSource') }}</button>
          </form>
        </section>
  </section>
</template>
