<script setup lang="ts">
import type { PersonalWorkbenchTool, SoftwareCatalogItem, SoftwareCatalogSnapshot, SoftwareInstallationPlan, SoftwareInstallationRun } from 'craft-hub'
import { personalWorkbenchHomeSchema } from 'craft-hub/personal-workbench'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { useI18n } from './i18n'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'
import SoftwareIcon from './SoftwareIcon.vue'
import SoftwareInstallStatus from './SoftwareInstallStatus.vue'
import SoftwareLinks from './SoftwareLinks.vue'
import SoftwareSources from './SoftwareSources.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const store = useWorkbenchStore()
const { locale } = useI18n()
const zh = computed(() => locale.value === 'zh-CN')
const copy = (chinese: string, english: string) => zh.value ? chinese : english
const text = (value: { en: string, zh?: string }) => zh.value ? value.zh || value.en : value.en
const snapshot = ref<SoftwareCatalogSnapshot>()
const loading = ref(false)
const loadError = ref(false)
const query = ref('')
const selectedGroup = ref('')
const saving = ref(false)
const saveError = ref('')
const saveNotice = ref('')
let generation = 0
let mounted = true
let detectionNeedsRefresh = false
let runMutationGeneration = 0
let uncertainGeneration = 0
const runMutations = new Map<string, number>()
let pollingTimer: ReturnType<typeof setTimeout> | undefined
const selectedKeys = ref<string[]>([])
const installationPlan = ref<SoftwareInstallationPlan>()
const planOpen = ref(false)
const planning = ref(false)
const installing = ref(false)
const installationUncertain = ref(false)
const operationError = ref('')
const operationNotice = ref('')
const runs = ref<SoftwareInstallationRun[]>([])
const runsLoading = ref(false)
const runsError = ref(false)
const busyRunIds = ref<string[]>([])
const openingKeys = ref<string[]>([])
const activeStates = new Set(['queued', 'running', 'cancelling'])
const activeRuns = computed(() => runs.value.filter(run => activeStates.has(run.state)))
const displayedRuns = computed(() => [...runs.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt)))

function supports(sourceId: string, operation: string): boolean {
  const source = snapshot.value?.sources.find(source => source.id === sourceId)
  if (!source?.canManage) return false
  const support = source.operationSupport
  return !support || (support.state === 'available' && support.operations[operation]?.supported === true)
}

function supportReason(sourceId: string, operation: string): string | undefined {
  if (supports(sourceId, operation)) return undefined
  const support = snapshot.value?.sources.find(source => source.id === sourceId)?.operationSupport
  const reason = support?.operations[operation]?.reason
  if (reason === 'unsupported-platform') return copy('当前平台尚不支持此操作。', 'This operation is unavailable on this platform.')
  if (reason === 'unsupported-version' || support?.state === 'unsupported') return copy('请更新本机 CLI 以启用此操作。', 'Update the local CLI to enable this operation.')
  if (reason === 'unavailable' || support?.state === 'unavailable') return copy('本机 CLI 不可用，请检查连接后刷新。', 'The local CLI is unavailable. Check its connection and refresh.')
  return reason ?? copy('当前来源尚不支持此操作。', 'The provider does not support this operation.')
}
const canRefreshRuns = computed(() => snapshot.value?.sources.some(source => supports(source.id, 'runs')) ?? false)
const planSupportReason = computed(() => installationPlan.value ? supportReason(installationPlan.value.sourceId, 'install') : undefined)

const entries = computed(() => (snapshot.value?.sources ?? []).filter(source => !source.error).flatMap(source => source.items.map(item => ({
  key: JSON.stringify([source.id, item.id]),
  sourceId: source.id,
  sourceTitle: source.title,
  canManage: source.canManage === true,
  groupKey: JSON.stringify([source.id, item.group.id]),
  item: { ...item, canInstall: item.canInstall && supports(source.id, 'preview') && supports(source.id, 'install'), canOpen: item.canOpen && supports(source.id, 'open') },
}))))
const selectedEntries = computed(() => entries.value.filter(entry => selectedKeys.value.includes(entry.key)
  && entry.canManage && entry.item.canInstall && entry.item.status === 'not-detected'))
const selectionsBySource = computed(() => {
  const selections = new Map<string, { title: string, ids: string[] }>()
  for (const entry of selectedEntries.value) {
    const selection = selections.get(entry.sourceId) ?? { title: entry.sourceTitle, ids: [] }
    selection.ids.push(entry.item.id)
    selections.set(entry.sourceId, selection)
  }
  return [...selections].map(([sourceId, selection]) => ({ sourceId, ...selection }))
})
const planInstallCount = computed(() => installationPlan.value?.items.filter(item => item.action === 'install').length ?? 0)
const groups = computed(() => {
  const options = new Map<string, string>()
  for (const entry of entries.value) {
    const label = text(entry.item.group.title)
    options.set(entry.groupKey, snapshot.value!.sources.length > 1 ? `${label} · ${entry.sourceTitle}` : label)
  }
  return [...options].map(([value, label]) => ({ value, label }))
})
const visibleEntries = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return entries.value.filter(({ item, groupKey, sourceTitle }) => (!selectedGroup.value || selectedGroup.value === groupKey)
    && (!keyword || [item.title.en, item.title.zh, item.group.title.en, item.group.title.zh, item.url, item.downloadUrl, item.repositoryUrl, item.description, sourceTitle]
      .some(value => value?.toLocaleLowerCase().includes(keyword))))
})

