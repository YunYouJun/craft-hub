<script setup lang="ts">
import type { SetupProfile, SetupProfileInventory, SetupProfileResolution, SetupProfileReview, SetupProfileSnapshot } from 'craft-hub'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { api, ApiRequestError } from './api'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import EnvironmentSetupGuide from './EnvironmentSetupGuide.vue'
import { useI18n } from './i18n'
import { useMachineReadinessStore } from './store'
import WorkbenchViewFrame from './WorkbenchViewFrame.vue'

const { locale } = useI18n()
const machineReadiness = useMachineReadinessStore()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const text = (value: { en: string, zh?: string }) => locale.value === 'zh-CN' ? value.zh ?? value.en : value.en
const snapshot = ref<SetupProfileSnapshot>()
const inventory = ref<SetupProfileInventory>()
const review = ref<SetupProfileReview>()
const name = ref('')
const query = ref('')
const software = ref<string[]>([])
const configurations = ref<string[]>([])
const imported = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const hosted = ref(false)
let mounted = true
const key = (source: string, id: string) => JSON.stringify([source, id])
const exported = computed(() => snapshot.value?.profile ? JSON.stringify(snapshot.value.profile, null, 2) : '')
const visibleSoftware = computed(() => inventory.value?.software.filter(item => [item.reference.title.en, item.reference.title.zh].some(value => value?.toLowerCase().includes(query.value.toLowerCase()))) ?? [])
const unavailableSoftware = computed(() => snapshot.value?.profile?.software.filter(saved => !inventory.value?.software.some(item => key(item.reference.sourceId, item.reference.softwareId) === key(saved.sourceId, saved.softwareId))) ?? [])
const unavailableConfigurations = computed(() => snapshot.value?.profile?.configurations.filter(saved => !inventory.value?.configurations.some(item => key(item.reference.integrationId, item.reference.itemId) === key(saved.integrationId, saved.itemId))) ?? [])
const total = computed(() => software.value.length + configurations.value.length)
const ready = computed(() => review.value ? [...review.value.software, ...review.value.configurations].filter(item => item.state === 'ready').length : 0)
const labels: Record<SetupProfileResolution, [string, string]> = {
  ready: ['已就绪', 'Ready'], missing: ['未检测到', 'Not detected'], review: ['待审阅配置', 'Review configuration'],
  changed: ['来源已变化，需重新审阅', 'Source changed; review again'], unavailable: ['待连接来源或重新检测', 'Connect the source or check again'], unknown: ['检测结果未知', 'Detection unknown'],
}
const stateLabel = (state: SetupProfileResolution) => copy(...labels[state])

function selectSaved(): void {
  name.value = snapshot.value?.profile?.name ?? copy('我的开发环境', 'My development environment')
  software.value = snapshot.value?.profile?.software.map(item => key(item.sourceId, item.softwareId)) ?? []
  configurations.value = snapshot.value?.profile?.configurations.map(item => key(item.integrationId, item.itemId)) ?? []
}

