<script setup lang="ts">
import type { CommandCapability, CommandCategory, CommandPackage } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import CapabilityRow from './CapabilityRow.vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import ProjectConfigInitDialog from './ProjectConfigInitDialog.vue'
import { commandPaletteShortcutId, defaultCommandPaletteShortcut, formatShortcut } from './shortcuts'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { locale, t } = useI18n()
const paletteShortcut = computed(() => formatShortcut(store.settings?.settings['workbench.shortcuts']?.[commandPaletteShortcutId] ?? defaultCommandPaletteShortcut))
const query = ref('')
const filter = ref<'all' | 'command' | 'skill' | 'package'>('all')
const categoryFilter = ref<'all' | CommandCategory>('all')
const selectedPackagePath = ref('')
const categories: Array<'all' | CommandCategory> = ['all', 'develop', 'build', 'test', 'quality', 'preview', 'deploy', 'other']
const draggingId = ref('')
const recoveryBusy = ref(false)
const recoveryError = ref('')
const projectConfigOpen = ref(false)
const filtered = computed(() => store.capabilities.filter(matchesFilter))
const pinned = computed(() => store.pinnedCapabilities.filter(matchesFilter))
const pinnedIds = computed(() => new Set(store.pinnedCapabilityIds))
const unpinned = computed(() => filtered.value.filter(capability => !pinnedIds.value.has(capability.id)))
const commandCount = computed(() => store.capabilities.filter(capability => capability.kind === 'command').length)
const skillCount = computed(() => store.capabilities.filter(capability => capability.kind === 'skill').length)
const showSkillSources = computed(() => new Set(store.capabilities
  .filter(capability => capability.kind === 'skill')
  .map(capability => capability.source)).size > 1)
interface PackageOverviewRow extends CommandPackage {
  capabilities: CommandCapability[]
}
const packageRows = computed<PackageOverviewRow[]>(() => {
  const rows = new Map<string, PackageOverviewRow>(store.commandPackages.map(commandPackage => [
    commandPackage.relativePath,
    { ...commandPackage, capabilities: [] },
  ]))
  for (const capability of store.capabilities) {
    if (capability.kind !== 'command')
      continue
    const commandPackage = capability.package ?? { relativePath: '.', root: true }
    const row = rows.get(commandPackage.relativePath) ?? { ...commandPackage, capabilities: [] }
    row.name ??= commandPackage.name
    row.description ??= commandPackage.description
    row.capabilities.push(capability)
    rows.set(commandPackage.relativePath, row)
  }
  return [...rows.values()].sort(comparePackages)
})
const visiblePackageRows = computed(() => {
  const normalizedQuery = query.value.trim().toLowerCase()
  if (!normalizedQuery)
    return packageRows.value
  return packageRows.value.filter(row => `${row.relativePath} ${row.name ?? ''} ${row.description ?? ''} ${row.capabilities.map(capability => capability.name).join(' ')}`.toLowerCase().includes(normalizedQuery))
})
const packageSections = computed(() => (['root', 'apps', 'packages', 'docs', 'other'] as const).map(section => ({
  section,
  rows: visiblePackageRows.value.filter(row => packageSection(row.relativePath) === section),
})).filter(group => group.rows.length))
const packageCommandCount = computed(() => packageRows.value.reduce((count, row) => count + row.capabilities.length, 0))
const commandGroups = computed(() => {
  const groups = new Map<string, typeof store.capabilities>()
  for (const capability of unpinned.value.filter(item => item.kind === 'command')) {
    const relativePath = capability.kind === 'command' ? capability.package?.relativePath ?? '.' : '.'
    const commands = groups.get(relativePath) ?? []
    commands.push(capability)
    groups.set(relativePath, commands)
  }
  return [...groups].map(([relativePath, capabilities]) => ({
    relativePath,
    name: capabilities[0]?.kind === 'command' ? capabilities[0].package?.name : undefined,
    capabilities,
  })).sort((left, right) => {
    if (left.relativePath === '.')
      return -1
    if (right.relativePath === '.')
      return 1
    return left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true })
  })
})
const unpinnedSkills = computed(() => unpinned.value.filter(item => item.kind === 'skill'))
const collapsedGroups = ref<string[]>([])
const improveAction = computed(() => store.agentActions.find(action => action.id === 'improve-project-config'))
const dismissedFingerprint = ref('')
const missingProjectDescriptionCount = computed(() => (improveAction.value?.missingCommandCount ?? 0) + (improveAction.value?.missingPackageCount ?? 0))
const showDescriptionHint = computed(() => Boolean(missingProjectDescriptionCount.value)
  && improveAction.value?.commandFingerprint !== dismissedFingerprint.value)

