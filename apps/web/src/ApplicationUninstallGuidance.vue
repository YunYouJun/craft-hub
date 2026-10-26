<script setup lang="ts">
import type { ApplicationMaintenanceSnapshot, ApplicationUninstallGuidance } from 'craft-hub'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import { useI18n } from './i18n'

const props = defineProps<{ bundleId?: string }>()
const bundleFilter = ref(props.bundleId)
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const snapshot = ref<ApplicationMaintenanceSnapshot>()
const guidance = ref<ApplicationUninstallGuidance>()
const selected = ref('')
const query = ref('')
const loading = ref(false)
const inspecting = ref(false)
const revealing = ref(false)
const error = ref('')
const notice = ref('')
let generation = 0
let active = true
const applications = computed(() => snapshot.value?.applications.filter(app => (!bundleFilter.value || app.bundleId === bundleFilter.value)
  && `${app.name} ${app.bundleId} ${app.path}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())) ?? [])

function selectRequested(): void {
  if (!applications.value.some(app => app.id === selected.value)) selected.value = applications.value[0]?.id ?? ''
}
async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  selected.value = ''
  guidance.value = undefined
  snapshot.value = undefined
  try {
    const result = await api.maintainedApplications()
    if (!active) return
    snapshot.value = result
    selectRequested()
  }
  catch { if (active) error.value = copy('无法读取本机应用，请重试。', 'Could not read local applications. Please retry.') }
  finally { if (active) loading.value = false }
}
watch(() => props.bundleId, value => { bundleFilter.value = value })
watch([bundleFilter, query], selectRequested)
watch(selected, async (id) => {
  const request = ++generation
  guidance.value = undefined
  error.value = ''
  notice.value = ''
  inspecting.value = !!id
  if (!id) return
  try {
    const result = await api.applicationUninstallGuidance(id)
    if (active && request === generation) guidance.value = result
  }
  catch { if (active && request === generation) error.value = copy('应用或候选文件已变化，请刷新后重试。', 'The application or its files changed. Refresh and try again.') }
  finally { if (active && request === generation) inspecting.value = false }
})
async function reveal(candidateId?: string): Promise<void> {
  if (!guidance.value || revealing.value) return
  const id = guidance.value.application.id
  revealing.value = true
  error.value = ''
  try {
    await api.revealMaintainedApplication(id, candidateId)
    if (active && selected.value === id) notice.value = copy('已请求在 Finder 中显示。', 'Requested reveal in Finder.')
  }
  catch { if (active && selected.value === id) error.value = copy('文件已变化或无法显示，请刷新后重试。', 'The file changed or could not be revealed. Refresh and try again.') }
  finally { if (active) revealing.value = false }
}
onMounted(refresh)
onUnmounted(() => { active = false; generation++ })
</script>

<template>
  <section class="uninstall-guidance" aria-labelledby="uninstall-title">
    <header><div><h2 id="uninstall-title">{{ copy('卸载指引', 'Uninstall guidance') }}</h2><p>{{ copy('查找卸载入口与说明，选择应用不会执行卸载。', 'Find uninstall entry points and documentation. Selecting an app does not uninstall it.') }}</p></div><button :disabled="loading" @click="refresh">{{ copy('刷新应用', 'Refresh applications') }}</button></header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">{{ copy('正在读取本机应用…', 'Reading local applications…') }}</p>
    <p v-else-if="snapshot && !snapshot.supported">{{ copy('本机应用探测需要 macOS。', 'Local application inspection requires macOS.') }}</p>
    <template v-else-if="snapshot">
      <p v-if="snapshot.incomplete" role="status">{{ copy('部分目录或应用无法读取，列表可能不完整。', 'Some folders or apps could not be read. This list may be incomplete.') }}</p>
      <button v-if="bundleFilter" @click="bundleFilter = undefined">{{ copy('显示所有应用', 'Show all applications') }}</button>
      <label>{{ copy('搜索已安装应用', 'Search installed applications') }}<input v-model="query" type="search"></label>
      <label>{{ copy('应用', 'Application') }}<select v-model="selected" :disabled="!applications.length"><option v-if="!applications.length" value="">{{ copy('未找到匹配的应用', 'No matching applications') }}</option><option v-for="app in applications" :key="app.id" :value="app.id">{{ app.name }} · {{ app.path }}</option></select></label>
      <p v-if="!applications.length">{{ copy('可刷新重试；仅检查应用程序文件夹，未扫描其他磁盘或用户数据。', 'Refresh to try again. Only Applications folders are inspected; other disks and user data are not scanned.') }}</p>
      <p v-if="inspecting" role="status">{{ copy('正在查找卸载入口…', 'Looking for uninstall entry points…') }}</p>
      <article v-if="guidance">
        <h3>{{ guidance.application.name }}</h3><p class="app-identity">{{ guidance.application.bundleId }}<br>{{ guidance.application.path }}</p>
        <button :disabled="revealing" @click="reveal()">{{ copy('在 Finder 中显示应用', 'Show application in Finder') }}</button>
        <p v-if="guidance.incomplete">{{ copy('部分位置或说明来源无法读取，结果可能不完整。', 'Some locations or documentation sources could not be read. Results may be incomplete.') }}</p>
        <ul v-if="guidance.candidates.length" class="candidate-list"><li v-for="candidate in guidance.candidates" :key="candidate.id"><strong>{{ candidate.name }}</strong><span>{{ copy('未验证的候选', 'Unverified candidate') }} · {{ candidate.evidence === 'inside-application' ? copy('位于应用包内', 'Inside the application bundle') : copy('位于相邻安装文件夹', 'In the enclosing installation folder') }}</span><code>{{ candidate.path }}</code><button :disabled="revealing" @click="reveal(candidate.id)">{{ copy('在 Finder 中显示候选', 'Show candidate in Finder') }}</button></li></ul>
        <p v-else>{{ copy('未找到本机卸载程序候选。应用内菜单可能仍有卸载功能。', 'No local uninstaller candidate found. The application may still have an uninstall menu item.') }}</p>
        <ul v-if="guidance.documentation.length" class="documentation"><li v-for="doc in guidance.documentation" :key="doc.url"><a :href="doc.url" target="_blank" rel="noopener noreferrer">{{ copy('卸载说明', 'Uninstall documentation') }}</a> · {{ copy('来源：', 'Source: ') }}{{ doc.source }}</li></ul>
        <p v-if="!guidance.documentation.length">{{ copy('软件目录尚未提供此应用的卸载说明。', 'The software catalog has not supplied uninstall documentation for this application.') }}</p>
        <div class="guide-links"><a href="https://support.apple.com/102610" target="_blank" rel="noopener noreferrer">{{ copy('Apple 通用卸载指南', 'Apple’s general uninstall guide') }}</a><a :href="guidance.searchUrl" target="_blank" rel="noopener noreferrer">{{ copy('搜索官方卸载说明', 'Search for official uninstall instructions') }}</a></div>
        <p class="guidance-note">{{ copy('候选仅根据名称和位置发现，尚未验证发布者。搜索结果也未经验证，请核对开发商官网。', 'Candidates are based on names and locations; their publisher has not been verified. Search results are also unverified; check the developer’s website.') }}</p>
      </article>
    </template>
  </section>
</template>

<style scoped>
.uninstall-guidance { max-width: 860px; display: grid; gap: 14px; }
header { display: flex; align-items: start; justify-content: space-between; gap: 16px; }
h2, h3, p { margin: 0; }
header p, .app-identity, .guidance-note { color: var(--muted); font-size: 13px; line-height: 1.6; }
label, article, .candidate-list li { display: grid; gap: 10px; min-width: 0; }
input, select { width: 100%; min-height: 36px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--control-radius); padding: 6px 10px; }
button { width: fit-content; padding: 7px 12px; border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); color: var(--text); cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
article { border: 1px solid var(--border); border-radius: var(--control-radius); padding: 18px; gap: 16px; }
.app-identity, code { overflow-wrap: anywhere; }
.candidate-list { padding: 0; list-style: none; display: grid; gap: 12px; }
.candidate-list li { padding: 14px; border: 1px solid var(--border); border-radius: var(--control-radius); }
.candidate-list span { color: var(--muted); font-size: 12px; }
.guide-links { display: flex; flex-wrap: wrap; gap: 16px; }
a { color: var(--accent); }
[role="alert"] { color: var(--danger, #b42318); }
@media (max-width: 540px) { header { flex-direction: column; } }
</style>
