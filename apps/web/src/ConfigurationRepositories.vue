<script setup lang="ts">
import type { ConfigurationManagementPage } from 'craft-hub'
import { computed, reactive, ref } from 'vue'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { FormSelect } from './components/ui/select'
import { useI18n } from './i18n'

type Registry = NonNullable<ConfigurationManagementPage['registry']>
const props = defineProps<{ registry: Registry, busy: boolean, canManage: boolean, canBackup: boolean }>()
const emit = defineEmits<{ request: [operation: string, input: Record<string, unknown>] }>()
const { locale } = useI18n()
const copy = (en: string, zh: string) => locale.value === 'zh-CN' ? zh : en
const form = ref<'source' | 'target'>()
const editing = ref(false)
const source = reactive({ id: '', name: '', root: '', kind: 'overlay', audience: 'personal', manifest: 'config/sync-manifest.json', enabled: true })
const target = reactive({ id: '', name: '', root: '', directory: 'workstation', audience: 'personal', driver: 'workstation', sourceIds: [] as string[], keyEnvironment: 'WORKSTATION_BACKUP_PASSPHRASE' })
const replace = reactive<Record<string, boolean>>({})
const audienceOptions = computed(() => [{ value: 'public', label: copy('Public', '公开') }, { value: 'personal', label: copy('Personal private', '个人私有') }, { value: 'work', label: copy('Work private', '公司私有') }])
const targetAudiences = computed(() => audienceOptions.value.filter(option => option.value !== 'public'))
const kindOptions = computed(() => [{ value: 'dotfiles', label: copy('Dotfiles', '通用 dotfiles') }, { value: 'overlay', label: copy('Private overlay', '私有配置清单') }])
const driverOptions = computed(() => [{ value: 'workstation', label: copy('Workstation encrypted backup', 'Workstation 加密备份') }, { value: 'external', label: copy('Original application', '由原应用同步') }])
const audienceLabel = (value: string) => audienceOptions.value.find(option => option.value === value)?.label ?? copy('Classification required', '待分类')
const eligibleSources = computed(() => props.registry.sources.filter(source => source.audience === 'public' || source.audience === target.audience))
function update(input: Record<string, unknown>) {
  emit('request', 'repositories-update', { registry: { ...input, revision: props.registry.revision } })
}
function editSource(value?: Registry['sources'][number]) {
  editing.value = !!value
  Object.assign(source, value ? { ...value, audience: value.audience === 'unclassified' ? 'personal' : value.audience, manifest: value.manifest ?? 'config/sync-manifest.json' } : { id: '', name: '', root: '', kind: 'overlay', audience: 'personal', manifest: 'config/sync-manifest.json', enabled: true })
  form.value = 'source'
}
function editTarget(value?: Registry['targets'][number]) {
  editing.value = !!value
  Object.assign(target, value ? { ...value, root: value.root ?? '', sourceIds: [...value.sourceIds], keyEnvironment: value.keyEnvironment ?? 'WORKSTATION_BACKUP_PASSPHRASE' } : { id: '', name: '', root: '', directory: 'workstation', audience: 'personal', driver: 'workstation', sourceIds: [], keyEnvironment: 'WORKSTATION_BACKUP_PASSPHRASE' })
  form.value = 'target'
}
function saveSource() {
  update({ action: 'save-source', source: { ...source, manifest: source.kind === 'overlay' ? source.manifest : undefined } })
}
function saveTarget() {
  update({ action: 'save-target', target: { ...target, root: target.root || undefined, sourceIds: target.driver === 'external' ? [] : target.sourceIds.filter(id => eligibleSources.value.some(source => source.id === id)), keyEnvironment: target.driver === 'workstation' ? target.keyEnvironment : undefined } })
}
function preview(value: Registry['targets'][number], action: 'save' | 'restore') {
  emit('request', 'backup-preview', { targetId: value.id, action, revision: props.registry.revision, ...(action === 'save' && replace[value.id] ? { resolution: 'replace' } : {}) })
}
</script>

