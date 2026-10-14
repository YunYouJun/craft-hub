<script setup lang="ts">
import type { SoftwareSource, SoftwareSourceInput, SoftwareSourcePreview, SoftwareSourceSnapshot } from 'craft-hub'
import { computed, onMounted, ref, watch } from 'vue'
import { api } from './api'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { useI18n } from './i18n'
import { Icon } from './icons'
import { useWorkbenchStore } from './store'

const emit = defineEmits<{ changed: [] }>()
const { locale } = useI18n()
const store = useWorkbenchStore()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const state = ref<SoftwareSourceSnapshot>()
const loading = ref(false)
const busy = ref('')
const pending = computed(() => loading.value || !!busy.value)
const error = ref('')
const dialogOpen = ref(false)
const preview = ref<SoftwareSourcePreview>()
const removingId = ref('')
const draft = ref<SoftwareSourceInput>({ mode: 'remote' })
const localAvailable = computed(() => state.value?.localAvailable ?? store.hostEnvironment.kind === 'local')
const workstationRepository = 'https://github.com/YunYouJun/workstation'
const workstationSource = computed(() => state.value?.sources.find(source => source.repository?.toLowerCase() === workstationRepository.toLowerCase() && source.catalogPath === 'software.config.ts'))
const workstationUnavailable = computed(() => !state.value || pending.value || (!localAvailable.value && workstationSource.value?.mode === 'local'))
const picker = window.craftHubDesktop?.selectProjectDirectory
const modeLabel = (mode: 'remote' | 'local') => mode === 'local' ? copy('本地工作目录', 'Local working tree') : copy('线上仓库', 'Online repository')
const dateLabel = (value: string) => new Date(value).toLocaleString(locale.value)

watch(draft, () => { preview.value = undefined }, { deep: true, flush: 'sync' })

async function reload(): Promise<void> {
  if (pending.value)
    return
  loading.value = true
  error.value = ''
  try { state.value = await api.softwareSources() }
  catch { error.value = copy('无法读取仓库来源，内置目录仍可使用。', 'Could not load repository sources. The bundled catalog is still available.') }
  finally { loading.value = false }
}
onMounted(reload)

async function loadWorkstation(): Promise<void> {
  if (workstationUnavailable.value)
    return
  if (workstationSource.value) {
    await refresh(workstationSource.value)
    return
  }
  busy.value = 'workstation'
  error.value = ''
  try {
    const result = await api.previewSoftwareSource({ repository: workstationRepository, mode: 'remote', branch: 'HEAD', catalogPath: 'software.config.ts' })
    if (result.replaces) {
      error.value = copy('来源列表已变化。请重新载入，再按现有设置刷新 Workstation 目录。', 'The source list changed. Reload to refresh Workstation using its saved settings.')
      return
    }
    state.value = await api.applySoftwareSource(result.previewId)
    emit('changed')
  }
  catch { error.value = copy('Workstation 目录未加载，已有缓存保持不变。请检查网络后重试；来源列表有变化时请先重新载入。', 'Workstation catalog was not loaded. Existing caches are unchanged. Check the connection and retry; reload if the source list changed.') }
  finally { busy.value = '' }
}

function edit(source?: SoftwareSource): void {
  if (pending.value)
    return
  draft.value = source
    ? { id: source.id, repository: source.repository, localPath: localAvailable.value ? source.localPath : undefined, mode: source.mode, branch: source.branch, catalogPath: source.catalogPath }
    : { repository: '', localPath: '', mode: 'remote', branch: 'HEAD', catalogPath: 'software.config.ts' }
  error.value = ''
  preview.value = undefined
  dialogOpen.value = true
}

async function chooseDirectory(): Promise<void> {
  if (!picker)
    return
  try {
    const path = await picker(draft.value.localPath || undefined)
    if (path) {
      draft.value.localPath = path
      draft.value.mode = 'local'
    }
  }
  catch { error.value = copy('无法选择目录，请输入本地仓库路径。', 'Could not select a directory. Enter the local repository path.') }
}

function chooseProject(event: Event): void {
  const path = (event.target as HTMLSelectElement).value
  if (path) {
    draft.value.localPath = path
    draft.value.mode = 'local'
  }
}

