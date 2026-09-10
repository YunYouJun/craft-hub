<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { DialogShell } from './components/ui/dialog'
import Icon from './NavigationIcon.vue'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = withDefaults(defineProps<{ open: boolean, mode?: 'all' | 'projects' | 'commands' }>(), { mode: 'all' })
const emit = defineEmits<{ 'update:open': [value: boolean], openWorkbench: [], openIntegration: [integrationId: string, viewId: string], openPluginWorkbench: [pluginId: string, workbenchId: string], openSettings: [], refresh: [] }>()
const store = useWorkbenchStore()
const { t, locale } = useI18n()
const query = ref(props.mode === 'commands' ? '> ' : '')
type Category = 'all' | 'projects' | 'pages' | 'commands' | 'skills'
const category = ref<Category>(props.mode === 'projects' ? 'projects' : 'all')
const categories = computed(() => [
  { id: 'all', label: locale.value === 'zh-CN' ? '全部' : 'All' },
  { id: 'projects', label: locale.value === 'zh-CN' ? '项目' : 'Projects' },
  { id: 'pages', label: locale.value === 'zh-CN' ? '页面' : 'Pages' },
  { id: 'commands', label: locale.value === 'zh-CN' ? '命令' : 'Commands' },
  { id: 'skills', label: locale.value === 'zh-CN' ? '技能' : 'Skills' },
] as const)
async function changeCategory(value: string | number): Promise<void> {
  category.value = value as Category
  query.value = query.value.replace(/^\s*>\s*/, '')
  activeIndex.value = 0
  await nextTick()
  searchInput.value?.focus()
}
const activeIndex = ref(0)
const searchInput = ref<HTMLInputElement>()
const resultList = ref<HTMLElement>()
async function revealActive(): Promise<void> {
  await nextTick()
  resultList.value?.children[activeIndex.value]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}
const commandMode = computed(() => query.value.trimStart().startsWith('>'))
const projectMode = computed(() => category.value === 'projects' && !commandMode.value)
const searchLabel = computed(() => locale.value === 'zh-CN'
  ? commandMode.value ? '搜索命令和页面…' : projectMode.value ? '搜索项目…（> 切换命令模式）' : '搜索项目、页面、命令和技能…'
  : commandMode.value ? 'Search commands and pages…' : projectMode.value ? 'Search projects… (> for commands)' : 'Search projects, pages, commands and skills…')
const modeLabel = computed(() => locale.value === 'zh-CN' ? commandMode.value ? '命令与导航' : projectMode.value ? '项目' : '搜索结果' : commandMode.value ? 'Commands and navigation' : projectMode.value ? 'Projects' : 'Search results')
function projectStatus(id: string) {
  const zh = locale.value === 'zh-CN'
  if (store.projectCatalogDiagnostics.some(item => item.projectId === id))
    return { icon: 'error' as const, tone: 'warning', label: zh ? '项目配置需检查' : 'Project configuration needs attention' }
  if (store.projects.find(project => project.id === id)?.trust === 'trusted')
    return { icon: 'trusted' as const, tone: 'trusted', label: zh ? '已信任项目' : 'Trusted project' }
  return { icon: 'folder' as const, tone: 'neutral', label: zh ? '尚未信任项目' : 'Project not yet trusted' }
}
function detail(item: PaletteMatch): string {
  if (item.kind === 'project') return item.path
  if (item.kind === 'page') {
    const zh = locale.value === 'zh-CN'
    if (item.target === 'refresh') return zh ? '重新加载项目与工作台数据' : 'Reload projects and workbench data'
    if (item.target === 'home') return zh ? '返回项目总览与命令面板' : 'Go to project overview and commands'
    if (item.target === 'settings') return zh ? '管理外观、快捷键和工作台偏好' : 'Manage appearance, shortcuts and preferences'
    return zh ? `打开${item.name}页面` : `Open ${item.name}`
  }
  if (item.kind === 'scope') return t('ownerScope')
  if (item.kind === 'workspace') return item.scopeName
  return item.description || item.detail
}
type PaletteMatch =
  | { kind: 'project', id: string, name: string, path: string }
  | { kind: 'page', id: string, name: string, target: 'home' | 'settings' | 'refresh' | 'integration' | 'plugin-workbench', integrationId?: string, viewId?: string, pluginId?: string, workbenchId?: string }
  | { kind: 'scope', id: string, name: string }
  | { kind: 'workspace', id: string, name: string, scopeId: string, scopeName: string }
  | { kind: 'capability', id: string, projectId: string, projectName: string, capabilityId: string, name: string, description?: string, source: string, icon: 'terminal' | 'skill', detail: string }