async function perform(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try { await action() }
  catch (caught) {
    if (!mounted) return
    hosted.value = caught instanceof ApiRequestError && caught.status === 403
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally { if (mounted) busy.value = false }
}

async function load(): Promise<void> {
  await perform(async () => {
    const [saved, available] = await Promise.all([api.setupProfile(), api.setupProfileInventory()])
    if (!mounted) return
    snapshot.value = saved
    inventory.value = available
    review.value = undefined
    hosted.value = false
    selectSaved()
  })
}

async function save(): Promise<void> {
  if (!snapshot.value) return
  await perform(async () => {
    const saved = await api.saveSetupProfile({
      operation: 'save', revision: snapshot.value!.revision, name: name.value,
      software: software.value.map(value => { const [sourceId, softwareId] = JSON.parse(value); return { sourceId, softwareId } }),
      configurations: configurations.value.map(value => { const [integrationId, itemId] = JSON.parse(value); return { integrationId, itemId } }),
    })
    machineReadiness.invalidate()
    if (!mounted) return
    snapshot.value = saved
    review.value = undefined
    selectSaved()
    notice.value = copy('方案已保存。导出后可在另一台 Mac 导入。', 'Profile saved. Export it to import on another Mac.')
  })
}

async function importProfile(): Promise<void> {
  if (!snapshot.value) return
  await perform(async () => {
    const saved = await api.saveSetupProfile({ operation: 'import', revision: snapshot.value!.revision, profile: JSON.parse(imported.value) as SetupProfile })
    machineReadiness.invalidate()
    if (!mounted) return
    snapshot.value = saved
    review.value = undefined
    selectSaved()
    imported.value = ''
    notice.value = copy('导入已保存。点击“检查这台 Mac”查看恢复步骤。', 'Imported profile saved. Check this Mac to review the recovery steps.')
  })
}

async function check(): Promise<void> {
  await perform(async () => {
    const result = await api.reviewSetupProfile()
    if (!mounted) return
    review.value = result
    snapshot.value = result.snapshot
    selectSaved()
  })
}

async function readImport(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  await perform(async () => {
    if (file.size > 256 * 1024) throw new Error(copy('方案文件超过 256 KiB，请检查文件。', 'The profile exceeds 256 KiB. Check the file.'))
    const content = await file.text()
    if (mounted) imported.value = content
  })
}

function download(): void {
  const url = URL.createObjectURL(new Blob([`${exported.value}\n`], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'craft-hub-environment.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

onMounted(load)
onUnmounted(() => { mounted = false })
</script>

<template>
  <WorkbenchViewFrame :title="copy('我的环境方案', 'My environment profile')" :description="copy('保存希望具备的软件与配置，在另一台 Mac 检查差异并恢复。', 'Save desired software and configuration, then review and restore on another Mac.')" icon="builtin:settings" class="setup-profile">
    <template #actions><UiButton size="compact" :disabled="busy" @click="load">{{ copy('重新读取', 'Reload') }}</UiButton></template>
    <p class="setup-note">{{ copy('在目标 Mac 打开 Craft Hub，导入方案后，按下方引导准备工具与配置源，再审阅恢复。', 'Open Craft Hub on the target Mac, import your profile, prepare tools and configuration sources with the guide below, then review recovery.') }}</p>
    <Alert v-if="error" variant="danger" role="alert">{{ hosted ? copy('请在本机打开 Craft Hub 管理环境方案。', 'Open Craft Hub locally to manage environment profiles.') : error }}<span v-if="review"> {{ copy('下方保留上次检查结果，请重新检查后继续。', 'Previous results remain below. Check again before continuing.') }}</span></Alert>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="busy && !snapshot" aria-live="polite">{{ copy('正在读取…', 'Loading…') }}</p>
    <template v-if="snapshot && !hosted">
      <section class="setup-section">
        <header><h2>{{ copy('1. 保存我的方案', '1. Save my profile') }}</h2><span>{{ total }} {{ copy('项已选择', 'selected') }}</span></header>
        <label class="setup-name"><span>{{ copy('方案名称', 'Profile name') }}</span><Input v-model="name" maxlength="80" :disabled="busy" /></label>
        <p class="setup-note">{{ copy('方案保存你勾选的软件和源配置引用。配置文件内容、账号凭据、本机路径和执行信任保留在本机。', 'The profile saves selected software and source references. Configuration contents, credentials, machine paths and execution trust stay on this Mac.') }}</p>
        <details class="setup-options">
          <summary>{{ copy('选择软件', 'Choose software') }} · {{ software.length }}</summary>
          <Input v-model="query" type="search" :placeholder="copy('搜索软件…', 'Search software…')" :aria-label="copy('搜索方案软件', 'Search profile software')" />
          <div class="setup-selections">
            <label v-for="item in visibleSoftware" :key="key(item.reference.sourceId, item.reference.softwareId)"><input v-model="software" type="checkbox" :value="key(item.reference.sourceId, item.reference.softwareId)" :disabled="busy"><span>{{ text(item.reference.title) }}<small>{{ item.reference.sourceId }}</small></span></label>
            <label v-for="item in unavailableSoftware" :key="key(item.sourceId, item.softwareId)"><input v-model="software" type="checkbox" :value="key(item.sourceId, item.softwareId)" :disabled="busy"><span>{{ text(item.title) }}<small>{{ copy('来源未连接；可取消选择后保存', 'Source unavailable; deselect to save') }}</small></span></label>
          </div>
        </details>
        <details class="setup-options">
          <summary>{{ copy('选择已纳管配置', 'Choose managed configuration') }} · {{ configurations.length }}</summary>
          <p v-if="!inventory?.configurations.length" class="setup-note">{{ copy('当前没有可选择的配置。请先在“环境配置”中连接配置源并确认纳管范围。', 'No managed configuration is available. Connect a configuration source and confirm ownership in Environment configuration first.') }}</p>
          <p class="setup-note">{{ copy('仅能保存已与源同步的配置。本机修改需先在环境配置中审阅并保存到源仓库。', 'Only synchronized configuration can be saved. Review local changes and save them to the source repository first.') }}</p>
          <p v-if="inventory?.unavailableIntegrations.length" class="setup-note">{{ copy('部分配置来源暂时无法读取，请连接后重新读取。', 'Some configuration sources are unavailable. Connect them and reload.') }}</p>
          <div class="setup-selections">
            <label v-for="item in inventory?.configurations" :key="key(item.reference.integrationId, item.reference.itemId)"><input v-model="configurations" type="checkbox" :value="key(item.reference.integrationId, item.reference.itemId)" :disabled="busy || (item.status !== 'synced' && !configurations.includes(key(item.reference.integrationId, item.reference.itemId)))"><span>{{ item.reference.title }}<small>{{ item.reference.kind }} · {{ item.reference.origin }} · {{ item.status === 'synced' ? copy('已同步', 'Synchronized') : copy('请先同步', 'Synchronize first') }}</small></span></label>
            <label v-for="item in unavailableConfigurations" :key="key(item.integrationId, item.itemId)"><input v-model="configurations" type="checkbox" :value="key(item.integrationId, item.itemId)" :disabled="busy"><span>{{ item.title }}<small>{{ copy('来源未连接；可取消选择后保存', 'Source unavailable; deselect to save') }}</small></span></label>
          </div>
        </details>
        <div class="setup-actions"><UiButton variant="primary" :disabled="busy || !name.trim() || !total" data-testid="save-setup-profile" @click="save">{{ copy('保存方案', 'Save profile') }}</UiButton><UiButton v-if="snapshot.profile" :disabled="busy" @click="download">{{ copy('导出方案', 'Export profile') }}</UiButton></div>
        <details v-if="snapshot.profile" class="setup-options"><summary>{{ copy('查看已保存的方案', 'View saved profile') }}</summary><textarea readonly :value="exported" :aria-label="copy('已保存的环境方案', 'Saved environment profile')" /></details>
      </section>
      <section class="setup-section">
        <header><h2>{{ copy('2. 在另一台 Mac 导入', '2. Import on another Mac') }}</h2></header>
        <details class="setup-options">
          <summary>{{ copy('导入环境方案', 'Import environment profile') }}</summary>
          <p class="setup-note">{{ copy('粘贴导出的 JSON。保存将替换当前方案；导入完成后可检查这台 Mac 的差异。', 'Paste the exported JSON. Saving replaces the current profile; then check this Mac for differences.') }}</p>
          <input type="file" accept=".json,application/json" :disabled="busy" :aria-label="copy('选择环境方案文件', 'Choose an environment profile file')" @change="readImport">
          <textarea v-model="imported" :disabled="busy" :aria-label="copy('待导入的环境方案', 'Environment profile to import')" spellcheck="false" />
          <UiButton :disabled="busy || !imported.trim()" data-testid="import-setup-profile" @click="importProfile">{{ copy('保存导入的方案', 'Save imported profile') }}</UiButton>
        </details>
      </section>
      <EnvironmentSetupGuide :profile-revision="snapshot.revision" />
      <section class="setup-section">
        <header><h2>{{ copy('4. 检查并恢复这台 Mac', '4. Check and restore this Mac') }}</h2><UiButton :disabled="busy || !snapshot.profile" data-testid="check-setup-profile" @click="check">{{ copy('检查这台 Mac', 'Check this Mac') }}</UiButton></header>
        <p class="setup-note">{{ copy('安装和配置分别审阅。完成后再次检查，以实际检测和配置状态确认结果。', 'Review installation and configuration separately. Check again afterward to verify actual software and configuration state.') }}</p>
        <template v-if="review?.snapshot.profile">
          <p role="status">{{ copy(`已就绪 ${ready} / ${review.software.length + review.configurations.length} 项`, `${ready} / ${review.software.length + review.configurations.length} ready`) }}</p>
          <ul class="setup-results">
            <li v-for="item in review.software" :key="key(item.reference.sourceId, item.reference.softwareId)"><span>{{ text(item.reference.title) }}</span><Badge :variant="item.state === 'ready' ? 'success' : 'secondary'">{{ stateLabel(item.state) }}</Badge><a v-if="item.state !== 'ready'" :href="item.reference.url" target="_blank" rel="noopener noreferrer">{{ copy('官网', 'Website') }}</a></li>
            <li v-for="item in review.configurations" :key="key(item.reference.integrationId, item.reference.itemId)"><span>{{ item.reference.title }}</span><Badge :variant="item.state === 'ready' ? 'success' : 'secondary'">{{ stateLabel(item.state) }}</Badge><RouterLink v-if="item.href && item.state !== 'ready'" :to="{ path: item.href, query: { scope: 'global', setupItem: item.reference.itemId } }">{{ copy('审阅配置', 'Review configuration') }}</RouterLink></li>
          </ul>
          <RouterLink v-if="review.software.some(item => item.canInstall)" class="setup-link" to="/software?setup=1">{{ copy('前往软件中心审阅安装', 'Review installation in Software center') }} →</RouterLink>
        </template>
      </section>
    </template>
  </WorkbenchViewFrame>
</template>

<style scoped>
.setup-profile { max-width: 1040px; }
.setup-note { color: var(--muted); font-size: var(--font-size-control); line-height: 1.7; overflow-wrap: anywhere; }
.setup-section { padding: var(--space-5) 0; border-bottom: 1px solid var(--border); }
.setup-section > header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.setup-section h2 { margin: 0; font-size: var(--font-size-body); font-weight: 600; }
.setup-section header > span { color: var(--muted); font-size: var(--font-size-control); }
.setup-name { display: grid; gap: var(--space-2); max-width: 420px; margin-top: var(--space-4); font-size: var(--font-size-control); }
.setup-options { margin-top: var(--space-3); }
.setup-options summary { padding: var(--space-2) 0; cursor: pointer; font-size: var(--font-size-control); }
.setup-selections { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); max-height: 320px; overflow: auto; margin-top: var(--space-2); }
.setup-selections label { display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2); font-size: var(--font-size-control); overflow-wrap: anywhere; }
.setup-selections input { margin-top: 3px; flex: none; accent-color: var(--accent); }
.setup-selections small { display: block; color: var(--muted); }
.setup-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-4); }
.setup-options textarea { display: block; width: 100%; min-height: 170px; margin: var(--space-3) 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); color: var(--text); font: 12px/1.6 var(--font-mono); resize: vertical; }
.setup-results { list-style: none; margin: var(--space-3) 0; padding: 0; }
.setup-results li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-3) 0; border-bottom: 1px solid var(--border); font-size: var(--font-size-control); }
.setup-results li > span:first-child { flex: 1; min-width: min(180px, 100%); overflow-wrap: anywhere; }
.setup-results a, .setup-link { font-size: var(--font-size-control); }
</style>
