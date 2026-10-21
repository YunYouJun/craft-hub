<script setup lang="ts">
import type { IntegrationEntity, PersonalWorkbenchHome } from 'craft-hub'
import type { HomeWorkSource } from './personal-workbench'
import { computed, ref } from 'vue'
import { api } from './api'
import { SkeletonList } from './components/ui/skeleton'
import { Icon } from './icons'
import { useI18n } from './i18n'
import MachineReadiness from './MachineReadiness.vue'
import { useWorkbenchStore } from './store'
import PersonalTools from './PersonalTools.vue'
import VisualIcon from './VisualIcon.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'
import WorkHandoffDialog from './WorkHandoffDialog.vue'
import WorkItemsOverview from './WorkItemsOverview.vue'

const props = defineProps<{ refreshKey?: number }>()
const emit = defineEmits<{
  capture: []
  openProject: [projectId: string]
  openWorkspace: [workspaceId: string]
  openIntegration: [integrationId: string, viewId: string, scope?: 'global']
  openPluginWorkbench: [pluginId: string, workbenchId: string]
  openNavigation: []
  openSettings: []
  openDiagnostics: []
  openMarketplace: []
}>()
const store = useWorkbenchStore()
const { locale, t } = useI18n()
const zh = computed(() => locale.value === 'zh-CN')
const copy = (chinese: string, english: string) => zh.value ? chinese : english
const home = computed<PersonalWorkbenchHome>(() => store.settings?.settings['workbench.home'] ?? { tools: [] })
const saving = ref(false)
const actionError = ref('')
const visibleProjects = computed(() => {
  const scopeId = store.activeOwnerScopeId
  const ids = new Set([
    ...store.unassignedProjects.map(project => project.id),
    ...store.allWorkspaces.filter(workspace => (workspace.ownerScopeId ?? 'personal') === scopeId).flatMap(workspace => workspace.members.map(member => member.projectId)),
  ])
  return store.projects.filter(project => ids.has(project.id))
})
const orderedProjects = computed(() => {
  const pins = home.value.pinnedProjectIds ?? []
  const priority = [...pins, ...store.recentProjectIds.filter(id => !pins.includes(id))]
  return [...visibleProjects.value].sort((a, b) => {
    const left = priority.indexOf(a.id)
    const right = priority.indexOf(b.id)
    return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right) || a.name.localeCompare(b.name)
  })
})
const showAllProjects = ref(false)
const displayedProjects = computed(() => showAllProjects.value ? orderedProjects.value : orderedProjects.value.slice(0, 5))
async function togglePin(projectId: string): Promise<void> {
  if (saving.value || !store.settings)
    return
  saving.value = true
  actionError.value = ''
  const pins = home.value.pinnedProjectIds ?? []
  const next = { ...home.value, pinnedProjectIds: pins.includes(projectId) ? pins.filter(id => id !== projectId) : [...pins, projectId] }
  try { await store.applySettings(await api.updateSettings({ 'workbench.home': next }, store.settings.revision)) }
  catch { actionError.value = copy('收藏未保存，请刷新设置后重试。', 'The pin was not saved. Reload settings and try again.') }
  finally { saving.value = false }
}
const addingProject = ref(false)
async function addProject(): Promise<void> {
  if (addingProject.value)
    return
  addingProject.value = true
  actionError.value = ''
  try {
    const path = window.craftHubDesktop?.selectProjectDirectory
      ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
      : window.prompt(t('projectPath'))
    if (path)
      await store.addProject(path)
  }
  catch { actionError.value = copy('添加项目失败，请检查路径后重试。', 'Could not add the project. Check the path and try again.') }
  finally { addingProject.value = false }
}

const entries = computed(() => store.standaloneIntegrationViews.filter(view => view.scope !== 'project'))
const workspaces = computed(() => store.allWorkspaces.filter(workspace => (workspace.ownerScopeId ?? 'personal') === store.activeOwnerScopeId).slice(0, 4))
const diagnosticsCount = computed(() => store.workbenchDiagnostics?.summary?.errors ?? 0)
const handoffOpen = ref(false)
const handoffProjectId = ref('')
const handoffWork = ref<{ source: HomeWorkSource, item: IntegrationEntity }>()
function prepareHandoff(projectId = '', work?: { source: HomeWorkSource, item: IntegrationEntity }): void {
  handoffProjectId.value = projectId
  handoffWork.value = work
  handoffOpen.value = true
}
</script>