const matches = computed(() => {
  const search = query.value.replace(/^\s*>\s*/, '')
  const [projectQuery, capabilityQuery] = search.includes(':')
    ? search.toLowerCase().split(':', 2)
    : ['', search.toLowerCase()]
  const navigationQuery = search.trim().toLowerCase()
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
  const projects: PaletteMatch[] = store.projects
    .filter(project => `${project.name} ${project.path}`.toLowerCase().includes(navigationQuery))
    .sort((a, b) => Number(b.id === store.selectedProjectId) - Number(a.id === store.selectedProjectId))
    .map(project => ({ kind: 'project', id: project.id, name: project.name, path: project.path }))
  const pages = ([
    { kind: 'page', id: 'home', name: t('paletteHome'), target: 'home' },
    { kind: 'page', id: 'settings', name: t('settings'), target: 'settings' },
    { kind: 'page', id: 'refresh', name: t('refresh'), target: 'refresh' },
    ...store.integrationViews.map(view => ({ kind: 'page' as const, id: `view:${view.integrationId}:${view.id}`, name: view.title, target: 'integration' as const, integrationId: view.integrationId, viewId: view.id })),
    ...store.pluginWorkbenches.map(workbench => ({ kind: 'page' as const, id: `workbench:${workbench.pluginId}:${workbench.id}`, name: workbench.title, target: 'plugin-workbench' as const, pluginId: workbench.pluginId, workbenchId: workbench.id })),
  ] satisfies PaletteMatch[]).filter(item => `${item.name} ${item.id}`.toLowerCase().includes(navigationQuery))
  if (commandMode.value)
    return [...pages, ...capabilities].slice(0, 20)
  if (projectMode.value)
    return projects.slice(0, 20)
  if (category.value === 'pages')
    return pages.slice(0, 20)
  if (category.value === 'commands' || category.value === 'skills')
    return capabilities.filter(item => item.kind === 'capability' && item.icon === (category.value === 'skills' ? 'skill' : 'terminal')).slice(0, 20)
  return (navigationQuery ? [...projects, ...pages, ...scopes, ...workspaces, ...capabilities] : [...capabilities, ...projects, ...pages]).slice(0, 20)
})

watch(() => [props.open, props.mode] as const, async ([open]) => {
  if (!open)
    return
  category.value = props.mode === 'projects' ? 'projects' : 'all'
  query.value = props.mode === 'commands' ? '> ' : ''
  activeIndex.value = 0
  void store.loadOwnerScopeWorkspaceIndex().catch(() => {})
  await nextTick()
  searchInput.value?.focus()
})

