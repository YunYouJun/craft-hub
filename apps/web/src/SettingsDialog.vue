<script setup lang="ts">
import type { DotfilesManagerStatus, DotfilesOperation, DotfilesOperationResult, PersonalGitSyncResolution, PersonalGitSyncStatus, WorkbenchCodexReasoningEffort, WorkbenchEditorId } from 'craft-hub'
import type { IconName } from './icons'
import { useMediaQuery } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import AgentConnectionSettings from './AgentConnectionSettings.vue'
import CelebrationSettings from './CelebrationSettings.vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { SettingsRow, SettingsSection, SettingsStatus } from './components/ui/settings'
import { Switch } from './components/ui/switch'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'
import { Icon } from './icons'
import { useI18n } from './i18n'
import SidebarIcon from './SidebarIcon.vue'
import { applicationShortcutReferencesForPlatform, capabilityShortcutId, commandPaletteShortcutId, defaultCommandPaletteShortcut, formatShortcut, shortcutFromKeyboardEvent } from './shortcuts'
import { useWorkbenchStore } from './store'

type SettingsTab = 'agents' | 'cloud' | 'configuration' | 'general' | 'help' | 'history' | 'shortcuts' | 'transfer'

const props = withDefaults(defineProps<{ initialTab?: SettingsTab, open: boolean }>(), {
  initialTab: 'general',
})
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { locale, t } = useI18n()
const store = useWorkbenchStore()
const canOpenSettingsFile = Boolean(window.craftHubDesktop?.openSettingsFile)
const canChooseGitRepository = Boolean(window.craftHubDesktop?.selectProjectDirectory)
const canOpenDotfilesInTerminal = Boolean(window.craftHubDesktop?.openDotfilesInTerminal)
const canManageUpdates = Boolean(window.craftHubDesktop?.updateStatus)
const canManageCodexActivity = Boolean(window.craftHubDesktop?.codexActivityStatus)
const replaceOnImport = ref(false)
const settingsImportInput = ref<HTMLInputElement>()
const transferError = ref('')
const transferring = ref(false)
const cleanupMessage = ref('')
const shortcutQuery = ref('')
const recordingShortcutId = ref('')
const shortcutError = ref('')
const editorId = ref<WorkbenchEditorId>('vscode')
const customEditorName = ref('')
const customEditorCommand = ref('')
const customEditorArgs = ref('{path}')
const editorSaving = ref(false)
const repositoriesRoot = ref('')
const repositoriesRootSaving = ref(false)
const codexModel = ref('')
const codexReasoningEffort = ref<WorkbenchCodexReasoningEffort | ''>('')
const codexSaving = ref(false)
interface CloudStatus {
  state: 'disabled' | 'disconnected' | 'connecting' | 'connected' | 'error'
  deviceId?: string
  lastSyncAt?: string
  diagnostic?: string
}
const cloudStatus = ref<CloudStatus>({ state: 'disabled' })
const cloudBusy = ref(false)
const gitSyncStatus = ref<PersonalGitSyncStatus>({ state: 'unconfigured' })
const gitRepositoryPath = ref('')
const gitSyncBusy = ref(false)
const userConfigStatus = computed(() => store.userConfigStatus)
const dotfilesStatus = ref<DotfilesManagerStatus>({ state: 'unconfigured' })
const dotfilesBusy = ref(false)
const dotfilesResult = ref<DotfilesOperationResult>()
const readonlyDotfilesOperations: DotfilesOperation[] = ['check', 'status', 'diff']
const updateStatus = ref<DesktopUpdateStatus>()
const updateBusy = ref(false)
const updateError = ref('')
const updateInFlight = computed(() => updateBusy.value || updateStatus.value?.phase === 'checking' || updateStatus.value?.phase === 'available')
const updateSupported = computed(() => Boolean(updateStatus.value && updateStatus.value.phase !== 'unsupported'))
const automaticUpdatesDisabled = computed(() => !updateSupported.value || updateInFlight.value || !window.craftHubDesktop?.setAutomaticUpdates)
const checkUpdatesDisabled = computed(() => !updateSupported.value || updateInFlight.value || updateStatus.value?.phase === 'downloaded' || !window.craftHubDesktop?.checkForUpdates)
const installUpdateDisabled = computed(() => !updateSupported.value || updateBusy.value || updateStatus.value?.phase !== 'downloaded' || !window.craftHubDesktop?.installUpdate)
const codexActivityStatus = ref<CodexActivityStatus>()
const codexActivityBusy = ref(false)
const activeTab = ref<SettingsTab>(props.initialTab)
const horizontalNavigation = useMediaQuery('(max-width: 620px)')
const settingsNavigation = ref<HTMLElement>()
const settingsTabs = computed(() => [
  { value: 'general', icon: 'settings', label: t('settingsGeneral') },
  { value: 'agents', icon: 'link', label: t('agentConnection') },
  { value: 'shortcuts', icon: 'keyboard', label: t('keyboardShortcuts') },
  { value: 'cloud', icon: 'cloud', label: t('personalCloud') },
  { value: 'configuration', icon: 'docs', label: t('configurationFiles') },
  { value: 'history', icon: 'list', label: t('runHistory') },
  { value: 'transfer', icon: 'transfer', label: t('settingsTransfer') },
  { value: 'help', icon: 'help', label: t('help') },
] satisfies { value: SettingsTab, icon: IconName, label: string }[])
const activeTabTitle = computed(() => settingsTabs.value.find(tab => tab.value === activeTab.value)?.label ?? t('settings'))
let removeUpdateListener: (() => void) | undefined
let removeCodexActivityListener: (() => void) | undefined