<template>
  <section class="configuration-source-manager" :aria-label="copy('Sources and backup targets', '配置源与备份目标')">
    <header><div><h3>{{ copy('Configuration sources', '配置源') }}</h3><p>{{ copy('Changes return to their original source. Local checkout paths stay on this device.', '修改写回原来源；本机仓库路径只保存在此设备。') }}</p></div><Button size="compact" :disabled="busy || !canManage" @click="editSource()">{{ copy('Add source', '添加配置源') }}</Button></header>
    <article v-for="entry in registry.sources" :key="entry.id" :data-source-id="entry.id">
      <div class="source-heading"><strong>{{ entry.name }}</strong><Badge>{{ audienceLabel(entry.audience) }}</Badge><Badge v-if="!entry.enabled">{{ copy('Disabled', '已停用') }}</Badge></div>
      <code>{{ entry.root }}</code><small>{{ entry.kind }} · {{ entry.id }}</small>
      <div class="source-actions"><Button size="compact" :disabled="busy || !canManage" @click="editSource(entry)">{{ copy('Edit source', '编辑配置源') }}</Button><Button size="compact" :disabled="busy || !canManage" @click="update({ action: 'save-source', source: { ...entry, enabled: !entry.enabled } })">{{ entry.enabled ? copy('Disable', '停用') : copy('Enable', '启用') }}</Button><Button size="compact" :disabled="busy || !canManage" @click="update({ action: 'remove-source', id: entry.id })">{{ copy('Remove registration', '移除登记') }}</Button></div>
    </article>
    <form v-if="form === 'source'" class="source-form" @submit.prevent="saveSource">
      <h4>{{ editing ? copy('Edit source', '编辑配置源') : copy('Add source', '添加配置源') }}</h4>
      <label>{{ copy('Source ID', '来源标识') }}<Input v-model="source.id" required :disabled="editing" pattern="[a-z][a-z0-9-]{0,63}" /></label>
      <label>{{ copy('Name', '名称') }}<Input v-model="source.name" required /></label>
      <label>{{ copy('Existing local Git checkout', '已有本地 Git 仓库') }}<Input v-model="source.root" required :disabled="editing" placeholder="/path/to/configuration" /></label>
      <label>{{ copy('Configuration format', '配置格式') }}<FormSelect v-model="source.kind" :options="kindOptions" :disabled="editing" :aria-label="copy('Configuration format', '配置格式')" /></label>
      <label>{{ copy('Content scope', '内容范围') }}<FormSelect v-model="source.audience" :disabled="editing && registry.sources.find(entry => entry.id === source.id)?.audience !== 'unclassified'" :options="audienceOptions" :aria-label="copy('Content scope', '内容范围')" /></label>
      <label v-if="source.kind === 'overlay'">{{ copy('Manifest in repository', '仓库内的配置清单') }}<Input v-model="source.manifest" required :disabled="editing" /></label>
      <div class="source-actions"><Button type="submit" :disabled="busy || !canManage">{{ copy('Save source', '保存配置源') }}</Button><Button type="button" @click="form = undefined">{{ copy('Close', '关闭') }}</Button></div>
    </form>
    <header><div><h3>{{ copy('Backup targets', '备份目标') }}</h3><p>{{ copy('Keep work and personal backups separate. A reserved target creates no repository.', '公司与个人备份分别保存。预留目标不会创建仓库。') }}</p></div><Button size="compact" :disabled="busy || !canManage" @click="editTarget()">{{ copy('Add backup target', '添加备份目标') }}</Button></header>
    <p v-if="!registry.targets.length">{{ copy('No backup targets registered.', '尚未登记备份目标。') }}</p>
    <article v-for="entry in registry.targets" :key="entry.id" :data-target-id="entry.id">
      <div class="source-heading"><strong>{{ entry.name }}</strong><Badge>{{ audienceLabel(entry.audience) }}</Badge><Badge v-if="!entry.root">{{ copy('Reserved', '已预留') }}</Badge></div>
      <code v-if="entry.root">{{ entry.root }}/{{ entry.directory }}</code><small>{{ entry.driver === 'external' ? copy('Managed by the original application', '由原应用管理同步') : entry.sourceIds.join(', ') }}</small>
      <div class="source-actions"><Button size="compact" :disabled="busy || !canManage" @click="editTarget(entry)">{{ copy('Edit target', '编辑目标') }}</Button><Button size="compact" :disabled="busy || !canManage" @click="update({ action: 'remove-target', id: entry.id })">{{ copy('Remove registration', '移除登记') }}</Button></div>
      <template v-if="entry.driver === 'workstation' && entry.root">
        <p>{{ copy('Passphrase environment variable', '口令环境变量') }}: <code>{{ entry.keyEnvironment }}</code></p>
        <label class="replace-choice"><input v-model="replace[entry.id]" type="checkbox">{{ copy('Review replacing a backup changed by another device', '审阅替换其他设备修改过的备份') }}</label>
        <div class="source-actions"><Button size="compact" :disabled="busy || !canBackup" @click="preview(entry, 'save')">{{ copy('Preview encrypted backup', '预览加密备份') }}</Button><Button size="compact" :disabled="busy || !canBackup" @click="preview(entry, 'restore')">{{ copy('Preview restoration to source', '预览恢复到配置源') }}</Button></div>
      </template>
    </article>
    <form v-if="form === 'target'" class="source-form" @submit.prevent="saveTarget">
      <h4>{{ editing ? copy('Edit target', '编辑目标') : copy('Add backup target', '添加备份目标') }}</h4>
      <label>{{ copy('Target ID', '目标标识') }}<Input v-model="target.id" required :disabled="editing" pattern="[a-z][a-z0-9-]{0,63}" /></label>
      <label>{{ copy('Name', '名称') }}<Input v-model="target.name" required /></label>
      <label>{{ copy('Local checkout · leave empty to reserve', '本地仓库 · 留空即预留') }}<Input v-model="target.root" :disabled="editing && !!registry.targets.find(entry => entry.id === target.id)?.root" placeholder="/path/to/backups" /></label>
      <label>{{ copy('Directory within repository', '仓库内目录') }}<Input v-model="target.directory" :disabled="editing" required /></label>
      <label>{{ copy('Content scope', '内容范围') }}<FormSelect v-model="target.audience" :disabled="editing" :options="targetAudiences" :aria-label="copy('Backup scope', '备份范围')" /></label>
      <label>{{ copy('Sync method', '同步方式') }}<FormSelect v-model="target.driver" :disabled="editing" :options="driverOptions" :aria-label="copy('Sync method', '同步方式')" /></label>
      <template v-if="target.driver === 'workstation'">
        <label>{{ copy('Passphrase environment variable name', '口令环境变量名称') }}<Input v-model="target.keyEnvironment" required pattern="[A-Z][A-Z0-9_]*" /></label>
        <Alert>{{ copy('Provide the passphrase to the local Workstation process through your secret manager. This form stores its variable name only.', '通过密钥管理器向本机 Workstation 进程提供口令。此处只保存变量名称。') }}</Alert>
        <fieldset><legend>{{ copy('Sources to back up', '备份哪些配置源') }}</legend><label v-for="entry in eligibleSources" :key="entry.id"><input v-model="target.sourceIds" type="checkbox" :value="entry.id">{{ entry.name }} · {{ audienceLabel(entry.audience) }}</label></fieldset>
      </template>
      <div class="source-actions"><Button type="submit" :disabled="busy || !canManage">{{ copy('Save target', '保存目标') }}</Button><Button type="button" @click="form = undefined">{{ copy('Close', '关闭') }}</Button></div>
    </form>
  </section>
</template>

<style scoped>
.configuration-source-manager { display: grid; gap: 14px; min-width: 0; }
header, .source-heading, .source-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
header { justify-content: space-between; }
header p { margin: 5px 0; color: var(--muted); }
article, .source-form { padding: 14px; border: 1px solid var(--border); border-radius: 10px; display: grid; gap: 10px; min-width: 0; }
code { overflow-wrap: anywhere; }
small { color: var(--muted); }
.source-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.source-form > h4, .source-form > .source-actions, .source-form > fieldset, .source-form > .ui-alert { grid-column: 1 / -1; }
.source-form label { display: grid; gap: 6px; min-width: 0; }
.source-form fieldset label, .replace-choice { display: flex; gap: 8px; align-items: center; }
fieldset { display: grid; gap: 8px; }
@media (max-width: 640px) { .source-form { grid-template-columns: minmax(0, 1fr); } }
</style>
