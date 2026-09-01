<script setup lang="ts">
import type { CatalogPluginV1, ManagedPlugin, MarketplaceSource, PluginDependencyV1, PluginDocumentPreview, PluginManifestV1 } from 'craft-hub'
import { maxSatisfying, satisfies } from 'semver'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import MarkdownPreview from './MarkdownPreview.vue'

type CatalogItem = CatalogPluginV1 & { sourceId: string, sourceName: string, sourceKind: MarketplaceSource['kind'] }
type PluginTarget = Pick<CatalogItem, 'displayName' | 'package' | 'sourceId' | 'version'>

const props = defineProps<{
  sourceId: string
  packageName: string
  version?: string
  catalog: CatalogItem[]
  installed: ManagedPlugin[]
  parentName?: string
}>()
const emit = defineEmits<{ back: [], navigate: [sourceId: string, packageName: string, version: string, parentName?: string], changed: [] }>()
const { locale, t } = useI18n()
const documentPreview = ref<PluginDocumentPreview>()
const documentPath = ref<string>()
const documentLoading = ref(false)
const documentError = ref('')
const busy = ref('')
const operationError = ref('')
let documentRequestId = 0

const catalogEntry = computed(() => props.catalog.find(item => item.sourceId === props.sourceId
  && item.package === props.packageName
  && (!props.version || item.version === props.version)))
const installedPlugin = computed(() => props.installed.find(item => item.package === props.packageName
  && (props.sourceId === 'local' ? item.origin === 'local' : item.sourceId === props.sourceId)
  && (!props.version || item.version === props.version)))
const resolvedVersion = computed(() => props.version ?? installedPlugin.value?.version ?? catalogEntry.value?.version)
const manifest = computed<PluginManifestV1 | undefined>(() => documentPreview.value?.manifest ?? installedPlugin.value?.manifest)
const metadata = computed(() => catalogEntry.value ?? manifest.value)
const localized = computed(() => metadata.value?.localizations?.[locale.value])
const displayName = computed(() => localized.value?.displayName ?? metadata.value?.displayName ?? props.packageName)
const description = computed(() => localized.value?.description ?? metadata.value?.description)
const permissions = computed(() => catalogEntry.value?.permissions ?? manifest.value?.permissions ?? [])
const permissionReasons = computed(() => ({ ...(metadata.value?.permissionReasons ?? {}), ...(localized.value?.permissionReasons ?? {}) }))
const links = computed(() => metadata.value?.links)
const maintainers = computed(() => metadata.value?.maintainers ?? [])
const includesPlugins = computed(() => catalogEntry.value?.includesPlugins ?? manifest.value?.includesPlugins ?? [])
const requiresPlugins = computed(() => catalogEntry.value?.requiresPlugins ?? manifest.value?.requiresPlugins ?? [])
const unavailable = computed(() => !catalogEntry.value && !installedPlugin.value)
const contributionGroups = computed(() => Object.entries(manifest.value?.contributes ?? {}).filter(([, items]) => items.length))

watch(() => [props.sourceId, props.packageName, resolvedVersion.value] as const, () => {
  documentPath.value = undefined
  void loadDocument()
}, { immediate: true })

async function loadDocument(path = documentPath.value): Promise<void> {
  if (!resolvedVersion.value || unavailable.value)
    return
  const requestId = ++documentRequestId
  documentLoading.value = true
  documentError.value = ''
  try {
    const preview = await api.pluginDocument(props.sourceId, props.packageName, resolvedVersion.value, path)
    if (requestId !== documentRequestId)
      return
    documentPreview.value = preview
    documentPath.value = documentPreview.value.document.path
  }
  catch (caught) {
    if (requestId === documentRequestId)
      documentError.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    if (requestId === documentRequestId)
      documentLoading.value = false
  }
}

async function loadReadme(): Promise<void> {
  documentPath.value = undefined
  await loadDocument('')
}