function websiteIdentity(value: string): string {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.hash = ''
    return url.href
  }
  catch { return value }
}
const favoriteTools = computed(() => store.settings?.settings['workbench.home']?.tools ?? [])
function isFavorite(item: SoftwareCatalogItem): boolean {
  return favoriteTools.value.some(tool => websiteIdentity(tool.url) === websiteIdentity(item.url)
    && (!tool.id.startsWith('software:') || websiteIdentity(tool.downloadUrl || tool.url) === websiteIdentity(item.downloadUrl || item.url)))
}

async function loadCatalog(): Promise<void> {
  if (loading.value)
    return
  const current = ++generation
  loading.value = true
  loadError.value = false
  try {
    const result = await api.softwareCatalog()
    if (current !== generation)
      return
    snapshot.value = result
    if (!groups.value.some(group => group.value === selectedGroup.value))
      selectedGroup.value = ''
    selectedKeys.value = selectedEntries.value.map(entry => entry.key)
    await loadRuns(result.sources.filter(source => supports(source.id, 'runs')).map(source => source.id))
  }
  catch {
    if (current === generation)
      loadError.value = true
  }
  finally {
    if (current === generation) {
      loading.value = false
      if (detectionNeedsRefresh) {
        detectionNeedsRefresh = false
        void loadCatalog()
      }
    }
  }
}
onMounted(() => { void loadCatalog() })
onUnmounted(() => {
  mounted = false
  generation++
  clearTimeout(pollingTimer)
})

function upsertRun(run: SoftwareInstallationRun): void {
  runMutations.set(JSON.stringify([run.sourceId, run.id]), ++runMutationGeneration)
  runs.value = [...runs.value.filter(previous => previous.id !== run.id || previous.sourceId !== run.sourceId), run]
}

function schedulePolling(): void {
  clearTimeout(pollingTimer)
  if (!mounted || !activeRuns.value.some(run => supports(run.sourceId, 'runs')))
    return
  pollingTimer = setTimeout(() => {
    if (mounted)
      void loadRuns([...new Set(activeRuns.value.map(run => run.sourceId))])
  }, 1500)
}

async function loadRuns(sourceIds?: string[]): Promise<void> {
  if (!mounted || runsLoading.value)
    return
  const ids = (sourceIds ?? [...new Set([
    ...(snapshot.value?.sources.filter(source => source.canManage).map(source => source.id) ?? []),
    ...runs.value.map(run => run.sourceId),
  ])]).filter(sourceId => supports(sourceId, 'runs'))
  if (!ids.length)
    return
  runsLoading.value = true
  const readGeneration = runMutationGeneration
  let detectionChanged = false
  try {
    const results = await Promise.allSettled(ids.map(sourceId => api.softwareInstallationRuns(sourceId)))
    if (!mounted)
      return
    runsError.value = results.some(result => result.status === 'rejected')
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') {
        const sourceId = ids[index]!
        // Keep mutation acknowledgements received after this history request began.
        const protectedRuns = runs.value.filter(run => run.sourceId === sourceId && (runMutations.get(JSON.stringify([sourceId, run.id])) ?? 0) > readGeneration)
        const nextRuns = result.value.runs.filter(run => !protectedRuns.some(protectedRun => protectedRun.id === run.id))
        detectionChanged ||= nextRuns.some(next => !activeStates.has(next.state) && runs.value.some(previous => previous.id === next.id && previous.sourceId === sourceId && activeStates.has(previous.state)))
        runs.value = [...runs.value.filter(run => run.sourceId !== sourceId), ...nextRuns, ...protectedRuns]
        for (const key of runMutations.keys()) {
          if (!runs.value.some(run => key === JSON.stringify([run.sourceId, run.id])))
            runMutations.delete(key)
        }
        if (installationUncertain.value && readGeneration >= uncertainGeneration && installationPlan.value?.sourceId === sourceId) {
          const found = result.value.runs.some(run => run.planId === installationPlan.value?.id)
          installationUncertain.value = false
          planOpen.value = false
          installationPlan.value = undefined
          operationError.value = found ? '' : copy('没有找到这次安装的记录。请重新审阅计划后重试。', 'No record of this installation was found. Review a fresh plan before retrying.')
        }
      }
    }
  }
  finally {
    if (mounted) {
      runsLoading.value = false
      schedulePolling()
      detectionNeedsRefresh ||= detectionChanged
      if (detectionNeedsRefresh && !loading.value) {
        detectionNeedsRefresh = false
        void loadCatalog()
      }
    }
  }
}

function sourceBusy(sourceId: string): boolean {
  return activeRuns.value.some(run => run.sourceId === sourceId)
}

const activeItems = computed(() => new Map(activeRuns.value.flatMap(run => run.items.filter(item => ['queued', 'running'].includes(item.state)).map(item => [JSON.stringify([run.sourceId, item.softwareId]), { item, run }]))))

function stopLabel(run: SoftwareInstallationRun): string {
  const remaining = run.items.filter(item => ['queued', 'running'].includes(item.state))
  if (remaining.length > 1)
    return copy('停止整个安装任务（含剩余项目）', 'Stop the entire installation task, including remaining items')
  return copy(`停止安装 ${text(remaining[0]?.title ?? { en: '' })}`, `Stop installing ${text(remaining[0]?.title ?? { en: '' })}`)
}

