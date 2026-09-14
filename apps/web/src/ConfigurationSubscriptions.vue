<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import ConfigurationSyncStatus from './ConfigurationSyncStatus.vue'
import WorkbenchPageShell from './WorkbenchPageShell.vue'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'
import { Button } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import WorkspaceSourceCatalog from './WorkspaceSourceCatalog.vue'

interface Subscription { ownerScopeId?: string, autoFollow?: boolean, id: string, url: string, name?: string, sourceRevision?: string, repository: string, branch: string, directory: string, lastImportedAt?: string, selectedWorkspaceIds?: string[], lastRevision?: string, legacy?: boolean }
interface Manifest { id: string, name: string, members: { project: string, label?: string }[] }
interface Preview { revision: string, subscription: Subscription, workspaces: Manifest[], removedWorkspaceIds?: string[] }
interface SubscriptionState { connected: boolean, canConnect?: boolean, provider: string, exampleUrl?: string, subscriptions: Subscription[] }
const { locale } = useI18n()
const store = useWorkbenchStore()
const text = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const route = useRoute()
const router = useRouter()
const state = ref<SubscriptionState>()
function sourceLocation(source: Subscription): string {
  if (source.url.includes('/tree/')) return source.url
  const repository = source.repository.startsWith('https://') ? source.repository : `${new URL(source.url).origin}/${source.repository}`
  return `${repository.replace(/\.git$/, '')}/tree/${source.branch}/${source.directory}`
}
const catalogSources = computed(() => state.value?.subscriptions.map(source => ({ url: sourceLocation(source), applied: Boolean(source.lastImportedAt) })) || [])
const detailId = computed(() => String(route.params.subscriptionId || ''))
const detail = computed(() => state.value?.subscriptions.find(source => source.id === detailId.value))
const discover = computed(() => route.name === 'subscriptions-discover')
const adding = computed(() => route.name === 'subscriptions-new')
const marketPreview = computed(() => route.name === 'subscriptions-preview')
const listing = computed(() => !detailId.value && !adding.value && !marketPreview.value)
const settings = computed(() => route.query.panel === 'settings')
const discoverPath = computed(() => {
  const params = new URLSearchParams()
  for (const key of ['market', 'search']) {
    if (typeof route.query[key] === 'string') params.set(key, route.query[key])
  }
  return `/subscriptions/discover${params.size ? `?${params}` : ''}`
})
const breadcrumbs = computed(() => [
  { label: text('工作台', 'Workbench'), to: '/' },
  { label: text('工作区源', 'Workspace sources'), to: '/subscriptions' },
  { label: discover.value || marketPreview.value ? text('发现源', 'Discover sources') : text('我的源', 'My sources'), to: discover.value || marketPreview.value ? discoverPath.value : `/subscriptions${route.query.q ? `?q=${encodeURIComponent(String(route.query.q))}` : ''}` },
  ...(!listing.value ? [{ label: adding.value ? text('添加源', 'Add source') : marketPreview.value ? text('添加预览', 'Add preview') : detail.value?.name || detail.value?.repository || text('源详情', 'Source details'), to: detailId.value ? sourcePath(detailId.value) : undefined }] : []),
  ...(detail.value && (settings.value || route.query.view === 'preview') ? [{ label: settings.value ? text('订阅设置', 'Subscription settings') : text('更新预览', 'Update preview') }] : []),
])
function sourcePath(id: string): string { return `/subscriptions/${encodeURIComponent(id)}` }
function returnToList(): void { void router.push({ path: '/subscriptions', query: route.query.q ? { q: route.query.q } : {} }) }

