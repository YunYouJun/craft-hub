<script lang="ts">
import { lazyComponent } from './lazy-components'

// Home, project and shell chrome stay in the startup bundle; other views and dialogs load on demand and prefetch
// while idle so first navigation still feels immediate. Module scope keeps one wrapper per view for the app's life.
const MarketplaceDialog = lazyComponent(() => import('./MarketplaceDialog.vue'))
const ConfigurationSubscriptions = lazyComponent(() => import('./ConfigurationSubscriptions.vue'))
const PluginWorkbench = lazyComponent(() => import('./PluginWorkbench.vue'))
const ToolsWorkbench = lazyComponent(() => import('./ToolsWorkbench.vue'))
const WorkbenchesOverview = lazyComponent(() => import('./WorkbenchesOverview.vue'))
const SoftwareCenter = lazyComponent(() => import('./SoftwareCenter.vue'))
const SetupProfileWorkbench = lazyComponent(() => import('./SetupProfileWorkbench.vue'))
const EnvironmentWorkbench = lazyComponent(() => import('./EnvironmentWorkbench.vue'))
const DiagnosticsWorkbench = lazyComponent(() => import('./DiagnosticsWorkbench.vue'))
const IntegrationWorkbench = lazyComponent(() => import('./IntegrationWorkbench.vue'))
const NavigationWorkbench = lazyComponent(() => import('./NavigationWorkbench.vue'))
const WorkspaceDashboard = lazyComponent(() => import('./WorkspaceDashboard.vue'))
const WelcomePanel = lazyComponent(() => import('./WelcomePanel.vue'))
const CommandPalette = lazyComponent(() => import('./CommandPalette.vue'))
const SettingsDialog = lazyComponent(() => import('./SettingsDialog.vue'))
const QuickCaptureDialog = lazyComponent(() => import('./QuickCaptureDialog.vue'))
const ProjectAgentActionDialog = lazyComponent(() => import('./ProjectAgentActionDialog.vue'))
const DesktopNavigationDialog = lazyComponent(() => import('./DesktopNavigationDialog.vue'))
</script>

<script setup lang="ts">
import type { WorkbenchDiagnosticTarget } from 'craft-hub'
import type { WorkbenchNavigationGroup } from './workbench-navigation'
import type { DesktopMenuAction } from './shortcuts'
import { TransitionPresets, useLocalStorage, useMediaQuery, useTransition } from '@vueuse/core'
import { computed, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, SplitterPanel } from 'reka-ui'
import { useRoute, useRouter } from 'vue-router'
import { subscribeToProjectChanges } from './api'
import CapabilityList from './CapabilityList.vue'
import { celebration } from './celebration'
import { Button as UiButton } from './components/ui/button'
import DetailPanel from './DetailPanel.vue'
import Icon from './NavigationIcon.vue'
import { useI18n } from './i18n'
import WorkbenchSectionNavigation from './WorkbenchSectionNavigation.vue'
import { classifyWorkbenchSection, isEnvironmentView } from './workbench-navigation'
import PersonalWorkbench from './PersonalWorkbench.vue'
import ProjectRail from './ProjectRail.vue'
import ProjectToolbar from './ProjectToolbar.vue'
import { capabilityShortcutPrefix, commandPaletteShortcutId, defaultCommandPaletteShortcut, desktopWorkbenchShortcuts, formatShortcut, matchesShortcut, parseCapabilityShortcutId } from './shortcuts'
import WorkbenchPageShell from './WorkbenchPageShell.vue'
import WorkbenchToolbar from './WorkbenchToolbar.vue'
import WorkbenchResizeHandle from './WorkbenchResizeHandle.vue'
import WorkbenchSplitter from './WorkbenchSplitter.vue'
import WorkspaceProjectList from './WorkspaceProjectList.vue'
import { useWorkbenchStore } from './store'
import { prefetchLazyComponents, useOpenedOnce } from './lazy-components'