async function keepSelectedTabVisible(): Promise<void> {
  if (!props.open || !horizontalNavigation.value)
    return
  await nextTick()
  settingsNavigation.value?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

watch([activeTab, () => props.open, horizontalNavigation], keepSelectedTabVisible, { flush: 'post' })

const shortcutRows = computed(() => {
  const query = shortcutQuery.value.trim().toLowerCase()
  const paletteRow = {
    id: commandPaletteShortcutId,
    label: t('showCommandPalette'),
    description: t('showCommandPaletteDescription'),
  }
  const commandRows = store.paletteItems
    .filter(item => item.capability.kind === 'command')
    .map(item => ({
      id: capabilityShortcutId(item.project.id, item.capability.id),
      projectId: item.project.id,
      label: item.capability.name,
      description: `${item.project.name} · ${item.capability.kind === 'command' ? item.capability.package?.relativePath ?? item.capability.source : item.capability.source}`,
    }))
  if (query) {
    const terms = query.split(/\s+/).filter(Boolean)
    return [paletteRow, ...commandRows]
      .filter(row => terms.every(term => `${row.label} ${row.description}`.toLowerCase().includes(term)))
      .slice(0, 100)
  }
  const configured = new Set(Object.keys(store.settings?.settings['workbench.shortcuts'] ?? {}))
  return [paletteRow, ...commandRows.filter(row => row.projectId === store.selectedProjectId || configured.has(row.id)).slice(0, 100)]
})

const shortcutReferenceRows = computed(() => applicationShortcutReferencesForPlatform().map(reference => ({
  ...reference,
  label: t(`shortcutReference_${reference.id}`),
  description: t(`shortcutReference_${reference.id}Description`),
  shortcuts: reference.shortcuts.map(shortcut => formatShortcut(shortcut)),
})))

function shortcutFor(id: string): string {
  if (id === commandPaletteShortcutId)
    return store.settings?.settings['workbench.shortcuts']?.[id] ?? defaultCommandPaletteShortcut
  return store.settings?.settings['workbench.shortcuts']?.[id] ?? ''
}

async function saveShortcut(id: string, shortcut: string): Promise<void> {
  const current = {
    [commandPaletteShortcutId]: shortcutFor(commandPaletteShortcutId),
    ...store.settings?.settings['workbench.shortcuts'],
  }
  const conflict = Object.entries(current).find(([otherId, value]) => otherId !== id && value === shortcut)
  if (conflict) {
    shortcutError.value = t('shortcutConflict', { shortcut: formatShortcut(shortcut) })
    return
  }
  shortcutError.value = ''
  try {
    await store.updateShortcuts({ ...current, [id]: shortcut })
    recordingShortcutId.value = ''
  }
  catch (error) {
    shortcutError.value = error instanceof Error ? error.message : String(error)
  }
}

async function clearShortcut(id: string): Promise<void> {
  const next: Record<string, string> = {
    [commandPaletteShortcutId]: shortcutFor(commandPaletteShortcutId),
    ...store.settings?.settings['workbench.shortcuts'],
  }
  if (id === commandPaletteShortcutId)
    next[id] = defaultCommandPaletteShortcut
  else
    delete next[id]
  shortcutError.value = ''
  recordingShortcutId.value = ''
  try {
    await store.updateShortcuts(next)
  }
  catch (error) {
    shortcutError.value = error instanceof Error ? error.message : String(error)
  }
}

function onShortcutKeydown(event: KeyboardEvent, id: string): void {
  if (event.key === 'Escape') {
    recordingShortcutId.value = ''
    shortcutError.value = ''
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    void clearShortcut(id)
    return
  }
  const shortcut = shortcutFromKeyboardEvent(event)
  if (shortcut)
    void saveShortcut(id, shortcut)
}

watch([() => props.open, () => props.initialTab], ([open, initialTab], previous) => {
  if (!previous || initialTab !== previous[1])
    activeTab.value = initialTab
  if (open) {
    shortcutQuery.value = ''
    recordingShortcutId.value = ''
    shortcutError.value = ''
    const editor = store.settings?.settings['workbench.editor']
    editorId.value = editor?.default ?? 'vscode'
    customEditorName.value = editor?.custom?.name ?? ''
    customEditorCommand.value = editor?.custom?.command ?? ''
    customEditorArgs.value = editor?.custom?.args.join('\n') ?? '{path}'
    repositoriesRoot.value = store.settings?.settings['workbench.repositoriesRoot'] ?? ''
    const codex = store.settings?.settings['workbench.codex']
    codexModel.value = codex?.model ?? ''
    codexReasoningEffort.value = codex?.reasoningEffort ?? ''
    void Promise.all([refreshCloudStatus(), refreshGitSyncStatus(), refreshUserConfigStatus(), refreshDotfilesStatus(), refreshUpdateStatus(), refreshCodexActivityStatus()])
  }
}, { immediate: true })

onMounted(() => {
  void keepSelectedTabVisible()
  removeUpdateListener = window.craftHubDesktop?.onUpdateStatus?.((status) => {
    updateStatus.value = status
    updateError.value = ''
  })
  removeCodexActivityListener = window.craftHubDesktop?.onCodexActivityStatus?.(status => codexActivityStatus.value = status)
})

onUnmounted(() => {
  removeUpdateListener?.()
  removeCodexActivityListener?.()
})

async function refreshCodexActivityStatus(): Promise<void> {
  if (canManageCodexActivity)
    codexActivityStatus.value = await window.craftHubDesktop?.codexActivityStatus?.()
}

async function setCodexActivityHooks(enabled: boolean): Promise<void> {
  codexActivityBusy.value = true
  transferError.value = ''
  try {
    codexActivityStatus.value = enabled
      ? await window.craftHubDesktop?.installCodexActivityHooks?.()
      : await window.craftHubDesktop?.uninstallCodexActivityHooks?.()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    codexActivityBusy.value = false
  }
}

async function refreshUpdateStatus(): Promise<void> {
  if (!canManageUpdates)
    return
  updateError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop?.updateStatus?.()
  }
  catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error)
  }
}