const sourceUrl = ref('')
const sourceName = ref('')
const editing = ref<Subscription>()
const query = computed({ get: () => String(route.query.q || ''), set: value => { void router.replace({ query: { ...route.query, q: value || undefined } }) } })
const searchTerm = computed(() => query.value.trim().toLocaleLowerCase())
const visibleSources = computed(() => state.value?.subscriptions.filter(item => [item.name, item.repository, item.branch, item.directory].some(value => value?.toLocaleLowerCase().includes(searchTerm.value))) || [])
const sourceSearch = ref<HTMLInputElement>()
async function clearSearch(): Promise<void> {
  query.value = ''
  await nextTick()
  sourceSearch.value?.focus()
}
function appliedTime(value: string): string {
  return new Date(value).toLocaleString(locale.value, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
function editSource(source: Subscription): void {
  editing.value = source
  sourceName.value = source.name || source.repository
  sourceUrl.value = sourceLocation(source)
  preview.value = undefined
  void router.push({ path: sourcePath(source.id), query: { ...route.query, panel: 'settings' } })
}
function resetForm(): void {
  editing.value = undefined
  sourceName.value = ''
  sourceUrl.value = ''
  preview.value = undefined
}
async function saveSource(): Promise<void> {
  await run(async () => {
    await request(editing.value ? `/${editing.value.id}` : '', editing.value ? 'PATCH' : 'POST', { name: sourceName.value.trim(), url: sourceUrl.value.trim(), expectedSourceRevision: editing.value?.sourceRevision })
    await load()
    resetForm()
    returnToList()
    notice.value = text('配置源已保存，可预览并选择订阅的工作区。', 'Source saved. Preview and select workspaces to subscribe to.')
  })
}
const preview = ref<Preview>()
const previewUrl = ref('')
const selectedId = ref('')
const selectedWorkspaces = ref<string[]>([])
const cachedPreview = ref(false)
const pending = ref(0)
const busy = computed(() => pending.value > 0)
const error = ref('')
const notice = ref('')

async function request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/config-subscriptions${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 404)
    throw new Error(text('当前版本尚未接入仓库订阅服务，仍可浏览目录和查看源仓库。', 'Repository subscriptions are not available in this host. You can still browse the catalog and view source repositories.'))
  const value = await response.json()
  if (!response.ok)
    throw new Error(value.error || text('订阅服务不可用', 'Subscription service unavailable'))
  return value as T
}
async function run(action: () => Promise<void>): Promise<void> {
  pending.value++
  const path = route.fullPath
  error.value = ''
  notice.value = ''
  try { await action() }
  catch (caught) { if (route.fullPath === path) error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { pending.value-- }
}
async function joinTeam(url: string): Promise<void> {
  await run(async () => {
    const response = await fetch('/api/team-subscriptions/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
    const result = await response.json()
    if (!response.ok)
      throw new Error(result.error || text('加入团队失败', 'Unable to join Team'))
    await store.loadOwnerScopes()
    await store.switchOwnerScope(result.id)
    await load()
    notice.value = text('已加入团队，将自动跟随源仓库版本。', 'Joined Team. Source updates will be applied automatically.')
  })
}
async function load(): Promise<void> { state.value = await request<SubscriptionState>() }
async function connect(): Promise<void> {
  await run(async () => {
    const result = await request<{ url: string }>('/connect', 'POST', {})
    const target = new URL(result.url)
    if (target.protocol !== 'https:')
      throw new Error(text('授权链接无效', 'Invalid authorization URL'))
    window.location.assign(target.href)
  })
}
async function inspect(id = ''): Promise<void> {
  if (id && detailId.value !== id)
    await router.push({ path: sourcePath(id), query: route.query })
  cachedPreview.value = false
  preview.value = undefined
  await run(async () => {
    previewUrl.value = sourceUrl.value.trim()
    const path = route.fullPath
    const result = await request<Preview>(id ? `/${id}/preview` : '/preview', 'POST', { url: previewUrl.value })
    if (route.fullPath !== path) return
    preview.value = result
    selectedId.value = id
    selectedWorkspaces.value = preview.value.subscription.selectedWorkspaceIds ?? preview.value.workspaces.map(workspace => workspace.id)
  })
}
async function selectSource(url: string): Promise<void> {
  sourceUrl.value = url
  const existing = state.value?.subscriptions.find(source => {
    if (!source.url)
      return false
    const location = sourceLocation(source)
    return location.replace(/\/$/, '') === url.replace(/\/$/, '')
  })
  if (existing) {
    await openPreview(existing.id)
  }
  else {
    await router.push({ path: '/subscriptions/preview', query: { ...route.query, url } })
  }
}
async function apply(): Promise<void> {
  if (!preview.value)
    return
  await run(async () => {
    await request(selectedId.value ? `/${selectedId.value}/apply` : '/apply', 'POST', { url: previewUrl.value, expectedRevision: preview.value!.revision, selectedWorkspaceIds: selectedWorkspaces.value })
    if (preview.value?.subscription.ownerScopeId)
      await store.loadOwnerScopes()
    await Promise.all([load(), store.loadWorkspaces()])
    notice.value = text('已应用订阅配置，可从左侧工作台查看。', 'Subscription applied. Open the workbench to view the workspaces.')
    preview.value = undefined
    sourceUrl.value = ''
    returnToList()
  })
}
async function unsubscribe(id: string): Promise<void> {
  await run(async () => {
    const team = state.value?.subscriptions.find(item => item.id === id)?.ownerScopeId
    await request(`/${id}`, 'DELETE', {})
    if (team)
      await store.loadOwnerScopes()
    await Promise.all([load(), store.loadWorkspaces()])
    preview.value = undefined
    returnToList()
    notice.value = text('配置源已删除，本地项目与独立工作区副本仍保留。', 'Source deleted. Local projects and independent workspace copies are retained.')
  })
}
async function inspectCached(id: string): Promise<void> {
  await run(async () => {
    const path = route.fullPath
    const snapshot = await request<Subscription & { snapshot: { workspaces: Manifest[] } }>(`/${id}/export`)
    if (route.fullPath !== path) return
    preview.value = { revision: snapshot.lastRevision || '', subscription: snapshot, workspaces: snapshot.snapshot.workspaces.filter(workspace => snapshot.selectedWorkspaceIds?.includes(workspace.id)) }
    selectedId.value = id
    cachedPreview.value = true
  })
}
async function copyWorkspace(workspaceId: string): Promise<void> {
  await run(async () => {
    await request(`/${selectedId.value}/copy`, 'POST', { workspaceId })
    await store.loadWorkspaces()
    notice.value = text('已复制为可编辑的个人工作区。', 'Copied to an editable Personal workspace.')
  })
}
const content = ref<InstanceType<typeof WorkbenchViewFrame>>()
const scrollPositions = new Map<string, number>()
async function openPreview(id: string, cached = false): Promise<void> {
  const view = cached ? 'applied' : 'preview'
  if (detailId.value === id && route.query.view === view) {
    if (cached) await inspectCached(id)
    else await inspect(id)
  }
  else await router.push({ path: sourcePath(id), query: { q: route.query.q, view } })
}
async function restoreRoute(): Promise<void> {
  preview.value = undefined
  error.value = ''
  if (adding.value) resetForm()
  if (settings.value && detail.value) {
    editing.value = detail.value
    sourceName.value = detail.value.name || detail.value.repository
    sourceUrl.value = sourceLocation(detail.value)
  }
  else if (marketPreview.value && typeof route.query.url === 'string') {
    sourceUrl.value = route.query.url
    await inspect()
  }
  else if (detail.value && route.query.view === 'preview') await inspect(detail.value.id)
  else if (detail.value && !detail.value.legacy && detail.value.lastImportedAt) await inspectCached(detail.value.id)
}
watch(() => route.fullPath, async (_, previous) => {
  if (content.value) scrollPositions.set(previous, content.value.getScrollTop())
  if (state.value) await restoreRoute()
  await nextTick()
  if (content.value) content.value.scrollTo(scrollPositions.get(route.fullPath) || 0)
})
onMounted(async () => {
  await run(load)
  if (route.name === 'subscriptions' && state.value && !state.value.subscriptions.length && !route.query.q) {
    await router.replace('/subscriptions/discover')
    return
  }
  await restoreRoute()
})
</script>

<template>
  <WorkbenchPageShell :breadcrumbs="breadcrumbs">
    <WorkbenchViewFrame ref="content" class="subscriptions-workbench" :title="detail ? detail.name || detail.repository : adding ? text('添加源', 'Add source') : text('工作区源', 'Workspace sources')" :description="text('订阅共享工作区，预览源更新，按需复制为个人工作区。', 'Subscribe to shared workspaces, preview updates, and create personal copies when needed.')" icon="builtin:workspace">
      <template #actions><Button v-if="listing" size="compact" :disabled="busy" @click="router.push('/subscriptions/new')">{{ text('添加源', 'Add source') }}</Button><Button v-if="!discover" size="compact" :disabled="busy" @click="run(load)">{{ text('刷新', 'Refresh') }}</Button></template>
      <p v-if="error" role="alert" class="subscription-error">{{ error }}</p>
      <p v-if="notice" role="status" class="subscription-notice">{{ notice }}</p>
      <p v-if="busy" role="status">{{ text('正在处理…', 'Working…') }}</p>
      <nav v-if="listing" class="source-tabs workbench-tabs" :aria-label="text('工作区源视图', 'Workspace source views')">
        <RouterLink :to="{ path: '/subscriptions', query: route.query.q ? { q: route.query.q } : {} }" :aria-current="!discover ? 'page' : undefined">{{ text('我的源', 'My sources') }}</RouterLink>
        <RouterLink :to="discoverPath" :aria-current="discover ? 'page' : undefined">{{ text('发现源', 'Discover sources') }}</RouterLink>
      </nav>
      <ConfigurationSyncStatus />
      <WorkspaceSourceCatalog v-if="discover" :sources="catalogSources" :disabled="busy || !state?.connected" @select="selectSource" @join="joinTeam" />
      <p v-if="detailId && state && !detail" role="alert">{{ text('配置源不存在或已删除。', 'Source not found or deleted.') }}</p>
      <nav v-if="detail" class="source-tabs workbench-tabs" :aria-label="text('源详情视图', 'Source detail views')">
        <RouterLink :to="{ path: sourcePath(detail.id), query: { q: route.query.q } }" :aria-current="!settings ? 'page' : undefined">{{ text('工作区', 'Workspaces') }}</RouterLink>
        <RouterLink :to="{ path: sourcePath(detail.id), query: { ...route.query, panel: 'settings' } }" :aria-current="settings ? 'page' : undefined">{{ text('订阅设置', 'Subscription settings') }}</RouterLink>
      </nav>
      <template v-if="state">
        <section v-if="state.canConnect !== false" class="subscription-connection">
          <div class="subscription-connection-summary"><Icon :name="state.connected ? 'check' : 'gitRepository'" :class="{ connected: state.connected }" /><strong>{{ state.provider }}</strong><span>{{ state.connected ? text('已连接 · 按账号仓库权限读取', 'Connected · Uses your repository permissions') : text('连接账号后读取配置仓库', 'Connect to read configuration repositories') }}</span></div>
          <Button size="compact" :variant="state.connected ? 'ghost' : 'secondary'" :disabled="busy" @click="connect">{{ state.connected ? text('重新连接', 'Reconnect') : text('连接账号', 'Connect account') }}</Button>
        </section>
        <section v-if="adding || (detail && settings)" class="subscription-card">
          <h2>{{ editing ? text('编辑配置源', 'Edit source') : text('添加配置源', 'Add source') }}</h2>
          <form @submit.prevent="saveSource">
            <label for="source-name">{{ text('名称', 'Name') }}</label><input id="source-name" v-model="sourceName" required maxlength="120" :disabled="busy">
            <label for="subscription-url">{{ text('配置目录链接', 'Configuration directory URL') }}</label>
            <div class="subscription-input-row"><input id="subscription-url" v-model="sourceUrl" type="url" required :placeholder="state.exampleUrl || 'https://…'" :disabled="busy"><Button type="submit" variant="primary" :disabled="busy || !state.connected || !sourceUrl.trim() || !sourceName.trim()">{{ editing ? text('保存修改', 'Save changes') : text('添加源', 'Add source') }}</Button><Button v-if="editing" :disabled="busy" @click="router.push(sourcePath(detailId))">{{ text('取消编辑', 'Cancel edit') }}</Button></div>
          </form>
          <Button v-if="!editing" :disabled="busy || !state.connected || !sourceUrl.trim()" @click="joinTeam(sourceUrl.trim())">{{ text('作为团队加入并自动更新', 'Join as a Team and follow updates') }}</Button>
          <p>{{ text('支持 source.jsonc 和工作区 JSON/JSONC；项目 YAML 由下游仓库适配器提供。添加源后可选择工作区并预览更新。', 'Supports source.jsonc and workspace JSON/JSONC; host adapters may also support project YAML. Save a source, then select workspaces and preview updates.') }}</p>
        </section>
        <section v-if="preview && !listing && !settings" class="subscription-card">
          <div class="subscription-row"><h2>{{ cachedPreview ? text('已应用工作区', 'Applied workspaces') : text('订阅预览', 'Subscription preview') }} · {{ preview.workspaces.length }}</h2><span>{{ preview.revision.slice(0, 8) }}</span></div>
          <p>{{ preview.subscription.repository }} · {{ preview.subscription.branch }} · {{ preview.subscription.directory }}</p>
          <aside v-if="!preview.subscription.legacy" class="subscription-explainer">
            <strong>{{ preview.subscription.autoFollow ? text('已加入团队，自动跟随源版本', 'Joined Team, following source updates') : text('保持订阅，更新由你确认', 'Stay subscribed, review updates before applying') }}</strong>
            <p v-if="!preview.subscription.autoFollow">{{ text('工作区定义由源仓库维护。你管理订阅选择、本机路径和执行权限；源有变化时，预览后再应用。需要自行修改定义，可在订阅后复制到个人工作区，副本不再同步。', 'The source repository maintains workspace definitions. You manage workspace selection, local paths and execution permissions. Preview source changes before applying them. For independent edits, copy an applied workspace to Personal; copies no longer sync.') }}</p>
          </aside>
          <article v-for="workspace in preview.workspaces" :key="workspace.id" class="subscription-preview">
            <label v-if="!cachedPreview"><input v-model="selectedWorkspaces" type="checkbox" :value="workspace.id" :disabled="busy"> {{ workspace.name }}</label><strong v-else>{{ workspace.name }}</strong><Button v-if="cachedPreview" :disabled="busy" @click="copyWorkspace(workspace.id)">{{ text('复制到个人工作区', 'Copy to Personal') }}</Button><span>{{ workspace.members.length }} {{ text('个项目', 'projects') }}</span>
            <ul><li v-for="member in workspace.members" :key="member.project">{{ member.label || member.project }}</li></ul>
          </article>
          <p>{{ text('订阅工作区只读，可复制后编辑。本机路径和执行权限不随源更新。确认更新后，远端已移除的工作区将退出订阅视图，独立副本仍保留。', 'Subscribed workspaces are read-only; copy them to edit. Updates preserve local paths and trust. Confirmed updates remove deleted upstream workspaces from the subscription view and retain independent copies.') }}</p>
          <p v-if="preview.removedWorkspaceIds?.length" role="status">{{ text('源中已移除：', 'Removed upstream: ') }}{{ preview.removedWorkspaceIds.join(', ') }}</p>
          <div class="subscription-actions"><Button v-if="!cachedPreview" variant="primary" :disabled="busy || (!selectedWorkspaces.length && preview.workspaces.length > 0)" @click="apply">{{ selectedId ? text('应用订阅更新', 'Apply subscription update') : text('确认订阅', 'Subscribe') }}</Button><Button :disabled="busy" @click="marketPreview ? router.push(discoverPath) : router.push(sourcePath(detailId))">{{ text('取消', 'Cancel') }}</Button></div>
        </section>
        <section v-if="(listing && !discover) || (detail && !settings)" class="subscription-card subscription-list" :aria-label="text('我的配置源', 'My sources')">
          <header v-if="listing" class="subscription-list-toolbar">
            <h2>{{ text('我的配置源', 'My sources') }}<span class="subscription-count" role="status">{{ searchTerm ? `${visibleSources.length} / ${state.subscriptions.length}` : state.subscriptions.length }}</span></h2>
            <div class="subscription-search" role="search">
              <Icon name="search" />
              <input id="source-search" ref="sourceSearch" v-model="query" type="search" :aria-label="text('搜索配置源', 'Search sources')" :placeholder="text('搜索名称、仓库或分支…', 'Search name, repository or branch…')">
              <button v-if="query" type="button" :aria-label="text('清空搜索', 'Clear search')" @click="clearSearch"><Icon name="close" /></button>
            </div>
          </header>
          <div v-if="listing && !visibleSources.length" class="subscription-empty" role="status">
            <span>{{ state.subscriptions.length ? text('没有匹配的配置源', 'No matching sources') : text('还没有订阅，可浏览发现源或添加仓库链接。', 'No subscriptions yet. Discover sources or add a repository URL.') }}</span>
            <Button v-if="query" size="compact" variant="ghost" @click="clearSearch">{{ text('清空搜索', 'Clear search') }}</Button>
          </div>
          <article v-for="subscription in detail ? [detail] : visibleSources" :key="subscription.id" class="subscription-item">
            <RouterLink class="subscription-link" :to="{ path: sourcePath(subscription.id), query: route.query.q ? { q: route.query.q } : {} }">
              <Icon name="gitRepository" />
              <div class="subscription-summary">
                <div class="subscription-heading"><strong :title="subscription.name || subscription.repository">{{ subscription.name || subscription.repository }}</strong><span v-if="subscription.name && subscription.name !== subscription.repository" :title="subscription.repository">{{ subscription.repository }}</span></div>
                <div class="subscription-meta"><span :title="subscription.branch">{{ subscription.branch }}</span><span aria-hidden="true">·</span><span :title="subscription.directory">{{ subscription.directory }}</span></div>
              </div>
              <time v-if="subscription.lastImportedAt" class="subscription-updated" :datetime="subscription.lastImportedAt" :title="new Date(subscription.lastImportedAt).toLocaleString()">{{ text('上次应用', 'Last applied') }} {{ appliedTime(subscription.lastImportedAt) }}</time>
              <span v-else class="subscription-updated">{{ text('尚未应用', 'Not applied') }}</span>
              <Icon v-if="listing" name="arrowRight" />
            </RouterLink>
            <div v-if="detail" class="subscription-actions"><Button :disabled="busy" @click="editSource(subscription)">{{ text('编辑', 'Edit') }}</Button><Button :disabled="busy || !state.connected" @click="openPreview(subscription.id)">{{ text('预览订阅更新', 'Preview subscription update') }}</Button><Button v-if="!subscription.legacy && subscription.lastImportedAt" :disabled="busy" @click="openPreview(subscription.id, true)">{{ text('查看已应用快照', 'View applied snapshot') }}</Button><a class="workbench-action-link" :href="`/api/config-subscriptions/${subscription.id}/export`" download><span class="app-icon i-ri-download-2-line" aria-hidden="true" />{{ text('导出配置', 'Export') }}</a><Button variant="ghost" :disabled="busy" @click="unsubscribe(subscription.id)">{{ subscription.ownerScopeId ? text('退出团队', 'Leave Team') : text('删除源', 'Delete source') }}</Button></div>
          </article>
        </section>
      </template>
    </WorkbenchViewFrame>
  </WorkbenchPageShell>
</template>

<style scoped>
:global(body:has(.subscriptions-workbench)) { min-width: 0; }
header, .subscription-connection, .subscription-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h2 { font-size: var(--page-section-title-size); margin: 0 0 var(--space-4); }
p, small { color: var(--muted); font-size: var(--font-size-body); line-height: 1.6; } p { margin: 6px 0; }
.subscription-card { border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); padding: var(--space-4); margin-top: var(--page-section-gap); }
.subscription-connection { flex-wrap: wrap; gap: var(--space-2); padding-block: var(--space-1); margin-bottom: var(--space-3); }
.subscription-connection-summary { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: var(--space-2); font-size: var(--font-size-body); }
.subscription-connection-summary > .app-icon { width: 14px; height: 14px; color: var(--muted); }
.subscription-connection-summary > .connected { color: var(--success); }
.subscription-connection-summary > span { color: var(--muted); }
label { display: block; font-size: var(--font-size-body); margin-bottom: 8px; }
.subscription-input-row, .subscription-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
input[type=checkbox] { min-width: auto; width: auto; flex: none; margin-right: 6px; }
input:not([type=checkbox]) { flex: 1; min-width: 180px; border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; color: var(--text); background: var(--surface); }
.subscription-list { padding: 0; margin-top: var(--space-3); overflow: hidden; }
.subscription-list-toolbar { flex-wrap: wrap; gap: var(--space-2); padding: var(--space-2) var(--space-3); }
.subscription-list-toolbar h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--font-size-body); white-space: nowrap; }
.subscription-count { color: var(--muted); font-size: var(--font-size-control); font-weight: 400; font-variant-numeric: tabular-nums; }
.subscription-search { display: flex; align-items: center; flex: 0 1 300px; min-width: 0; gap: var(--space-2); min-height: var(--control-height-compact); padding-inline: var(--space-2); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); color: var(--muted); }
.subscription-search:focus-within { border-color: var(--focus-ring); box-shadow: 0 0 0 1px var(--focus-ring); }
.subscription-search .app-icon { width: 14px; height: 14px; }
.subscription-search input { width: 100%; min-width: 0; height: var(--control-height-compact); padding: 0; border: 0; border-radius: 0; outline: none; background: transparent; font-size: var(--font-size-body); }
.subscription-search input::-webkit-search-cancel-button { appearance: none; }
.subscription-search input::placeholder { color: var(--muted); }
.subscription-search button { display: grid; flex: none; width: 24px; height: 24px; place-items: center; border-radius: 4px; background: transparent; color: var(--muted); }
.subscription-search button:hover { background: var(--surface-hover); color: var(--text); }
.subscription-search button:focus-visible { outline: 2px solid var(--focus-ring); }
.subscription-item + .subscription-item, .subscription-list-toolbar + .subscription-item { border-top: 1px solid var(--border); }
.subscription-link { display: flex; align-items: center; gap: var(--space-3); min-height: 68px; padding: var(--space-3); color: var(--text); text-decoration: none; }
.subscription-link:hover { background: var(--surface-hover); }
.subscription-link:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.subscription-link > .app-icon { width: 16px; height: 16px; color: var(--muted); }
.subscription-summary { display: grid; flex: 1; min-width: 0; gap: var(--space-1); }
.subscription-heading, .subscription-meta { display: flex; min-width: 0; align-items: baseline; gap: var(--space-2); line-height: var(--line-height-body); }
.subscription-heading strong { font-size: var(--font-size-body); font-weight: 500; }
.subscription-heading > *, .subscription-meta > span:not([aria-hidden]) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.subscription-heading > span { color: var(--muted); font-size: var(--font-size-control); }
.subscription-meta { color: var(--muted); font-size: var(--font-size-control); }
.subscription-updated { flex: none; color: var(--muted); font-size: var(--font-size-control); white-space: nowrap; }
.subscription-item > .subscription-actions { padding: 0 var(--space-3) var(--space-3); }
.subscription-empty { display: flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 68px; padding: var(--space-3); border-top: 1px solid var(--border); color: var(--muted); font-size: var(--font-size-body); }
.subscription-explainer { margin: 16px 0; padding: 14px 16px; border-left: 3px solid var(--accent); border-radius: 4px; background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.subscription-explainer strong { font-size: var(--font-size-body); }
.subscription-preview { padding: 12px 0; border-top: 1px solid var(--border); } .subscription-preview > span { margin-left: 12px; font-size: 12px; color: var(--muted); }
ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); padding-left: 20px; gap: 6px; font-size: var(--font-size-body); overflow-wrap: anywhere; }
a { font-size: var(--font-size-body); color: var(--accent); } .subscription-error { color: var(--danger, #c44); } .subscription-notice { color: var(--text); }
@media (max-width: 720px) {
  input { width: 100%; }
  .subscription-search { flex-basis: 100%; min-height: 40px; }
  .subscription-search input { height: 40px; }
  .subscription-search button { width: 32px; height: 32px; }
  .subscription-link { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: var(--space-1) var(--space-2); }
  .subscription-heading { flex-wrap: wrap; gap: 0 var(--space-2); }
  .subscription-updated { grid-column: 2; }
  .subscription-link > .app-icon:last-child { grid-column: 3; grid-row: 1 / 3; }
  .subscription-empty { flex-direction: column; }
}
</style>