function relationTarget(dependency: PluginDependencyV1): PluginTarget | undefined {
  if (props.sourceId === 'local') {
    const local = props.installed.find(item => item.origin === 'local' && item.package === dependency.package && satisfies(item.version, dependency.version, { includePrerelease: true }))
    return local ? { sourceId: 'local', package: local.package, version: local.version, displayName: local.manifest.displayName } : undefined
  }
  const candidates = props.catalog.filter(item => item.sourceId === props.sourceId && item.package === dependency.package)
  const installed = props.installed.find(item => item.sourceId === props.sourceId && item.package === dependency.package && satisfies(item.version, dependency.version, { includePrerelease: true }))
  if (installed)
    return { sourceId: installed.sourceId, package: installed.package, version: installed.version, displayName: installed.manifest.displayName }
  const version = maxSatisfying(candidates.map(item => item.version), dependency.version, { includePrerelease: true })
  return version ? candidates.find(item => item.version === version) : undefined
}

function relationName(dependency: PluginDependencyV1): string {
  return relationTarget(dependency)?.displayName
    ?? props.installed.find(item => item.package === dependency.package)?.manifest.displayName
    ?? dependency.package
}

function navigateRelation(dependency: PluginDependencyV1): void {
  const target = relationTarget(dependency)
  if (target)
    emit('navigate', target.sourceId, target.package, target.version, displayName.value)
}

function assetUrl(path: string): string {
  return api.pluginDocumentAssetUrl(props.sourceId, props.packageName, resolvedVersion.value!, path)
}

