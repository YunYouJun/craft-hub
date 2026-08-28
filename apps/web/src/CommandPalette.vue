<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { commandPaletteShortcutId, defaultCommandPaletteShortcut, formatShortcut } from './shortcuts'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const query = ref('')
const activeIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const paletteShortcut = computed(() => formatShortcut(store.settings?.settings['workbench.shortcuts']?.[commandPaletteShortcutId] ?? defaultCommandPaletteShortcut))
type PaletteMatch =
  | { kind: 'scope', id: string, name: string }
  | { kind: 'workspace', id: string, name: string, scopeId: string, scopeName: string }
  | { kind: 'capability', id: string, projectId: string, projectName: string, capabilityId: string, name: string, description?: string, source: string, icon: 'terminal' | 'skill', detail: string }
const matches = computed(() => {
  const [projectQuery, capabilityQuery] = query.value.includes(':')
    ? query.value.toLowerCase().split(':', 2)
    : ['', query.value.toLowerCase()]
  const navigationQuery = query.value.trim().toLowerCase()
  const scopes: PaletteMatch[] = navigationQuery
    ? store.ownerScopes
        .filter(scope => scope.name.toLowerCase().includes(navigationQuery))
        .map(scope => ({ kind: 'scope', id: `scope:${scope.id}`, name: scope.name }))
    : []
  const workspaces: PaletteMatch[] = navigationQuery
    ? store.ownerScopeWorkspaceIndex
        .filter(item => `${item.workspace.name} ${item.ownerScope.name}`.toLowerCase().includes(navigationQuery))
        .map(item => ({ kind: 'workspace', id: `workspace:${item.ownerScope.id}:${item.workspace.id}`, name: item.workspace.name, scopeId: item.ownerScope.id, scopeName: item.ownerScope.name }))
    : []
  const capabilities: PaletteMatch[] = store.paletteItems
    .filter(item => (!projectQuery || item.project.name.toLowerCase().includes(projectQuery))
      && `${item.capability.name} ${item.capability.description ?? ''} ${item.capability.kind === 'command' ? `${item.capability.package?.relativePath ?? ''} ${item.capability.package?.name ?? ''}` : ''}`.toLowerCase().includes(capabilityQuery ?? ''))
    .sort((left, right) => {
      const matchDifference = matchScore(right.capability.name, right.capability.description, capabilityQuery ?? '')
        - matchScore(left.capability.name, left.capability.description, capabilityQuery ?? '')
      if (matchDifference)
        return matchDifference
      const projectDifference = Number(right.project.id === store.selectedProjectId) - Number(left.project.id === store.selectedProjectId)
      if (projectDifference)
        return projectDifference
      const pinDifference = Number(store.isCapabilityPinned(right.project.id, right.capability.id))
        - Number(store.isCapabilityPinned(left.project.id, left.capability.id))
      return pinDifference || left.capability.name.localeCompare(right.capability.name)
    })
    .map(item => ({
      kind: 'capability' as const,
      id: `capability:${item.project.id}:${item.capability.id}`,
      projectId: item.project.id,
      projectName: item.project.name,
      capabilityId: item.capability.id,
      name: item.capability.name,
      description: item.capability.description,
      source: item.capability.source,
      icon: item.capability.kind === 'command' ? 'terminal' as const : 'skill' as const,
      detail: [item.project.id === store.selectedProjectId ? '' : item.project.name, item.capability.kind === 'command' ? item.capability.package?.relativePath : '', item.capability.source].filter(Boolean).join(' · '),
    }))
  return [...scopes, ...workspaces, ...capabilities].slice(0, 9)
})

watch(() => props.open, async (open) => {
  if (!open)
    return
  query.value = ''
  activeIndex.value = 0
  void store.loadOwnerScopeWorkspaceIndex().catch(() => {})
  await nextTick()
  searchInput.value?.focus()
})

watch(matches, (items) => {
  activeIndex.value = Math.min(activeIndex.value, Math.max(0, items.length - 1))
})

function matchScore(name: string, description: string | undefined, query: string): number {
  if (!query)
    return 0
  const normalizedName = name.toLowerCase()
  if (normalizedName === query)
    return 3
  if (normalizedName.startsWith(query))
    return 2
  if (normalizedName.includes(query))
    return 1
  return description?.toLowerCase().includes(query) ? 0 : -1
}

async function select(item: PaletteMatch): Promise<void> {
  if (item.kind === 'scope')
    await store.switchOwnerScope(item.id.slice('scope:'.length))
  else if (item.kind === 'workspace')
    await store.jumpToWorkspace(item.scopeId, item.id.split(':').slice(2).join(':'))
  else {
    if (item.projectId !== store.selectedProjectId)
      await store.selectProject(item.projectId)
    store.selectedCapabilityId = item.capabilityId
  }
  emit('update:open', false)
}

function moveActive(offset: number): void {
  if (!matches.value.length)
    return
  activeIndex.value = (activeIndex.value + offset + matches.value.length) % matches.value.length
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  }
  else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  }
  else if (event.key === 'Home') {
    event.preventDefault()
    activeIndex.value = 0
  }
  else if (event.key === 'End') {
    event.preventDefault()
    activeIndex.value = Math.max(0, matches.value.length - 1)
  }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const item = matches.value[activeIndex.value]
    if (item)
      void select(item)
  }
}
</script>

<template>
  <DialogShell :open="open" content-class="command-palette" description-class="sr-only" overlay-class="palette-overlay" title-class="sr-only" @update:open="emit('update:open', $event)">
    <template #title>{{ t('projectPalette') }}</template>
    <template #description>{{ t('currentProjectFirst') }}</template>
        <label class="palette-search"><Icon name="search" /><input ref="searchInput" v-model="query" :aria-activedescendant="matches[activeIndex] ? `palette-option-${activeIndex}` : undefined" aria-controls="command-palette-results" aria-autocomplete="list" role="combobox" :placeholder="t('typeCapability')" @keydown="onSearchKeydown"><kbd>{{ paletteShortcut }}</kbd></label>
        <small>{{ t('currentProjectFirst') }}</small>
        <div id="command-palette-results" class="palette-results" role="listbox">
          <button v-for="(item, index) in matches" :id="`palette-option-${index}`" :key="item.id" type="button" role="option" :aria-selected="index === activeIndex" :class="{ active: index === activeIndex }" @mouseenter="activeIndex = index" @click="select(item)">
            <Icon :name="item.kind === 'scope' ? 'team' : item.kind === 'workspace' ? 'workspace' : item.icon" />
            <strong>{{ item.name }}</strong><span>{{ item.kind === 'scope' ? t('ownerScope') : item.kind === 'workspace' ? item.scopeName : item.detail }}</span>
          </button>
          <p v-if="!matches.length" class="palette-empty">{{ t('noShortcutCommands') }}</p>
        </div>
        <footer><kbd>↑</kbd><kbd>↓</kbd> {{ t('navigate') }} <span>↵ {{ t('select') }}</span><span><kbd>esc</kbd> {{ t('close') }}</span></footer>
  </DialogShell>
</template>
