<script setup lang="ts">
import type { ConfigurationManagementPage, ResolvedIntegrationContribution } from 'craft-hub'
import { computed, reactive, ref, watch } from 'vue'
import { api } from './api'
import FilePreview from './FilePreview.vue'
import FileDiffPreview from './FileDiffPreview.vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { Badge } from './components/ui/badge'
import { Alert } from './components/ui/alert'
import { Field, FieldGroup, FieldLabel } from './components/ui/field'
import DialogShell from './components/ui/dialog/DialogShell.vue'
import Icon from './NavigationIcon.vue'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'

const props = defineProps<{ page: ConfigurationManagementPage, contribution: ResolvedIntegrationContribution, projectId?: string }>()
const emit = defineEmits<{ updated: [page: ConfigurationManagementPage] }>()
const { locale } = useI18n()
const copy = (en: string, zh: string) => locale.value === 'zh-CN' ? zh : en
const translate = (value: string) => props.contribution.translations?.[locale.value]?.[value] ?? value
const selected = ref('')
const filter = ref('')
const kind = ref('all')
const status = ref('all')
const section = ref('configuration')
const previewOpen = ref(false)
const choices = reactive<Record<string, string>>({})
const fields = reactive<Record<string, Record<string, string>>>({})
const busy = ref(false)
const error = ref('')
const gitReview = ref<{ repository: string, revision: string, action: string, paths: string[], message: string, outgoing?: string[], diff?: string }>()
const commitMessage = ref('Update workstation configuration')
const commitPaths = reactive<Record<string, string[]>>({})
const rows = computed(() => props.page.items.filter(item => (kind.value === 'all' || item.kind === kind.value) && (status.value === 'all' || (status.value === 'attention' ? !['synced', 'read-only'].includes(item.status) : item.status === status.value)) && `${item.title} ${label(item.status)} ${label(item.origin)}`.toLowerCase().includes(filter.value.toLowerCase())))
const item = computed(() => props.page.items.find(row => row.id === selected.value))
const labels: Record<string, [string, string]> = {
  synced: ['Synchronized', '已同步'], 'local-modified': ['Local changes', '本机修改'], 'source-modified': ['Source changes', '源端修改'], conflict: ['Conflict', '双方冲突'],
  'first-adoption': ['First adoption · no baseline', '首次接管差异 · 无历史基线'], unmanaged: ['Unmanaged', '未纳管'], 'read-only': ['Read only', '不可写'], error: ['Scan failed', '扫描失败'],
  local: ['Device local', '设备本地'], public: ['Public workstation', '公开 workstation'], private: ['Private dotfiles', '私有 dotfiles'], user: ['User maintained', '用户维护'], installer: ['Installer managed', '安装器管理'], project: ['Project configuration', '项目配置'],
  'to-local': ['Source → local file', '源配置 → 本机文件'], 'to-source': ['Local → repository source', '本机 → 仓库源文件'],
  applied: ['Applied', '已应用'], restored: ['Restored', '已恢复'], failed: ['Failed · recovery available', '失败 · 可检查恢复'], applying: ['Interrupted · inspect recovery', '未完成 · 检查恢复'], preview: ['Preview only', '仅预览'],
}
const label = (value: string) => labels[value] ? copy(...labels[value]) : value
const decisions = computed(() => props.page.items.filter(item => choices[item.id] && choices[item.id] !== 'skip').map(item => ({ id: item.id, revision: item.revision, choice: choices[item.id], fields: fields[item.id] })))
const kindOptions = computed(() => [{ value: 'all', label: copy('All types', '全部类型') }, { value: 'mcp', label: 'MCP' }, { value: 'skill', label: 'Skills' }, { value: 'instructions', label: copy('Global instructions', '全局指令') }, { value: 'terminal', label: copy('Terminal', '终端') }])
const choiceOptions = computed(() => [{ value: 'skip', label: copy('Defer', '暂不处理') }, { value: 'local', label: copy('Keep local → update source', '保留本机 → 更新源文件') }, { value: 'source', label: copy('Use source → update local', '使用源配置 → 更新本机') }, { value: 'merge', label: copy('Choose fields → update both', '按字段合并 → 更新双方') }])
const fieldOptions = computed(() => [{ value: 'local', label: copy('Local', '本机') }, { value: 'source', label: copy('Source', '源端') }])
const statusOptions = computed(() => [{ value: 'all', label: copy('All states', '全部状态') }, { value: 'attention', label: copy('Needs review', '待审阅') }, ...['conflict', 'first-adoption', 'local-modified', 'source-modified', 'synced', 'unmanaged', 'read-only', 'error'].map(value => ({ value, label: label(value) }))])
const attentionCount = computed(() => props.page.items.filter(item => !['synced', 'read-only'].includes(item.status)).length)
const writable = computed(() => item.value?.sourcePath && !['error', 'read-only'].includes(item.value.status))
const tone = (state: string) => state === 'synced' ? 'success' : ['error', 'conflict', 'failed'].includes(state) ? 'danger' : ['first-adoption', 'local-modified', 'source-modified'].includes(state) ? 'warning' : 'secondary'
const choiceLabel = (id: string) => choiceOptions.value.find(option => option.value === choices[id])?.label
watch(rows, (next) => {
  if (!next.some(row => row.id === selected.value)) selected.value = next[0]?.id ?? ''
}, { immediate: true })
watch(() => props.page.preview, value => { previewOpen.value = !!value }, { immediate: true })
function clearChoices() {
  for (const key of Object.keys(choices)) delete choices[key]
  for (const key of Object.keys(fields)) delete fields[key]
}
const canPreview = computed(() => decisions.value.length > 0 && decisions.value.every(decision => decision.choice !== 'merge' || props.page.items.find(item => item.id === decision.id)!.fields.every(field => fields[decision.id]?.[field])))