watch(() => [store.selectedProjectId, improveAction.value?.commandFingerprint] as const, () => {
  dismissedFingerprint.value = store.selectedProjectId
    ? window.localStorage.getItem(`craft-hub-agent-action-hint:${store.selectedProjectId}`) ?? ''
    : ''
}, { immediate: true })

watch(() => store.selectedProjectId, (projectId) => {
  selectedPackagePath.value = ''
  if (!projectId) {
    collapsedGroups.value = []
    return
  }
  try {
    const stored = JSON.parse(window.localStorage.getItem(`craft-hub-capability-groups:${projectId}`) ?? '[]') as unknown
    collapsedGroups.value = Array.isArray(stored) && stored.every(item => typeof item === 'string') ? stored : []
  }
  catch {
    collapsedGroups.value = []
  }
}, { immediate: true })

watch(filter, (value) => {
  if (value === 'skill' || value === 'package')
    categoryFilter.value = 'all'
})

function matchesFilter(item: typeof store.capabilities[number]): boolean {
  const packageText = item.kind === 'command' ? `${item.package?.relativePath ?? ''} ${item.package?.name ?? ''}` : ''
  const packagePath = item.kind === 'command' ? item.package?.relativePath ?? '.' : ''
  return filter.value !== 'package'
    && (filter.value === 'all' || item.kind === filter.value)
    && (!selectedPackagePath.value || packagePath === selectedPackagePath.value)
    && (categoryFilter.value === 'all' || (item.kind === 'command' && (item.category ?? 'other') === categoryFilter.value))
    && `${item.name} ${item.description ?? ''} ${item.source} ${packageText}`.toLowerCase().includes(query.value.toLowerCase())
}

function comparePackages(left: CommandPackage, right: CommandPackage): number {
  if (left.root !== right.root)
    return left.root ? -1 : 1
  return left.relativePath.localeCompare(right.relativePath, undefined, { numeric: true })
}

function packageSection(relativePath: string): 'root' | 'apps' | 'packages' | 'docs' | 'other' {
  if (relativePath === '.')
    return 'root'
  if (relativePath.startsWith('apps/'))
    return 'apps'
  if (relativePath.startsWith('packages/'))
    return 'packages'
  if (relativePath === 'docs' || relativePath.startsWith('docs/'))
    return 'docs'
  return 'other'
}

function packageSubtitle(row: CommandPackage): string {
  return [row.name, row.description].filter(Boolean).join(' · ')
}

function selectFilter(value: typeof filter.value): void {
  filter.value = value
  if (value !== 'command')
    selectedPackagePath.value = ''
}

function selectPackage(relativePath: string): void {
  selectedPackagePath.value = relativePath
  filter.value = 'command'
  categoryFilter.value = 'all'
  query.value = ''
}

function clearPackageScope(): void {
  selectedPackagePath.value = ''
  categoryFilter.value = 'all'
}

function categoryLabel(category: 'all' | CommandCategory): string {
  return t(category === 'all' ? 'allCategories' : `commandCategory_${category}`)
}

function toggleGroup(relativePath: string): void {
  collapsedGroups.value = collapsedGroups.value.includes(relativePath)
    ? collapsedGroups.value.filter(item => item !== relativePath)
    : [...collapsedGroups.value, relativePath]
  if (store.selectedProjectId)
    window.localStorage.setItem(`craft-hub-capability-groups:${store.selectedProjectId}`, JSON.stringify(collapsedGroups.value))
}

function groupCollapsed(relativePath: string): boolean {
  return !query.value && collapsedGroups.value.includes(relativePath)
}

function startDrag(capabilityId: string, event: DragEvent): void {
  draggingId.value = capabilityId
  event.dataTransfer?.setData('text/plain', capabilityId)
  if (event.dataTransfer)
    event.dataTransfer.effectAllowed = 'move'
}

function movePinned(targetId: string, direction?: -1 | 1): void {
  const ids = [...store.pinnedCapabilityIds]
  const draggedId = direction ? targetId : draggingId.value
  const from = ids.indexOf(draggedId)
  const target = ids.indexOf(targetId)
  const to = direction ? from + direction : target
  draggingId.value = ''
  if (from < 0 || to < 0 || to >= ids.length || from === to)
    return
  ids.splice(from, 1)
  ids.splice(to, 0, draggedId)
  void store.setCapabilityPinOrder(ids)
}