async function reviewInstallation(sourceId: string, softwareIds: string[]): Promise<void> {
  if (planning.value || installing.value || sourceBusy(sourceId))
    return
  if (!supports(sourceId, 'preview') || !supports(sourceId, 'install')) {
    operationError.value = supportReason(sourceId, 'preview') ?? supportReason(sourceId, 'install') ?? ''
    return
  }
  planning.value = true
  if (installationUncertain.value && installationPlan.value) {
    await loadRuns([installationPlan.value.sourceId])
    if (!mounted || installationUncertain.value || sourceBusy(sourceId)) {
      planning.value = false
      return
    }
  }
  if (!supports(sourceId, 'preview') || !supports(sourceId, 'install')) {
    planning.value = false
    operationError.value = supportReason(sourceId, 'preview') ?? supportReason(sourceId, 'install') ?? ''
    return
  }
  operationError.value = ''
  operationNotice.value = ''
  installationPlan.value = undefined
  try {
    const result = await api.softwareInstallationPlan(sourceId, softwareIds)
    if (mounted) {
      installationPlan.value = result
      planOpen.value = true
    }
  }
  catch {
    if (mounted)
      operationError.value = copy('无法生成安装计划。请刷新目录后重试。', 'Could not prepare the installation plan. Refresh the catalog and retry.')
  }
  finally {
    if (mounted)
      planning.value = false
  }
}

async function confirmInstallation(): Promise<void> {
  const plan = installationPlan.value
  if (!plan || installing.value || installationUncertain.value || !planInstallCount.value || plan.prerequisites.length || sourceBusy(plan.sourceId))
    return
  if (!supports(plan.sourceId, 'install')) {
    operationError.value = supportReason(plan.sourceId, 'install') ?? ''
    return
  }
  installing.value = true
  operationError.value = ''
  try {
    const run = await api.installSoftware(plan.sourceId, plan.id, true)
    if (!mounted)
      return
    upsertRun(run)
    selectedKeys.value = selectedKeys.value.filter(key => !plan.items.some(item => key === JSON.stringify([plan.sourceId, item.softwareId])))
    planOpen.value = false
    installationPlan.value = undefined
    schedulePolling()
    if (!activeStates.has(run.state))
      void loadCatalog()
  }
  catch {
    if (mounted) {
      installationUncertain.value = true
      uncertainGeneration = ++runMutationGeneration
      operationError.value = copy('未能确认安装任务状态。请先刷新安装记录，再决定是否重试。', 'Could not confirm the installation state. Refresh installation history before retrying.')
    }
  }
  finally {
    if (mounted)
      installing.value = false
  }
}

async function cancelInstallation(run: SoftwareInstallationRun): Promise<void> {
  if (busyRunIds.value.includes(run.id))
    return
  if (!supports(run.sourceId, 'cancel')) {
    operationError.value = supportReason(run.sourceId, 'cancel') ?? ''
    return
  }
  busyRunIds.value.push(run.id)
  operationError.value = ''
  try {
    const result = await api.cancelSoftwareInstallation(run.sourceId, run.id)
    if (mounted) {
      upsertRun(result)
      schedulePolling()
    }
  }
  catch {
    if (mounted)
      operationError.value = copy('未能确认停止状态。安装可能仍在进行，请刷新安装记录。', 'Could not confirm that installation stopped. It may still be running; refresh installation history.')
  }
  finally {
    if (mounted)
      busyRunIds.value = busyRunIds.value.filter(id => id !== run.id)
  }
}

function retryableItems(run: SoftwareInstallationRun): string[] {
  return run.items.filter(item => ['failed', 'interrupted', 'cancelled'].includes(item.state)).map(item => item.softwareId)
}

async function openApplication(sourceId: string, item: SoftwareCatalogItem): Promise<void> {
  const key = JSON.stringify([sourceId, item.id])
  if (openingKeys.value.includes(key))
    return
  const current = entries.value.find(entry => entry.sourceId === sourceId && entry.item.id === item.id)
  if (!supports(sourceId, 'open') || !current?.item.canOpen || current.item.status !== 'detected') {
    operationError.value = supportReason(sourceId, 'open') ?? copy('请刷新本机检测。', 'Refresh local detection.')
    return
  }
  openingKeys.value.push(key)
  operationError.value = ''
  operationNotice.value = ''
  try {
    await api.openSoftwareApplication(sourceId, item.id)
    if (mounted)
      operationNotice.value = copy(`已请求打开 ${text(item.title)}。`, `Requested opening ${text(item.title)}.`)
  }
  catch {
    if (mounted)
      operationError.value = copy('无法打开应用。请刷新本机检测，或使用官网下载入口。', 'Could not open the application. Refresh local detection, or use the official download link.')
  }
  finally {
    if (mounted)
      openingKeys.value = openingKeys.value.filter(value => value !== key)
  }
}

function runStateLabel(state: SoftwareInstallationRun['state'] | SoftwareInstallationRun['items'][number]['state']): string {
  const labels: Record<string, [string, string]> = {
    queued: ['等待安装', 'Queued'],
    running: ['正在安装', 'Installing'],
    cancelling: ['正在停止', 'Stopping'],
    completed: ['安装完成', 'Completed'],
    installed: ['已安装', 'Installed'],
    failed: ['安装失败', 'Failed'],
    cancelled: ['已停止', 'Stopped'],
    interrupted: ['安装中断', 'Interrupted'],
    waiting: ['需要手动操作', 'Manual action required'],
    skipped: ['已跳过', 'Skipped'],
    manual: ['手动安装', 'Manual installation'],
  }
  const label = labels[state]!
  return copy(...label)
}

function stateVariant(state: string): 'success' | 'warning' | 'danger' | 'secondary' {
  if (['completed', 'installed'].includes(state))
    return 'success'
  if (state === 'failed')
    return 'danger'
  if (['running', 'cancelling', 'interrupted', 'waiting', 'manual'].includes(state))
    return 'warning'
  return 'secondary'
}

function settledCount(run: SoftwareInstallationRun): number {
  return run.items.filter(item => !['queued', 'running'].includes(item.state)).length
}

function planActionLabel(action: SoftwareInstallationPlan['items'][number]['action']): string {
  return action === 'install' ? copy('安装', 'Install') : action === 'skip' ? copy('跳过', 'Skip') : copy('手动操作', 'Manual action')
}