watch(() => props.page, () => {
  for (const repo of props.page.repositories ?? []) commitPaths[repo.id] = (commitPaths[repo.id] ?? []).filter(path => repo.paths?.some(entry => entry.path === path))
  if (!props.page.preview) {
    for (const key of Object.keys(choices)) delete choices[key]
    for (const key of Object.keys(fields)) delete fields[key]
  }
}, { immediate: true })
function choose(id: string, value: string) {
  choices[id] = value
  fields[id] ??= {}
}
async function invoke(operation: string, input: Record<string, unknown> = {}) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const action = props.contribution.actions.find(action => action.operation === (operation === 'inspect' ? 'configuration.read' : operation === 'git-action' ? 'configuration.execute' : 'configuration.update'))
    if (!action) throw new Error('Configuration action is unavailable')
    const page = await api.invokeIntegrationAction<ConfigurationManagementPage>(props.contribution.id, action.id, { operation, ...input }, props.projectId, operation !== 'inspect')
    emit('updated', page)
    gitReview.value = undefined
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { busy.value = false }
}
</script>

<template>
  <section class="configuration-manager" :aria-busy="busy">
    <div class="configuration-overview">
      <p>{{ copy('Review differences, choose a direction, then preview before applying.', '查看差异、选择处理方向，再预览并应用。') }}</p>
      <Badge :variant="attentionCount ? 'warning' : 'success'">{{ attentionCount }} {{ copy('need review', '项待审阅') }}</Badge>
    </div>
    <Alert v-if="error" variant="danger"><p>{{ translate(error) }}</p><UiButton size="compact" :disabled="busy" @click="invoke('inspect')">{{ copy('Refresh and inspect recovery', '刷新并检查恢复记录') }}</UiButton></Alert>
    <p v-if="page.message" role="status" class="configuration-message"><Icon name="check" />{{ label(page.message) }}</p>
    <TabsRoot v-model="section" class="configuration-tabs">
      <TabsList class="workbench-tabs" :aria-label="copy('Configuration management', '配置管理')">
        <TabsTrigger value="configuration">{{ copy('Review configurations', '配置审阅') }} <small>{{ page.items.length }}</small></TabsTrigger>
        <TabsTrigger value="repositories">{{ copy('Repository sync', '仓库同步') }}</TabsTrigger>
        <TabsTrigger value="history">{{ copy('Recovery history', '恢复记录') }} <small>{{ page.history?.length ?? 0 }}</small></TabsTrigger>
      </TabsList>
      <TabsContent value="configuration">
        <div class="configuration-toolbar">
          <Input v-model="filter" type="search" :aria-label="copy('Filter configuration', '筛选配置')" :placeholder="copy('Search name, source or status…', '搜索名称、来源或状态…')" />
          <FormSelect v-model="kind" :options="kindOptions" :aria-label="copy('Configuration type', '配置类型')" />
          <FormSelect v-model="status" :options="statusOptions" :aria-label="copy('Configuration status', '配置状态')" />
          <UiButton size="compact" :disabled="busy" @click="invoke('inspect')"><Icon :name="busy ? 'loading' : 'refresh'" />{{ copy('Refresh', '刷新') }}</UiButton>
        </div>
        <div class="configuration-columns">
          <aside class="configuration-list" :aria-label="copy('Configuration inventory', '配置清单')">
            <div class="configuration-list-heading">{{ copy('Configurations', '配置项') }} <span>{{ rows.length }} / {{ page.items.length }}</span></div>
            <ul>
              <li v-for="row in rows" :key="row.id">
                <button type="button" class="configuration-item" :aria-pressed="row.id === selected" @click="selected = row.id">
                  <span class="configuration-item-title"><Icon :name="row.kind === 'mcp' ? 'plugins' : row.kind === 'skill' ? 'skill' : row.kind === 'terminal' ? 'terminal' : 'docs'" /><strong>{{ row.title }}</strong><Icon v-if="choices[row.id] && choices[row.id] !== 'skip'" name="check" /></span>
                  <span class="configuration-item-meta"><Badge :variant="tone(row.status)">{{ label(row.status) }}</Badge><small>{{ label(row.origin) }}</small></span>
                  <small v-if="choices[row.id] && choices[row.id] !== 'skip'" class="configuration-choice-summary">{{ choiceLabel(row.id) }}</small>
                </button>
              </li>
            </ul>
            <p v-if="!rows.length" class="configuration-empty">{{ copy('No matching configuration. Adjust the filters.', '没有匹配的配置，请调整筛选条件。') }}</p>
          </aside>
          <section v-if="item" class="configuration-diff" :aria-label="copy('Configuration difference', '配置差异')">
            <header class="configuration-detail-heading"><h3>{{ item.title }}</h3><Badge :variant="tone(item.status)">{{ label(item.status) }}</Badge></header>
            <p class="configuration-note">{{ label(item.origin) }} · {{ label(item.owner) }}</p>
            <Alert v-if="item.status === 'first-adoption'">{{ copy('No previous baseline. Review both versions before adopting this configuration.', '没有历史基线。请审阅双方内容后决定如何接管。') }}</Alert>
            <p v-if="item.management" class="configuration-note">{{ item.management }}</p>
            <FieldGroup class="configuration-decision">
              <Field v-if="writable">
                <FieldLabel :for="`decision-${item.id}`">{{ copy('Resolution', '处理方式') }}</FieldLabel>
                <FormSelect :id="`decision-${item.id}`" :model-value="choices[item.id] ?? 'skip'" :options="choiceOptions" :aria-label="`${copy('Decision', '处理方式')} ${item.title}`" :disabled="busy || !!page.preview" @update:model-value="choose(item.id, $event)" />
                <small>{{ copy('Your selection is staged only. Preview lists the exact files before application.', '选择仅加入待处理清单，预览会列出准确的修改文件。') }}</small>
              </Field>
              <p v-else class="configuration-note">{{ copy('This item cannot be written here. Use its supported management entry.', '此项不可在这里写入，请使用其所属管理入口。') }}</p>
              <Field v-for="field in item.fields" v-if="choices[item.id] === 'merge'" :key="field">
                <FieldLabel :for="`merge-${item.id}-${field}`">{{ field }}</FieldLabel>
                <FormSelect :id="`merge-${item.id}-${field}`" v-model="fields[item.id]![field]" :options="fieldOptions" :placeholder="copy('Choose explicitly', '请选择')" :aria-label="`${copy('Merge field', '合并字段')} ${field}`" :disabled="busy || !!page.preview" />
              </Field>
            </FieldGroup>
            <p v-if="item.fields.length" class="configuration-note">{{ copy('Changed fields', '变化字段') }}: {{ item.fields.join(', ') }}</p>
            <FileDiffPreview v-if="item.local && item.source"
              :before="item.local" :after="item.source"
              :before-path="item.localPath" :after-path="item.sourcePath"
              :before-label="copy('Local file', '本机文件')" :after-label="copy('Repository source', '仓库源文件')"
            />
            <div v-else class="configuration-comparison">
              <section><h4><Icon name="terminal" />{{ copy('Local file', '本机文件') }}</h4><code>{{ item.localPath }}</code><FilePreview v-if="item.local" :content="item.local" :path="item.localPath" /><pre v-else>{{ copy('File absent', '文件不存在') }}</pre></section>
              <section><h4><Icon name="gitRepository" />{{ copy('Repository source', '仓库源文件') }}</h4><code>{{ item.sourcePath ?? copy('No connected source', '未连接配置源') }}</code><FilePreview v-if="item.source" :content="item.source" :path="item.sourcePath" /><pre v-else>{{ copy('File absent', '文件不存在') }}</pre></section>
            </div>
            <p class="configuration-note">{{ copy('Recognizable credentials are hidden. Line numbers refer to the preview; structured fragments may differ from the original file.', '可识别的凭据已隐藏。行号对应预览内容，结构化片段可能与原文件位置不同。') }}</p>
          </section>
          <p v-else class="configuration-empty">{{ copy('Select an item to review its difference and ownership.', '选择配置项，查看差异和管理归属。') }}</p>
        </div>
        <footer class="configuration-review-bar">
          <span>{{ decisions.length }} {{ copy('selected · no files changed', '项待处理 · 尚未修改文件') }}<small v-if="decisions.length && !canPreview">{{ copy('Choose every merge field to continue.', '请先选择每个合并字段。') }}</small></span>
          <div><UiButton v-if="decisions.length && !page.preview" size="compact" :disabled="busy" @click="clearChoices">{{ copy('Clear choices', '清空选择') }}</UiButton>
          <UiButton size="compact" variant="primary" v-if="!page.preview" :disabled="busy || !canPreview" @click="invoke('preview', { decisions })"><Icon :name="busy ? 'loading' : 'arrowRight'" />{{ copy('Preview selected changes', '预览所选修改') }} ({{ decisions.length }})</UiButton>
          <UiButton v-else size="compact" variant="primary" @click="previewOpen = true">{{ copy('Review prepared plan', '查看待应用方案') }}</UiButton></div>
        </footer>
      </TabsContent>
      <TabsContent value="repositories">
    <section class="configuration-repositories">
      <h3>{{ copy('Repository synchronization', '仓库同步') }}</h3>
      <p>{{ copy('Ahead / behind reflects the last fetch. Fetch updates the checkout only. Publish never force-pushes.', '领先 / 落后基于上次拉取。拉取仅更新仓库；发布不会强推。') }}</p>
      <article v-for="repo in page.repositories" :key="repo.id">
        <strong>{{ label(repo.id) }}</strong><code>{{ repo.root }}</code><p v-if="repo.error" role="alert">{{ translate(repo.error) }}</p>
        <template v-else>
          <p>{{ repo.branch }} · {{ copy('Uncommitted', '未提交') }}: {{ repo.paths?.length ?? 0 }} · {{ copy('Unpushed', '未推送') }}: {{ repo.ahead ?? '?' }} · {{ copy('Remote ahead', '远端领先') }}: {{ repo.behind ?? '?' }} <strong v-if="repo.diverged">{{ copy('Diverged', '已分叉') }}</strong></p>
          <details v-if="repo.outgoing?.length"><summary>{{ copy('Review outgoing commits and changed lines', '审阅待发布提交和变更行数') }}</summary><code>{{ repo.outgoing.join(', ') }}</code><pre>{{ repo.outgoingChanges?.join('\n') }}</pre><pre>{{ repo.outgoingDiff }}</pre></details>
          <details><summary>{{ copy('Review commit paths', '审阅待提交文件') }}</summary>
            <label v-for="file in repo.paths" :key="file.path"><input v-model="commitPaths[repo.id]" class="ui-form-checkbox" type="checkbox" :value="file.path">{{ file.status }} {{ file.path }}</label>
            <pre v-if="repo.workingDiff">{{ repo.workingDiff }}</pre>
            <Input v-model="commitMessage" :aria-label="copy('Commit message', '提交说明')" />
          </details>
          <UiButton size="compact" v-for="action in ['fetch', 'commit', 'publish']" :key="action" :disabled="busy || !repo.revision || (action === 'commit' && !commitPaths[repo.id]?.length)" @click="gitReview = { repository: repo.id, revision: repo.revision!, action, paths: action === 'commit' ? commitPaths[repo.id] ?? [] : [], message: commitMessage, outgoing: repo.outgoing, diff: action === 'publish' ? repo.outgoingDiff : repo.workingDiff }">{{ copy(`Review ${action}`, ({ fetch: '审阅拉取', commit: '审阅提交', publish: '审阅发布' } as Record<string, string>)[action]!) }}</UiButton>
        </template>
      </article>
      <section v-if="gitReview" class="configuration-preview">
        <h4>{{ gitReview.repository }} · {{ gitReview.action }}</h4><p>{{ gitReview.paths.join(', ') }}</p><p v-if="gitReview.action === 'publish'">{{ copy('Publish all reviewed outgoing commits', '发布全部已审阅的待推送提交') }}: {{ gitReview.outgoing?.join(', ') }}</p><pre v-if="gitReview.action !== 'fetch'">{{ gitReview.diff }}</pre><p v-if="gitReview.action === 'commit'">{{ gitReview.message }}</p>
        <p>{{ copy('This operation affects the repository. Local configuration is applied separately.', '此操作修改仓库状态。本机配置需单独应用。') }}</p>
        <UiButton size="compact" :disabled="busy" @click="invoke('git-action', gitReview)">{{ copy('Confirm repository operation', '确认仓库操作') }}</UiButton><UiButton size="compact" :disabled="busy" @click="gitReview = undefined">{{ copy('Cancel', '取消') }}</UiButton>
      </section>
    </section>      </TabsContent>
      <TabsContent value="history">
    <section class="configuration-history">
      <h3>{{ copy('Application and recovery history', '应用与恢复记录') }}</h3><p class="configuration-note">{{ copy('Restore only files unchanged since application. Later edits are protected.', '仅恢复应用后未再次修改的文件，后续修改会受到保护。') }}</p><p v-if="!page.history?.length">{{ copy('No application history yet.', '暂无应用记录。') }}</p>
      <article v-for="plan in page.history" :key="plan.planId"><code>{{ plan.planId }}</code> · {{ label(plan.state) }}<small>{{ plan.createdAt }}</small><code v-for="path in plan.paths" :key="path">{{ path }}</code><p v-if="plan.error">{{ translate(plan.error) }}</p>
        <UiButton size="compact" v-if="['applied', 'failed', 'applying'].includes(plan.state)" :disabled="busy" @click="invoke('restore', { planId: plan.planId })">{{ copy('Restore unchanged files from backup', '从备份恢复未再次修改的文件') }}</UiButton>
      </article>
    </section>
      </TabsContent>
    </TabsRoot>
    <DialogShell :open="previewOpen && !!page.preview" layout="panel" @update:open="previewOpen = $event">
      <template #title>{{ copy('Review modification scope', '审阅修改范围') }}</template>
      <template #description>{{ copy('Only the listed files will change. Commit and publish are separate actions.', '仅修改下列文件。提交和发布需另行操作。') }}</template>
      <template #header-actions><UiButton size="icon" variant="ghost" :aria-label="copy('Close preview', '关闭预览')" @click="previewOpen = false"><Icon name="close" /></UiButton></template>
      <section v-if="page.preview" class="configuration-preview" aria-label="Change preview">
        <Alert v-if="error" variant="danger">{{ translate(error) }}</Alert>
        <article v-for="change in page.preview.changes" :key="change.path">
          <Badge :variant="change.deletion ? 'danger' : 'secondary'">{{ label(change.direction) }}</Badge><code>{{ change.path }}</code>
          <Alert v-if="change.deletion" variant="danger">{{ copy('This file will be deleted; a backup is retained for recovery.', '此文件将被删除，并保留备份用于恢复。') }}</Alert>
          <details><summary>{{ copy('Redacted before / after', '脱敏前后对比') }}</summary><FileDiffPreview :before="change.before" :after="change.after" :before-path="change.path" :after-path="change.path" :before-label="copy('Before', '修改前')" :after-label="copy('After', '修改后')" /></details>
        </article>
        <p v-if="!page.preview.changes.length">{{ copy('No file changes; record the reviewed baseline.', '无需修改文件，仅记录已审阅基线。') }}</p>
      </section>
      <template #footer><UiButton size="compact" :disabled="busy" @click="invoke('inspect')">{{ copy('Discard preview', '放弃预览') }}</UiButton><UiButton size="compact" variant="primary" :disabled="busy || !page.preview" @click="invoke('apply', { planId: page.preview!.planId })"><Icon v-if="busy" name="loading" />{{ copy('Apply reviewed plan', '应用已审阅方案') }}</UiButton></template>
    </DialogShell>
  </section>