async function inspect(): Promise<void> {
  if (pending.value)
    return
  busy.value = 'preview'
  error.value = ''
  preview.value = undefined
  try {
    preview.value = await api.previewSoftwareSource({ ...draft.value, repository: draft.value.repository?.trim() || undefined, localPath: localAvailable.value ? draft.value.localPath?.trim() || undefined : undefined, branch: draft.value.branch?.trim() || 'HEAD' })
  }
  catch {
    error.value = copy('无法预览。请检查地址、分支和目录文件；本地仓库的 origin 须与线上地址一致。清单须以 export const softwareGroups 声明为字面量数组。', 'Could not preview. Check the URL, branch and catalog file; local origin must match the online URL. Declare the catalog as an exported softwareGroups literal array.')
  }
  finally { busy.value = '' }
}

async function apply(): Promise<void> {
  if (!preview.value || pending.value)
    return
  busy.value = 'apply'
  error.value = ''
  try {
    state.value = await api.applySoftwareSource(preview.value.previewId)
    dialogOpen.value = false
    preview.value = undefined
    emit('changed')
  }
  catch { error.value = copy('来源未保存。列表可能已变化或预览已过期，请重新预览。', 'Source was not saved. The list may have changed or the preview expired; preview again.') }
  finally { busy.value = '' }
}

async function refresh(source: SoftwareSource): Promise<void> {
  if (pending.value || (!localAvailable.value && source.mode === 'local'))
    return
  busy.value = source.id
  error.value = ''
  try {
    state.value = await api.refreshSoftwareSource(source.id)
    emit('changed')
  }
  catch { error.value = copy('无法刷新，已保存的缓存保持不变。请重新载入来源后重试。', 'Could not refresh. The saved cache is unchanged. Reload sources and retry.') }
  finally { busy.value = '' }
}

async function remove(source: SoftwareSource): Promise<void> {
  if (pending.value || !state.value)
    return
  busy.value = source.id
  error.value = ''
  try {
    state.value = await api.removeSoftwareSource(source.id, state.value.revision)
    removingId.value = ''
    emit('changed')
  }
  catch { error.value = copy('来源未移除，请重新载入后重试。', 'Source was not removed. Reload and retry.') }
  finally { busy.value = '' }
}
</script>

