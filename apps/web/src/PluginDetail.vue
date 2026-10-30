<script setup lang="ts">
import type { CatalogPluginV1, ManagedPlugin, MarketplaceSource, PluginDependencyV1, PluginDocumentPreview, PluginManifestV1 } from 'craft-hub'
import { marketplacePackMembers } from 'craft-hub/marketplace-model'
import { maxSatisfying, satisfies } from 'semver'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Skeleton } from './components/ui/skeleton'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { marketplaceActionDisabled, marketplaceActionIcons, marketplaceActionLabels, marketplaceActionVariant, marketplacePluginAction } from './marketplace-plugin-action'
import { pluginIconUrl } from './plugin-icon'
import { pluginDescription, pluginDisplayName } from './plugin-text'
import MarkdownPreview from './MarkdownPreview.vue'
import PluginPackContents from './PluginPackContents.vue'
import PluginPackIcon from './PluginPackIcon.vue'

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
const emit = defineEmits<{ back: [], navigate: [sourceId: string, packageName: string, version: string, parentName?: string], changed: [], manageHosts: [] }>()
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
const activePlugin = computed(() => props.installed.find(item => item.package === props.packageName))
const catalogAction = computed(() => catalogEntry.value ? marketplacePluginAction(catalogEntry.value, activePlugin.value) : undefined)
const resolvedVersion = computed(() => props.version ?? installedPlugin.value?.version ?? catalogEntry.value?.version)
const manifest = computed<PluginManifestV1 | undefined>(() => documentPreview.value?.manifest ?? installedPlugin.value?.manifest)
const icon = computed(() => {
  if (catalogEntry.value?.icon)
    return catalogEntry.value.icon
  if (resolvedVersion.value && manifest.value?.icon)
    return pluginIconUrl({ sourceId: props.sourceId, package: props.packageName, version: resolvedVersion.value }, manifest.value.icon)
  const active = activePlugin.value
  return active && (active.origin === 'local' || active.sourceId === props.sourceId) ? pluginIconUrl(active, active.manifest.icon) : undefined
})
const failedIcon = ref<string>()
watch(icon, () => { failedIcon.value = undefined })
const metadata = computed(() => catalogEntry.value ?? manifest.value)
const localized = computed(() => metadata.value?.localizations?.[locale.value])
const displayName = computed(() => metadata.value ? pluginDisplayName(metadata.value, locale.value) : props.packageName)
const description = computed(() => metadata.value ? pluginDescription(metadata.value, locale.value) : undefined)
const permissions = computed(() => catalogEntry.value?.permissions ?? manifest.value?.permissions ?? [])
const permissionReasons = computed(() => ({ ...(metadata.value?.permissionReasons ?? {}), ...(localized.value?.permissionReasons ?? {}) }))
const links = computed(() => metadata.value?.links)
const maintainers = computed(() => metadata.value?.maintainers ?? [])
const includesPlugins = computed(() => catalogEntry.value?.includesPlugins ?? manifest.value?.includesPlugins ?? [])
const members = computed(() => marketplacePackMembers({ sourceId: props.sourceId, includesPlugins: includesPlugins.value }, props.catalog, props.installed))
const requiresPlugins = computed(() => catalogEntry.value?.requiresPlugins ?? manifest.value?.requiresPlugins ?? [])
const unavailable = computed(() => !catalogEntry.value && !installedPlugin.value)
const contributionGroups = computed(() => Object.entries(manifest.value?.contributes ?? {}).filter(([, items]) => items.length))
const contributionTotal = computed(() => contributionGroups.value.reduce((total, [, items]) => total + items.length, 0))
const visibleIcon = computed(() => icon.value && icon.value !== failedIcon.value ? icon.value : undefined)
const installationState = computed(() => !installedPlugin.value ? 'none' : installedPlugin.value.enabled ? 'enabled' : 'disabled')