watch(matches, async () => {
  activeIndex.value = 0
  await nextTick()
  if (resultList.value)
    resultList.value.scrollTop = 0
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
  if (item.kind === 'page') {
    if (item.target === 'home')
      emit('openWorkbench')
    else if (item.target === 'settings')
      emit('openSettings')
    else if (item.target === 'refresh')
      emit('refresh')
    else if (item.target === 'integration' && item.integrationId && item.viewId)
      emit('openIntegration', item.integrationId, item.viewId)
    else if (item.target === 'plugin-workbench' && item.pluginId && item.workbenchId)
      emit('openPluginWorkbench', item.pluginId, item.workbenchId)
  }
  else if (item.kind === 'project') {
    await store.selectProject(item.id)
    emit('openWorkbench')
  }
  else if (item.kind === 'scope')
    await store.switchOwnerScope(item.id.slice('scope:'.length))
  else if (item.kind === 'workspace')
    await store.jumpToWorkspace(item.scopeId, item.id.split(':').slice(2).join(':'))
  else {
    if (item.projectId !== store.selectedProjectId)
      await store.selectProject(item.projectId)
    store.selectedCapabilityId = item.capabilityId
    emit('openWorkbench')
  }
  emit('update:open', false)
}

function moveActive(offset: number): void {
  if (!matches.value.length)
    return
  activeIndex.value = (activeIndex.value + offset + matches.value.length) % matches.value.length
  void revealActive()
}

function onSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Tab') {
    event.preventDefault()
    const index = categories.value.findIndex(item => item.id === category.value)
    void changeCategory(categories.value[(index + (event.shiftKey ? -1 : 1) + categories.value.length) % categories.value.length]!.id)
  }
  else if (event.key === 'ArrowDown') {
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
    void revealActive()
  }
  else if (event.key === 'End') {
    event.preventDefault()
    activeIndex.value = Math.max(0, matches.value.length - 1)
    void revealActive()
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
    <template #title>{{ modeLabel }}</template>
    <template #description>{{ t('currentProjectFirst') }}</template>
    <label class="palette-search">
      <Icon :name="commandMode ? 'terminal' : 'search'" />
      <input ref="searchInput" v-model="query" :aria-label="searchLabel" :aria-activedescendant="matches[activeIndex] ? `palette-option-${activeIndex}` : undefined" aria-controls="command-palette-results" :aria-expanded="open" aria-autocomplete="list" role="combobox" :placeholder="searchLabel" @keydown="onSearchKeydown">
      <button class="palette-dismiss" type="button" :aria-label="t('close')" @click="emit('update:open', false)"><kbd>Esc</kbd></button>
    </label>
    <TabsRoot :model-value="category" class="palette-category-root" @update:model-value="changeCategory">
      <TabsList class="palette-category-list" :aria-label="locale === 'zh-CN' ? '搜索分类' : 'Search categories'">
        <TabsTrigger v-for="item in categories" :key="item.id" :value="item.id">{{ item.label }}</TabsTrigger>
      </TabsList>
      <TabsContent :value="category" class="palette-category-panel" :tabindex="-1">
    <small v-if="commandMode" class="palette-section-label">{{ modeLabel }}</small>
    <div id="command-palette-results" ref="resultList" class="palette-results" role="listbox">
      <button v-for="(item, index) in matches" :id="`palette-option-${index}`" :key="item.id" type="button" role="option" :aria-selected="index === activeIndex" :aria-current="item.kind === 'project' && item.id === store.selectedProjectId ? 'true' : undefined" :class="{ active: index === activeIndex, 'current-project': item.kind === 'project' && item.id === store.selectedProjectId }" @mouseenter="activeIndex = index" @click="select(item)">
        <Icon v-if="item.kind === 'project'" :name="projectStatus(item.id).icon" :class="`palette-project-status--${projectStatus(item.id).tone}`" :title="projectStatus(item.id).label" />
        <Icon v-else :name="item.kind === 'page' ? item.target === 'settings' ? 'settings' : item.target === 'refresh' ? 'refresh' : item.target === 'home' ? 'hub' : 'compass' : item.kind === 'scope' ? 'team' : item.kind === 'workspace' ? 'workspace' : item.icon" />
        <div class="palette-item-copy"><strong>{{ item.name }}</strong><span v-if="item.kind === 'project'" class="sr-only">{{ projectStatus(item.id).label }}</span><small :title="detail(item)">{{ detail(item) }}</small></div>
        <Icon v-if="item.kind === 'project' && item.id === store.selectedProjectId" name="check" class="palette-current-mark" :title="locale === 'zh-CN' ? '当前项目' : 'Current project'" />
      </button>
      <p v-if="!matches.length" class="palette-empty">{{ t('noShortcutCommands') }}</p>
    </div>
      </TabsContent>
    </TabsRoot>
    <footer><kbd>↑↓</kbd> {{ t('navigate') }} <span><kbd>↵</kbd> {{ t('select') }}</span><button v-if="!commandMode" class="palette-mode-switch" type="button" @click="query = '> '; searchInput?.focus()"><kbd>&gt;</kbd> {{ locale === 'zh-CN' ? '命令模式' : 'Commands' }}</button><button v-else class="palette-mode-switch" type="button" @click="query = ''; searchInput?.focus()">{{ locale === 'zh-CN' ? '返回搜索' : 'Back to search' }}</button></footer>
  </DialogShell>
</template>
