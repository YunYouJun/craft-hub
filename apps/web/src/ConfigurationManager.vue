<script setup lang="ts">
import type { ConfigurationManagementPage, ResolvedIntegrationContribution } from 'craft-hub'
import { computed, reactive, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'

const props = defineProps<{ page: ConfigurationManagementPage, contribution: ResolvedIntegrationContribution, projectId?: string }>()
const emit = defineEmits<{ updated: [page: ConfigurationManagementPage] }>()
const { locale } = useI18n()
const copy = (en: string, zh: string) => locale.value === 'zh-CN' ? zh : en
const selected = ref('')
const filter = ref('')
const kind = ref('all')
const choices = reactive<Record<string, string>>({})
const fields = reactive<Record<string, Record<string, string>>>({})
const busy = ref(false)
const error = ref('')
const gitReview = ref<{ repository: string, revision: string, action: string, paths: string[], message: string, outgoing?: string[], diff?: string }>()
const commitMessage = ref('Update workstation configuration')
const commitPaths = reactive<Record<string, string[]>>({})
const rows = computed(() => props.page.items.filter(item => (kind.value === 'all' || item.kind === kind.value) && `${item.title} ${item.status} ${item.origin}`.toLowerCase().includes(filter.value.toLowerCase())))
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
    <p class="configuration-intro">{{ copy('Review each source and destination before applying. Saving, committing and publishing are separate actions.', '逐项审阅来源、归属和修改目标。保存配置、提交和发布是独立操作。') }}</p>
    <p class="configuration-note">{{ copy('Literal values and prose are withheld. Changed fields or aligned line positions are listed below; no baseline means first adoption.', '字面值和正文已隐藏，下方列出变化字段或对齐后的行号。无历史基线的项目显示为首次接管。') }}</p>
    <p v-if="error" role="alert">{{ error }} <UiButton size="compact" :disabled="busy" @click="invoke('inspect')">{{ copy('Refresh and inspect recovery', '刷新并检查恢复记录') }}</UiButton></p>
    <p v-if="page.message" role="status">{{ label(page.message) }}</p>
    <div class="configuration-toolbar">
      <Input v-model="filter" class="configuration-filter" type="search" :aria-label="copy('Filter configuration', '筛选配置')" :placeholder="copy('Filter configuration', '筛选配置')" />
      <FormSelect v-model="kind" :options="kindOptions" :aria-label="copy('Configuration type', '配置类型')" />
      <span>{{ rows.length }} / {{ page.items.length }}</span>
    </div>
    <div class="configuration-columns">
      <div class="configuration-list" role="list">
        <article v-for="row in rows" :key="row.id" role="listitem" :class="{ selected: row.id === selected }">
          <UiButton size="compact" variant="ghost" class="configuration-item" @click="selected = row.id"><strong>{{ row.title }}</strong><span>{{ label(row.status) }}</span></UiButton>
          <small>{{ label(row.origin) }} · {{ label(row.owner) }}</small>
          <FormSelect v-if="row.sourcePath && !['error', 'read-only'].includes(row.status)" :model-value="choices[row.id] ?? 'skip'" :options="choiceOptions" :aria-label="`${copy('Decision', '处理方式')} ${row.title}`" :disabled="busy || !!page.preview" @update:model-value="choose(row.id, $event)" />
        </article>
        <p v-if="!rows.length">{{ copy('No matching configuration', '没有匹配的配置') }}</p>
      </div>
      <section v-if="item" class="configuration-diff" :aria-label="copy('Configuration difference', '配置差异')">
        <h3>{{ item.title }}</h3>
        <p>{{ label(item.status) }}</p>
        <p v-if="item.management">{{ item.management }}</p>
        <div v-if="item.fields.length" class="configuration-fields">
          <strong>{{ copy('Changed fields', '变化字段') }}</strong>
          <label v-for="field in item.fields" :key="field">{{ field }}
            <FormSelect v-if="choices[item.id] === 'merge'" v-model="fields[item.id]![field]" :options="fieldOptions" :placeholder="copy('Choose explicitly', '请选择')" :aria-label="`${copy('Merge field', '合并字段')} ${field}`" :disabled="busy || !!page.preview" />
          </label>
        </div>
        <h4>{{ copy('Local file', '本机文件') }}</h4><code>{{ item.localPath }}</code><pre>{{ item.local }}</pre>
        <h4>{{ copy('Repository source', '仓库源文件') }}</h4><code>{{ item.sourcePath ?? copy('No connected source', '未连接配置源') }}</code><pre>{{ item.source }}</pre>
      </section>
      <p v-else class="configuration-diff">{{ copy('Select an item to review its difference and ownership.', '选择配置项，查看差异和管理归属。') }}</p>
    </div>
    <UiButton size="compact" variant="primary" v-if="!page.preview" :disabled="busy || !canPreview" @click="invoke('preview', { decisions })">{{ copy('Preview selected changes', '预览所选修改') }} ({{ decisions.length }})</UiButton>
    <section v-if="page.preview" class="configuration-preview" aria-label="Change preview">
      <h3>{{ copy('Review modification scope', '审阅修改范围') }}</h3>
      <article v-for="change in page.preview.changes" :key="change.path">
        <strong>{{ label(change.direction) }}</strong><code>{{ change.path }}</code>
        <p v-if="change.deletion">{{ copy('This file will be deleted; the recovery journal retains a backup.', '将删除此文件；恢复记录保留备份。') }}</p>
        <details><summary>{{ copy('Redacted before / after', '脱敏前后对比') }}</summary><pre>{{ change.before }}</pre><pre>{{ change.after }}</pre></details>
      </article>
      <p v-if="!page.preview.changes.length">{{ copy('No file changes; record the reviewed baseline.', '无需修改文件，仅记录已审阅基线。') }}</p>
      <UiButton size="compact" variant="primary" :disabled="busy" @click="invoke('apply', { planId: page.preview.planId })">{{ copy('Apply reviewed plan', '应用已审阅方案') }}</UiButton>
      <UiButton size="compact" :disabled="busy" @click="invoke('inspect')">{{ copy('Discard preview', '放弃预览') }}</UiButton>
    </section>
    <details class="configuration-history" :open="!!error || page.history?.some(plan => ['failed', 'applying'].includes(plan.state))">
      <summary>{{ copy('Application and recovery history', '应用与恢复记录') }}</summary>
      <article v-for="plan in page.history" :key="plan.planId"><code>{{ plan.planId }}</code> · {{ label(plan.state) }}<small>{{ plan.createdAt }}</small><code v-for="path in plan.paths" :key="path">{{ path }}</code><p v-if="plan.error">{{ plan.error }}</p>
        <UiButton size="compact" v-if="['applied', 'failed', 'applying'].includes(plan.state)" :disabled="busy" @click="invoke('restore', { planId: plan.planId })">{{ copy('Restore unchanged files from backup', '从备份恢复未再次修改的文件') }}</UiButton>
      </article>
    </details>
    <section class="configuration-repositories">
      <h3>{{ copy('Repository synchronization', '仓库同步') }}</h3>
      <p>{{ copy('Ahead / behind reflects the last fetch. Fetch updates the checkout only. Publish never force-pushes.', '领先 / 落后基于上次拉取。拉取仅更新仓库；发布不会强推。') }}</p>
      <article v-for="repo in page.repositories" :key="repo.id">
        <strong>{{ label(repo.id) }}</strong><code>{{ repo.root }}</code><p v-if="repo.error" role="alert">{{ repo.error }}</p>
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
    </section>
  </section>
</template>

<style scoped>
.configuration-manager { min-width: 0; font-size: var(--font-size-body); }
.configuration-intro { margin-top: 0; line-height: var(--line-height-body); }
.configuration-note, small { color: var(--muted); }
.configuration-toolbar { display: flex; align-items: center; gap: var(--space-2); min-height: var(--page-toolbar-height); margin-block: var(--page-section-gap); flex-wrap: wrap; }
.configuration-filter { flex: 1; min-width: 140px; }
.configuration-toolbar :deep(.ui-select-trigger) { width: auto; }
.configuration-columns { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 1.4fr); border: 1px solid var(--border); border-radius: var(--control-radius); overflow: hidden; margin-bottom: var(--page-section-gap); }
.configuration-list { max-height: 650px; overflow: auto; border-right: 1px solid var(--border); background: var(--workbench-sidebar-background); }
.configuration-list article { display: grid; gap: var(--space-2); padding: var(--space-3); border-bottom: 1px solid var(--border); }
.configuration-list article.selected { background: var(--surface-hover); }
.configuration-item { flex-direction: column; align-items: flex-start; text-align: left; white-space: normal; overflow-wrap: anywhere; }
.configuration-item span { font-size: var(--font-size-caption); color: var(--muted); }
.configuration-diff { padding: var(--space-4); min-width: 0; max-height: 650px; overflow: auto; }
.configuration-diff h3 { margin-top: 0; }
h3 { font-size: var(--page-section-title-size); }
pre { padding: var(--space-3); background: var(--surface-hover); border-radius: var(--control-radius); overflow: auto; font-size: var(--font-size-control); max-height: 250px; }
code { display: block; overflow-wrap: anywhere; font-size: var(--font-size-control); margin-block: var(--space-2); }
.configuration-fields, .configuration-repositories label { display: grid; gap: var(--space-2); margin-bottom: var(--space-2); }
.configuration-fields label { display: flex; justify-content: space-between; gap: var(--space-2); }
.configuration-preview { border: 1px solid var(--accent); border-radius: var(--control-radius); padding: var(--space-4); margin-block: var(--page-section-gap); }
.configuration-preview article, .configuration-history article, .configuration-repositories article { padding-block: var(--space-3); border-bottom: 1px solid var(--border); }
.configuration-history { margin-block: var(--page-section-gap); }
summary { cursor: pointer; padding-block: var(--space-2); }
[role=alert] { color: var(--danger); }
.configuration-preview > .ui-button + .ui-button, .configuration-repositories .ui-button + .ui-button { margin-inline-start: var(--space-2); }
@media (max-width: 680px) { .configuration-columns { grid-template-columns: 1fr; } .configuration-list { max-height: 300px; border-right: 0; border-bottom: 1px solid var(--border); } }
</style>