<template>
  <WorkbenchViewFrame :title="copy('首页', 'Home')" icon="builtin:hub" hide-heading>
    <div class="personal-home" data-testid="personal-workbench">
      <MachineReadiness :refresh-key="props.refreshKey" />
      <div class="home-work-column"><WorkItemsOverview compact tabbed @capture="emit('capture')" :refresh-key="props.refreshKey" @prepare-handoff="work => prepareHandoff('', work)" @open-integration="(id, view, scope) => emit('openIntegration', id, view, scope)" @open-marketplace="emit('openMarketplace')" /></div>

      <aside class="home-support-column" :aria-label="copy('项目与工具', 'Projects and tools')">
        <section class="home-card home-projects">
          <div class="home-section-heading"><h2>{{ copy('常用项目', 'Projects') }}</h2><button v-if="store.hostEnvironment.capabilities.localProjectDirectories" class="home-text-button" :disabled="addingProject" @click="addProject"><Icon name="plus" />{{ copy('添加项目', 'Add project') }}</button></div>
          <SkeletonList v-if="['idle', 'loading'].includes(store.projectsLoadState) && !displayedProjects.length" class="home-project-skeleton" :label="copy('正在读取项目…', 'Loading projects…')" icon />
          <p v-else-if="store.projectsLoadState === 'error'" class="home-error" role="alert">{{ copy('项目未载入。', 'Projects could not be loaded.') }}<button class="home-text-button" @click="store.loadProjects()">{{ copy('重试', 'Retry') }}</button></p>
          <div v-else-if="!displayedProjects.length" class="home-empty"><Icon name="folder" /><strong>{{ copy('把项目放到工作台', 'Bring your projects here') }}</strong><p>{{ copy('添加本机项目，或从工作区订阅中导入。', 'Add a local project or import a workspace subscription.') }}</p></div>
          <div class="home-project-list motion-reveal-list"><div v-for="project in displayedProjects" :key="project.id" class="home-project-row">
            <button class="home-project-open" :title="project.path" @click="emit('openProject', project.id)"><span class="home-project-icon"><VisualIcon :icon="project.icon" fallback="folder" /></span><span><strong>{{ project.name }}</strong><small>{{ project.path }}</small></span></button>
            <button class="home-icon-button" :aria-label="`${copy('准备交接', 'Prepare handoff')} ${project.name}`" @click="prepareHandoff(project.id)"><Icon name="copy" /></button>
            <button class="home-pin" :class="{ pinned: home.pinnedProjectIds?.includes(project.id) }" :disabled="saving || !store.settings" :aria-pressed="home.pinnedProjectIds?.includes(project.id) ?? false" :aria-label="`${home.pinnedProjectIds?.includes(project.id) ? copy('取消收藏', 'Unpin') : copy('收藏', 'Pin')} ${project.name}`" @click="togglePin(project.id)"><Icon :name="home.pinnedProjectIds?.includes(project.id) ? 'starFilled' : 'star'" /></button>
          </div></div>
          <button v-if="orderedProjects.length > 5" class="home-text-button home-show-projects" @click="showAllProjects = !showAllProjects">{{ showAllProjects ? copy('收起项目', 'Show fewer projects') : copy('查看全部项目', 'Show all projects') }}<Icon name="arrowDown" /></button>
          <div v-if="workspaces.length" class="home-workspaces"><span>{{ copy('工作区', 'Workspaces') }}</span><button v-for="workspace in workspaces" :key="workspace.id" @click="emit('openWorkspace', workspace.id)"><VisualIcon :icon="workspace.icon" fallback="workspace" />{{ workspace.name }}<Icon name="arrowRight" /></button></div>
          <p v-if="actionError" class="home-error" role="alert">{{ actionError }}</p>
        </section>
        <PersonalTools compact @open-navigation="emit('openNavigation')" />
      </aside>

      <section v-if="store.pluginWorkbenches.length || entries.length" class="home-integrations"><div class="home-section-heading"><h2>{{ copy('已接入的工作台', 'Connected workbenches') }}</h2><button class="home-text-button" @click="emit('openMarketplace')">{{ copy('管理插件', 'Manage plugins') }}<Icon name="arrowRight" /></button></div><div class="home-entry-grid">
        <button v-for="workbench in store.pluginWorkbenches" :key="`${workbench.pluginId}:${workbench.id}`" @click="emit('openPluginWorkbench', workbench.pluginId, workbench.id)"><VisualIcon :icon="workbench.icon" fallback="workspace" /><span><strong>{{ workbench.title }}</strong><small>{{ workbench.pluginName }}</small></span><Icon name="arrowRight" /></button>
        <button v-for="view in entries" :key="`${view.integrationId}:${view.id}`" @click="emit('openIntegration', view.integrationId, view.id)"><VisualIcon :icon="view.icon" fallback="list" /><span><strong>{{ view.title }}</strong><small>{{ view.providerId }}</small></span><Icon name="arrowRight" /></button>
      </div></section>
      <footer class="home-status"><strong>{{ copy('工作台状态', 'Workbench status') }}</strong><span>{{ store.workbenchDiagnosticsError ? copy('诊断未载入，请重试', 'Diagnostics could not be loaded. Retry in diagnostics.') : store.workbenchDiagnostics.checkedAt ? (diagnosticsCount ? copy('有诊断需要处理', 'Diagnostics need attention') : copy('诊断已载入', 'Diagnostics loaded')) : copy('打开诊断查看连接与配置', 'Open diagnostics to check connections and configuration') }}</span><button class="home-text-button" @click="emit('openSettings')"><Icon name="settings" />{{ copy('配置', 'Settings') }}</button><button class="home-text-button" @click="emit('openDiagnostics')"><Icon name="chart" />{{ copy('诊断', 'Diagnostics') }}</button></footer>
    </div>
  </WorkbenchViewFrame>

  <WorkHandoffDialog v-model:open="handoffOpen" :initial-project-id="handoffProjectId" :work="handoffWork" :projects="visibleProjects" />