const quickCaptureOpen = ref(false)
let stopQuickCapture: (() => void) | undefined
const store = useWorkbenchStore()
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const compactViewport = useMediaQuery('(max-width: 760px)')
const desktopSidebarCollapsed = useLocalStorage('craft-hub-desktop-sidebar-collapsed', false)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
// The rail glides between its widths like a native sidebar; the grid and the home splitter both follow every frame.
// Compact layouts and reduced motion switch at once.
const activityRailWidth = useTransition(
  computed(() => compactViewport.value ? 48 : desktopSidebarCollapsed.value ? 52 : 176),
  { duration: computed(() => compactViewport.value || reducedMotion.value ? 0 : 220), transition: TransitionPresets.easeOutCubic },
)
const mobileNavigationOpen = ref(false)
watch(() => route.fullPath, () => { mobileNavigationOpen.value = false })
const desktopMac = window.craftHubDesktop?.platform === 'darwin'
const shortcutPlatform = window.craftHubDesktop?.platform ?? navigator.platform
const historyState = ref({ ...router.options.history.state })
const canGoBack = computed(() => typeof historyState.value.back === 'string')
const canGoForward = computed(() => typeof historyState.value.forward === 'string')
const stopHistoryTracking = router.afterEach((_to, _from, failure) => {
  if (!failure)
    historyState.value = { ...router.options.history.state }
})
function toggleDesktopSidebar(): void {
  if (!compactViewport.value)
    desktopSidebarCollapsed.value = !desktopSidebarCollapsed.value
}
function goBack(): void {
  if (canGoBack.value)
    router.back()
}
function goForward(): void {
  if (canGoForward.value)
    router.forward()
}
const paletteOpen = ref(false)
const paletteMode = ref<'all' | 'projects' | 'commands'>('all')
const paletteShortcutLabel = computed(() => formatShortcut(store.settings?.settings['workbench.shortcuts']?.[commandPaletteShortcutId] ?? defaultCommandPaletteShortcut, shortcutPlatform))
function showPalette(mode: 'all' | 'projects' | 'commands'): void {
  paletteMode.value = mode
  paletteOpen.value = true
}
const settingsOpen = ref(false)
const settingsInitialTab = ref<'general' | 'help'>('general')
const paletteMounted = useOpenedOnce(() => paletteOpen.value)
const settingsMounted = useOpenedOnce(() => settingsOpen.value)
const quickCaptureMounted = useOpenedOnce(() => quickCaptureOpen.value)
const agentActionMounted = useOpenedOnce(() => store.agentActionDialogOpen)
onMounted(prefetchLazyComponents)
const marketplaceOpen = computed(() => route.name === 'marketplace' || route.name === 'plugin-detail')
const subscriptionsOpen = computed(() => String(route.name).startsWith('subscriptions'))
const navigationOpen = computed(() => route.name === 'navigation')
const overviewOpen = computed(() => route.name === 'overview')
const diagnosticsOpen = computed(() => route.name === 'diagnostics')
const setupProfileOpen = computed(() => route.name === 'setup-profile')
const environmentOpen = computed(() => route.name === 'environment' || setupProfileOpen.value)
const softwareOpen = computed(() => route.name === 'software')
const toolsOpen = computed(() => route.name === 'tools')
const workbenchesOpen = computed(() => route.name === 'workbenches')
const integrationOpen = computed(() => route.name === 'integration')
const pluginWorkbenchOpen = computed(() => route.name === 'plugin-workbench')
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const currentIntegrationView = computed(() => store.integrationViews.find(view => view.integrationId === route.params.integrationId && view.id === route.params.viewId))
const activeSection = computed(() => classifyWorkbenchSection(route.name, currentIntegrationView.value))
const sectionTitle = computed(() => ({
  home: copy('首页', 'Home'),
  projects: copy('项目', 'Projects'),
  tools: copy('工具', 'Tools'),
  environment: copy('开发环境', 'Development environment'),
  workbenches: copy('工作台', 'Workbenches'),
})[activeSection.value ?? 'home'])
const sectionIcon = computed(() => ({ home: 'builtin:hub', projects: 'builtin:folder', tools: 'builtin:package', environment: 'builtin:terminal', workbenches: 'builtin:hub' })[activeSection.value ?? 'home'])
const sectionPath = computed(() => ({ home: '/overview', projects: '/', tools: '/tools', environment: '/environment', workbenches: '/workbenches' })[activeSection.value ?? 'home'])
function integrationPath(integrationId: string, viewId: string): string {
  return `/integrations/${encodeURIComponent(integrationId)}/${encodeURIComponent(viewId)}`
}
const sectionGroups = computed<WorkbenchNavigationGroup[]>(() => {
  if (activeSection.value === 'projects') {
    return [{ entries: [
      { key: 'projects', title: copy('项目与工作区', 'Projects and workspaces'), icon: 'builtin:folder', to: '/' },
      { key: 'sources', title: copy('配置源', 'Workspace sources'), icon: 'builtin:workspace', to: '/subscriptions', match: 'prefix' },
    ] }]
  }
  if (activeSection.value === 'tools') {
    return [{ entries: [
      { key: 'favorites', title: copy('常用工具', 'Favorite tools'), icon: 'builtin:star', to: '/tools' },
      { key: 'software', title: copy('软件中心', 'Software center'), icon: 'builtin:package', to: '/software' },
      { key: 'navigation', title: copy('网站导航', 'Website navigation'), icon: 'builtin:web', to: '/navigation' },
    ] }]
  }
  if (activeSection.value === 'environment') {
    return [
      { entries: [
        { key: 'environment', title: copy('本机检测', 'Machine checks'), icon: 'builtin:terminal', to: '/environment' },
        { key: 'setup-profile', title: copy('我的环境方案', 'My environment profile'), icon: 'builtin:settings', to: '/environment/setup' },
      ] },
      { title: copy('环境配置', 'Environment configuration'), entries: store.integrationViews.filter(isEnvironmentView).map(view => ({
        key: `${view.integrationId}:${view.id}`, title: view.title, icon: view.icon ?? 'builtin:settings', to: integrationPath(view.integrationId, view.id),
      })) },
    ].filter(group => group.entries.length)
  }
  if (activeSection.value === 'workbenches') {
    return [
      { entries: [{ key: 'workbenches', title: copy('全部工作台', 'All workbenches'), icon: 'builtin:hub', to: '/workbenches' }] },
      { title: copy('已安装工作台', 'Installed workbenches'), entries: store.pluginWorkbenches.map(workbench => ({
        key: `${workbench.pluginId}:${workbench.id}`, title: workbench.title, icon: workbench.icon,
        to: `/workbenches/${encodeURIComponent(workbench.pluginId)}/${encodeURIComponent(workbench.id)}`,
      })) },
      { title: copy('独立集成', 'Standalone integrations'), entries: store.standaloneIntegrationViews.filter(view => !isEnvironmentView(view)).map(view => ({
        key: `${view.integrationId}:${view.id}`, title: view.title, icon: view.icon, to: integrationPath(view.integrationId, view.id),
      })) },
    ].filter(group => group.entries.length)
  }
  return []
})
const pageBreadcrumbs = computed(() => {
  const pluginWorkbench = store.pluginWorkbenches.find(workbench => workbench.pluginId === route.params.pluginId && workbench.id === route.params.workbenchId)
  const label = overviewOpen.value ? copy('首页', 'Home') : marketplaceOpen.value ? copy('插件管理', 'Plugins') : navigationOpen.value ? copy('网站导航', 'Website navigation') : softwareOpen.value ? copy('软件中心', 'Software center') : toolsOpen.value ? copy('常用工具', 'Favorite tools') : workbenchesOpen.value ? copy('全部工作台', 'All workbenches') : setupProfileOpen.value ? copy('我的环境方案', 'My environment profile') : environmentOpen.value ? copy('本机检测', 'Machine checks') : diagnosticsOpen.value ? t('diagnostics') : integrationOpen.value ? (currentIntegrationView.value?.title ?? copy('集成', 'Integration')) : (pluginWorkbench?.title ?? copy('插件工作台', 'Plugin workbench'))
  return [
    { label: store.applicationName, to: '/overview' },
    ...(activeSection.value && activeSection.value !== 'home' ? [{ label: sectionTitle.value, to: sectionPath.value }] : []),
    { label, to: marketplaceOpen.value ? '/marketplace' : undefined },
    ...(route.name === 'plugin-detail' ? [{ label: String(route.params.packageName) }] : []),
  ]
})
const activeIntegrationId = computed(() => typeof route.params.integrationId === 'string' ? route.params.integrationId : '')
const activeIntegrationViewId = computed(() => typeof route.params.viewId === 'string' ? route.params.viewId : '')
const activePluginWorkbenchPluginId = computed(() => typeof route.params.pluginId === 'string' ? route.params.pluginId : '')
const activePluginWorkbenchId = computed(() => typeof route.params.workbenchId === 'string' ? route.params.workbenchId : '')
const navigationRevision = ref(0)
const toolbarTitle = computed(() => route.name === 'workbench' ? sectionTitle.value : pageBreadcrumbs.value.at(-1)?.label ?? sectionTitle.value)
const activePage = ref<{ refresh: () => Promise<void> }>()
const toolbarRefreshing = ref(false)
const toolbarRefreshError = ref('')
const marketplaceImportCatalogUrl = ref('')
const onboardingOpen = ref(false)
const desktopNavigation = ref<Extract<DesktopNavigation, { kind: 'project' }>>()
/** Kept separate from the navigation so the dialog keeps its content while it animates closed. */
const desktopNavigationOpen = ref(false)
const eventStreamConnected = ref(false)
const codexActivityStatus = ref<CodexActivityStatus>()
const runningCodexTaskCount = computed(() => {
  const sessionIds = new Set(codexActivityStatus.value?.runningSessionIds ?? [])
  let localOnlyCount = 0
  for (const task of store.agentTasks.filter(task => task.provider === 'codex' && task.status === 'running')) {
    if (task.externalThreadId)
      sessionIds.add(task.externalThreadId)
    else
      localOnlyCount++
  }
  return sessionIds.size + localOnlyCount
})
let stopProjectEvents: (() => void) | undefined
let stopCodexActivityEvents: (() => void) | undefined
let stopCelebrationEvents: (() => void) | undefined
let stopOnboardingEvents: (() => void) | undefined
let stopHelpEvents: (() => void) | undefined
let stopSettingsEvents: (() => void) | undefined
let stopMenuActionEvents: (() => void) | undefined
let stopMarketplaceImportEvents: (() => void) | undefined
let stopDesktopNavigationEvents: (() => void) | undefined
let visibilityRefreshTimer: ReturnType<typeof setTimeout> | undefined
let workbenchRefresh: Promise<void> | undefined