async function setAutomaticUpdates(enabled: boolean): Promise<void> {
  if (automaticUpdatesDisabled.value)
    return
  updateBusy.value = true
  updateError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop!.setAutomaticUpdates!(enabled)
  }
  catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    updateBusy.value = false
  }
}

async function checkForUpdates(): Promise<void> {
  if (checkUpdatesDisabled.value)
    return
  updateBusy.value = true
  updateError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop!.checkForUpdates!()
  }
  catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    updateBusy.value = false
  }
}

async function installUpdate(): Promise<void> {
  if (installUpdateDisabled.value)
    return
  updateBusy.value = true
  updateError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop!.installUpdate!()
  }
  catch (error) {
    updateError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    updateBusy.value = false
  }
}

function updateStatusLabel(): string {
  const phase = updateStatus.value?.phase ?? 'idle'
  return t(phase === 'up-to-date' ? 'updateStatus_upToDate' : `updateStatus_${phase}`)
}

async function refreshGitSyncStatus(): Promise<void> {
  gitSyncStatus.value = await api.personalGitSyncStatus()
  gitRepositoryPath.value = gitSyncStatus.value.target?.repositoryPath ?? gitRepositoryPath.value
}

async function refreshUserConfigStatus(): Promise<void> {
  await store.loadUserConfigStatus()
}

async function refreshDotfilesStatus(): Promise<void> {
  dotfilesStatus.value = await api.dotfilesManagerStatus()
  gitRepositoryPath.value = dotfilesStatus.value.repositoryPath ?? gitRepositoryPath.value
}

async function trustDotfiles(): Promise<void> {
  dotfilesBusy.value = true
  transferError.value = ''
  try {
    dotfilesStatus.value = await api.trustDotfilesManager()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    dotfilesBusy.value = false
  }
}

async function runDotfilesOperation(operation: DotfilesOperation): Promise<void> {
  dotfilesBusy.value = true
  transferError.value = ''
  try {
    dotfilesResult.value = await api.runDotfilesOperation(operation)
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    dotfilesBusy.value = false
  }
}

function dotfilesStateLabel(): string {
  if (dotfilesStatus.value.state === 'ready')
    return t('dotfilesManagerState_ready')
  if (dotfilesStatus.value.state === 'untrusted')
    return t('dotfilesManagerState_untrusted')
  if (dotfilesStatus.value.state === 'unsupported-platform')
    return t('dotfilesManagerState_unsupportedPlatform')
  if (dotfilesStatus.value.state === 'manifest-missing')
    return t('dotfilesManagerState_manifestMissing')
  return t('dotfilesManagerState_unconfigured')
}

function dotfilesOperationLabel(operation: DotfilesOperation): string {
  if (operation === 'check')
    return t('dotfilesOperation_check')
  if (operation === 'status')
    return t('dotfilesOperation_status')
  return t('dotfilesOperation_diff')
}