function statusLabel(status: SoftwareCatalogItem['status']): string {
  if (status === 'detected')
    return copy('已检测到', 'Detected')
  if (status === 'not-detected')
    return copy('未检测到', 'Not detected')
  return copy('未检测', 'Not checked')
}

async function reloadSettings(): Promise<void> {
  if (saving.value)
    return
  saving.value = true
  saveNotice.value = ''
  try {
    await store.loadSettings()
    saveError.value = ''
    saveNotice.value = copy('设置已重新载入，请再次添加常用工具。', 'Settings reloaded. Add the favorite again.')
  }
  catch { saveError.value = copy('无法重新载入工具设置，请重试。', 'Could not reload tool settings. Please retry.') }
  finally { saving.value = false }
}

async function addFavorite(item: SoftwareCatalogItem): Promise<void> {
  if (saving.value || isFavorite(item))
    return
  saving.value = true
  saveError.value = ''
  saveNotice.value = ''
  try {
    if (!store.settings)
      await store.loadSettings()
    const settings = store.settings
    if (!settings)
      throw new Error('Settings unavailable')
    const home = settings.settings['workbench.home'] ?? { tools: [] }
    if (isFavorite(item))
      return
    if (home.tools.length >= 100) {
      saveError.value = copy('常用工具已达到 100 项，请先在个人工作台移除一些工具。', 'Favorites already contain 100 tools. Remove a tool from your personal workbench first.')
      return
    }
    const tool: PersonalWorkbenchTool = {
      id: `software:${crypto.randomUUID()}`,
      title: text(item.title).slice(0, 128),
      group: text(item.group.title).slice(0, 64),
      url: item.url,
      ...(item.downloadUrl ? { downloadUrl: item.downloadUrl } : {}),
      ...(item.repositoryUrl ? { repositoryUrl: item.repositoryUrl } : {}),
      ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
      ...(item.macosIconUrl ? { macosIconUrl: item.macosIconUrl } : {}),
      ...(item.iconStyle ? { iconStyle: item.iconStyle } : {}),
      ...(item.iconScale !== undefined ? { iconScale: item.iconScale } : {}),
      ...(item.description ? { description: item.description.slice(0, 512) } : {}),
    }
    const next = personalWorkbenchHomeSchema.parse({ ...home, tools: [...home.tools, tool] })
    await store.applySettings(await api.updateSettings({ 'workbench.home': next }, settings.revision))
    saveNotice.value = copy(`已将 ${tool.title} 添加到个人工作台。`, `Added ${tool.title} to your personal workbench.`)
  }
  catch {
    saveError.value = copy('常用工具未保存。请重试；若设置已在别处修改，请先重新载入设置。', 'The favorite was not saved. Retry, or reload settings if they changed elsewhere.')
  }
  finally { saving.value = false }
}
defineExpose({ refresh: loadCatalog })
</script>