watch(() => [props.sourceId, props.packageName, resolvedVersion.value] as const, () => {
  documentPreview.value = undefined
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
  const target = relationTarget(dependency)
  const metadata = target && (props.catalog.find(item => item.sourceId === target.sourceId && item.package === target.package && item.version === target.version)
    ?? props.installed.find(item => item.sourceId === target.sourceId && item.package === target.package && item.version === target.version)?.manifest)
  return metadata ? pluginDisplayName(metadata, locale.value) : target?.displayName ?? dependency.package
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
  if (catalogAction.value === 'local') {
    emit('navigate', 'local', activePlugin.value!.package, activePlugin.value!.version)
    return
  }
  if (catalogAction.value && marketplaceActionDisabled(catalogAction.value, plugin.status))
    return
  await operate('install', async () => {
    const plan = await api.previewPluginInstall(plugin.sourceId, plugin.package, plugin.version)
    const changes = plan.items.filter(item => item.action !== 'none')
    const plugins = changes.map(item => `${pluginDisplayName(props.catalog.find(entry => entry.sourceId === plugin.sourceId && entry.package === item.package && entry.version === item.version) ?? item, locale.value)}@${item.version}`).join(', ') || pluginDisplayName(plugin, locale.value)
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
  const plugin = installedPlugin.value
  if (plugin) {
    await operate('toggle', async () => {
      await api.setPluginEnabled(plugin.package, !plugin.enabled)
      if (!plugin.enabled && plugin.origin === 'local') {
        const status = await window.craftHubDesktop?.configureLocalPluginHost?.(plugin.package)
        if (status?.restartRequired)
          emit('manageHosts')
      }
    })
  }
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
      <div v-if="visibleIcon" class="plugin-detail-backdrop" aria-hidden="true"><img :src="visibleIcon" alt="" referrerpolicy="no-referrer"></div>
      <UiButton class="plugin-detail-back" variant="ghost" size="compact" @click="emit('back')"><Icon name="arrowRight" />{{ parentName ? t('backToPlugin', { name: parentName }) : t('backToMarketplace') }}</UiButton>
      <div v-if="unavailable" class="plugin-detail-unavailable" role="alert">
        <span class="plugin-detail-icon"><Icon name="error" /></span>
        <div>
          <h1>{{ packageName }}</h1>
          <p>{{ t('pluginVersionUnavailable', { version: version || t('unknown') }) }}</p>
        </div>
      </div>
      <template v-else>
        <div class="plugin-detail-identity">
          <PluginPackIcon v-if="includesPlugins.length" :members="members" />
          <div v-else class="plugin-detail-icon"><img v-if="visibleIcon" :src="visibleIcon" alt="" referrerpolicy="no-referrer" @error="failedIcon = icon"><Icon v-else name="plugins" /></div>
          <div class="plugin-detail-heading">
            <div class="plugin-detail-title"><h1>{{ displayName }}</h1><span v-if="includesPlugins.length" class="plugin-pack-badge">{{ t('pluginPackBadge') }}</span><span v-if="installedPlugin?.origin === 'local'" class="local-plugin-badge">{{ t('localPluginBadge') }}</span></div>
            <code>{{ packageName }}@{{ resolvedVersion }}</code>
            <p v-if="description">{{ description }}</p>
            <ul class="plugin-detail-facts">
              <li class="plugin-install-state" :class="installationState"><span class="plugin-state-dot" />{{ installedPlugin ? t(installedPlugin.enabled ? 'pluginEnabled' : 'pluginDisabled') : t('pluginNotInstalled') }}</li>
              <li v-if="catalogEntry"><Icon name="personal" />{{ catalogEntry.publisher }}</li>
              <li v-if="catalogEntry?.sourceName ?? installedPlugin?.sourceId"><Icon name="web" />{{ catalogEntry?.sourceName ?? installedPlugin?.sourceId }}</li>
              <li v-if="manifest && contributionTotal"><Icon name="collection" />{{ t('pluginContributions') }} {{ contributionTotal }}</li>
            </ul>
          </div>
        </div>
        <div class="plugin-actions">
          <UiButton v-if="catalogAction" :variant="marketplaceActionVariant(catalogAction)" :disabled="Boolean(busy) || marketplaceActionDisabled(catalogAction, catalogEntry?.status)" @click="install"><Icon :name="busy === 'install' ? 'loading' : marketplaceActionIcons[catalogAction]" />{{ busy === 'install' ? t('installingPlugin') : t(includesPlugins.length && catalogAction === 'install' ? 'installPluginPack' : marketplaceActionLabels[catalogAction]) }}</UiButton>
          <UiButton v-if="installedPlugin && !includesPlugins.length" :disabled="Boolean(busy)" @click="toggle"><Icon :name="busy === 'toggle' ? 'loading' : installedPlugin.enabled ? 'stop' : 'play'" />{{ t(installedPlugin.enabled ? 'disablePlugin' : 'enablePlugin') }}</UiButton>
          <UiButton v-if="installedPlugin?.origin === 'local'" :disabled="Boolean(busy)" @click="refreshLocal"><Icon :name="busy === 'refresh' ? 'loading' : 'refresh'" />{{ t('refreshLocalPlugin') }}</UiButton>
          <UiButton v-else-if="installedPlugin && !includesPlugins.length" :disabled="Boolean(busy) || !installedPlugin.previousVersion" @click="rollback">{{ t('rollbackPlugin') }}</UiButton>
          <UiButton v-if="installedPlugin" variant="danger-secondary" :disabled="Boolean(busy)" @click="remove">{{ t(installedPlugin.origin === 'local' ? 'unlinkLocalPlugin' : includesPlugins.length ? 'removePluginPack' : 'uninstallPlugin') }}</UiButton>
        </div>
        <p v-if="catalogAction === 'local'" class="plugin-detail-note"><Icon name="folderOpen" />{{ t('localPluginOverridesMarket') }}</p>
      </template>
    </header>

    <div v-if="!unavailable" class="plugin-detail-body">
      <aside class="plugin-detail-sidebar motion-reveal-list">
        <p v-if="operationError" class="marketplace-error" role="alert"><Icon name="error" /><span>{{ operationError }}</span></p>
        <section>
          <h2>{{ t('pluginDetails') }}</h2>
          <dl>
            <div><dt>{{ t('pluginVersion') }}</dt><dd>{{ resolvedVersion }}</dd></div>
            <div><dt>{{ t('pluginSource') }}</dt><dd>{{ catalogEntry?.sourceName ?? installedPlugin?.sourceId }}</dd></div>
            <div v-if="catalogEntry"><dt>{{ t('pluginPublisher') }}</dt><dd>{{ catalogEntry.publisher }}</dd></div>
            <div v-if="catalogEntry"><dt>{{ t('pluginStatus') }}</dt><dd>{{ catalogEntry.status }}<span v-if="catalogEntry.statusReason"> · {{ catalogEntry.statusReason }}</span></dd></div>
            <div><dt>{{ t('pluginInstallationStatus') }}</dt><dd>{{ installedPlugin ? t(installedPlugin.enabled ? 'pluginEnabled' : 'pluginDisabled') : t('pluginNotInstalled') }}</dd></div>
            <div v-if="catalogEntry?.requires"><dt>{{ t('pluginCompatibility') }}</dt><dd>Craft Hub {{ catalogEntry.requires }}</dd></div>
            <div v-if="installedPlugin?.origin === 'local'" class="stacked"><dt>{{ t('localPluginPath') }}</dt><dd><code>{{ installedPlugin.packagePath }}</code></dd></div>
          </dl>
          <ul v-if="catalogEntry?.categories.length" class="plugin-category-list" :aria-label="t('pluginCategories')"><li v-for="category in catalogEntry.categories" :key="category">{{ category }}</li></ul>
        </section>

        <section v-if="manifest">
          <h2>{{ t('pluginContributions') }} <small>{{ contributionTotal }}</small></h2>
          <ul v-if="contributionGroups.length" class="plugin-contribution-list">
            <li v-for="([kind, items]) in contributionGroups" :key="kind" :style="{ '--share': `${Math.round(items.length / contributionTotal * 100)}%` }"><span>{{ kind }}</span><strong>{{ items.length }}</strong></li>
          </ul>
          <p v-else class="muted">{{ t('none') }}</p>
        </section>

        <section>
          <h2>{{ t('pluginPermissions') }} <small v-if="permissions.length">{{ permissions.length }}</small></h2>
          <p v-if="!permissions.length" class="muted">{{ t('none') }}</p>
          <ul v-else class="plugin-detail-list plugin-permission-list"><li v-for="permission in permissions" :key="permission"><Icon name="security" /><span><strong>{{ permission }}</strong><span v-if="permissionReasons[permission]">{{ permissionReasons[permission] }}</span></span></li></ul>
        </section>

        <section v-if="maintainers.length">
          <h2>{{ t('pluginMaintainers') }}</h2>
          <ul class="plugin-detail-list plugin-person-list"><li v-for="maintainer in maintainers" :key="maintainer.url || maintainer.handle"><span class="plugin-person-avatar" aria-hidden="true">{{ (maintainer.name || maintainer.handle || '?').slice(0, 1).toUpperCase() }}</span><a v-if="maintainer.url" :href="maintainer.url" target="_blank" rel="noreferrer noopener">{{ maintainer.name || maintainer.handle || maintainer.url }}</a><span v-else>{{ maintainer.name || maintainer.handle }}</span></li></ul>
        </section>

        <section v-if="links && Object.keys(links).length">
          <h2>{{ t('pluginLinks') }}</h2>
          <ul class="plugin-detail-list plugin-link-list"><li v-for="(href, label) in links" :key="label"><a :href="href" target="_blank" rel="noreferrer noopener"><Icon name="link" /><span>{{ label }}</span><Icon name="externalLink" /></a></li></ul>
        </section>
      </aside>

      <main class="plugin-detail-main">
        <section v-if="includesPlugins.length || requiresPlugins.length" class="plugin-relations motion-reveal">
          <h2>{{ t('pluginRelationships') }}</h2>
          <PluginPackContents v-if="includesPlugins.length" :members="members" @navigate="member => member.version && emit('navigate', member.sourceId, member.package, member.version, displayName)" />
          <div v-if="requiresPlugins.length"><h3>{{ t('pluginDependencies') }}</h3><div class="plugin-relation-grid"><button v-for="dependency in requiresPlugins" :key="dependency.package" :disabled="!relationTarget(dependency)" @click="navigateRelation(dependency)"><span class="plugin-relation-mark" aria-hidden="true"><Icon name="link" /></span><span class="plugin-relation-copy"><strong>{{ relationName(dependency) }}</strong><code>{{ dependency.package }} · {{ dependency.version }}</code><span v-if="!relationTarget(dependency)">{{ t('pluginUnavailableFromSource') }}</span></span><Icon v-if="relationTarget(dependency)" name="arrowRight" /></button></div></div>
        </section>

        <section class="plugin-readme">
          <header><div><h2><Icon name="docs" />README</h2><span>{{ t('pluginReadmeVersion', { version: resolvedVersion || t('unknown') }) }}</span></div><UiButton v-if="documentError" size="compact" @click="loadDocument()">{{ t('retry') }}</UiButton></header>
          <nav v-if="documentPreview?.document.path && documentPreview.document.path !== 'README.md'" class="plugin-document-path"><button @click="loadReadme">README</button><span>/</span><code>{{ documentPreview.document.path }}</code></nav>
          <div v-if="documentLoading" class="plugin-readme-loading" role="status" aria-busy="true">
            <span class="sr-only">{{ t('loadingPluginReadme') }}</span>
            <Skeleton width="42%" height="18px" /><Skeleton width="96%" /><Skeleton width="88%" /><Skeleton width="92%" /><Skeleton width="64%" />
            <Skeleton width="28%" height="14px" /><Skeleton width="90%" /><Skeleton width="76%" />
          </div>
          <div v-else-if="documentError" class="plugin-readme-state error" role="alert"><Icon name="error" /><p>{{ documentError }}</p></div>
          <MarkdownPreview v-else-if="documentPreview?.document.status === 'found' && documentPreview.document.content && documentPreview.document.path" :key="documentPreview.document.path" class="motion-reveal" :content="documentPreview.document.content" :readme-path="documentPreview.document.path" :asset-url="assetUrl" @navigate-document="loadDocument" />
          <div v-else class="plugin-readme-state"><Icon name="docs" /><p>{{ documentPreview?.document.message || t('pluginReadmeMissing') }}</p></div>
        </section>
      </main>
    </div>
  </section>
</template>