async function openMarketplace(): Promise<void> {
  if (!marketplaceOpen.value)
    await router.push({ name: 'marketplace' })
}

async function openWorkbench(): Promise<void> {
  if (overviewOpen.value || subscriptionsOpen.value || marketplaceOpen.value || navigationOpen.value || toolsOpen.value || workbenchesOpen.value || softwareOpen.value || environmentOpen.value || diagnosticsOpen.value || integrationOpen.value || pluginWorkbenchOpen.value)
    await router.push({ name: 'workbench' })
}

async function openOverview(): Promise<void> {
  if (!overviewOpen.value)
    await router.push({ name: 'overview' })
}

async function openProject(projectId: string): Promise<void> {
  await openWorkbench()
  await store.selectProject(projectId)
}

async function openWorkspace(workspaceId: string): Promise<void> {
  await openWorkbench()
  store.selectWorkspace(workspaceId)
}

async function openIntegration(integrationId: string, viewId: string, scope?: 'global'): Promise<void> {
  await router.push({ name: 'integration', params: { integrationId, viewId }, ...(scope ? { query: { scope } } : {}) })
}

async function openPluginWorkbench(pluginId: string, workbenchId: string): Promise<void> {
  await router.push({ name: 'plugin-workbench', params: { pluginId, workbenchId } })
}