<template>
  <WorkbenchViewFrame class="software-center" :title="copy('软件中心', 'Software center')" :description="copy('浏览和收藏软件，连接本机插件后可检测、安装和打开应用。', 'Browse and favorite software. Connect a local plugin to detect, install and open applications.')" icon="builtin:package">
    <template #actions>
      <UiButton size="compact" :disabled="loading" data-testid="refresh-software" @click="loadCatalog"><Icon :name="loading ? 'loading' : 'refresh'" />{{ copy('刷新', 'Refresh') }}</UiButton>
    </template>
    <p v-for="source in snapshot?.sources.filter(source => source.operationSupport)" :key="`support-${source.id}`" class="software-note" data-testid="software-operation-support">{{ source.title }} · {{ source.operationSupport?.platform }}<template v-if="source.operationSupport?.cliVersion"> · CLI {{ source.operationSupport.cliVersion }}</template><template v-if="supportReason(source.id, 'install')"> · {{ supportReason(source.id, 'install') }}</template></p>
    <p v-if="snapshot?.sources.some(source => source.bundled)" class="software-note" data-testid="software-bundled-note">{{ copy('正在浏览内置目录，尚未检测本机安装状态。官网、下载和收藏可用；本机检测与自动安装需要本地软件管理插件。', 'Browsing the bundled catalog without local installation checks. Website, download and favorites are available; local detection and automatic installation require a local software management plugin.') }}</p>
    <p v-if="snapshot?.sources.some(source => source.repositorySourceId && !source.canManage)" class="software-note" data-testid="software-repository-note">{{ copy('正在浏览仓库目录缓存，本机安装状态尚未检测。连接本机软件管理插件后可检测、安装和打开应用。', 'Browsing a cached repository catalog without local installation checks. Connect a local software management plugin to detect, install and open applications.') }}</p>
    <p v-if="snapshot?.sources.some(source => !source.bundled && !source.error && (!source.repositorySourceId || source.canManage))" class="software-note">{{ copy('安装前先审阅来源提供的计划；仅安装选中的缺失软件。本机检测查找常见应用目录和可执行路径；未检测到不代表未安装。', 'Review the source installation plan first; only selected missing software is installed. Local detection checks common application directories and executable paths; an undetected app may be installed elsewhere.') }}</p>
    <Alert v-if="operationError && !planOpen" variant="danger" class="software-alert" data-testid="software-operation-error" role="alert">{{ operationError }}</Alert>
    <p v-if="operationNotice" class="software-note" role="status">{{ operationNotice }}</p>
    <Alert v-if="loadError" variant="danger" class="software-alert" data-testid="software-load-error">
      <strong>{{ copy('无法读取软件目录。', 'Could not load the software catalog.') }}</strong>
      <p v-if="snapshot">{{ copy('下面保留上次读取的目录，检测结果可能已过期。', 'The previous catalog remains below; detection results may be out of date.') }}</p>
      <UiButton size="compact" :disabled="loading" @click="loadCatalog">{{ copy('重试', 'Retry') }}</UiButton>
    </Alert>
    <p v-if="loading" class="software-note" role="status">{{ snapshot ? copy('正在刷新目录…', 'Refreshing catalog…') : copy('正在读取软件目录…', 'Loading software catalog…') }}</p>
    <SoftwareSources @changed="loadCatalog" />
    <details v-if="snapshot?.sources.length" class="software-sources" :open="snapshot.sources.some(source => source.error)">
      <summary>{{ copy('软件来源', 'Catalog sources') }}<span>{{ snapshot.sources.length }}</span></summary>
      <div class="software-source-list">
        <section v-for="source in snapshot.sources" :key="source.id" class="software-source" :data-source-id="source.id">
          <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}<Icon name="externalLink" /></a>
          <span v-else>{{ source.title }}</span>
          <span v-if="!source.error">{{ copy(`${source.items.length} 款软件`, `${source.items.length} applications`) }}</span>
          <template v-else><span class="software-source-error" role="alert">{{ copy('目录不可用，请检查来源服务。', 'Catalog unavailable. Check the source service.') }}</span><UiButton size="compact" :disabled="loading" @click="loadCatalog">{{ copy('重试', 'Retry') }}</UiButton></template>
          <Badge v-if="source.bundled">{{ copy('内置目录', 'Bundled catalog') }}</Badge>
          <Badge v-if="source.repositorySourceId">{{ source.repositoryReadFrom === 'local' ? copy('本地目录缓存', 'Local catalog cache') : copy('线上目录缓存', 'Online catalog cache') }}</Badge>
        </section>
      </div>
    </details>
    <section v-if="snapshot && !snapshot.sources.length" class="software-empty" data-testid="software-no-sources">
      <Icon name="package" /><h2>{{ copy('尚未接入软件目录', 'No software catalog connected') }}</h2><p>{{ copy('接入 Workstation 软件目录后，即可在这里浏览和收藏常用软件。', 'Connect a Workstation software catalog to browse and favorite applications here.') }}</p>
    </section>
    <section v-if="runs.length || runsError" class="software-installations" data-testid="software-installations" :aria-label="copy('安装记录', 'Installation history')">
      <header class="software-installations-header"><h2>{{ copy('安装记录', 'Installation history') }}</h2><UiButton size="compact" :disabled="runsLoading || !canRefreshRuns" data-testid="refresh-software-installations" @click="loadRuns()"><Icon :name="runsLoading ? 'loading' : 'refresh'" />{{ copy('刷新记录', 'Refresh history') }}</UiButton></header>
      <Alert v-if="runsError" variant="danger" class="software-alert" data-testid="software-history-error" role="alert">{{ copy('无法读取最新安装状态。下面保留上次记录，安装可能仍在进行。', 'Could not read the latest installation state. Previous records remain below; installation may still be running.') }}</Alert>
      <article v-for="run in displayedRuns" :key="JSON.stringify([run.sourceId, run.id])" class="software-installation-run" :data-run-id="run.id">
        <header><div><Badge :variant="stateVariant(run.state)">{{ run.state === 'running' ? copy('安装进行中', 'Installation in progress') : runStateLabel(run.state) }}</Badge><span>{{ copy(`已处理 ${settledCount(run)} / ${run.items.length} 项`, `${settledCount(run)} / ${run.items.length} items processed`) }}</span></div><time :datetime="run.createdAt">{{ new Date(run.createdAt).toLocaleString(zh ? 'zh-CN' : 'en') }}</time></header>
        <p v-if="!supports(run.sourceId, 'runs')" class="software-note">{{ supportReason(run.sourceId, 'runs') }} {{ copy('仍可审阅已载入的记录。', 'Previously loaded records remain available to review.') }}</p>
        <p v-if="activeStates.has(run.state) && !supports(run.sourceId, 'cancel')" class="software-note">{{ supportReason(run.sourceId, 'cancel') }}</p>
        <ol class="software-installation-items"><li v-for="item in run.items" :key="item.softwareId" :data-install-item-id="item.softwareId"><div class="software-installation-item-title"><strong>{{ text(item.title) }}</strong><SoftwareInstallStatus v-if="['running', 'queued'].includes(item.state)" :item="item" :stopping="run.state === 'cancelling'" :cancel-pending="busyRunIds.includes(run.id)" /><Badge v-else :variant="stateVariant(item.state)">{{ runStateLabel(item.state) }}</Badge></div><p v-if="item.state === 'running' && item.progress?.phase === 'downloading' && item.progress.resource" class="software-download-resource">{{ item.progress.resource }}</p><p v-if="item.message">{{ item.message }}</p><details v-if="item.log"><summary>{{ copy('安装日志', 'Installation log') }}</summary><pre>{{ item.log }}</pre></details></li></ol>
        <footer><UiButton v-if="activeStates.has(run.state)" size="compact" variant="ghost" :disabled="busyRunIds.includes(run.id) || run.state === 'cancelling' || !supports(run.sourceId, 'cancel')" :title="supportReason(run.sourceId, 'cancel')" data-testid="stop-software-installation" @click="cancelInstallation(run)"><Icon name="stop" />{{ copy('停止安装', 'Stop installation') }}</UiButton><UiButton v-if="!activeStates.has(run.state) && retryableItems(run).length" size="compact" :disabled="planning || installing || sourceBusy(run.sourceId) || !supports(run.sourceId, 'preview') || !supports(run.sourceId, 'install')" :title="supportReason(run.sourceId, 'preview') ?? supportReason(run.sourceId, 'install')" data-testid="retry-software-installation" @click="reviewInstallation(run.sourceId, retryableItems(run))"><Icon name="refresh" />{{ copy('重新审阅未完成项', 'Review unfinished items again') }}</UiButton><UiButton v-if="!activeStates.has(run.state)" size="compact" :disabled="loading" @click="loadCatalog">{{ copy('重新检测软件', 'Check installed software') }}</UiButton></footer>
      </article>
    </section>
    <template v-if="entries.length">
      <div class="software-filters">
        <label class="software-search"><Icon name="search" /><input v-model="query" type="search" :aria-label="copy('搜索软件', 'Search software')" :placeholder="copy('搜索软件或链接…', 'Search applications or links…')"></label>
        <label class="software-group-label">{{ copy('分类', 'Category') }}<select v-model="selectedGroup" :aria-label="copy('软件分类', 'Software category')"><option value="">{{ copy('全部分类', 'All categories') }}</option><option v-for="group in groups" :key="group.value" :value="group.value">{{ group.label }}</option></select></label>
      </div>
      <div v-if="selectedEntries.length" class="software-selection" data-testid="software-install-selection"><span>{{ copy(`已选择 ${selectedEntries.length} 项`, `${selectedEntries.length} selected`) }}</span><UiButton v-for="selection in selectionsBySource" :key="selection.sourceId" size="compact" variant="primary" :disabled="planning || installing || sourceBusy(selection.sourceId)" data-testid="review-selected-software" @click="reviewInstallation(selection.sourceId, selection.ids)">{{ copy(`审阅安装 · ${selection.title}`, `Review installation · ${selection.title}`) }}</UiButton><UiButton size="compact" variant="ghost" :disabled="planning || installing" @click="selectedKeys = []">{{ copy('清除选择', 'Clear selection') }}</UiButton></div>
      <Alert v-if="saveError" variant="danger" class="software-alert" role="alert">{{ saveError }}<UiButton size="compact" :disabled="saving" data-testid="reload-software-settings" @click="reloadSettings">{{ copy('重新载入设置', 'Reload settings') }}</UiButton></Alert>
      <p v-if="saveNotice" class="software-note" role="status">{{ saveNotice }}</p>
      <p v-if="!visibleEntries.length" class="software-note" data-testid="software-no-results">{{ copy('没有匹配的软件，试试其他关键词或分类。', 'No matching applications. Try another search or category.') }}</p>
      <div class="software-grid">
        <article v-for="entry in visibleEntries" :key="entry.key" class="software-card" :data-software-id="entry.item.id" :data-source-id="entry.sourceId">
          <header><div class="software-identity"><h2 :title="text(entry.item.title)"><SoftwareIcon class="software-mark" :url="entry.item.url" :icon-url="entry.item.iconUrl" :macos-icon-url="entry.item.macosIconUrl" :icon-style="entry.item.iconStyle" :icon-scale="entry.item.iconScale" /><span class="software-title">{{ text(entry.item.title) }}</span></h2><p class="software-category" :title="`${text(entry.item.group.title)} · ${entry.sourceTitle}`">{{ text(entry.item.group.title) }} · {{ entry.sourceTitle }}</p></div><Badge :variant="entry.item.status === 'detected' ? 'success' : 'secondary'">{{ statusLabel(entry.item.status) }}</Badge></header>
          <p class="software-description" :title="entry.item.description">{{ entry.item.description }}</p>
          <div class="software-card-actions">
            <SoftwareLinks class="software-links" :title="text(entry.item.title)" :url="entry.item.url" :download-url="entry.item.downloadUrl" :repository-url="entry.item.repositoryUrl" />
            <div class="software-install-actions">
              <template v-if="entry.item.status === 'not-detected' && entry.canManage && entry.item.canInstall">
                <div class="software-primary-action">
                  <SoftwareInstallStatus v-if="activeItems.has(entry.key)" class="software-card-progress" :item="activeItems.get(entry.key)!.item" :stopping="activeItems.get(entry.key)!.run.state === 'cancelling'" :cancellable="supports(entry.sourceId, 'cancel')" :cancel-pending="busyRunIds.includes(activeItems.get(entry.key)!.run.id)" :stop-label="stopLabel(activeItems.get(entry.key)!.run)" @stop="cancelInstallation(activeItems.get(entry.key)!.run)" />
                  <span v-else-if="sourceBusy(entry.sourceId)" class="software-waiting">{{ copy('等待其他安装', 'Waiting for another installation') }}</span>
                  <button v-else type="button" class="software-store-button" :disabled="planning || installing" data-testid="install-software" @click="reviewInstallation(entry.sourceId, [entry.item.id])">{{ copy('安装', 'Install') }}</button>
                </div>
              </template>
              <div v-if="entry.item.status === 'detected' && entry.canManage && entry.item.canOpen" class="software-primary-action">
                <button type="button" class="software-store-button" :disabled="openingKeys.includes(entry.key)" :aria-label="`${copy('打开应用', 'Open application')} ${text(entry.item.title)}`" data-testid="open-software" @click="openApplication(entry.sourceId, entry.item)">{{ openingKeys.includes(entry.key) ? copy('正在打开', 'Opening') : copy('打开', 'Open') }}</button>
              </div>
            </div>
          </div>
          <footer class="software-card-footer">
            <div class="software-secondary-actions">
              <UiButton size="compact" variant="ghost" :disabled="saving || isFavorite(entry.item)" @click="addFavorite(entry.item)"><Icon :name="isFavorite(entry.item) ? 'check' : 'plus'" />{{ isFavorite(entry.item) ? copy('已在常用工具', 'In favorites') : copy('添加到常用', 'Add to favorites') }}</UiButton>
              <label v-if="entry.item.status === 'not-detected' && entry.canManage && entry.item.canInstall" class="software-select-item"><input v-model="selectedKeys" type="checkbox" :value="entry.key" :disabled="planning || installing || sourceBusy(entry.sourceId)" :aria-label="`${copy('选择安装', 'Select for installation')} ${text(entry.item.title)}`">{{ copy('选择', 'Select') }}</label>
            </div>
            <span v-if="entry.item.installation.packageId && ['brew-cask', 'brew-formula'].includes(entry.item.installation.kind)" class="software-package" :title="`${entry.item.installation.kind === 'brew-cask' ? 'Homebrew cask' : 'Homebrew formula'} · ${entry.item.installation.packageId}`">{{ entry.item.installation.packageId }}</span>
            <span v-else-if="entry.item.status === 'not-detected' && (!entry.canManage || !entry.item.canInstall)" class="software-package" :title="copy('通过官方下载页手动安装', 'Install manually from the official download page')">{{ copy('手动安装', 'Manual install') }}</span>
          </footer>
        </article>
      </div>
    </template>
    <DialogShell :open="planOpen && !!installationPlan" layout="panel" content-class="dialog-content software-plan-dialog" data-testid="software-install-plan" @update:open="value => { if (!installing) planOpen = value }">
      <template #title>{{ copy('审阅安装计划', 'Review installation plan') }}</template>
      <template #description>{{ copy('仅执行下列安装项；已有软件会跳过。安装日志和结果会保留在本机。', 'Only the install items below will run; existing software is skipped. Logs and results are retained locally.') }}</template>
      <template #header-actions><UiButton size="icon" variant="ghost" :disabled="installing" :aria-label="copy('关闭安装计划', 'Close installation plan')" @click="planOpen = false"><Icon name="close" /></UiButton></template>
      <template v-if="installationPlan">
        <Alert v-if="planSupportReason" class="software-alert" data-testid="software-plan-operation-support">{{ planSupportReason }}</Alert>
        <Alert v-if="operationError" variant="danger" class="software-alert" role="alert">{{ operationError }}<UiButton size="compact" :disabled="runsLoading || !canRefreshRuns" @click="loadRuns()">{{ copy('刷新安装记录', 'Refresh installation history') }}</UiButton></Alert>
        <Alert v-if="installationPlan.prerequisites.length" class="software-alert" data-testid="software-install-prerequisites"><strong>{{ copy('先完成以下准备', 'Complete these prerequisites first') }}</strong><ul><li v-for="prerequisite in installationPlan.prerequisites" :key="prerequisite">{{ prerequisite }}</li></ul></Alert>
        <ol class="software-plan-items"><li v-for="item in installationPlan.items" :key="item.softwareId"><div class="software-installation-item-title"><strong>{{ text(item.title) }}</strong><Badge :variant="item.action === 'install' ? 'secondary' : 'warning'">{{ planActionLabel(item.action) }}</Badge></div><code v-if="item.installation.packageId">{{ item.installation.kind === 'brew-cask' ? 'Homebrew cask' : 'Homebrew formula' }} · {{ item.installation.packageId }}</code><p v-if="item.reason">{{ item.reason }}</p></li></ol>
        <p v-if="!planInstallCount" class="software-note">{{ copy('本计划没有可自动安装的缺失软件。手动安装项请使用官方下载入口。', 'This plan has no missing software that can be installed automatically. Use the official download link for manual items.') }}</p>
      </template>
      <template #footer><UiButton size="compact" :disabled="installing" @click="planOpen = false">{{ copy('取消', 'Cancel') }}</UiButton><UiButton size="compact" variant="primary" :disabled="installing || installationUncertain || !planInstallCount || !!installationPlan?.prerequisites.length || !supports(installationPlan!.sourceId, 'install')" :title="planSupportReason" data-testid="confirm-software-installation" @click="confirmInstallation"><Icon v-if="installing" name="loading" />{{ installing ? copy('正在开始安装…', 'Starting installation…') : copy(`确认安装 ${planInstallCount} 项`, `Confirm installation of ${planInstallCount} ${planInstallCount === 1 ? 'item' : 'items'}`) }}</UiButton></template>
    </DialogShell>
  </WorkbenchViewFrame>