</template>
<style scoped>
.configuration-manager { min-width: 0; padding: var(--space-4); font-size: var(--font-size-body); }
.configuration-overview, .configuration-detail-heading, .configuration-item-title, .configuration-item-meta, .configuration-review-bar, .configuration-review-bar > div { display: flex; align-items: center; gap: var(--space-2); }
.configuration-overview { justify-content: space-between; margin-bottom: var(--space-3); flex-wrap: wrap; }
.configuration-overview p { margin: 0; color: var(--muted); }
.configuration-note, small { color: var(--muted); line-height: var(--line-height-emphasis); }
.configuration-message { display: flex; align-items: center; gap: var(--space-2); color: var(--success); }
.configuration-tabs .workbench-tabs { margin-bottom: var(--space-3); }
.workbench-tabs [data-state='active'] { color: var(--accent); box-shadow: inset 0 -2px var(--accent); }
.configuration-toolbar { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(110px, 160px) minmax(120px, 180px) auto; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.configuration-columns { display: grid; grid-template-columns: minmax(220px, 30%) minmax(0, 1fr); height: clamp(260px, calc(100dvh - 430px), 700px); min-height: 0; border: 1px solid var(--border); border-radius: var(--control-radius); overflow: hidden; }
.configuration-list { min-height: 0; overflow: auto; border-right: 1px solid var(--border); background: var(--workbench-sidebar-background); scrollbar-width: thin; }
.configuration-list-heading { display: flex; justify-content: space-between; padding: var(--space-3); color: var(--muted); border-bottom: 1px solid var(--border); }
.configuration-list ul { list-style: none; padding: 0; margin: 0; }
.configuration-item { display: grid; width: 100%; gap: var(--space-2); padding: var(--space-3); border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.configuration-item:hover { background: var(--surface-hover); }
.configuration-item[aria-pressed='true'] { background: var(--surface-hover); box-shadow: inset 2px 0 var(--accent); }
.configuration-item:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.configuration-item-title strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
.configuration-item .app-icon { flex: none; width: 14px; height: 14px; color: var(--muted); }
.configuration-item-meta { flex-wrap: wrap; }
.configuration-choice-summary { color: var(--accent); }
.configuration-diff { padding: var(--space-4); min-width: 0; min-height: 0; overflow: auto; scrollbar-width: thin; }
.configuration-detail-heading { flex-wrap: wrap; justify-content: space-between; }
h3 { margin: 0; font-size: var(--page-section-title-size); overflow-wrap: anywhere; }
h4 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--font-size-body); }
h4 .app-icon { width: 14px; height: 14px; }
.configuration-decision { margin-block: var(--space-4); }
.configuration-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.configuration-comparison > section { min-width: 0; }
pre { margin: var(--space-2) 0; padding: var(--space-3); background: var(--surface-hover); border: 1px solid var(--border); border-radius: var(--control-radius); overflow: auto; font-size: var(--font-size-control); max-height: 300px; }
code { display: block; overflow-wrap: anywhere; white-space: normal; font-size: var(--font-size-control); margin-block: var(--space-2); color: var(--muted); }
.configuration-review-bar { position: sticky; bottom: 0; justify-content: space-between; flex-wrap: wrap; padding-block: var(--space-3); background: var(--surface); border-top: 1px solid var(--border); }
.configuration-review-bar > span { display: grid; gap: var(--space-1); }
.configuration-review-bar > div { flex-wrap: wrap; }
.configuration-preview article, .configuration-history article, .configuration-repositories article { padding-block: var(--space-3); border-bottom: 1px solid var(--border); }
.configuration-repositories label { display: flex; gap: var(--space-2); margin-block: var(--space-2); }
.configuration-repositories .ui-button { margin-block: var(--space-2); }
.configuration-repositories .ui-button + .ui-button { margin-inline-start: var(--space-2); }
.configuration-empty { padding: var(--space-4); color: var(--muted); }
summary { cursor: pointer; padding-block: var(--space-2); }
[role=alert] { margin-block: var(--space-2); }
@media (max-width: 960px) { .configuration-comparison { grid-template-columns: 1fr; } }
@media (max-width: 680px) {
 .configuration-manager { padding: var(--space-3); }
 .configuration-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
 .configuration-toolbar > :first-child { grid-column: 1 / -1; }
 .configuration-columns { grid-template-columns: 1fr; height: auto; }
 .configuration-list { max-height: 240px; border-right: 0; border-bottom: 1px solid var(--border); }
 .configuration-diff { max-height: none; }
}
</style>
