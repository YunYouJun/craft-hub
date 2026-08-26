<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CapabilityRow from './CapabilityRow.vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const query = ref('')
const filter = ref<'all' | 'command' | 'skill'>('all')
const draggingId = ref('')
const filtered = computed(() => store.capabilities.filter(matchesFilter))
const pinned = computed(() => store.pinnedCapabilities.filter(matchesFilter))
const pinnedIds = computed(() => new Set(store.pinnedCapabilityIds))
const unpinned = computed(() => filtered.value.filter(capability => !pinnedIds.value.has(capability.id)))
const improveAction = computed(() => store.agentActions.find(action => action.id === 'improve-project-config'))
const dismissedFingerprint = ref('')
const showDescriptionHint = computed(() => Boolean(improveAction.value?.missingCommandCount)
  && improveAction.value?.commandFingerprint !== dismissedFingerprint.value)

watch(() => [store.selectedProjectId, improveAction.value?.commandFingerprint] as const, () => {
  dismissedFingerprint.value = store.selectedProjectId
    ? window.localStorage.getItem(`craft-hub-agent-action-hint:${store.selectedProjectId}`) ?? ''
    : ''
}, { immediate: true })

function matchesFilter(item: typeof store.capabilities[number]): boolean {
  return (filter.value === 'all' || item.kind === filter.value)
    && `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.value.toLowerCase())
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
          @select="store.selectedCapabilityId = capability.id"
          @toggle-pin="store.toggleCapabilityPin(capability.id)"
          @dragstart="startDrag(capability.id, $event)"
          @drop="movePinned(capability.id)"
          @move="movePinned(capability.id, $event)"
        />
      </section>
      <section v-if="unpinned.length" class="capability-section">
        <h3 v-if="pinned.length">{{ t('allCapabilities') }}</h3>
        <CapabilityRow
          v-for="capability in unpinned"
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