</template>

<style scoped>
.software-installations { display: grid; gap: var(--space-3); margin-bottom: var(--space-5); }
.software-installations-header, .software-installation-run > header, .software-installation-run > header > div, .software-installation-item-title, .software-selection, .software-install-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.software-installations-header, .software-installation-run > header { justify-content: space-between; }
.software-installations-header h2 { margin: 0; font-size: var(--page-section-title-size); }
.software-installation-run { min-width: 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.software-installation-run > header { margin-bottom: var(--space-3); }
.software-installation-run > header span, .software-installation-run time, .software-plan-items code { color: var(--muted); font-size: var(--font-size-control); overflow-wrap: anywhere; }
.software-installation-items, .software-plan-items { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.software-installation-items li, .software-plan-items li { min-width: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); }
.software-installation-item-title strong { overflow-wrap: anywhere; }
.software-installation-items p, .software-plan-items p { margin: var(--space-2) 0 0; color: var(--muted); line-height: 1.6; overflow-wrap: anywhere; }
.software-installation-items details { margin-top: var(--space-2); }
.software-installation-items summary { cursor: pointer; color: var(--accent); font-size: var(--font-size-control); }
.software-installation-items pre { max-height: 220px; margin: var(--space-2) 0 0; overflow: auto; padding: var(--space-3); border-radius: var(--control-radius); background: var(--surface-subtle); color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--font-size-caption); white-space: pre-wrap; overflow-wrap: anywhere; }
.software-installation-run footer { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.software-selection { margin-bottom: var(--space-4); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface-subtle); font-size: var(--font-size-control); }
.software-select-item { display: flex; align-items: center; gap: var(--space-2); min-height: var(--control-height-default); color: var(--muted); font-size: var(--font-size-control); cursor: pointer; }
.software-select-item input { width: 16px; height: 16px; accent-color: var(--accent); }
.software-note { margin: 0 0 var(--space-4); color: var(--muted); font-size: var(--font-size-control); line-height: 1.6; overflow-wrap: anywhere; }
.software-alert { display: grid; justify-items: start; gap: var(--space-2); margin-bottom: var(--space-4); }
.software-alert p { margin: 0; }
.software-sources { margin-bottom: var(--space-5); border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.software-sources summary { display: flex; align-items: center; gap: var(--space-2); min-height: 36px; padding: 0 var(--space-3); color: var(--text-secondary); font-size: var(--font-size-control); cursor: pointer; list-style: none; }
.software-sources summary::-webkit-details-marker { display: none; }
.software-sources summary::before { content: ''; width: 5px; height: 5px; margin-right: 2px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); }
.software-sources[open] summary::before { transform: rotate(45deg); }
.software-sources summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--control-radius); }
.software-sources summary > span { color: var(--muted); font-variant-numeric: tabular-nums; }
.software-source-list { border-top: 1px solid var(--border); }
.software-source { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); min-width: 0; padding: var(--space-3) var(--space-4); color: var(--muted); font-size: var(--font-size-control); }
.software-source + .software-source { border-top: 1px solid var(--border); }
.software-source > span { margin-left: auto; }
.software-source a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); text-decoration: none; overflow-wrap: anywhere; }
.software-source a:hover { text-decoration: underline; }
.software-source .app-icon { flex: none; width: 12px; height: 12px; }
.software-source-error { color: var(--danger); }
.software-empty { display: grid; justify-items: center; align-content: center; gap: var(--space-3); min-height: 280px; color: var(--muted); text-align: center; }
.software-empty > .app-icon { width: 28px; height: 28px; }
.software-empty h2 { margin: 0; color: var(--text); font-size: var(--font-size-emphasis); }
.software-empty p { max-width: 440px; margin: 0; line-height: 1.6; }
.software-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-bottom: var(--space-5); }
.software-search { display: flex; flex: 1; align-items: center; gap: var(--space-2); min-width: min(100%, 220px); padding: 0 var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); color: var(--muted); }
.software-search input { width: 100%; min-width: 0; height: var(--control-height-default); padding: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; font-size: var(--font-size-control); }
.software-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.software-group-label { display: flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--muted); font-size: var(--font-size-control); }
.software-group-label select { min-width: 0; max-width: 240px; height: var(--control-height-default); padding-block: 4px; border: 1px solid var(--border); border-radius: var(--control-radius); background-color: var(--surface); color: var(--text); font: inherit; }
.software-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); align-items: start; gap: var(--space-3); }
.software-card { display: grid; grid-template-rows: 40px 40px minmax(32px, auto) auto; gap: var(--space-2); min-width: 0; padding: 14px; border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.software-card > header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--space-2); }
.software-identity { min-width: 0; min-height: 40px; }
.software-card h2 { position: relative; min-width: 0; margin: 0; padding-left: 52px; color: var(--text); font-size: 14px; font-weight: 600; line-height: 20px; }
.software-title { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.software-mark { position: absolute; inset: 0 auto auto 0; }
.software-card p { margin: 0; overflow-wrap: anywhere; }
.software-card .software-category { margin-top: 0; line-height: 20px; padding-left: 52px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.software-category, .software-package { color: var(--muted); font-size: var(--font-size-caption); line-height: 1.6; overflow-wrap: anywhere; }
.software-description { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--text-secondary); font-size: 13px; line-height: 20px; }
.software-card-actions { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.software-links { flex: none; margin-left: -8px; }
.software-install-actions { min-width: 0; margin-left: auto; }
.software-primary-action { display: flex; align-items: center; justify-content: flex-end; min-width: 0; min-height: 32px; margin-left: auto; }
.software-card-progress { flex-direction: row-reverse; }
.software-store-button { display: inline-flex; align-items: center; justify-content: center; min-width: 76px; min-height: 28px; padding: 4px 18px; border: 1px solid transparent; border-radius: 999px; background: var(--surface-hover); color: var(--accent); font: inherit; font-size: var(--font-size-control); font-weight: 600; line-height: 18px; cursor: pointer; }
.software-store-button:hover:not(:disabled) { background: var(--accent-soft); }
.software-store-button:active:not(:disabled) { background: color-mix(in srgb, var(--accent) 16%, var(--surface)); }
.software-store-button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.software-store-button:disabled { color: var(--muted); cursor: default; }
.software-waiting { color: var(--muted); font-size: var(--font-size-control); }
@media (prefers-contrast: more) { .software-store-button { border-color: currentColor; } }
@media (forced-colors: active) { .software-store-button { border-color: ButtonText; background: ButtonFace; color: ButtonText; } }
@media (pointer: coarse) { .software-store-button { min-height: 44px; } }
.software-card-footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; padding-top: var(--space-2); border-top: 1px solid var(--border); }
.software-secondary-actions { display: flex; flex: none; align-items: center; gap: var(--space-2); margin-left: -8px; }
.software-secondary-actions > .ui-button { padding-inline: 8px; white-space: nowrap; }
.software-secondary-actions .software-select-item { min-height: 28px; gap: 4px; white-space: nowrap; }
.software-secondary-actions input { margin: 0; }
.software-card-footer .software-package { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: right; }
@media (pointer: coarse) { .software-card { grid-template-rows: 40px 40px minmax(44px, auto) auto; } }
@media (max-width: 767.9px), (pointer: coarse) { .software-search input, .software-group-label select { font-size: 16px; } }
@media (max-width: 600px) { .software-group-label { flex-basis: 100%; } .software-group-label select { flex: 1; max-width: none; } }
</style>