async function openTools(): Promise<void> {
  if (!toolsOpen.value)
    await router.push({ name: 'tools' })
}

async function openWorkbenches(): Promise<void> {
  if (!workbenchesOpen.value)
    await router.push({ name: 'workbenches' })
}

async function openEnvironment(): Promise<void> {
  if (!environmentOpen.value)
    await router.push({ name: 'environment' })
}

async function openDiagnostics(): Promise<void> {
  if (!diagnosticsOpen.value)
    await router.push({ name: 'diagnostics' })
}

async function openDiagnosticTarget(target: WorkbenchDiagnosticTarget): Promise<void> {
  if (target.type === 'settings') {
    openSettings()
    return
  }
  if (target.type === 'marketplace') {
    if (target.package && target.sourceId) {
      await router.push({ name: 'plugin-detail', params: { sourceId: target.sourceId, packageName: target.package } })
      return
    }
    await openMarketplace()
    return
  }
  if (target.type === 'project' && target.projectId) {
    await openWorkbench()
    if (store.projects.some(project => project.id === target.projectId))
      await store.selectProject(target.projectId)
    return
  }
  if (target.type === 'integration' && target.integrationId) {
    const view = store.integrationViews.find(candidate => candidate.integrationId === target.integrationId)
    if (view)
      await openIntegration(view.integrationId, view.id)
  }
}

async function openMarketplaceSourceImport(catalogUrl: string): Promise<void> {
  marketplaceImportCatalogUrl.value = catalogUrl
  await openMarketplace()
}

function openSettings(tab: 'general' | 'help' = 'general'): void {
  settingsInitialTab.value = tab
  settingsOpen.value = true
}

async function openDesktopNavigation(navigation: DesktopNavigation): Promise<void> {
  onboardingOpen.value = false
  settingsOpen.value = false
  desktopNavigationOpen.value = false
  if (navigation.kind === 'marketplace') {
    await openMarketplace()
    return
  }
  await openWorkbench()
  if (navigation.kind === 'settings') {
    openSettings()
    return
  }
  if (navigation.kind === 'home') {
    return
  }
  if (navigation.kind === 'workspace') {
    if (navigation.ownerScopeId && navigation.ownerScopeId !== store.activeOwnerScopeId)
      await store.switchOwnerScope(navigation.ownerScopeId)
    if (store.allWorkspaces.some(workspace => workspace.id === navigation.workspaceId))
      store.selectWorkspace(navigation.workspaceId)
    return
  }
  if (navigation.matches.length === 1) {
    await store.selectProject(navigation.matches[0]!.id)
    if (navigation.capabilityId)
      store.selectCapability(navigation.capabilityId)
    return
  }
  desktopNavigation.value = navigation
  desktopNavigationOpen.value = true
}

async function openShortcutCapability(shortcutId: string): Promise<void> {
  const target = parseCapabilityShortcutId(shortcutId)
  if (!target || !store.paletteItems.some(item => item.project.id === target.projectId && item.capability.id === target.capabilityId))
    return
  if (target.projectId !== store.selectedProjectId)
    await store.selectProject(target.projectId)
  store.selectedCapabilityId = target.capabilityId
  paletteOpen.value = false
  await openWorkbench()
}

const navigationActions = new Set<DesktopMenuAction>(['back', 'forward', 'home', 'workbench', 'tools', 'environment', 'workbenches', 'marketplace'])
function hasOpenOverlay(ignorePalette = false): boolean {
  const dialogs = ignorePalette ? '[role="dialog"]:not(.command-palette)' : '[role="dialog"]'
  return Boolean(document.querySelector(`${dialogs}, [role="menu"]:not([data-state="closed"]), [data-slot="select-content"], [popover]:popover-open`))
}

