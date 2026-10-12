<script setup lang="ts">
import type { PersonalWorkbenchHome, PersonalWorkbenchTool } from 'craft-hub'
import { personalWorkbenchHomeSchema } from 'craft-hub/personal-workbench'
import { computed, ref, watch } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import { websiteToolIcon } from './tool-icons'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ openNavigation: [] }>()
const store = useWorkbenchStore()
const { locale } = useI18n()
const zh = computed(() => locale.value === 'zh-CN')
const copy = (chinese: string, english: string) => zh.value ? chinese : english
const query = ref('')
const home = computed<PersonalWorkbenchHome>(() => store.settings?.settings['workbench.home'] ?? { tools: [] })
const settingsError = ref('')
const saving = ref(false)
const editing = ref(false)
const draft = ref<PersonalWorkbenchTool[]>([])
const draftRevision = ref('')
const editorError = ref('')
const toolsError = computed(() => settingsError.value || (store.settingsLoadState === 'error' ? copy('无法读取工具设置，请重试。', 'Could not load tool settings. Please retry.') : ''))
const toolsLoading = computed(() => !store.settings && !toolsError.value)
const keyword = computed(() => query.value.trim().toLocaleLowerCase())
const matches = (...values: Array<string | undefined>) => !keyword.value || values.some(value => value?.toLocaleLowerCase().includes(keyword.value))
const toolGroups = computed(() => {
  const groups = new Map<string, PersonalWorkbenchTool[]>()
  const tools = props.compact ? home.value.tools.slice(0, 6) : home.value.tools
  for (const tool of tools) {
    if (!matches(tool.title, tool.url, tool.downloadUrl, tool.repositoryUrl, displayGroup(tool.group), tool.group, tool.description))
      continue
    groups.set(tool.group, [...(groups.get(tool.group) ?? []), tool])
  }
  return [...groups].map(([title, tools]) => ({ title, tools }))
})
const displayGroup = (title: string) => title === 'AI Tools' ? copy('AI 工具', 'AI tools') : title === 'Work tools' ? copy('执行工具', 'Work tools') : title
const openingToolId = ref('')
const supportsNativeTools = Boolean(window.craftHubDesktop?.openWorkbenchTool)
const toolNotice = ref('')
const toolError = ref('')
const failedToolUrl = ref('')
async function openTool(tool: PersonalWorkbenchTool, event: MouseEvent): Promise<void> {
  if (!tool.launch || !window.craftHubDesktop?.openWorkbenchTool || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return
  event.preventDefault()
  if (openingToolId.value)
    return
  openingToolId.value = tool.id
  toolNotice.value = ''
  toolError.value = ''
  failedToolUrl.value = ''
  try {
    const result = await window.craftHubDesktop.openWorkbenchTool(tool.id)
    toolNotice.value = result.destination === 'application'
      ? tool.launch.application === 'raycast' && tool.launch.commandUrl
        ? copy(`已请求运行 ${tool.title} 配置的 Raycast 命令。上下文未自动传入，请在目标工具中确认结果。`, `Requested the configured Raycast command for ${tool.title}. Context was not sent; confirm the result in the target tool.`)
        : copy(`已请求打开 ${tool.title}。请在目标工具中确认打开结果；工作上下文需要单独粘贴。`, `Requested ${tool.title}. Confirm it opened in the target tool; paste work context separately.`)
      : copy(`已打开 ${tool.title} 网站；本机应用未能启动。`, `Opened the ${tool.title} website; the local application could not be launched.`)
  }
  catch {
    toolError.value = copy('打开工具失败，请使用网站入口重试。', 'Could not open the tool. Try its website link.')
    failedToolUrl.value = tool.url
  }
  finally { openingToolId.value = '' }
}
function setLaunch(tool: PersonalWorkbenchTool, event: Event): void {
  const application = (event.target as HTMLSelectElement).value
  if (application === 'raycast' || application === 'orca')
    tool.launch = { application }
  else
    delete tool.launch
}
function domain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

async function ensureSettings(): Promise<void> {
  settingsError.value = ''
  try { await store.loadSettings() }
  catch { settingsError.value = copy('无法读取工具设置，请重试。', 'Could not load tool settings. Please retry.') }
}
// App owns initial settings loading; revision events update the home in place.
watch(() => store.settings, (value) => {
  if (value)
    settingsError.value = ''
})
async function openEditor(): Promise<void> {
  if (!store.settings)
    await ensureSettings()
  if (!store.settings)
    return
  draft.value = home.value.tools.map(tool => ({ ...tool, ...(tool.launch ? { launch: { ...tool.launch } } : {}) }))
  draftRevision.value = store.settings.revision
  editorError.value = ''
  editing.value = true
}
function addTool(): void {
  draft.value.push({ id: crypto.randomUUID(), title: '', url: '', group: 'AI Tools' })
}
async function saveTools(): Promise<void> {
  if (saving.value || !store.settings)
    return
  const tools = draft.value.map((tool) => {
    const next = { ...tool }
    if (!next.downloadUrl?.trim())
      delete next.downloadUrl
    if (!next.repositoryUrl?.trim())
      delete next.repositoryUrl
    if (next.launch?.application === 'raycast' && !next.launch.commandUrl?.trim())
      next.launch = { application: 'raycast' }
    return next
  })
  const result = personalWorkbenchHomeSchema.safeParse({ ...home.value, tools })
  if (!result.success) {
    editorError.value = copy('请填写名称、分组和有效的 HTTPS 链接（不能包含账号密码）；Raycast 命令需使用不带参数的 raycast://extensions/作者/扩展/命令 链接。', 'Enter a name, group and valid HTTPS URL without embedded credentials. Raycast commands require a raycast://extensions/owner/extension/command URL without parameters.')
    return
  }
  saving.value = true
  editorError.value = ''
  try {
    await store.applySettings(await api.updateSettings({ 'workbench.home': result.data }, draftRevision.value))
    editing.value = false
  }
  catch {
    editorError.value = copy('保存失败。设置可能已在别处修改；草稿已保留，请重新载入后再编辑。', 'Save failed. Settings may have changed elsewhere. Your draft is retained; reload settings before editing again.')
  }
  finally { saving.value = false }
}
async function reloadDraft(): Promise<void> {
  await ensureSettings()
  if (!settingsError.value)
    await openEditor()
}
</script>

<template>
  <section class="home-tools" :aria-label="copy('常用工具', 'Favorite tools')" :class="{ compact }">
    <div class="home-section-heading"><h2>{{ compact ? copy('常用工具', 'Favorite tools') : copy('已收藏工具', 'Saved tools') }}</h2><button v-if="compact" class="home-text-button" data-testid="view-all-tools" @click="emit('openNavigation')">{{ copy('查看全部工具', 'View all tools') }}<Icon name="arrowRight" /></button><UiButton v-else :disabled="saving" @click="openEditor"><Icon name="edit" />{{ copy('自定义工具', 'Customize tools') }}</UiButton></div>
    <p v-if="!compact" class="home-hint">{{ copy('快捷启动交给 Raycast，编码会话交给 Orca。这里保留工作上下文和来源。', 'Use Raycast for quick actions and Orca for coding sessions. Keep work context and sources here.') }}</p>
    <label v-if="!compact" class="home-search"><Icon name="search" /><input v-model="query" type="search" :aria-label="copy('搜索工具', 'Search tools')" :placeholder="copy('搜索工具…', 'Search tools…')"></label>
    <p v-if="toolsLoading" class="home-hint" role="status">{{ copy('正在读取工具设置…', 'Loading tool settings…') }}</p>
    <p v-if="toolsError" class="home-error" role="alert">{{ toolsError }} <button class="home-text-button" @click="ensureSettings">{{ copy('重试', 'Retry') }}</button></p>
    <div class="home-tool-groups">
      <section v-for="group in toolGroups" :key="group.title" class="home-tool-group"><h3>{{ displayGroup(group.title) }}</h3><div class="home-tool-grid">
        <div v-for="tool in group.tools" :key="tool.id" class="home-tool-card">
          <a class="home-tool" :href="tool.url" target="_blank" rel="noopener noreferrer" :title="tool.description || tool.url" :aria-busy="openingToolId === tool.id" @click="openTool(tool, $event)">
            <span class="home-tool-mark" aria-hidden="true"><Icon :name="websiteToolIcon(tool.url)" /></span><span class="home-tool-copy"><strong>{{ tool.title }}</strong><small>{{ tool.launch ? (supportsNativeTools ? (tool.launch.application === 'raycast' && tool.launch.commandUrl ? copy('运行已配置的 Raycast 命令', 'Run configured Raycast command') : copy('打开本机应用', 'Open local application')) : copy('浏览器模式 · 打开网站', 'Browser mode · Open website')) : tool.description || domain(tool.url) }}</small></span><Icon :name="openingToolId === tool.id ? 'loading' : 'externalLink'" />
          </a>
          <div v-if="tool.downloadUrl || tool.repositoryUrl" class="home-tool-links">
            <a v-if="tool.downloadUrl" :href="tool.downloadUrl" target="_blank" rel="noopener noreferrer" :aria-label="`${copy('下载', 'Download')} ${tool.title}`">{{ copy('下载', 'Download') }}<Icon name="externalLink" /></a>
            <a v-if="tool.repositoryUrl" :href="tool.repositoryUrl" target="_blank" rel="noopener noreferrer" :aria-label="`${copy('GitHub / 源码', 'GitHub / source')} ${tool.title}`">{{ copy('GitHub / 源码', 'GitHub / source') }}<Icon name="externalLink" /></a>
          </div>
        </div>
      </div></section>
    </div>
    <div v-if="!toolsLoading && !toolGroups.length" class="home-empty-inline"><Icon name="web" /><p>{{ query ? copy('没有匹配的工具，试试其他关键词。', 'No matching tools. Try another search.') : copy('添加常用工具，让这里成为你的工作入口。', 'Add your favorite tools to make this your starting point.') }}</p><button v-if="!query" class="home-text-button" @click="compact ? emit('openNavigation') : openEditor()">{{ copy('添加工具', 'Add tool') }}</button></div>
    <p v-if="toolNotice" class="home-hint" role="status">{{ toolNotice }}</p>
    <p v-if="toolError" class="home-error" role="alert">{{ toolError }} <a :href="failedToolUrl" target="_blank" rel="noopener noreferrer">{{ copy('打开网站', 'Open website') }}</a></p>
  </section>

  <DialogShell :open="editing" layout="panel" content-class="dialog-content home-tools-dialog" @update:open="value => { if (!saving) editing = value }">
    <template #title>{{ copy('自定义工具', 'Customize tools') }}</template>
    <template #description>{{ copy('配置网站或本机执行工具。浏览器模式使用 HTTPS 网站入口，设置保存在本机。', 'Configure websites or local work tools. Browser mode uses the HTTPS website destination. Settings stay on this device.') }}</template>
    <template #header-actions><button class="home-icon-button" :disabled="saving" :aria-label="copy('关闭', 'Close')" @click="editing = false"><Icon name="close" /></button></template>
    <form id="home-tools-form" class="home-tools-form" @submit.prevent="saveTools">
      <fieldset v-for="(tool, index) in draft" :key="tool.id" :disabled="saving" class="home-tool-editor"><legend>{{ copy('工具', 'Tool') }} {{ index + 1 }}</legend><label>{{ copy('名称', 'Name') }}<input v-model="tool.title" required maxlength="128" :placeholder="copy('工具名称', 'Tool name')"></label><label>{{ copy('分组', 'Group') }}<input v-model="tool.group" required maxlength="64" list="home-tool-groups"></label><label class="home-url-field">{{ copy('打开方式', 'Open with') }}<select :value="tool.launch?.application || 'website'" @change="setLaunch(tool, $event)"><option value="website">{{ copy('网站', 'Website') }}</option><option value="raycast">Raycast</option><option value="orca">Orca</option></select></label><label class="home-url-field">{{ copy('网站入口（浏览器回退）', 'Website destination (browser fallback)') }}<input v-model="tool.url" required type="url" maxlength="4096" placeholder="https://example.com"></label><label class="home-url-field">{{ copy('下载链接（可选）', 'Download URL (optional)') }}<input v-model="tool.downloadUrl" type="url" maxlength="4096" name="downloadUrl" placeholder="https://example.com/download"></label><label class="home-url-field">{{ copy('GitHub / 源码链接（可选）', 'GitHub / source URL (optional)') }}<input v-model="tool.repositoryUrl" type="url" maxlength="4096" name="repositoryUrl" placeholder="https://github.com/owner/repository"></label><label v-if="tool.launch?.application === 'raycast'" class="home-url-field">{{ copy('Raycast 命令链接（可选）', 'Raycast command deeplink (optional)') }}<input v-model="tool.launch.commandUrl" maxlength="4096" placeholder="raycast://extensions/owner/extension/command"><span>{{ copy('从已安装命令复制 Deeplink，留空则打开 Raycast。不支持链接参数。', 'Copy Deeplink from an installed command. Leave blank to open Raycast. URL parameters are not supported.') }}</span></label><label class="home-url-field">{{ copy('描述（可选）', 'Description (optional)') }}<input v-model="tool.description" maxlength="512"></label><button type="button" class="home-remove-tool" @click="draft.splice(index, 1)">{{ copy('删除工具', 'Remove tool') }}</button></fieldset>
      <datalist id="home-tool-groups"><option v-for="group in [...new Set(draft.map(tool => tool.group))]" :key="group" :value="group" /></datalist>
      <UiButton type="button" :disabled="saving || draft.length >= 100" @click="addTool"><Icon name="plus" />{{ copy('添加工具', 'Add tool') }}</UiButton>
      <p v-if="!draft.length" class="home-hint">{{ copy('尚无常用工具，可添加网站或本机应用。', 'No favorite tools yet. Add a website or local application.') }}</p>
      <p v-if="editorError" class="home-error" role="alert">{{ editorError }}<button type="button" class="home-text-button" :disabled="saving" @click="reloadDraft">{{ copy('重新载入', 'Reload') }}</button></p>
    </form>
    <template #footer><UiButton :disabled="saving" @click="editing = false">{{ copy('取消', 'Cancel') }}</UiButton><UiButton type="submit" form="home-tools-form" variant="primary" :disabled="saving">{{ saving ? copy('保存中…', 'Saving…') : copy('保存', 'Save') }}</UiButton></template>
  </DialogShell>
</template>

<style scoped>
.home-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; margin-bottom: 12px; }
.home-section-heading h2 { margin: 0; font-size: var(--font-size-subheading); font-weight: 600; line-height: 22px; }
.home-text-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 28px; border: 0; border-radius: 4px; padding: 3px 0; background: none; color: var(--accent); font: inherit; font-size: var(--font-size-control); cursor: pointer; }
.home-text-button:hover { text-decoration: underline; }
.home-text-button > .app-icon { flex: none; width: 14px; height: 14px; }
.home-text-button:disabled { opacity: .55; cursor: default; }
.home-empty-inline { display: flex; align-items: center; gap: 10px; padding: 16px 12px; background: var(--surface-subtle); border-radius: var(--control-radius); color: var(--muted); font-size: var(--font-size-caption); line-height: 1.6; }
.home-empty-inline > .app-icon { flex: none; }
.home-empty-inline p { margin: 0; flex: 1; }
.home-hint, .home-error { margin: 8px 0; font-size: var(--font-size-caption); line-height: 1.6; color: var(--muted); overflow-wrap: anywhere; }
.home-error { color: var(--danger); }
.home-hint .home-text-button, .home-error .home-text-button { margin-left: 6px; }
.home-tools > .home-hint:first-of-type { margin: -4px 0 16px; }
.home-tools > .home-search { margin-bottom: 20px; }
.home-search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: var(--control-radius); padding: 0 10px; height: var(--control-height-default); background: var(--surface-subtle); color: var(--muted); }
.home-search > .app-icon { flex: none; width: 15px; height: 15px; }
.home-search input { width: 100%; min-width: 0; border: 0; outline: 0; padding: 0; background: transparent; color: var(--text); font: inherit; font-size: var(--font-size-control); }
.home-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
.home-tool-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 370px), 1fr)); gap: 20px 24px; }
.home-tool-group { min-width: 0; }
.home-tool-group h3 { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font-size: var(--font-size-body); font-weight: 600; line-height: 20px; }
.home-tool-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 8px; }
.home-tool { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 64px; padding: 10px; border: 0; border-radius: var(--control-radius); color: var(--text); background: var(--surface-subtle); text-decoration: none; }
.home-tool:hover { background: var(--surface-hover); }
.home-tool-card { display: flex; flex-direction: column; min-width: 0; border: 0; border-radius: var(--control-radius); background: var(--surface-subtle); }
.home-tool-card:hover, .home-tool-card:focus-within { background: var(--surface-hover); }
.home-tool-card > .home-tool { flex: 1; background: transparent; }
.home-tool-links { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 0 10px 8px 52px; }
.home-tool-links a { display: inline-flex; align-items: center; gap: 4px; min-height: 20px; color: var(--accent); font-size: var(--font-size-caption); text-decoration: none; }
.home-tool-links a:hover { text-decoration: underline; }
.home-tool-links .app-icon { width: 12px; height: 12px; }
.home-tool-mark { display: flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 7px; color: var(--text); background: var(--surface); font-size: 16px; font-weight: 600; }
.home-tool-mark :deep(.app-icon) { width: 22px; height: 22px; }
.home-tool-copy { min-width: 0; flex: 1; }
.home-tool strong, .home-tool small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home-tool strong { font-size: var(--font-size-body); font-weight: 500; line-height: 20px; }
.home-tool small { margin-top: 2px; color: var(--muted); font-size: var(--font-size-caption); line-height: 16px; }
.home-tool > .app-icon { flex: none; width: 13px; height: 13px; color: var(--muted); }
.home-tools-form { display: grid; gap: 16px; }
.home-tool-editor { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--border); border-radius: var(--panel-radius); background: var(--surface); }
.home-tool-editor legend { padding: 0 5px; color: var(--muted); font-size: var(--font-size-control); }
.home-tool-editor label { display: grid; gap: 5px; font-size: var(--font-size-control); color: var(--muted); }
.home-tool-editor input { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--control-radius); height: var(--control-height-default); padding: 4px 8px; background: var(--surface); color: var(--text); font: inherit; }
.home-tool-editor select { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--control-radius); padding: 7px 8px; background: var(--surface); color: var(--text); font: inherit; }
.home-tool-editor select { height: var(--control-height-default); padding-block: 4px; }
.home-tool-editor input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.home-url-field { grid-column: 1 / -1; }
.home-remove-tool { justify-self: start; border: 0; padding: 4px 0; background: none; color: var(--danger); font: inherit; font-size: var(--font-size-control); cursor: pointer; }
.home-tools { min-width: 0; border: 1px solid var(--border); border-radius: var(--panel-radius); padding: 20px; background: var(--surface); }
.home-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 0; border-radius: var(--control-radius); color: var(--muted); background: transparent; cursor: pointer; }
.home-icon-button > .app-icon { width: 15px; height: 15px; }
.home-icon-button:hover { background: var(--surface-hover); color: var(--text); }
.home-icon-button:disabled { opacity: .55; cursor: default; }
.home-text-button:focus-visible, .home-icon-button:focus-visible, .home-tool:focus-visible, .home-tool-links a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 767.9px), (pointer: coarse) { .home-tool-editor input, .home-tool-editor select { font-size: 16px; } }
@media (max-width: 600px) { .home-tools { padding: 16px; } .home-tool-editor { grid-template-columns: 1fr; } .home-tool-grid { grid-template-columns: 1fr; } .home-tool-links { padding-left: 10px; } }
</style>

<style>
.home-tools-dialog { --dialog-panel-width: 600px; }
</style>