<template>
  <section class="software-repositories" data-testid="software-repositories" :aria-label="copy('仓库来源', 'Repository sources')">
    <header><div><h2>{{ copy('仓库来源', 'Repository sources') }}</h2><p>{{ copy('可将线上仓库与本机目录关联为同一来源。默认内置目录始终保留。', 'Link an online repository and a local checkout as one source. The bundled catalog remains available.') }}</p></div><div class="repository-header-actions"><UiButton size="compact" :disabled="workstationUnavailable" data-testid="load-workstation-source" @click="loadWorkstation"><Icon :name="busy === 'workstation' || (workstationSource && busy === workstationSource.id) ? 'loading' : 'refresh'" />{{ workstationSource ? copy('刷新 Workstation 目录', 'Refresh Workstation catalog') : copy('加载 Workstation 目录', 'Load Workstation catalog') }}</UiButton><UiButton size="compact" :disabled="pending" data-testid="add-software-source" @click="edit()"><Icon name="plus" />{{ copy('添加来源', 'Add source') }}</UiButton></div></header>
    <Alert v-if="error && !dialogOpen" variant="danger" role="alert">{{ error }}<UiButton size="compact" :disabled="pending" data-testid="reload-software-sources" @click="reload">{{ copy('重新载入', 'Reload') }}</UiButton></Alert>
    <article v-for="source in state?.sources" :key="source.id" class="repository-row" :data-repository-source="source.id">
      <div class="repository-title"><strong>{{ source.title }}</strong><Badge>{{ modeLabel(source.cache.readFrom) }}</Badge><Badge v-if="source.repository && source.localPath">{{ copy('已关联本地与线上', 'Local and online linked') }}</Badge></div>
      <a v-if="source.repository" :href="source.repository" target="_blank" rel="noopener noreferrer">{{ source.repository }}</a>
      <p v-if="source.localPath" class="repository-path">{{ source.localPath }}</p>
      <p>{{ source.branch === 'HEAD' ? copy('默认分支', 'Default branch') : source.branch }} · {{ source.cache.itemCount }} {{ copy('款软件', 'applications') }} · {{ copy('缓存于', 'Cached') }} {{ dateLabel(source.cache.savedAt) }}<span v-if="source.cache.commit"> · {{ source.cache.commit.slice(0, 8) }}</span></p>
      <p v-if="source.error" class="repository-error" role="status">{{ copy('上次刷新失败，继续使用以上缓存。请检查仓库连接和目录文件。', 'Last refresh failed; the cache above remains in use. Check the repository connection and catalog file.') }}</p>
      <footer><UiButton size="compact" :disabled="pending" data-testid="edit-software-source" @click="edit(source)">{{ copy('预览 / 关联目录', 'Preview / link checkout') }}</UiButton><UiButton size="compact" :disabled="pending || (!localAvailable && source.mode === 'local')" data-testid="refresh-software-source" @click="refresh(source)"><Icon :name="busy === source.id ? 'loading' : 'refresh'" />{{ copy('刷新来源', 'Refresh source') }}</UiButton><template v-if="removingId === source.id"><UiButton size="compact" variant="danger-secondary" :disabled="pending" data-testid="confirm-remove-software-source" @click="remove(source)">{{ copy('确认移除来源', 'Confirm removal') }}</UiButton><UiButton size="compact" variant="ghost" :disabled="pending" @click="removingId = ''">{{ copy('取消', 'Cancel') }}</UiButton></template><UiButton v-else size="compact" variant="ghost" :disabled="pending" data-testid="remove-software-source" @click="removingId = source.id">{{ copy('移除', 'Remove') }}</UiButton></footer>
    </article>
  </section>

  <DialogShell v-model:open="dialogOpen" layout="panel" class="software-source-dialog">
    <template #title>{{ copy('添加或关联软件仓库', 'Add or link a software repository') }}</template>
    <template #description>{{ copy('可同时保存线上地址与本地路径。预览并选择本次读取位置，确认后保存目录快照。', 'Save both the online URL and local path. Choose where to read, preview, then save the catalog snapshot.') }}</template>
    <template #header-actions><UiButton size="icon" variant="ghost" :disabled="pending" :aria-label="copy('关闭来源设置', 'Close source settings')" @click="dialogOpen = false"><Icon name="close" /></UiButton></template>
    <form class="software-source-form" @submit.prevent="inspect">
      <UiButton v-if="!draft.id" type="button" size="compact" variant="ghost" :disabled="pending" data-testid="workstation-source-preset" @click="draft.repository = workstationRepository">{{ copy('填入 Workstation 地址', 'Use Workstation URL') }}</UiButton>
      <label>{{ copy('线上仓库（HTTPS，可选）', 'Online repository (HTTPS, optional)') }}<input v-model="draft.repository" :disabled="pending || !!state?.sources.find(source => source.id === draft.id)?.repository" data-testid="software-source-url" placeholder="https://github.com/owner/repository"></label>
      <template v-if="localAvailable">
        <label v-if="store.projects.length">{{ copy('复用已登记的本地项目', 'Use a registered local project') }}<select :disabled="pending" data-testid="software-source-project" @change="chooseProject"><option value="">{{ copy('选择项目…', 'Choose project…') }}</option><option v-for="project in store.projects" :key="project.id" :value="project.path">{{ project.name }} · {{ project.path }}</option></select></label>
        <label>{{ copy('本地 Git 仓库目录（可选）', 'Local Git repository directory (optional)') }}<span class="repository-folder"><input v-model="draft.localPath" :disabled="pending" data-testid="software-source-path" :placeholder="copy('选择或输入绝对路径', 'Choose or enter an absolute path')"><UiButton v-if="picker" type="button" size="compact" :disabled="pending" @click="chooseDirectory">{{ copy('选择文件夹…', 'Choose folder…') }}</UiButton></span></label>
      </template>
      <label>{{ copy('读取位置', 'Read from') }}<select v-model="draft.mode" :disabled="pending" data-testid="software-source-mode"><option value="remote">{{ copy('线上仓库', 'Online repository') }}</option><option v-if="localAvailable" value="local">{{ copy('本地工作目录（包含未提交的目录文件）', 'Local working tree (includes uncommitted catalog files)') }}</option></select></label>
      <label>{{ copy('线上分支', 'Online branch') }}<input v-model="draft.branch" :disabled="pending" placeholder="HEAD" data-testid="software-source-branch"><small>{{ copy('HEAD 表示线上默认分支。本地模式读取当前工作目录，不切换分支。', 'HEAD uses the remote default branch. Local mode reads the current working tree without switching branches.') }}</small></label>
      <label>{{ copy('目录文件（相对仓库根目录）', 'Catalog file (relative to repository root)') }}<input v-model="draft.catalogPath" :disabled="pending" data-testid="software-source-catalog-path"></label>
      <p class="repository-help">{{ copy('直接读取 software.config.ts 中的 softwareGroups 清单，无需构建或导出。安装和配置管理仍由插件提供。', 'Read softwareGroups directly from software.config.ts without building or exporting. Installation and configuration remain plugin operations.') }}</p>
      <Alert v-if="error" variant="danger" role="alert">{{ error }}</Alert>
      <UiButton type="submit" size="compact" :disabled="pending" data-testid="preview-software-source"><Icon :name="busy === 'preview' ? 'loading' : 'search'" />{{ copy('预览目录', 'Preview catalog') }}</UiButton>
      <section v-if="preview" class="repository-preview" data-testid="software-source-preview">
        <h3>{{ preview.source.title }} · {{ preview.catalog.items.length }} {{ copy('款软件', 'applications') }}</h3><p>{{ modeLabel(preview.source.cache.readFrom) }} · {{ preview.source.repository || preview.source.localPath }}</p><p v-if="preview.source.localPath && preview.source.repository">{{ copy('关联本机目录：', 'Linked checkout: ') }}{{ preview.source.localPath }}</p>
        <p v-if="preview.replaces">{{ copy('保存将更新现有来源，不会重复添加。', 'Saving updates the existing source without adding a duplicate.') }}</p>
        <ul><li v-for="item in preview.catalog.items" :key="item.id">{{ locale === 'zh-CN' ? item.title.zh || item.title.en : item.title.en }} <span>{{ locale === 'zh-CN' ? item.group.title.zh || item.group.title.en : item.group.title.en }}</span></li></ul>
      </section>
    </form>
    <template #footer><UiButton size="compact" :disabled="pending" @click="dialogOpen = false">{{ copy('取消', 'Cancel') }}</UiButton><UiButton size="compact" variant="primary" :disabled="pending || !preview" data-testid="apply-software-source" @click="apply">{{ copy('确认保存来源', 'Save source') }}</UiButton></template>
  </DialogShell>