async function performWorkbenchAction(action: DesktopMenuAction): Promise<void> {
  if (hasOpenOverlay(action.startsWith('palette-')))
    return
  if (['toggle-sidebar', 'refresh'].includes(action) && compactViewport.value)
    return
  switch (action) {
    case 'back':
      goBack()
      break
    case 'forward':
      goForward()
      break
    case 'home':
      await openOverview()
      break
    case 'workbench':
      await openWorkbench()
      break
    case 'tools':
      await openTools()
      break
    case 'environment':
      await openEnvironment()
      break
    case 'workbenches':
      await openWorkbenches()
      break
    case 'marketplace':
      await openMarketplace()
      break
    case 'toggle-sidebar':
      toggleDesktopSidebar()
      break
    case 'refresh':
      await refreshCurrentView()
      break
    case 'settings':
      openSettings()
      break
    case 'palette-all':
      showPalette('all')
      break
    case 'palette-projects':
      showPalette('projects')
      break
    case 'palette-commands':
      showPalette('commands')
      break
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.repeat)
    return
  if (matchesShortcut(event, 'Mod+Shift+Space', shortcutPlatform)) {
    event.preventDefault()
    quickCaptureOpen.value = true
    return
  }
  const shortcuts = store.settings?.settings['workbench.shortcuts'] ?? { [commandPaletteShortcutId]: defaultCommandPaletteShortcut }
  const paletteShortcut = shortcuts[commandPaletteShortcutId] ?? defaultCommandPaletteShortcut
  if (matchesShortcut(event, paletteShortcut, shortcutPlatform)) {
    if (hasOpenOverlay(true))
      return
    event.preventDefault()
    paletteMode.value = 'all'
    paletteOpen.value = !paletteOpen.value
    return
  }
  const match = Object.entries(shortcuts).find(([id, shortcut]) => id.startsWith(capabilityShortcutPrefix) && matchesShortcut(event, shortcut, shortcutPlatform))
  if (match) {
    if (hasOpenOverlay())
      return
    event.preventDefault()
    void openShortcutCapability(match[0])
    return
  }
  const builtin = desktopWorkbenchShortcuts(shortcutPlatform).find(({ shortcut }) => matchesShortcut(event, shortcut, shortcutPlatform))
  if (!builtin)
    return
  const editing = event.target instanceof Element && Boolean(event.target.closest('input, textarea, [contenteditable="true"], [role="textbox"], .xterm'))
  if (navigationActions.has(builtin.action) && (editing || hasOpenOverlay()))
    return
  if (['toggle-sidebar', 'refresh'].includes(builtin.action) && (compactViewport.value || hasOpenOverlay()))
    return
  event.preventDefault()
  void performWorkbenchAction(builtin.action)
}

async function refreshCodexActivity(): Promise<void> {
  codexActivityStatus.value = await window.craftHubDesktop?.codexActivityStatus?.() ?? codexActivityStatus.value
}

async function refreshWorkbench(): Promise<void> {
  if (workbenchRefresh)
    return workbenchRefresh
  const request = Promise.all([
    store.refreshProjects(),
    store.loadWorkspaces(),
    store.loadAgentTasks(),
    store.loadIntegrations(),
    store.loadPluginWorkbenches(),
    store.loadWorkbenchDiagnostics(),
    refreshCodexActivity(),
  ]).then(() => {})
  workbenchRefresh = request
  try {
    await request
  }
  finally {
    if (workbenchRefresh === request)
      workbenchRefresh = undefined
  }
}

async function refreshCurrentView(): Promise<void> {
  if (toolbarRefreshing.value)
    return
  toolbarRefreshing.value = true
  toolbarRefreshError.value = ''
  try {
    await refreshWorkbench()
    await store.loadSettings()
    if (environmentOpen.value)
      await store.loadLocalEnvironment()
    await activePage.value?.refresh()
    navigationRevision.value++
  }
  catch (error) {
    toolbarRefreshError.value = copy('刷新失败：', 'Refresh failed: ') + (error instanceof Error ? error.message : String(error))
  }
  finally {
    toolbarRefreshing.value = false
  }
}

function refreshWhenVisible(): void {
  if (document.visibilityState !== 'visible')
    return
  if (visibilityRefreshTimer)
    clearTimeout(visibilityRefreshTimer)
  visibilityRefreshTimer = setTimeout(() => {
    visibilityRefreshTimer = undefined
    void refreshWorkbench().catch(() => {})
  }, 100)
}

function retryProjects(): void {
  void store.loadProjects().catch(() => {})
}

async function focusCodexApplication(): Promise<void> {
  await window.craftHubDesktop?.focusCodexApplication?.()
}

