<script setup lang="ts">
import type { CommandCategory } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import CapabilityRow from './CapabilityRow.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const query = ref('')
const filter = ref<'all' | 'command' | 'skill'>('all')
const categoryFilter = ref<'all' | CommandCategory>('all')
const categories: Array<'all' | CommandCategory> = ['all', 'develop', 'build', 'test', 'quality', 'preview', 'deploy', 'other']
const draggingId = ref('')
const filtered = computed(() => store.capabilities.filter(matchesFilter))
const pinned = computed(() => store.pinnedCapabilities.filter(matchesFilter))
const pinnedIds = computed(() => new Set(store.pinnedCapabilityIds))
const unpinned = computed(() => filtered.value.filter(capability => !pinnedIds.value.has(capability.id)))
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
const showDescriptionHint = computed(() => Boolean(improveAction.value?.missingCommandCount)
  && improveAction.value?.commandFingerprint !== dismissedFingerprint.value)

watch(() => [store.selectedProjectId, improveAction.value?.commandFingerprint] as const, () => {
  dismissedFingerprint.value = store.selectedProjectId
    ? window.localStorage.getItem(`craft-hub-agent-action-hint:${store.selectedProjectId}`) ?? ''
    : ''
}, { immediate: true })

watch(() => store.selectedProjectId, (projectId) => {
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
  if (value === 'skill')
    categoryFilter.value = 'all'
})

function matchesFilter(item: typeof store.capabilities[number]): boolean {
  const packageText = item.kind === 'command' ? `${item.package?.relativePath ?? ''} ${item.package?.name ?? ''}` : ''
  return (filter.value === 'all' || item.kind === filter.value)
    && (categoryFilter.value === 'all' || (item.kind === 'command' && (item.category ?? 'other') === categoryFilter.value))
    && `${item.name} ${item.description ?? ''} ${item.source} ${packageText}`.toLowerCase().includes(query.value.toLowerCase())
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
</script>

<template>
  <section class="capability-panel">
    <div class="panel-heading">
      <h2>{{ t('projectPalette') }}</h2><kbd>⌘K</kbd>
    </div>
    <label class="search-box">
      <Icon name="search" />
      <input v-model="query" :placeholder="t('searchCapabilities')">
    </label>
    <nav class="filters" :aria-label="t('capabilityFilters')">
      <button v-for="item in ['all', 'command', 'skill'] as const" :key="item" :class="{ active: filter === item }" @click="filter = item">
        {{ item === 'all' ? t('all') : item === 'command' ? t('commands') : t('skills') }}
      </button>
    </nav>
    <nav v-if="filter !== 'skill'" class="category-filters" :aria-label="t('commandCategoryFilters')">
      <button v-for="category in categories" :key="category" :class="{ active: categoryFilter === category }" @click="categoryFilter = category">
        {{ categoryLabel(category) }}
      </button>
    </nav>
    <details v-if="store.capabilityDiagnostics.length" class="capability-diagnostics">
      <summary><Icon name="error" /> {{ t('capabilityDiagnostics', { count: String(store.capabilityDiagnostics.length) }) }}</summary>
      <ul><li v-for="diagnostic in store.capabilityDiagnostics" :key="`${diagnostic.path}:${diagnostic.message}`"><strong>{{ diagnostic.path }}</strong> — {{ diagnostic.message }}</li></ul>
    </details>
    <aside v-if="showDescriptionHint" class="agent-action-hint">
      <button class="agent-action-hint-main" @click="store.agentActionDialogOpen = true">
        <Icon name="codex" />
        <span>{{ t('missingDescriptionsHint', { count: String(improveAction?.missingCommandCount ?? 0) }) }} <strong>{{ t('configureWithCodex') }}</strong></span>
      </button>
      <button class="agent-action-hint-dismiss" :aria-label="t('dismissHint')" :title="t('dismissHint')" @click="dismissDescriptionHint"><Icon name="close" /></button>
    </aside>
    <div class="capability-list">
      <section v-if="pinned.length" class="capability-section">
        <h3><Icon name="starFilled" /> {{ t('pinned') }}</h3>
        <CapabilityRow
          v-for="capability in pinned"
          :key="capability.id"
          :capability="capability"
          pinned
          :selected="capability.id === store.selectedCapabilityId"
          package-context
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
          @select="store.selectedCapabilityId = capability.id"
          @toggle-pin="store.toggleCapabilityPin(capability.id)"
        />
      </section>
      <div v-if="!filtered.length" class="empty">{{ t('noMatchingCapabilities') }}</div>
    </div>
  </section>
</template>