function dismissDescriptionHint(): void {
  if (!store.selectedProjectId || !improveAction.value)
    return
  dismissedFingerprint.value = improveAction.value.commandFingerprint
  window.localStorage.setItem(`craft-hub-agent-action-hint:${store.selectedProjectId}`, dismissedFingerprint.value)
}

async function chooseAnotherProject(): Promise<void> {
  const path = window.craftHubDesktop?.selectProjectDirectory
    ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
    : window.prompt(t('projectPath')) ?? undefined
  if (!path)
    return
  recoveryBusy.value = true
  recoveryError.value = ''
  try {
    await store.addProject(path)
  }
  catch (caught) {
    recoveryError.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    recoveryBusy.value = false
  }
}

async function openConfigurationGuide(): Promise<void> {
  const path = locale.value === 'zh-CN' ? 'docs/zh/guide/configuration.md' : 'docs/guide/configuration.md'
  const url = `https://github.com/YunYouJun/craft-hub/blob/main/${path}`
  if (window.craftHubDesktop?.openExternalUrl)
    await window.craftHubDesktop.openExternalUrl(url)
  else
    window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <section class="capability-panel">
    <div class="panel-heading">
      <h2>{{ t('projectPalette') }}</h2><kbd>{{ paletteShortcut }}</kbd>
    </div>
    <label class="search-box">
      <Icon name="search" />
      <input v-model="query" :placeholder="t('searchCapabilities')">
    </label>
    <nav class="filters" :aria-label="t('capabilityFilters')">
      <button v-for="item in ['all', 'command', 'skill'] as const" :key="item" :class="{ active: filter === item }" @click="selectFilter(item)">
        {{ item === 'all' ? t('all') : item === 'command' ? t('commands') : t('skills') }}
        <small v-if="item !== 'all'">{{ item === 'command' ? commandCount : skillCount }}</small>
      </button>
      <button v-if="packageRows.length > 1" :class="{ active: filter === 'package' }" @click="selectFilter('package')">
        {{ t('packages') }} <small>{{ packageRows.length }}</small>
      </button>
    </nav>
    <div class="capability-filter-row">
      <nav v-if="filter !== 'skill' && filter !== 'package'" class="category-filters" :aria-label="t('commandCategoryFilters')">
        <button v-if="selectedPackagePath" class="package-scope-filter" :title="t('clearPackageFilter')" @click="clearPackageScope">
          <Icon name="folder" /> {{ selectedPackagePath === '.' ? t('projectRoot') : selectedPackagePath }} <Icon name="close" />
        </button>
        <button v-for="category in categories" :key="category" :class="{ active: categoryFilter === category }" @click="categoryFilter = category">
          {{ categoryLabel(category) }}
        </button>
      </nav>
    </div>
    <div class="capability-notices">
      <details v-if="store.capabilityDiagnostics.length" class="capability-diagnostics">
        <summary><Icon name="error" /> {{ t('capabilityDiagnostics', { count: String(store.capabilityDiagnostics.length) }) }}</summary>
        <ul><li v-for="diagnostic in store.capabilityDiagnostics" :key="`${diagnostic.path}:${diagnostic.message}`"><strong>{{ diagnostic.path }}</strong> — {{ diagnostic.message }}</li></ul>
      </details>
      <aside v-if="showDescriptionHint" class="agent-action-hint">
        <button class="agent-action-hint-main" @click="store.agentActionDialogOpen = true">
          <Icon name="codex" />
          <span>{{ t('missingProjectDescriptionsHint', { count: String(missingProjectDescriptionCount) }) }} <strong>{{ t('configureWithCodex') }}</strong></span>
        </button>
        <button class="agent-action-hint-dismiss" :aria-label="t('dismissHint')" :title="t('dismissHint')" @click="dismissDescriptionHint"><Icon name="close" /></button>
      </aside>
    </div>
    <div v-if="filter === 'package'" class="package-overview">
      <div class="package-overview-summary">
        <Icon name="collection" />
        <span>{{ t('packageOverviewSummary', { packages: String(packageRows.length), commands: String(packageCommandCount) }) }}</span>
      </div>
      <section v-for="group in packageSections" :key="group.section" class="package-overview-section">
        <h3>{{ t(`packageSection_${group.section}`) }}</h3>
        <button
          v-for="row in group.rows"
          :key="row.relativePath"
          class="package-overview-row"
          :aria-label="t('openPackageCommands', { package: row.relativePath === '.' ? t('projectRoot') : row.relativePath, count: String(row.capabilities.length) })"
          :aria-description="row.description"
          @click="selectPackage(row.relativePath)"
        >
          <Icon name="folder" />
          <span>
            <strong>{{ row.relativePath === '.' ? t('projectRoot') : row.relativePath }}</strong>
            <small v-if="packageSubtitle(row)" :title="packageSubtitle(row)">
              <b v-if="row.name">{{ row.name }}</b><template v-if="row.name && row.description"> · </template>{{ row.description }}
            </small>
          </span>
          <em>{{ row.capabilities.length }}</em>
          <Icon name="arrowRight" />
        </button>
      </section>
      <div v-if="!visiblePackageRows.length" class="empty">{{ t('noMatchingPackages') }}</div>
    </div>
    <div v-else class="capability-list">
      <section v-if="pinned.length" class="capability-section">
        <h3><Icon name="starFilled" /> {{ t('pinned') }}</h3>
        <CapabilityRow
          v-for="capability in pinned"
          :key="capability.id"
          :capability="capability"
          pinned
          :selected="capability.id === store.selectedCapabilityId"
          package-context
          :show-skill-source="showSkillSources"
          @select="store.selectedCapabilityId = capability.id"
          @toggle-pin="store.toggleCapabilityPin(capability.id)"
          @dragstart="startDrag(capability.id, $event)"
          @drop="movePinned(capability.id)"
          @move="movePinned(capability.id, $event)"
        />
      </section>
      <section v-for="group in commandGroups" :key="group.relativePath" class="capability-section package-capability-group">
        <button class="capability-group-heading" :aria-expanded="!groupCollapsed(group.relativePath)" @click="toggleGroup(group.relativePath)">
          <Icon name="arrowRight" :class="{ expanded: !groupCollapsed(group.relativePath) }" />
          <span><strong>{{ group.relativePath === '.' ? t('projectRoot') : group.relativePath }}</strong><small v-if="group.name">{{ group.name }}</small></span>
          <em>{{ group.capabilities.length }}</em>
        </button>
        <template v-if="!groupCollapsed(group.relativePath)">
          <CapabilityRow
            v-for="capability in group.capabilities"
            :key="capability.id"
            :capability="capability"
            :pinned="false"
            :selected="capability.id === store.selectedCapabilityId"
            :show-skill-source="showSkillSources"
            @select="store.selectedCapabilityId = capability.id"
            @toggle-pin="store.toggleCapabilityPin(capability.id)"
          />
        </template>
      </section>
      <section v-if="unpinnedSkills.length" class="capability-section">
        <h3><Icon name="skill" /> {{ t('agentSkills') }}</h3>
        <CapabilityRow
          v-for="capability in unpinnedSkills"
          :key="capability.id"
          :capability="capability"
          :pinned="false"
          :selected="capability.id === store.selectedCapabilityId"
          :show-skill-source="showSkillSources"
          @select="store.selectedCapabilityId = capability.id"
          @toggle-pin="store.toggleCapabilityPin(capability.id)"
        />
      </section>
      <div v-if="!store.capabilities.length && store.selectedProject" class="no-capabilities-state">
        <Icon name="terminal" />
        <h3>{{ t('noCapabilitiesTitle') }}</h3>
        <p>{{ t('noCapabilitiesDescription') }}</p>
        <p class="checked-capability-sources">{{ t('checkedCapabilitySources') }}</p>
        <div>
          <UiButton variant="primary" :disabled="recoveryBusy" @click="chooseAnotherProject"><Icon name="folder" /> {{ t('chooseAnotherProject') }}</UiButton>
          <UiButton @click="openConfigurationGuide"><Icon name="source" /> {{ t('viewConfigurationGuide') }}</UiButton>
          <UiButton @click="projectConfigOpen = true"><Icon name="plus" /> {{ t('previewProjectConfig') }}</UiButton>
        </div>
        <p v-if="recoveryError" class="error-message" role="alert">{{ recoveryError }}</p>
      </div>
      <div v-else-if="!filtered.length" class="empty">{{ t('noMatchingCapabilities') }}</div>
    </div>
    <ProjectConfigInitDialog v-model:open="projectConfigOpen" />
  </section>
</template>