async function operate(key: string, operation: () => Promise<unknown>): Promise<void> {
  if (busy.value)
    return
  busy.value = key
  operationError.value = ''
  try {
    await operation()
    emit('changed')
  }
  catch (caught) {
    operationError.value = t('pluginOperationFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    busy.value = ''
  }
}

async function install(): Promise<void> {
  const plugin = catalogEntry.value
  if (!plugin)
    return
  await operate('install', async () => {
    const plan = await api.previewPluginInstall(plugin.sourceId, plugin.package, plugin.version)
    const changes = plan.items.filter(item => item.action !== 'none')
    const plugins = changes.map(item => `${item.displayName}@${item.version}`).join(', ') || plugin.displayName
    if (!window.confirm(t('confirmPluginBundleInstall', {
      package: plugin.package,
      version: plugin.version,
      source: plugin.sourceName,
      count: String(changes.length),
      plugins,
      permissions: plan.permissions.join(', ') || t('none'),
    })))
      return
    await api.installPlugin(plugin.sourceId, plugin.package, plugin.version)
  })
}

async function toggle(): Promise<void> {
  if (installedPlugin.value)
    await operate('toggle', () => api.setPluginEnabled(installedPlugin.value!.package, !installedPlugin.value!.enabled))
}

async function rollback(): Promise<void> {
  if (installedPlugin.value)
    await operate('rollback', () => api.rollbackPlugin(installedPlugin.value!.package))
}

async function remove(): Promise<void> {
  const plugin = installedPlugin.value
  if (!plugin || !window.confirm(t(plugin.manifest.includesPlugins.length ? 'confirmPluginPackRemoval' : 'confirmPluginRemoval', { package: plugin.package })))
    return
  await operate('remove', () => plugin.origin === 'local' ? api.unlinkLocalPlugin(plugin.package) : api.removePlugin(plugin.package))
}

async function refreshLocal(): Promise<void> {
  if (installedPlugin.value?.origin === 'local')
    await operate('refresh', () => api.refreshLocalPlugin(installedPlugin.value!.package))
}

</script>

<template>
  <section class="plugin-detail" data-testid="plugin-detail">
    <header class="plugin-detail-header">
      <UiButton class="plugin-detail-back" variant="ghost" @click="emit('back')"><Icon name="arrowRight" />{{ parentName ? t('backToPlugin', { name: parentName }) : t('backToMarketplace') }}</UiButton>
      <div v-if="unavailable" class="plugin-detail-unavailable" role="alert">
        <h1>{{ packageName }}</h1>
        <p>{{ t('pluginVersionUnavailable', { version: version || t('unknown') }) }}</p>
      </div>
      <template v-else>
        <div class="plugin-detail-identity">
          <div class="plugin-detail-icon"><img v-if="catalogEntry?.icon" :src="catalogEntry.icon" alt="" referrerpolicy="no-referrer"><Icon v-else name="plugins" /></div>
          <div>
            <div class="plugin-detail-title"><h1>{{ displayName }}</h1><span v-if="includesPlugins.length" class="plugin-pack-badge">{{ t('pluginPackBadge') }}</span><span v-if="installedPlugin?.origin === 'local'" class="local-plugin-badge">{{ t('localPluginBadge') }}</span></div>
            <code>{{ packageName }}@{{ resolvedVersion }}</code>
            <p v-if="description">{{ description }}</p>
          </div>
        </div>
        <div class="plugin-actions">
          <UiButton v-if="catalogEntry" variant="primary" :disabled="Boolean(busy) || installedPlugin?.version === catalogEntry.version" @click="install">{{ busy === 'install' ? t('installingPlugin') : installedPlugin ? t('updatePlugin') : t('installPlugin') }}</UiButton>
          <UiButton v-if="installedPlugin && !includesPlugins.length" :disabled="Boolean(busy)" @click="toggle">{{ t(installedPlugin.enabled ? 'disablePlugin' : 'enablePlugin') }}</UiButton>
          <UiButton v-if="installedPlugin?.origin === 'local'" :disabled="Boolean(busy)" @click="refreshLocal">{{ t('refreshLocalPlugin') }}</UiButton>
          <UiButton v-else-if="installedPlugin && !includesPlugins.length" :disabled="Boolean(busy) || !installedPlugin.previousVersion" @click="rollback">{{ t('rollbackPlugin') }}</UiButton>
          <UiButton v-if="installedPlugin" variant="danger-secondary" :disabled="Boolean(busy)" @click="remove">{{ t(installedPlugin.origin === 'local' ? 'unlinkLocalPlugin' : includesPlugins.length ? 'removePluginPack' : 'uninstallPlugin') }}</UiButton>
        </div>
      </template>
    </header>

    <div v-if="!unavailable" class="plugin-detail-body">
      <aside class="plugin-detail-sidebar">
        <p v-if="operationError" class="marketplace-error" role="alert">{{ operationError }}</p>
        <section>
          <h2>{{ t('pluginDetails') }}</h2>
          <dl>
            <div><dt>{{ t('pluginVersion') }}</dt><dd>{{ resolvedVersion }}</dd></div>
            <div><dt>{{ t('pluginSource') }}</dt><dd>{{ catalogEntry?.sourceName ?? installedPlugin?.sourceId }}</dd></div>
            <div v-if="catalogEntry"><dt>{{ t('pluginPublisher') }}</dt><dd>{{ catalogEntry.publisher }}</dd></div>
            <div v-if="catalogEntry"><dt>{{ t('pluginStatus') }}</dt><dd>{{ catalogEntry.status }}<span v-if="catalogEntry.statusReason"> · {{ catalogEntry.statusReason }}</span></dd></div>
            <div><dt>{{ t('pluginInstallationStatus') }}</dt><dd>{{ installedPlugin ? t(installedPlugin.enabled ? 'pluginEnabled' : 'pluginDisabled') : t('pluginNotInstalled') }}</dd></div>
            <div v-if="catalogEntry?.requires"><dt>{{ t('pluginCompatibility') }}</dt><dd>Craft Hub {{ catalogEntry.requires }}</dd></div>
            <div v-if="installedPlugin?.origin === 'local'"><dt>{{ t('localPluginPath') }}</dt><dd>{{ installedPlugin.packagePath }}</dd></div>
            <div v-if="catalogEntry?.categories.length"><dt>{{ t('pluginCategories') }}</dt><dd>{{ catalogEntry.categories.join(', ') }}</dd></div>
            <div v-if="manifest"><dt>{{ t('pluginContributions') }}</dt><dd>{{ contributionGroups.reduce((total, [, items]) => total + items.length, 0) }}</dd></div>
          </dl>
          <ul v-if="contributionGroups.length" class="plugin-contribution-list"><li v-for="([kind, items]) in contributionGroups" :key="kind"><span>{{ kind }}</span><strong>{{ items.length }}</strong></li></ul>
        </section>

        <section>
          <h2>{{ t('pluginPermissions') }}</h2>
          <p v-if="!permissions.length" class="muted">{{ t('none') }}</p>
          <ul v-else class="plugin-detail-list"><li v-for="permission in permissions" :key="permission"><strong>{{ permission }}</strong><span v-if="permissionReasons[permission]">{{ permissionReasons[permission] }}</span></li></ul>
        </section>

        <section v-if="maintainers.length">
          <h2>{{ t('pluginMaintainers') }}</h2>
          <ul class="plugin-detail-list"><li v-for="maintainer in maintainers" :key="maintainer.url || maintainer.handle"><a v-if="maintainer.url" :href="maintainer.url" target="_blank" rel="noreferrer noopener">{{ maintainer.name || maintainer.handle || maintainer.url }}</a><span v-else>{{ maintainer.name || maintainer.handle }}</span></li></ul>
        </section>

        <section v-if="links && Object.keys(links).length">
          <h2>{{ t('pluginLinks') }}</h2>
          <ul class="plugin-detail-list"><li v-for="(href, label) in links" :key="label"><a :href="href" target="_blank" rel="noreferrer noopener">{{ label }}</a></li></ul>
        </section>
      </aside>

      <main class="plugin-detail-main">
        <section v-if="includesPlugins.length || requiresPlugins.length" class="plugin-relations">
          <h2>{{ t('pluginRelationships') }}</h2>
          <div v-if="includesPlugins.length"><h3>{{ t('pluginPackContents') }}</h3><div class="plugin-relation-grid"><button v-for="dependency in includesPlugins" :key="dependency.package" :disabled="!relationTarget(dependency)" @click="navigateRelation(dependency)"><strong>{{ relationName(dependency) }}</strong><code>{{ dependency.package }} · {{ dependency.version }}</code><span v-if="!relationTarget(dependency)">{{ t('pluginUnavailableFromSource') }}</span></button></div></div>
          <div v-if="requiresPlugins.length"><h3>{{ t('pluginDependencies') }}</h3><div class="plugin-relation-grid"><button v-for="dependency in requiresPlugins" :key="dependency.package" :disabled="!relationTarget(dependency)" @click="navigateRelation(dependency)"><strong>{{ relationName(dependency) }}</strong><code>{{ dependency.package }} · {{ dependency.version }}</code><span v-if="!relationTarget(dependency)">{{ t('pluginUnavailableFromSource') }}</span></button></div></div>
        </section>

        <section class="plugin-readme">
          <header><div><h2>README</h2><span>{{ t('pluginReadmeVersion', { version: resolvedVersion || t('unknown') }) }}</span></div><UiButton v-if="documentError" size="compact" @click="loadDocument()">{{ t('retry') }}</UiButton></header>
          <nav v-if="documentPreview?.document.path && documentPreview.document.path !== 'README.md'" class="plugin-document-path"><button @click="loadReadme">README</button><span>/</span><code>{{ documentPreview.document.path }}</code></nav>
          <div v-if="documentLoading" class="plugin-readme-state"><Icon name="loading" /><p>{{ t('loadingPluginReadme') }}</p></div>
          <div v-else-if="documentError" class="plugin-readme-state error" role="alert"><Icon name="error" /><p>{{ documentError }}</p></div>
          <MarkdownPreview v-else-if="documentPreview?.document.status === 'found' && documentPreview.document.content && documentPreview.document.path" :content="documentPreview.document.content" :readme-path="documentPreview.document.path" :asset-url="assetUrl" @navigate-document="loadDocument" />
          <div v-else class="plugin-readme-state"><Icon name="docs" /><p>{{ documentPreview?.document.message || t('pluginReadmeMissing') }}</p></div>
        </section>
      </main>
    </div>
  </section>
</template>