</template>

<style scoped>
.personal-home { display: grid; gap: 12px; }
.home-support-column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 12px; min-width: 0; }
.home-card, .home-integrations { min-width: 0; border: 1px solid var(--border); border-radius: var(--panel-radius); padding: 0 12px; background: var(--surface); }
.home-work-column { min-width: 0; }
.home-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; border-bottom: 1px solid var(--border); }
.home-section-heading h2 { margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
.home-text-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 28px; border: 0; border-radius: 4px; padding: 3px 0; background: none; color: var(--accent); font: inherit; font-size: var(--font-size-control); cursor: pointer; }
.home-text-button:hover { text-decoration: underline; }
.home-text-button > .app-icon { flex: none; width: 14px; height: 14px; }
.home-text-button:disabled, .home-icon-button:disabled { opacity: .55; cursor: default; }
.home-icon-button, .home-pin { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: var(--control-radius); color: var(--muted); background: transparent; cursor: pointer; }
.home-icon-button > .app-icon, .home-pin > .app-icon { width: 15px; height: 15px; }
.home-icon-button:hover, .home-pin:hover { background: var(--surface-hover); color: var(--text); }
.home-pin.pinned { color: var(--accent); }
.home-pin:disabled { opacity: .5; cursor: default; }
.home-text-button:focus-visible, .home-icon-button:focus-visible, .home-pin:focus-visible, .home-project-open:focus-visible, .home-work-item:focus-visible, .home-workspaces > button:focus-visible, .home-entry-grid > button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.home-project-list { display: grid; }
.home-project-skeleton { --skeleton-row-height: 48px; --skeleton-row-padding: 6px 0; }
.home-project-row { display: flex; align-items: center; min-width: 0; min-height: 48px; gap: 2px; }
.home-project-row + .home-project-row { border-top: 1px solid var(--border); }
.home-project-row:hover { background: var(--surface-subtle); }
.home-project-open { display: flex; flex: 1; gap: 8px; align-items: center; min-width: 0; min-height: 48px; padding: 6px 4px 6px 0; border: 0; border-radius: 4px; background: none; text-align: left; color: var(--text); cursor: pointer; font: inherit; }
.home-project-icon { display: flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--muted); }
.home-project-icon :deep(.app-icon) { width: 18px; height: 18px; }
.home-project-open > span:last-child { flex: 1; min-width: 0; }
.home-project-open strong, .home-project-open small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-project-open strong { font-size: 14px; font-weight: 500; line-height: 20px; }
.home-project-open small { margin-top: 1px; font-size: 12px; line-height: 16px; color: var(--muted); }
.home-show-projects { width: 100%; margin-block: 4px; }
.home-workspaces { display: grid; grid-template-columns: 1fr; margin-top: 4px; padding-top: 8px; border-top: 1px solid var(--border); }
.home-workspaces > span { margin-bottom: 2px; color: var(--muted); font-size: 12px; font-weight: 500; line-height: 18px; }
.home-workspaces > button, .home-entry-grid > button { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 38px; padding: 6px 0; border: 0; border-radius: 4px; background: none; color: var(--text); text-align: left; font: inherit; font-size: 14px; cursor: pointer; }
.home-workspaces > button + button { border-top: 1px solid var(--border); border-radius: 0; }
.home-workspaces > button:hover, .home-entry-grid > button:hover { background: var(--surface-subtle); }
.home-workspaces > button :deep(.app-icon) { flex: none; width: 16px; height: 16px; color: var(--muted); }
.home-workspaces > button > .app-icon:last-child { margin-left: auto; width: 13px; height: 13px; }
.home-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 22px 0; color: var(--muted); }
.home-empty > .app-icon { width: 24px; height: 24px; color: var(--muted); }
.home-empty strong { color: var(--text); font-size: var(--font-size-emphasis); font-weight: 500; }
.home-empty p { margin: 0; max-width: 340px; font-size: var(--font-size-caption); line-height: 1.7; }
.home-hint, .home-error, .home-preview-note { margin: 8px 0; font-size: var(--font-size-caption); line-height: 1.6; color: var(--muted); overflow-wrap: anywhere; }
.home-error { color: var(--danger); }
.home-hint .home-text-button, .home-error .home-text-button { margin-left: 6px; }
.home-source-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; padding: 2px 0 6px; }
.home-source-heading > strong { color: var(--muted); font-size: var(--font-size-caption); font-weight: 600; line-height: 18px; }
.home-work-source { border-top: 1px solid var(--border); padding-top: 10px; }
.home-work-source + .home-work-source { margin-top: 16px; }
.home-work-row { display: flex; align-items: center; gap: 6px; min-height: 56px; border-top: 1px solid var(--border); }
.home-work-row:hover { background: var(--surface-subtle); }
.home-work-item { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; min-height: 56px; padding: 9px 0; border: 0; border-radius: 4px; text-align: left; background: none; color: var(--text); font: inherit; font-size: var(--font-size-body); cursor: pointer; }
.home-work-item > .app-icon { flex: none; width: 16px; height: 16px; color: var(--muted); }
.home-work-item > .app-icon:last-child { width: 13px; height: 13px; }
.home-work-item > span { flex: 1; min-width: 0; }
.home-work-item strong { display: block; font-weight: 500; line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-work-item small { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 3px; color: var(--muted); font-size: var(--font-size-caption); line-height: 16px; }
.home-entry-grid { display: grid; grid-template-columns: 1fr; }
.home-entry-grid > button { min-height: 48px; border-radius: 0; }
.home-entry-grid > button + button { border-top: 1px solid var(--border); }
.home-entry-grid > button > .visual-icon { flex: none; width: 28px; height: 28px; }
.home-entry-grid > button :deep(.visual-icon-emoji) { font-size: 22px; }
.home-entry-grid > button :deep(.app-icon) { flex: none; width: 18px; height: 18px; color: var(--muted); }
.home-entry-grid > button > .app-icon:last-child { width: 13px; height: 13px; }
.home-entry-grid > button > span:nth-child(2) { flex: 1; min-width: 0; }
.home-entry-grid strong, .home-entry-grid small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-entry-grid strong { font-size: 14px; font-weight: 500; line-height: 20px; }
.home-entry-grid small { margin-top: 1px; color: var(--muted); font-size: 12px; line-height: 16px; }
.home-status { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; border-top: 1px solid var(--border); padding: 12px 0 0; font-size: var(--font-size-caption); }
.home-status > strong { font-weight: 500; }
.home-status > span { flex: 1; color: var(--muted); }
.home-status > button { flex: none; }
.home-handoff-form { display: grid; gap: 14px; }
.home-handoff-form label { display: grid; gap: 6px; font-size: var(--font-size-body); }
.home-handoff-preview { resize: vertical; font-size: var(--font-size-control) !important; line-height: 1.6; }
.home-handoff-tools { display: flex; flex-wrap: wrap; gap: 16px; }
@media (max-width: 767.9px), (pointer: coarse) { .home-tool-editor input, .home-tool-editor select, .home-handoff-form select, .home-handoff-form textarea { font-size: 16px; } }
@media (max-width: 680px) { .home-support-column { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .home-card, .home-integrations { padding-inline: 12px; } .home-status { gap: 10px; } .home-status > span { flex-basis: calc(100% - 120px); } }
</style>