async function openDotfilesInTerminal(): Promise<void> {
  try {
    await window.craftHubDesktop?.openDotfilesInTerminal?.()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
}

async function configureGitSync(): Promise<void> {
  gitSyncBusy.value = true
  transferError.value = ''
  try {
    gitSyncStatus.value = await api.configurePersonalGitSync(gitRepositoryPath.value.trim(), '.craft-hub')
    dotfilesResult.value = undefined
    await refreshDotfilesStatus()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    gitSyncBusy.value = false
  }
}

async function chooseGitRepository(): Promise<void> {
  const selected = await window.craftHubDesktop?.selectProjectDirectory?.(store.repositoriesRoot)
  if (selected)
    gitRepositoryPath.value = selected
}

async function chooseRepositoriesRoot(): Promise<void> {
  const selected = await window.craftHubDesktop?.selectProjectDirectory?.(repositoriesRoot.value.trim() || store.repositoriesRoot)
  if (selected)
    repositoriesRoot.value = selected
}

async function saveRepositoriesRoot(): Promise<void> {
  repositoriesRootSaving.value = true
  transferError.value = ''
  try {
    await store.updateRepositoriesRoot(repositoriesRoot.value)
    repositoriesRoot.value = store.repositoriesRoot ?? ''
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    repositoriesRootSaving.value = false
  }
}

async function synchronizeGit(resolution: PersonalGitSyncResolution = 'auto'): Promise<void> {
  gitSyncBusy.value = true
  transferError.value = ''
  try {
    gitSyncStatus.value = await api.synchronizePersonalGit(resolution)
    await store.loadWorkspaces()
    await store.loadSettings()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    gitSyncBusy.value = false
  }
}

function gitSyncStateLabel(): string {
  if (gitSyncStatus.value.state === 'clean')
    return t('personalGitSyncState_clean')
  if (gitSyncStatus.value.state === 'local-ahead')
    return t('personalGitSyncState_localAhead')
  if (gitSyncStatus.value.state === 'repository-ahead')
    return t('personalGitSyncState_repositoryAhead')
  if (gitSyncStatus.value.state === 'conflict')
    return t('personalGitSyncState_conflict')
  return t('personalGitSyncState_unconfigured')
}

async function refreshCloudStatus(): Promise<void> {
  cloudStatus.value = await window.craftHubDesktop?.cloudStatus?.() ?? { state: 'disabled' }
}

async function cloudAction(action: 'connect' | 'disconnect' | 'synchronize'): Promise<void> {
  cloudBusy.value = true
  transferError.value = ''
  try {
    if (action === 'connect')
      await window.craftHubDesktop?.cloudConnect?.()
    else if (action === 'disconnect')
      await window.craftHubDesktop?.cloudDisconnect?.()
    else
      await window.craftHubDesktop?.cloudSynchronize?.()
    await refreshCloudStatus()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
    await refreshCloudStatus()
  }
  finally {
    cloudBusy.value = false
  }
}

function cloudStateLabel(): string {
  if (cloudStatus.value.state === 'connected')
    return t('personalCloudState_connected')
  if (cloudStatus.value.state === 'connecting')
    return t('personalCloudState_connecting')
  if (cloudStatus.value.state === 'disconnected')
    return t('personalCloudState_disconnected')
  if (cloudStatus.value.state === 'error')
    return t('personalCloudState_error')
  return t('personalCloudState_disabled')
}

async function selectLocale(value: 'en' | 'zh-CN'): Promise<void> {
  transferError.value = ''
  try {
    await store.updateLocale(value)
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
}

async function selectTheme(value: 'system' | 'light' | 'dark'): Promise<void> {
  transferError.value = ''
  try {
    await store.updateTheme(value)
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
}

async function saveEditorSetting(): Promise<void> {
  transferError.value = ''
  editorSaving.value = true
  try {
    const args = customEditorArgs.value.split('\n').map(value => value.trim()).filter(Boolean)
    const custom = customEditorName.value.trim() || customEditorCommand.value.trim()
      ? { name: customEditorName.value.trim(), command: customEditorCommand.value.trim(), args }
      : undefined
    if (editorId.value === 'custom' && !custom)
      throw new Error(t('customEditorRequired'))
    await store.updateEditorSetting({ default: editorId.value, ...(custom ? { custom } : {}) })
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    editorSaving.value = false
  }
}

async function saveCodexSetting(): Promise<void> {
  transferError.value = ''
  codexSaving.value = true
  try {
    const model = codexModel.value.trim()
    await store.updateCodexSetting({
      ...(model ? { model } : {}),
      ...(codexReasoningEffort.value ? { reasoningEffort: codexReasoningEffort.value } : {}),
    })
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    codexSaving.value = false
  }
}

async function downloadSettings(mode: 'minimal' | 'full'): Promise<void> {
  transferring.value = true
  transferError.value = ''
  try {
    const document = await api.exportSettings(mode)
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = `craft-hub-settings-${mode}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  catch (error) {
    transferError.value = t('exportSettingsFailed', { message: error instanceof Error ? error.message : String(error) })
  }
  finally {
    transferring.value = false
  }
}

async function importSettings(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  transferring.value = true
  transferError.value = ''
  try {
    const document = JSON.parse(await file.text()) as unknown
    const strategy = replaceOnImport.value ? 'replace' : 'merge'
    const preview = await api.previewSettingsImport(document, strategy)
    if (!window.confirm(t('importSettingsPreview', { count: String(preview.changes.length) })))
      return
    if (!store.settings)
      await store.loadSettings()
    await store.applySettings(await api.importSettings(document, strategy, store.settings!.revision))
  }
  catch (error) {
    transferError.value = t('importSettingsFailed', { message: error instanceof Error ? error.message : String(error) })
  }
  finally {
    transferring.value = false
  }
}

async function openSettingsFile(): Promise<void> {
  try {
    await window.craftHubDesktop?.openSettingsFile?.()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
}

async function cleanupRuns(includeAllUnpinned: boolean): Promise<void> {
  transferError.value = ''
  cleanupMessage.value = ''
  try {
    const olderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const options = { includeAllUnpinned, olderThan: includeAllUnpinned ? undefined : olderThan }
    const preview = await api.cleanupRuns({ ...options, preview: true })
    if (!preview.count) {
      cleanupMessage.value = t('nothingToClean')
      return
    }
    if (!window.confirm(t('confirmLogCleanup', { count: String(preview.count), size: `${(preview.bytes / 1024 / 1024).toFixed(1)} MB` })))
      return
    const result = await api.cleanupRuns(options)
    cleanupMessage.value = t('logCleanupComplete', { count: String(result.count), size: `${(result.bytes / 1024 / 1024).toFixed(1)} MB` })
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <DialogShell :open="open" :aria-label="t('settings')" content-class="settings-dialog" header-class="settings-header" description-class="settings-description-sr-only" @update:open="emit('update:open', $event)">
    <template #title><span class="settings-description-sr-only">{{ t('settings') }} · </span>{{ activeTabTitle }}</template>
    <template #description>{{ t('settingsDescription') }}</template>
    <template #header-actions>
      <UiButton variant="ghost" size="icon" :aria-label="t('close')" @click="emit('update:open', false)">
        <Icon name="close" />
      </UiButton>
    </template>

    <div class="settings-body">
      <div v-if="store.settings?.diagnostic || transferError" class="settings-alerts">
        <p v-if="store.settings?.diagnostic" role="alert">
          {{ t('settingsFileInvalid', { path: store.settings.path, message: store.settings.diagnostic }) }}
        </p>
        <p v-if="transferError" role="alert">{{ transferError }}</p>
      </div>

      <TabsRoot v-model="activeTab" class="settings-tabs" :orientation="horizontalNavigation ? 'horizontal' : 'vertical'">
        <div ref="settingsNavigation" class="settings-navigation">
          <TabsList variant="sidebar" class="settings-tab-list" :aria-label="t('settings')">
            <TabsTrigger v-for="tab in settingsTabs" :key="tab.value" :value="tab.value" :title="tab.label" :aria-label="tab.label">
              <template #icon><SidebarIcon :name="tab.icon" :active="activeTab === tab.value" /></template>
              <template #default><span class="ui-navigation-label">{{ tab.label }}</span></template>
            </TabsTrigger>
          </TabsList>
        </div>

        <div class="settings-tab-panels">
          <TabsContent value="agents" class="settings-tab-content"><AgentConnectionSettings /></TabsContent>
          <TabsContent value="general" class="settings-tab-content">
            <SettingsSection :title="t('displayLanguage')" :description="t('displayLanguageDescription')">
              <SettingsRow :label="t('displayLanguage')">
                <template #control>
                  <div class="settings-choice-options language-options" :aria-label="t('displayLanguage')" role="group">
                    <UiButton size="compact" data-testid="locale-zh-CN" :class="{ active: locale === 'zh-CN' }" :aria-pressed="locale === 'zh-CN'" @click="selectLocale('zh-CN')">中文</UiButton>
                    <UiButton size="compact" data-testid="locale-en" :class="{ active: locale === 'en' }" :aria-pressed="locale === 'en'" @click="selectLocale('en')">English</UiButton>
                  </div>
                </template>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection :title="t('colorTheme')" :description="t('colorThemeDescription')">
              <SettingsRow :label="t('colorTheme')">
                <template #control>
                  <div class="settings-choice-options theme-options" :aria-label="t('colorTheme')" role="group">
                    <UiButton
                      v-for="option in (['system', 'light', 'dark'] as const)"
                      :key="option"
                      size="compact"
                      :data-testid="`theme-${option}`"
                      :class="{ active: store.settings?.settings['workbench.theme'] === option }"
                      :aria-pressed="store.settings?.settings['workbench.theme'] === option"
                      @click="selectTheme(option)"
                    >
                      {{ t(option === 'system' ? 'themeSystem' : option === 'light' ? 'themeLight' : 'themeDark') }}
                    </UiButton>
                  </div>
                </template>
              </SettingsRow>
            </SettingsSection>
            <CelebrationSettings context="settings" />
            <SettingsSection class="repository-root-settings" :title="t('localRepositoriesRoot')" :description="t('localRepositoriesRootDescription')">
              <template #controls>
                <UiButton size="compact" data-testid="save-repositories-root" :disabled="repositoriesRootSaving" @click="saveRepositoriesRoot">{{ repositoriesRootSaving ? t('saving') : t('save') }}</UiButton>
              </template>
              <SettingsRow :label="t('repositoriesRoot')" control-id="settings-repositories-root" orientation="vertical">
                <template #control>
                  <div class="settings-path-entry">
                    <Input id="settings-repositories-root" v-model="repositoriesRoot" data-testid="repositories-root" :placeholder="t('repositoriesRootPlaceholder')" />
                    <UiButton v-if="canChooseGitRepository" size="compact" data-testid="choose-repositories-root" @click="chooseRepositoriesRoot">{{ t('chooseGitRepository') }}</UiButton>
                  </div>
                </template>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection :title="t('defaultEditor')" :description="t('defaultEditorDescription')">
              <template #controls>
                <UiButton size="compact" data-testid="save-editor-setting" :disabled="editorSaving" @click="saveEditorSetting">{{ editorSaving ? t('saving') : t('saveEditorSetting') }}</UiButton>
              </template>
              <SettingsRow :label="t('editor')" control-id="settings-default-editor">
                <template #control>
                  <select class="ui-form-control" id="settings-default-editor" v-model="editorId" data-testid="default-editor">
                    <option value="vscode">VS Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="custom">{{ t('customEditor') }}</option>
                  </select>
                </template>
              </SettingsRow>
              <SettingsRow :label="t('editorName')" control-id="settings-custom-editor-name">
                <template #control><Input id="settings-custom-editor-name" v-model="customEditorName" data-testid="custom-editor-name" :placeholder="t('editorNamePlaceholder')" /></template>
              </SettingsRow>
              <SettingsRow :label="t('editorCommand')" control-id="settings-custom-editor-command">
                <template #control><Input id="settings-custom-editor-command" v-model="customEditorCommand" data-testid="custom-editor-command" :placeholder="t('editorCommandPlaceholder')" /></template>
              </SettingsRow>
              <SettingsRow :label="t('editorArguments')" control-id="settings-custom-editor-args" orientation="vertical">
                <template #control><Textarea id="settings-custom-editor-args" v-model="customEditorArgs" data-testid="custom-editor-args" rows="3" :placeholder="t('editorArgumentsPlaceholder')" /></template>
              </SettingsRow>
              <template #footer>{{ t('editorArgumentsHint') }}</template>
            </SettingsSection>
            <SettingsSection :title="t('codexTaskDefaults')" :description="t('codexTaskDefaultsDescription')">
              <template #controls>
                <UiButton size="compact" data-testid="save-codex-setting" :disabled="codexSaving" @click="saveCodexSetting">{{ codexSaving ? t('saving') : t('saveCodexDefaults') }}</UiButton>
              </template>
              <SettingsRow :label="t('codexModel')" control-id="settings-codex-model">
                <template #control><Input id="settings-codex-model" v-model="codexModel" data-testid="codex-model" :placeholder="t('codexModelPlaceholder')" /></template>
              </SettingsRow>
              <SettingsRow :label="t('codexReasoningEffort')" control-id="settings-codex-reasoning-effort">
                <template #control>
                  <select class="ui-form-control" id="settings-codex-reasoning-effort" v-model="codexReasoningEffort" data-testid="codex-reasoning-effort">
                    <option value="">{{ t('inheritCodexDefault') }}</option>
                    <option v-for="effort in (['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const)" :key="effort" :value="effort">{{ effort }}</option>
                  </select>
                </template>
              </SettingsRow>
              <template #footer>{{ t('codexTaskDefaultsHint') }}</template>
            </SettingsSection>
            <SettingsSection v-if="canManageCodexActivity" class="codex-activity-settings" :title="t('codexActivity')" :description="t('codexActivityDescription')">
              <SettingsStatus :title="t(codexActivityStatus?.installed ? 'codexActivityEnabled' : 'codexActivityDisabled')" :description="t('codexActivityRunning', { count: String(codexActivityStatus?.runningSessionIds.length ?? 0) })" :tone="codexActivityStatus?.installed ? 'success' : 'neutral'">
                <template #actions>
                  <UiButton size="compact" :disabled="codexActivityBusy || !codexActivityStatus?.supported" data-testid="toggle-codex-activity" @click="setCodexActivityHooks(!codexActivityStatus?.installed)">{{ t(codexActivityStatus?.installed ? 'disable' : 'enable') }}</UiButton>
                </template>
              </SettingsStatus>
              <template v-if="codexActivityStatus?.requiresTrustReview || codexActivityStatus?.diagnostic" #footer>
                <p v-if="codexActivityStatus?.requiresTrustReview">{{ t('codexActivityTrustReview') }}</p>
                <p v-if="codexActivityStatus?.diagnostic" class="error-message" role="alert">{{ codexActivityStatus.diagnostic }}</p>
              </template>
            </SettingsSection>
            <SettingsSection v-if="canManageUpdates" class="desktop-update-settings" :title="t('softwareUpdates')" :description="t('softwareUpdatesDescription')">
              <SettingsRow :label="t('checkUpdatesAutomatically')" control-id="settings-automatic-updates">
                <template #control="{ labelId }">
                  <Switch id="settings-automatic-updates" :aria-labelledby="labelId" :model-value="Boolean(updateStatus?.automaticCheck)" :disabled="automaticUpdatesDisabled" data-testid="automatic-updates" @update:model-value="setAutomaticUpdates(Boolean($event))" />
                </template>
              </SettingsRow>
              <SettingsStatus class="desktop-update-status" :title="updateStatusLabel()" :description="t('currentVersion', { version: updateStatus?.currentVersion ?? '—' })" :tone="updateStatus?.phase === 'error' ? 'danger' : updateStatus?.phase === 'downloaded' || updateStatus?.phase === 'up-to-date' ? 'success' : 'neutral'" role="status" aria-live="polite">
                <template #metadata>
                  <small v-if="updateStatus?.releaseName">{{ t('updateRelease', { release: updateStatus.releaseName }) }}</small>
                  <progress v-if="updateStatus?.phase === 'available'" :aria-label="t('updateStatus_available')" data-testid="update-download-progress" />
                </template>
                <template #actions>
                  <UiButton v-if="updateStatus?.phase === 'downloaded'" size="compact" :disabled="installUpdateDisabled" data-testid="install-update" @click="installUpdate">{{ t('restartAndInstallUpdate') }}</UiButton>
                  <UiButton v-else size="compact" :disabled="checkUpdatesDisabled" data-testid="check-for-updates" @click="checkForUpdates">{{ t('checkNow') }}</UiButton>
                </template>
              </SettingsStatus>
              <template v-if="updateError || updateStatus?.message" #footer>
                <p :class="updateError || updateStatus?.phase === 'error' ? 'error-message' : undefined" :role="updateError || updateStatus?.phase === 'error' ? 'alert' : undefined">{{ updateError || updateStatus?.message }}</p>
              </template>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="shortcuts" class="settings-tab-content">
            <SettingsSection class="shortcut-settings" :title="t('keyboardShortcuts')" :description="t('keyboardShortcutsDescription')">
              <label class="shortcut-search">
                <Icon name="search" />
                <input v-model="shortcutQuery" :aria-label="t('searchShortcutCommands')" :placeholder="t('searchShortcutCommands')">
              </label>
              <p v-if="shortcutError" class="error-message" role="alert">{{ shortcutError }}</p>
              <SettingsRow v-for="row in shortcutRows" :key="row.id" :label="row.label" :description="row.description">
                <template #control>
                  <div class="settings-row-actions">
                    <UiButton size="compact" class="shortcut-recorder" :class="{ recording: recordingShortcutId === row.id }" :data-testid="`shortcut-${row.id}`" :aria-label="`${row.label}: ${recordingShortcutId === row.id ? t('pressShortcut') : shortcutFor(row.id) ? formatShortcut(shortcutFor(row.id)) : t('addShortcut')}`" @click="recordingShortcutId = row.id; shortcutError = ''" @keydown.stop.prevent="onShortcutKeydown($event, row.id)">
                      {{ recordingShortcutId === row.id ? t('pressShortcut') : shortcutFor(row.id) ? formatShortcut(shortcutFor(row.id)) : t('addShortcut') }}
                    </UiButton>
                    <UiButton v-if="shortcutFor(row.id)" variant="ghost" size="icon" class="shortcut-clear" :aria-label="t('clearShortcut', { command: row.label })" :title="t('clearShortcut', { command: row.label })" @click="clearShortcut(row.id)"><Icon name="close" /></UiButton>
                  </div>
                </template>
              </SettingsRow>
            </SettingsSection>
            <SettingsSection class="shortcut-reference-section" :title="t('applicationShortcutReference')" :description="t('applicationShortcutReferenceDescription')">
              <SettingsRow v-for="row in shortcutReferenceRows" :key="row.id" class="shortcut-reference-row" :label="row.label" :description="row.description">
                <template #control>
                  <span class="shortcut-reference-keys"><kbd v-for="shortcut in row.shortcuts" :key="shortcut">{{ shortcut }}</kbd></span>
                </template>
              </SettingsRow>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="cloud" class="settings-tab-content">
            <SettingsSection :title="t('personalCloud')" :description="t('personalCloudDescription')">
              <SettingsStatus class="cloud-connection-track" :data-state="cloudStatus.state" :title="cloudStateLabel()" :tone="cloudStatus.state === 'connected' ? 'success' : cloudStatus.state === 'error' ? 'danger' : 'neutral'">
                <template #metadata>
                  <small v-if="cloudStatus.deviceId">{{ t('personalCloudDevice', { id: cloudStatus.deviceId }) }}</small>
                  <small v-if="cloudStatus.lastSyncAt">{{ t('personalCloudLastSync', { time: cloudStatus.lastSyncAt }) }}</small>
                  <small v-if="cloudStatus.diagnostic" class="error-message" role="alert">{{ cloudStatus.diagnostic }}</small>
                </template>
                <template #actions>
                  <UiButton v-if="cloudStatus.state === 'disconnected' || cloudStatus.state === 'error'" size="compact" :disabled="cloudBusy" @click="cloudAction('connect')">{{ t('connectPersonalCloud') }}</UiButton>
                  <UiButton v-if="cloudStatus.state === 'connected'" size="compact" :disabled="cloudBusy" @click="cloudAction('synchronize')">{{ t('syncNow') }}</UiButton>
                  <UiButton v-if="cloudStatus.state === 'connected' || cloudStatus.state === 'connecting'" size="compact" :disabled="cloudBusy" @click="cloudAction('disconnect')">{{ t('disconnectPersonalCloud') }}</UiButton>
                </template>
              </SettingsStatus>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="configuration" class="settings-tab-content">
            <SettingsSection :title="t('localConfiguration')" :description="t('localConfigurationDescription')">
              <SettingsStatus class="git-sync-status" :data-state="userConfigStatus?.diagnostics.length ? 'conflict' : 'clean'" :title="userConfigStatus?.diagnostics.length ? t('localConfigurationInvalid') : t('localConfigurationReady')" :description="userConfigStatus?.configDir" :tone="userConfigStatus?.diagnostics.length ? 'danger' : 'success'">
                <template #metadata>
                  <small v-if="userConfigStatus?.migrationBackupPath">{{ t('localConfigurationMigrated', { path: userConfigStatus.migrationBackupPath }) }}</small>
                  <small v-for="diagnostic in userConfigStatus?.diagnostics ?? []" :key="diagnostic.path" class="error-message" role="alert">{{ diagnostic.path }}: {{ diagnostic.message }}</small>
                </template>
              </SettingsStatus>
            </SettingsSection>
            <SettingsSection v-if="store.hostEnvironment.capabilities.localGitSync" :title="t('personalConfigurationRepository')" :description="t('personalConfigurationRepositoryDescription')">
              <form data-testid="personal-git-sync-form" @submit.prevent="configureGitSync">
                <SettingsRow :label="t('gitRepositoryPath')" control-id="settings-git-repository-path" orientation="vertical">
                  <template #control>
                    <div class="settings-path-entry">
                      <Input id="settings-git-repository-path" v-model="gitRepositoryPath" name="git-repository-path" :placeholder="t('gitRepositoryPathPlaceholder')" />
                      <UiButton v-if="canChooseGitRepository" size="compact" @click="chooseGitRepository">{{ t('chooseGitRepository') }}</UiButton>
                      <UiButton type="submit" size="compact" :disabled="gitSyncBusy || !gitRepositoryPath.trim()">{{ t('saveGitSyncTarget') }}</UiButton>
                    </div>
                  </template>
                </SettingsRow>
              </form>
            </SettingsSection>
            <SettingsSection v-if="store.hostEnvironment.capabilities.localGitSync" :title="t('personalGitSync')" :description="t('personalGitSyncDescription')">
              <SettingsStatus class="git-sync-status" :data-state="gitSyncStatus.state" :title="gitSyncStateLabel()" :description="gitSyncStatus.snapshotPath" :tone="gitSyncStatus.state === 'conflict' ? 'danger' : gitSyncStatus.state === 'clean' ? 'success' : 'neutral'">
                <template #metadata><small v-if="gitSyncStatus.workingTreeChanged">{{ t('gitSyncPendingCommit') }}</small></template>
                <template v-if="gitSyncStatus.state !== 'unconfigured'" #actions>
                  <UiButton v-if="gitSyncStatus.state !== 'conflict'" size="compact" :disabled="gitSyncBusy" @click="synchronizeGit()">{{ t('syncNow') }}</UiButton>
                  <template v-else>
                    <UiButton size="compact" :disabled="gitSyncBusy" @click="synchronizeGit('use-local')">{{ t('useLocalConfiguration') }}</UiButton>
                    <UiButton size="compact" :disabled="gitSyncBusy" @click="synchronizeGit('use-repository')">{{ t('useRepositoryConfiguration') }}</UiButton>
                  </template>
                </template>
              </SettingsStatus>
            </SettingsSection>
            <SettingsSection v-if="store.hostEnvironment.capabilities.localGitSync" :title="t('dotfilesManager')" :description="t('dotfilesManagerDescription')">
              <SettingsStatus class="git-sync-status" :data-state="dotfilesStatus.state === 'ready' ? 'clean' : dotfilesStatus.state === 'untrusted' ? 'conflict' : ''" :title="dotfilesStateLabel()" :description="dotfilesStatus.manifestPath" :tone="dotfilesStatus.state === 'ready' ? 'success' : dotfilesStatus.state === 'untrusted' ? 'warning' : 'neutral'">
                <template #metadata>
                  <small v-if="dotfilesStatus.manifest?.name">{{ dotfilesStatus.manifest.name }}</small>
                  <small v-for="(command, operation) in dotfilesStatus.manifest?.operations ?? {}" :key="operation" class="dotfiles-command"><code>{{ operation }}</code><span>· {{ command?.command }} {{ command?.args.join(' ') }}</span></small>
                </template>
                <template #actions>
                  <UiButton v-if="dotfilesStatus.state === 'untrusted'" size="compact" :disabled="dotfilesBusy" data-testid="trust-dotfiles" @click="trustDotfiles">{{ t('trustDotfilesSource') }}</UiButton>
                  <template v-if="dotfilesStatus.state === 'ready'">
                    <UiButton v-for="operation in readonlyDotfilesOperations" v-show="dotfilesStatus.manifest?.operations[operation]" :key="operation" size="compact" :disabled="dotfilesBusy" :data-testid="`run-dotfiles-${operation}`" @click="runDotfilesOperation(operation)">{{ dotfilesOperationLabel(operation) }}</UiButton>
                  </template>
                  <UiButton v-if="canOpenDotfilesInTerminal && dotfilesStatus.repositoryPath" size="compact" :disabled="dotfilesBusy" @click="openDotfilesInTerminal">{{ t('openInTerminal') }}</UiButton>
                </template>
              </SettingsStatus>
              <template v-if="dotfilesResult" #footer>
                <pre class="dotfiles-output" :data-succeeded="dotfilesResult.succeeded"><code>{{ dotfilesResult.stdout }}{{ dotfilesResult.stderr }}{{ dotfilesResult.error && !dotfilesResult.stderr ? dotfilesResult.error : '' }}</code></pre>
              </template>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="history" class="settings-tab-content">
            <SettingsSection :title="t('runHistory')" :description="t('runHistoryDescription')">
              <SettingsRow :label="t('cleanupExpiredLogs')">
                <template #control><UiButton size="compact" @click="cleanupRuns(false)">{{ t('cleanupExpiredLogs') }}</UiButton></template>
              </SettingsRow>
              <SettingsRow :label="t('cleanupAllLogs')">
                <template #control><UiButton size="compact" @click="cleanupRuns(true)">{{ t('cleanupAllLogs') }}</UiButton></template>
              </SettingsRow>
              <template v-if="cleanupMessage" #footer><p role="status">{{ cleanupMessage }}</p></template>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="transfer" class="settings-tab-content">
            <SettingsSection :title="t('settingsTransfer')" :description="t('settingsTransferDescription')">
              <SettingsRow :label="t('exportMinimalSettings')">
                <template #control><UiButton size="compact" :disabled="transferring" @click="downloadSettings('minimal')">{{ t('exportMinimalSettings') }}</UiButton></template>
              </SettingsRow>
              <SettingsRow :label="t('exportFullSettings')">
                <template #control><UiButton size="compact" :disabled="transferring" @click="downloadSettings('full')">{{ t('exportFullSettings') }}</UiButton></template>
              </SettingsRow>
              <SettingsRow :label="t('importSettings')">
                <template #control>
                  <UiButton size="compact" :disabled="transferring" @click="settingsImportInput?.click()">{{ t('importSettings') }}</UiButton>
                  <input ref="settingsImportInput" type="file" class="settings-import-input" accept="application/json,.json" :disabled="transferring" tabindex="-1" aria-hidden="true" @change="importSettings">
                </template>
              </SettingsRow>
              <SettingsRow :label="t('replaceSettingsOnImport')" control-id="settings-replace-import">
                <template #control="{ labelId }"><Switch id="settings-replace-import" v-model="replaceOnImport" :aria-labelledby="labelId" /></template>
              </SettingsRow>
              <SettingsRow v-if="canOpenSettingsFile" :label="t('openSettingsJson')">
                <template #control><UiButton size="compact" :disabled="transferring" @click="openSettingsFile">{{ t('openSettingsJson') }}</UiButton></template>
              </SettingsRow>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="help" class="settings-tab-content">
            <SettingsSection v-if="store.documentationUrl" :title="t('help')">
              <SettingsRow :label="t('help')">
                <template #control><a :href="store.documentationUrl" target="_blank" rel="noopener noreferrer">{{ t('help') }} <Icon name="externalLink" /></a></template>
              </SettingsRow>
            </SettingsSection>
            <CelebrationSettings context="help" />
          </TabsContent>
        </div>
      </TabsRoot>
    </div>
  </DialogShell>
</template>