onBeforeMount(async () => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('focus', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
  const initialProjectId = typeof route.query.project === 'string' ? route.query.project : undefined
  const pendingMarketplaceImport = await window.craftHubDesktop?.consumeMarketplaceSourceImport?.()
  const pendingDesktopNavigation = await window.craftHubDesktop?.consumeDesktopNavigation?.()
  if (route.name === 'workbench' && route.query.project === undefined && !pendingMarketplaceImport && !pendingDesktopNavigation)
    await router.replace({ name: 'overview', query: route.query, hash: route.hash })
  await store.loadSettings().catch(() => {})
  await store.loadOwnerScopes().catch(() => {})
  await store.loadWorkspaces().catch(() => {})
  const restoredProjectId = await store.loadWorkspaceState(initialProjectId).catch(() => initialProjectId)
  await Promise.allSettled([
    store.loadProjects(restoredProjectId),
    store.loadAgentTasks(),
    store.loadIntegrations(),
    store.loadPluginWorkbenches(),
    store.loadWorkbenchDiagnostics(),
    refreshCodexActivity(),
    store.loadRuns(),
  ])
  await store.loadRunSummaries().catch(() => {})
  stopProjectEvents = subscribeToProjectChanges({
    onChange: event => void store.refreshProject(event).catch(() => {}),
    onRunChange: summary => store.applyRunSummary(summary),
    onSettingsChange: snapshot => void store.applySettings(snapshot)
      .then(() => Promise.all([store.loadPluginWorkbenches(), store.loadWorkbenchDiagnostics()]))
      .catch(() => {}),
    onConfigurationSync: () => { void store.loadOwnerScopes().then(() => store.loadWorkspaces()).catch(() => {}) },
    onUserConfigChange: (status) => {
      store.applyUserConfigStatus(status)
      void Promise.all([store.loadOwnerScopes(), store.loadWorkspaces(), store.loadWorkbenchDiagnostics()]).catch(() => {})
    },
    onAgentTaskChange: task => store.applyAgentTask(task),
    onPluginChange: () => {
      navigationRevision.value++
      void Promise.all([store.refreshProjects(), store.loadIntegrations(), store.loadPluginWorkbenches(), store.loadWorkbenchDiagnostics()]).catch(() => {})
    },
    onError: () => { eventStreamConnected.value = false },
    onOpen: () => {
      eventStreamConnected.value = true
      void store.loadSettings().catch(() => {})
    },
  })
  stopCodexActivityEvents = window.craftHubDesktop?.onCodexActivityStatus?.(status => codexActivityStatus.value = status)
  stopCelebrationEvents = window.craftHubDesktop?.onCelebrationRequested?.(() => celebration.fire())
  stopOnboardingEvents = window.craftHubDesktop?.onReplayOnboarding?.(() => {
    void openWorkbench()
    onboardingOpen.value = true
  })
  stopHelpEvents = window.craftHubDesktop?.onOpenHelp?.(() => openSettings('help'))
  stopSettingsEvents = window.craftHubDesktop?.onOpenSettings?.(() => {
    if (!hasOpenOverlay() || settingsOpen.value)
      openSettings()
  })
  stopQuickCapture = window.craftHubDesktop?.onQuickCapture?.(() => { quickCaptureOpen.value = true })
  if (await window.craftHubDesktop?.consumeQuickCapture?.()) quickCaptureOpen.value = true
  stopMenuActionEvents = window.craftHubDesktop?.onMenuAction?.(action => { void performWorkbenchAction(action) })
  let marketplaceImportHandled = false
  let desktopNavigationHandled = false
  stopMarketplaceImportEvents = window.craftHubDesktop?.onMarketplaceSourceImport?.((catalogUrl) => {
    marketplaceImportHandled = true
    void openMarketplaceSourceImport(catalogUrl)
  })
  stopDesktopNavigationEvents = window.craftHubDesktop?.onDesktopNavigation?.((navigation) => {
    desktopNavigationHandled = true
    void openDesktopNavigation(navigation)
  })
  const latestMarketplaceImport = await window.craftHubDesktop?.consumeMarketplaceSourceImport?.()
  const marketplaceImport = latestMarketplaceImport ?? (marketplaceImportHandled ? undefined : pendingMarketplaceImport)
  if (marketplaceImport)
    await openMarketplaceSourceImport(marketplaceImport)
  if (await window.craftHubDesktop?.consumeCelebration?.())
    celebration.fire()
  const latestDesktopNavigation = await window.craftHubDesktop?.consumeDesktopNavigation?.()
  const navigation = latestDesktopNavigation ?? (desktopNavigationHandled ? undefined : pendingDesktopNavigation)
  if (navigation)
    await openDesktopNavigation(navigation)
})
onBeforeUnmount(() => {
  if (visibilityRefreshTimer)
    clearTimeout(visibilityRefreshTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
  stopProjectEvents?.()
  stopCodexActivityEvents?.()
  stopCelebrationEvents?.()
  stopOnboardingEvents?.()
  stopHelpEvents?.()
  stopSettingsEvents?.()
  stopQuickCapture?.()
  stopMenuActionEvents?.()
  stopMarketplaceImportEvents?.()
  stopDesktopNavigationEvents?.()
  stopHistoryTracking()
  celebration.reset()
})
</script>

<template>
  <QuickCaptureDialog v-if="quickCaptureMounted" v-model:open="quickCaptureOpen" @saved="refreshCurrentView" />
  <div class="app-shell" :style="{ '--workbench-activity-width': `${activityRailWidth}px` }" :class="{ 'mobile-navigation-open': mobileNavigationOpen, 'has-app-notices': toolbarRefreshError || store.runtimeSchemaMismatch || (store.projectsLoadState === 'error' && store.projects.length) }">
    <WorkbenchToolbar
      :title="toolbarTitle"
      :project-name="store.selectedProject?.name ?? store.applicationName"
      :sidebar-collapsed="desktopSidebarCollapsed"
      :can-go-back="canGoBack"
      :can-go-forward="canGoForward"
      :refreshing="toolbarRefreshing"
      :palette-shortcut-label="paletteShortcutLabel"
      :palette-open="paletteOpen"
      :palette-mode="paletteMode"
      :desktop-mac="desktopMac"
      :mobile-navigation-open="mobileNavigationOpen"
      @toggle-sidebar="toggleDesktopSidebar"
      @toggle-mobile-navigation="mobileNavigationOpen = !mobileNavigationOpen"
      @back="goBack"
      @forward="goForward"
      @refresh="refreshCurrentView"
      @open-palette="showPalette"
    />
    <section v-if="toolbarRefreshError || store.runtimeSchemaMismatch || (store.projectsLoadState === 'error' && store.projects.length)" class="app-notices">
      <div v-if="toolbarRefreshError" class="project-refresh-warning" role="alert">
        <Icon name="error" /><span>{{ toolbarRefreshError }}</span><button type="button" @click="refreshCurrentView">{{ t('retry') }}</button>
      </div>
      <div v-if="store.runtimeSchemaMismatch" class="runtime-schema-warning" data-testid="runtime-schema-mismatch" role="alert">
        <Icon name="error" />
        <span><strong>{{ t('runtimeOutdated') }}</strong> {{ t('runtimeOutdatedDescription') }}</span>
        <button type="button" @click="retryProjects">{{ t('retry') }}</button>
      </div>
      <div v-if="store.projectsLoadState === 'error' && store.projects.length" class="project-refresh-warning" data-testid="project-refresh-error" role="alert">
        <Icon name="error" />
        <span><strong>{{ t('projectRefreshFailed') }}</strong> {{ store.projectsLoadError }}</span>
        <button type="button" @click="retryProjects">{{ t('retry') }}</button>
      </div>
    </section>
    <section v-if="overviewOpen || subscriptionsOpen || navigationOpen || toolsOpen || workbenchesOpen || marketplaceOpen || integrationOpen || pluginWorkbenchOpen || softwareOpen || environmentOpen || diagnosticsOpen" class="navigation-view-shell">
      <ProjectRail
        :collapsed="desktopSidebarCollapsed"
        :active-view="overviewOpen ? 'overview' : subscriptionsOpen ? 'subscriptions' : pluginWorkbenchOpen ? 'plugin-workbench' : integrationOpen ? 'integration' : navigationOpen ? 'navigation' : toolsOpen ? 'tools' : workbenchesOpen ? 'workbenches' : softwareOpen ? 'software' : environmentOpen ? 'environment' : diagnosticsOpen ? 'diagnostics' : 'marketplace'"
        :active-integration-id="activeIntegrationId"
        :active-integration-view-id="activeIntegrationViewId"
        :active-plugin-workbench-id="activePluginWorkbenchId"
        :active-plugin-workbench-plugin-id="activePluginWorkbenchPluginId"
        @open-diagnostics="openDiagnostics"
        @open-environment="openEnvironment"
        @open-tools="openTools"
        @open-workbenches="openWorkbenches"
        @open-plugin-workbench="openPluginWorkbench"
        @open-integration="openIntegration"
        @open-marketplace="openMarketplace"
        @open-overview="openOverview"
        @open-settings="openSettings()"
        @open-workbench="openWorkbench"
      />
      <ConfigurationSubscriptions v-if="subscriptionsOpen" ref="activePage">
        <template #sidebar><WorkbenchSectionNavigation :title="sectionTitle" :icon="sectionIcon" :groups="sectionGroups" /></template>
      </ConfigurationSubscriptions>
      <PluginWorkbench v-else-if="pluginWorkbenchOpen" ref="activePage" :breadcrumbs="pageBreadcrumbs" :plugin-id="activePluginWorkbenchPluginId" :workbench-id="activePluginWorkbenchId" :refresh-key="navigationRevision" @manage-plugins="openMarketplace" @open-project="openProject" @open-integration="openIntegration" />
      <WorkbenchPageShell v-else :breadcrumbs="pageBreadcrumbs">
        <template v-if="sectionGroups.length" #sidebar><WorkbenchSectionNavigation :title="sectionTitle" :icon="sectionIcon" :groups="sectionGroups" /></template>
        <PersonalWorkbench
          @capture="quickCaptureOpen = true"
          :refresh-key="navigationRevision"
          v-if="overviewOpen"
          @open-project="openProject"
          @open-workspace="openWorkspace"
          @open-navigation="openTools"
          @open-integration="openIntegration"
          @open-plugin-workbench="openPluginWorkbench"
          @open-settings="openSettings()"
          @open-diagnostics="openDiagnostics"
          @open-marketplace="openMarketplace"
        />
        <ToolsWorkbench v-else-if="toolsOpen" />
        <WorkbenchesOverview v-else-if="workbenchesOpen" />
        <SoftwareCenter v-else-if="softwareOpen" ref="activePage" />
        <SetupProfileWorkbench v-else-if="setupProfileOpen" />
        <EnvironmentWorkbench v-else-if="environmentOpen" />
        <DiagnosticsWorkbench v-else-if="diagnosticsOpen" @open-target="openDiagnosticTarget" />
        <IntegrationWorkbench v-else-if="integrationOpen" ref="activePage" :integration-id="activeIntegrationId" :view-id="activeIntegrationViewId" :initial-scope="route.query.scope === 'global' ? 'global' : undefined" />
        <NavigationWorkbench v-else-if="navigationOpen" :refresh-key="navigationRevision" @manage-plugins="openMarketplace" />
        <MarketplaceDialog v-else ref="activePage" open :import-catalog-url="marketplaceImportCatalogUrl" />
      </WorkbenchPageShell>
    </section>
    <WorkbenchSplitter
      v-else
      id="craft-hub-workbench"
      class="workbench-splitter"
      :class="{ 'empty-projects': !store.projects.length }"
      :compact="compactViewport"
      includes-activity-rail
      :activity-rail-width="activityRailWidth"
      sidebar-id="projects-panel"
      handle-id="projects-resize-handle"
      :sidebar-label="t('resizeProjects')"
      auto-save-id="craft-hub-workbench-layout-v2"
    >
      <template #sidebar>
        <ProjectRail
          :collapsed="desktopSidebarCollapsed"
          :active-view="marketplaceOpen ? 'marketplace' : 'workbench'"
          @open-diagnostics="openDiagnostics"
          @open-environment="openEnvironment"
          @open-tools="openTools"
          @open-workbenches="openWorkbenches"
          @open-plugin-workbench="openPluginWorkbench"
          @open-integration="openIntegration"
          @open-marketplace="openMarketplace"
          @open-overview="openOverview"
          @open-settings="openSettings()"
          @open-workbench="openWorkbench"
        />
      </template>
      <component :is="compactViewport ? 'div' : SplitterPanel" data-panel v-if="store.projects.length" id="capabilities-panel" :order="2" size-unit="px" :default-size="320" :min-size="230" :max-size="540" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <WorkspaceProjectList v-if="store.selectedWorkspace" />
        <CapabilityList v-else />
      </component>
      <WorkbenchResizeHandle v-if="!compactViewport && store.projects.length" id="capabilities-resize-handle" :label="t('resizeCapabilities')" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen" />
      <component :is="compactViewport ? 'div' : SplitterPanel" data-panel id="detail-panel" :order="3" size-unit="px" :min-size="260" :aria-hidden="marketplaceOpen" :inert="marketplaceOpen">
        <section class="detail-workspace">
          <ProjectToolbar v-if="store.selectedProject && !store.selectedWorkspace" />
          <section v-if="store.projectsLoadState === 'error' && !store.projects.length" class="project-load-state error" data-testid="project-load-error" role="alert">
            <Icon name="error" />
            <h1>{{ t('projectLoadFailed') }}</h1>
            <p>{{ store.projectsLoadError }}</p>
            <button type="button" @click="retryProjects">{{ t('retry') }}</button>
          </section>
          <section v-else-if="store.projectsLoadState !== 'ready' && store.projectsLoadState !== 'error' && !store.selectedProject && !store.selectedWorkspace" class="project-load-state" aria-live="polite">
            <Icon name="loading" />
            <p>{{ t('loading') }}</p>
          </section>
          <WelcomePanel
            v-else-if="onboardingOpen || !store.projects.length"
            :replaying="Boolean(store.projects.length)"
            @close="onboardingOpen = false"
          />
          <DetailPanel v-else-if="store.workspaceCapability" />
          <WorkspaceDashboard v-else-if="store.selectedWorkspace" />
          <DetailPanel v-else />
        </section>
      </component>
    </WorkbenchSplitter>
    <footer class="status-bar">
      <span :aria-busy="store.refreshing">
        <Icon v-if="store.refreshing" name="loading" class="refresh-loading-icon" />
        <i v-else :class="{ updated: store.recentlyUpdated }" />
        {{ store.refreshing ? t('refreshing') : store.recentlyUpdated ? t('filesUpdated') : eventStreamConnected ? t('ready') : t('reconnecting') }}
      </span>
      <div class="status-actions">
        <button
          v-if="runningCodexTaskCount"
          type="button"
          class="codex-task-status tooltip-action"
          :aria-label="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          :data-tooltip="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          :title="t('codexTasksRunningOpen', { count: String(runningCodexTaskCount) })"
          @click="focusCodexApplication"
        >
          <Icon name="codex" />
          <strong>{{ runningCodexTaskCount }}</strong>
        </button>
        <button class="tooltip-action" :aria-label="t('refresh')" :aria-busy="store.refreshing" :data-tooltip="t('refresh')" :disabled="store.refreshing" :title="t('refresh')" @click="refreshWorkbench">
          <Icon :name="store.refreshing ? 'loading' : 'refresh'" :class="{ 'refresh-loading-icon': store.refreshing }" />
        </button>
        <span v-if="store.selectedProject">{{ t('project', { name: store.selectedProject.name }) }}</span>
      </div>
    </footer>
    <CommandPalette v-if="paletteMounted" v-model:open="paletteOpen" :mode="paletteMode" @open-workbench="openWorkbench" @open-integration="openIntegration" @open-plugin-workbench="openPluginWorkbench" @open-settings="openSettings()" @refresh="refreshWorkbench" />
    <SettingsDialog v-if="settingsMounted" v-model:open="settingsOpen" :initial-tab="settingsInitialTab" />
    <ProjectAgentActionDialog v-if="agentActionMounted" v-model:open="store.agentActionDialogOpen" />
    <DesktopNavigationDialog
      v-if="desktopNavigation"
      v-model:open="desktopNavigationOpen"
      :matches="desktopNavigation.matches"
      :reference="desktopNavigation.reference"
      :capability-id="desktopNavigation.capabilityId"
      @resolved="desktopNavigationOpen = false"
    />
    <DialogRoot :open="store.packageCapabilityDrawerOpen" @update:open="$event || store.closePackageCapabilityDrawer()">
      <DialogPortal>
        <DialogOverlay class="package-drawer-overlay" />
        <DialogContent class="package-drawer-content">
          <DialogTitle class="sr-only">{{ store.activeCapability?.name ?? t('package') }}</DialogTitle>
          <DialogDescription class="sr-only">{{ store.selectedPackage?.name ?? store.activeProject?.name }}</DialogDescription>
          <DialogClose as-child>
            <UiButton class="package-drawer-close" size="icon" variant="ghost" :aria-label="t('close')" :title="t('close')">
              <Icon name="close" />
            </UiButton>
          </DialogClose>
          <DetailPanel package-drawer-content />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