</template>

<style scoped>
.software-repositories { display: grid; gap: 12px; margin: 18px 0; }
.software-repositories > header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.repository-header-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.repository-header-actions > button { white-space: nowrap; }
.software-repositories h2 { margin: 0; font-size: 14px; }
.software-repositories p { margin: 5px 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.repository-row { padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--panel); }
.repository-title, .repository-row footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.repository-title { margin-bottom: 8px; }
.repository-row > a { font-size: 12px; overflow-wrap: anywhere; }
.repository-row footer { margin-top: 12px; }
.repository-row .repository-error { color: var(--danger); }
.software-source-form { display: grid; gap: 14px; }
.software-source-form > label { display: grid; gap: 6px; font-size: 13px; }
.software-source-form input, .software-source-form select { width: 100%; min-width: 0; padding: 8px 10px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.software-source-form small, .repository-help { color: var(--muted); font-size: 12px; line-height: 1.6; }
.repository-folder { display: flex; align-items: center; gap: 8px; }
.repository-folder input { flex: 1; }
.repository-preview { border: 1px solid var(--border); padding: 12px; border-radius: 8px; }
.repository-preview h3 { margin: 0; font-size: 14px; }
.repository-preview p { overflow-wrap: anywhere; font-size: 12px; }
.repository-preview ul { max-height: 200px; overflow: auto; padding-left: 20px; font-size: 12px; }
.repository-preview li { padding: 4px 0; }
.repository-preview li span { color: var(--muted); margin-left: 8px; }
@media (max-width: 600px) { .software-repositories > header { align-items: flex-start; flex-direction: column; } .repository-header-actions { justify-content: flex-start; } .repository-folder { flex-wrap: wrap; } }
</style>
