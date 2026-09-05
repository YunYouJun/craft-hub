<script setup lang="ts">
import type { DotfilesManagerStatus, DotfilesOperation, DotfilesOperationResult, PersonalGitSyncResolution, PersonalGitSyncStatus, WorkbenchCodexReasoningEffort, WorkbenchEditorId } from 'craft-hub'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { api } from './api'
import CelebrationSettings from './CelebrationSettings.vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { applicationShortcutReferences, capabilityShortcutId, commandPaletteShortcutId, defaultCommandPaletteShortcut, formatShortcut, shortcutFromKeyboardEvent } from './shortcuts'
import { useWorkbenchStore } from './store'

type SettingsTab = 'cloud' | 'configuration' | 'general' | 'help' | 'history' | 'shortcuts' | 'transfer'

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
const codexActivityStatus = ref<CodexActivityStatus>()
const codexActivityBusy = ref(false)
const activeTab = ref<SettingsTab>(props.initialTab)
let removeUpdateListener: (() => void) | undefined
let removeCodexActivityListener: (() => void) | undefined

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

const shortcutReferenceRows = computed(() => applicationShortcutReferences.map(reference => ({
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

watch([() => props.open, () => props.initialTab], ([open]) => {
  if (open) {
    activeTab.value = props.initialTab
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
  removeUpdateListener = window.craftHubDesktop?.onUpdateStatus?.(status => updateStatus.value = status)
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
  if (canManageUpdates)
    updateStatus.value = await window.craftHubDesktop?.updateStatus?.()
}

async function setAutomaticUpdates(enabled: boolean): Promise<void> {
  updateBusy.value = true
  transferError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop!.setAutomaticUpdates!(enabled)
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    updateBusy.value = false
  }
}

async function checkForUpdates(): Promise<void> {
  updateBusy.value = true
  transferError.value = ''
  try {
    updateStatus.value = await window.craftHubDesktop!.checkForUpdates!()
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
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
  <DialogShell :open="open" content-class="settings-dialog" header-class="settings-header" @update:open="emit('update:open', $event)">
    <template #title>{{ t('settings') }}</template>
    <template #description>{{ t('settingsDescription') }}</template>
    <template #header-actions>
          <button type="button" class="dialog-close" :aria-label="t('close')" @click="emit('update:open', false)">
            <Icon name="close" />
          </button>
    </template>

        <div class="settings-body">
          <div v-if="store.settings?.diagnostic || transferError" class="settings-alerts">
            <p v-if="store.settings?.diagnostic" role="alert">
              {{ t('settingsFileInvalid', { path: store.settings.path, message: store.settings.diagnostic }) }}
            </p>
            <p v-if="transferError" role="alert">{{ transferError }}</p>
          </div>

          <TabsRoot v-model="activeTab" class="settings-tabs" orientation="vertical">
            <TabsList class="settings-tab-list" :aria-label="t('settings')">
              <TabsTrigger value="general">{{ t('settingsGeneral') }}</TabsTrigger>
              <TabsTrigger value="shortcuts">{{ t('keyboardShortcuts') }}</TabsTrigger>
              <TabsTrigger value="cloud">{{ t('personalCloud') }}</TabsTrigger>
              <TabsTrigger value="configuration">{{ t('configurationFiles') }}</TabsTrigger>
              <TabsTrigger value="history">{{ t('runHistory') }}</TabsTrigger>
              <TabsTrigger value="transfer">{{ t('settingsTransfer') }}</TabsTrigger>
              <TabsTrigger value="help">{{ t('help') }}</TabsTrigger>
            </TabsList>

            <div class="settings-tab-panels">
            <TabsContent value="general" class="settings-tab-content">
              <section class="settings-section">
                <h3>{{ t('displayLanguage') }}</h3>
                <p>{{ t('displayLanguageDescription') }}</p>
                <div class="language-options">
                  <button
                    type="button"
                    data-testid="locale-zh-CN"
                    :class="{ active: locale === 'zh-CN' }"
                    :aria-pressed="locale === 'zh-CN'"
                    @click="selectLocale('zh-CN')"
                  >
                    <strong>中文</strong><span>简体中文</span>
                  </button>
                  <button
                    type="button"
                    data-testid="locale-en"
                    :class="{ active: locale === 'en' }"
                    :aria-pressed="locale === 'en'"
                    @click="selectLocale('en')"
                  >
                    <strong>English</strong><span>English</span>
                  </button>
                </div>
              </section>
              <section class="settings-section">
                <h3>{{ t('colorTheme') }}</h3>
                <p>{{ t('colorThemeDescription') }}</p>
                <div class="theme-options">
                  <button
                    v-for="option in (['system', 'light', 'dark'] as const)"
                    :key="option"
                    type="button"
                    :data-testid="`theme-${option}`"
                    :class="{ active: store.settings?.settings['workbench.theme'] === option }"
                    :aria-pressed="store.settings?.settings['workbench.theme'] === option"
                    @click="selectTheme(option)"
                  >
                    <span class="theme-preview" :class="option" aria-hidden="true"><i /><i /></span>
                    <strong>{{ t(option === 'system' ? 'themeSystem' : option === 'light' ? 'themeLight' : 'themeDark') }}</strong>
                  </button>
                </div>
              </section>
              <CelebrationSettings context="settings" />
              <section class="settings-section editor-settings repository-root-settings">
                <h3>{{ t('localRepositoriesRoot') }}</h3>
                <p>{{ t('localRepositoriesRootDescription') }}</p>
                <label>
                  <span>{{ t('repositoriesRoot') }}</span>
                  <span class="settings-path-entry">
                    <input v-model="repositoriesRoot" data-testid="repositories-root" :placeholder="t('repositoriesRootPlaceholder')">
                    <button v-if="canChooseGitRepository" type="button" data-testid="choose-repositories-root" @click="chooseRepositoriesRoot">{{ t('chooseGitRepository') }}</button>
                  </span>
                </label>
                <button type="button" class="settings-save-button" data-testid="save-repositories-root" :disabled="repositoriesRootSaving" @click="saveRepositoriesRoot">
                  {{ repositoriesRootSaving ? t('saving') : t('save') }}
                </button>
              </section>
              <section class="settings-section editor-settings">
                <h3>{{ t('defaultEditor') }}</h3>
                <p>{{ t('defaultEditorDescription') }}</p>
                <label>
                  <span>{{ t('editor') }}</span>
                  <select v-model="editorId" data-testid="default-editor">
                    <option value="vscode">VS Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="custom">{{ t('customEditor') }}</option>
                  </select>
                </label>
                <div class="custom-editor-fields">
                  <label>
                    <span>{{ t('editorName') }}</span>
                    <input v-model="customEditorName" data-testid="custom-editor-name" :placeholder="t('editorNamePlaceholder')">
                  </label>
                  <label>
                    <span>{{ t('editorCommand') }}</span>
                    <input v-model="customEditorCommand" data-testid="custom-editor-command" :placeholder="t('editorCommandPlaceholder')">
                  </label>
                  <label class="editor-args-field">
                    <span>{{ t('editorArguments') }}</span>
                    <textarea v-model="customEditorArgs" data-testid="custom-editor-args" rows="3" :placeholder="t('editorArgumentsPlaceholder')" />
                  </label>
                </div>
                <p class="editor-settings-hint">{{ t('editorArgumentsHint') }}</p>
                <button type="button" class="settings-save-button" data-testid="save-editor-setting" :disabled="editorSaving" @click="saveEditorSetting">
                  {{ editorSaving ? t('saving') : t('saveEditorSetting') }}
                </button>
              </section>
              <section class="settings-section editor-settings">
                <h3>{{ t('codexTaskDefaults') }}</h3>
                <p>{{ t('codexTaskDefaultsDescription') }}</p>
                <div class="custom-editor-fields">
                  <label>
                    <span>{{ t('codexModel') }}</span>
                    <input v-model="codexModel" data-testid="codex-model" :placeholder="t('codexModelPlaceholder')">
                  </label>
                  <label>
                    <span>{{ t('codexReasoningEffort') }}</span>
                    <select v-model="codexReasoningEffort" data-testid="codex-reasoning-effort">
                      <option value="">{{ t('inheritCodexDefault') }}</option>
                      <option v-for="effort in (['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const)" :key="effort" :value="effort">
                        {{ effort }}
                      </option>
                    </select>
                  </label>
                </div>
                <p class="editor-settings-hint">{{ t('codexTaskDefaultsHint') }}</p>
                <button type="button" class="settings-save-button" data-testid="save-codex-setting" :disabled="codexSaving" @click="saveCodexSetting">
                  {{ codexSaving ? t('saving') : t('saveCodexDefaults') }}
                </button>
              </section>
              <section v-if="canManageCodexActivity" class="settings-section codex-activity-settings">
                <h3>{{ t('codexActivity') }}</h3>
                <p>{{ t('codexActivityDescription') }}</p>
                <div class="desktop-update-status">
                  <span>
                    <strong>{{ t(codexActivityStatus?.installed ? 'codexActivityEnabled' : 'codexActivityDisabled') }}</strong>
                    <small>{{ t('codexActivityRunning', { count: String(codexActivityStatus?.runningSessionIds.length ?? 0) }) }}</small>
                  </span>
                  <UiButton
                    :disabled="codexActivityBusy || !codexActivityStatus?.supported"
                    data-testid="toggle-codex-activity"
                    @click="setCodexActivityHooks(!codexActivityStatus?.installed)"
                  >
                    {{ t(codexActivityStatus?.installed ? 'disable' : 'enable') }}
                  </UiButton>
                </div>
                <p v-if="codexActivityStatus?.requiresTrustReview" class="settings-note">{{ t('codexActivityTrustReview') }}</p>
                <p v-if="codexActivityStatus?.diagnostic" class="error-message" role="alert">{{ codexActivityStatus.diagnostic }}</p>
              </section>
              <section v-if="canManageUpdates" class="settings-section desktop-update-settings">
                <h3>{{ t('softwareUpdates') }}</h3>
                <p>{{ t('softwareUpdatesDescription') }}</p>
                <label class="settings-replace-option">
                  <input
                    type="checkbox"
                    :checked="updateStatus?.automaticCheck"
                    :disabled="updateBusy"
                    data-testid="automatic-updates"
                    @change="setAutomaticUpdates(($event.target as HTMLInputElement).checked)"
                  >
                  {{ t('checkUpdatesAutomatically') }}
                </label>
                <div class="desktop-update-status">
                  <span><strong>{{ updateStatusLabel() }}</strong><small>{{ t('currentVersion', { version: updateStatus?.currentVersion ?? '—' }) }}</small></span>
                  <UiButton :disabled="updateBusy || updateStatus?.phase === 'checking' || updateStatus?.phase === 'downloaded'" data-testid="check-for-updates" @click="checkForUpdates">
                    {{ t('checkNow') }}
                  </UiButton>
                </div>
                <p v-if="updateStatus?.message" class="error-message" role="alert">{{ updateStatus.message }}</p>
              </section>
            </TabsContent>

            <TabsContent value="shortcuts" class="settings-tab-content">
              <section class="settings-section shortcut-settings">
                <h3>{{ t('keyboardShortcuts') }}</h3>
                <p>{{ t('keyboardShortcutsDescription') }}</p>
                <label class="shortcut-search">
                  <Icon name="search" />
                  <input v-model="shortcutQuery" :placeholder="t('searchShortcutCommands')">
                </label>
                <p v-if="shortcutError" class="error-message" role="alert">{{ shortcutError }}</p>
                <div class="shortcut-list">
                  <div v-for="row in shortcutRows" :key="row.id" class="shortcut-row">
                    <span><strong>{{ row.label }}</strong><small>{{ row.description }}</small></span>
                    <button
                      type="button"
                      class="shortcut-recorder"
                      :class="{ recording: recordingShortcutId === row.id }"
                      :data-testid="`shortcut-${row.id}`"
                      @click="recordingShortcutId = row.id; shortcutError = ''"
                      @keydown.stop.prevent="onShortcutKeydown($event, row.id)"
                    >
                      {{ recordingShortcutId === row.id ? t('pressShortcut') : shortcutFor(row.id) ? formatShortcut(shortcutFor(row.id)) : t('addShortcut') }}
                    </button>
                    <button v-if="shortcutFor(row.id)" type="button" class="shortcut-clear" :aria-label="t('clearShortcut', { command: row.label })" :title="t('clearShortcut', { command: row.label })" @click="clearShortcut(row.id)">
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
              </section>
              <section class="settings-section shortcut-reference-section">
                <h3>{{ t('applicationShortcutReference') }}</h3>
                <p>{{ t('applicationShortcutReferenceDescription') }}</p>
                <div class="shortcut-reference-list" :aria-label="t('applicationShortcutReference')">
                  <div v-for="row in shortcutReferenceRows" :key="row.id" class="shortcut-reference-row">
                    <span><strong>{{ row.label }}</strong><small>{{ row.description }}</small></span>
                    <span class="shortcut-reference-keys">
                      <kbd v-for="shortcut in row.shortcuts" :key="shortcut">{{ shortcut }}</kbd>
                    </span>
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="cloud" class="settings-tab-content">
              <section class="settings-section">
                <h3>{{ t('personalCloud') }}</h3>
                <p>{{ t('personalCloudDescription') }}</p>
                <div class="cloud-connection-track" :data-state="cloudStatus.state">
                  <span class="cloud-status-dot" aria-hidden="true" />
                  <div>
                    <strong>{{ cloudStateLabel() }}</strong>
                    <small v-if="cloudStatus.deviceId">{{ t('personalCloudDevice', { id: cloudStatus.deviceId }) }}</small>
                    <small v-if="cloudStatus.lastSyncAt">{{ t('personalCloudLastSync', { time: cloudStatus.lastSyncAt }) }}</small>
                    <small v-if="cloudStatus.diagnostic" role="alert">{{ cloudStatus.diagnostic }}</small>
                  </div>
                  <div class="settings-transfer-actions">
                    <button v-if="cloudStatus.state === 'disconnected' || cloudStatus.state === 'error'" type="button" :disabled="cloudBusy" @click="cloudAction('connect')">{{ t('connectPersonalCloud') }}</button>
                    <button v-if="cloudStatus.state === 'connected'" type="button" :disabled="cloudBusy" @click="cloudAction('synchronize')">{{ t('syncNow') }}</button>
                    <button v-if="cloudStatus.state === 'connected' || cloudStatus.state === 'connecting'" type="button" :disabled="cloudBusy" @click="cloudAction('disconnect')">{{ t('disconnectPersonalCloud') }}</button>
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="configuration" class="settings-tab-content">
              <section class="settings-section">
                <h3>{{ t('localConfiguration') }}</h3>
                <p>{{ t('localConfigurationDescription') }}</p>
                <div class="git-sync-status" :data-state="userConfigStatus?.diagnostics.length ? 'conflict' : 'clean'">
                  <div>
                    <strong>{{ userConfigStatus?.diagnostics.length ? t('localConfigurationInvalid') : t('localConfigurationReady') }}</strong>
                    <small v-if="userConfigStatus">{{ userConfigStatus.configDir }}</small>
                    <small v-if="userConfigStatus?.migrationBackupPath">{{ t('localConfigurationMigrated', { path: userConfigStatus.migrationBackupPath }) }}</small>
                    <small v-for="diagnostic in userConfigStatus?.diagnostics ?? []" :key="diagnostic.path" role="alert">{{ diagnostic.path }}: {{ diagnostic.message }}</small>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <h3>{{ t('personalConfigurationRepository') }}</h3>
                <p>{{ t('personalConfigurationRepositoryDescription') }}</p>
                <form class="git-sync-form personal-repository-form" data-testid="personal-git-sync-form" @submit.prevent="configureGitSync">
                  <label>
                    <span>{{ t('gitRepositoryPath') }}</span>
                    <span class="git-repository-entry">
                      <input v-model="gitRepositoryPath" name="git-repository-path" :placeholder="t('gitRepositoryPathPlaceholder')">
                      <button v-if="canChooseGitRepository" type="button" @click="chooseGitRepository">{{ t('chooseGitRepository') }}</button>
                    </span>
                  </label>
                  <button type="submit" :disabled="gitSyncBusy || !gitRepositoryPath.trim()">{{ t('saveGitSyncTarget') }}</button>
                </form>
              </section>

              <section class="settings-section">
                <h3>{{ t('personalGitSync') }}</h3>
                <p>{{ t('personalGitSyncDescription') }}</p>
                <div class="git-sync-status" :data-state="gitSyncStatus.state">
                  <div>
                    <strong>{{ gitSyncStateLabel() }}</strong>
                    <small v-if="gitSyncStatus.snapshotPath">{{ gitSyncStatus.snapshotPath }}</small>
                    <small v-if="gitSyncStatus.workingTreeChanged">{{ t('gitSyncPendingCommit') }}</small>
                  </div>
                  <div v-if="gitSyncStatus.state !== 'unconfigured'" class="settings-transfer-actions">
                    <button v-if="gitSyncStatus.state !== 'conflict'" type="button" :disabled="gitSyncBusy" @click="synchronizeGit()">{{ t('syncNow') }}</button>
                    <template v-else>
                      <button type="button" :disabled="gitSyncBusy" @click="synchronizeGit('use-local')">{{ t('useLocalConfiguration') }}</button>
                      <button type="button" :disabled="gitSyncBusy" @click="synchronizeGit('use-repository')">{{ t('useRepositoryConfiguration') }}</button>
                    </template>
                  </div>
                </div>
              </section>

              <section class="settings-section">
                <h3>{{ t('dotfilesManager') }}</h3>
                <p>{{ t('dotfilesManagerDescription') }}</p>
                <div class="git-sync-status" :data-state="dotfilesStatus.state === 'ready' ? 'clean' : dotfilesStatus.state === 'untrusted' ? 'conflict' : ''">
                  <div>
                    <strong>{{ dotfilesStateLabel() }}</strong>
                    <small v-if="dotfilesStatus.manifestPath">{{ dotfilesStatus.manifestPath }}</small>
                    <small v-if="dotfilesStatus.manifest?.name">{{ dotfilesStatus.manifest.name }}</small>
                    <small v-for="(command, operation) in dotfilesStatus.manifest?.operations ?? {}" :key="operation" class="dotfiles-command">
                      <code>{{ operation }}</code>
                      <span>· {{ command?.command }} {{ command?.args.join(' ') }}</span>
                    </small>
                  </div>
                  <div class="settings-transfer-actions">
                    <button v-if="dotfilesStatus.state === 'untrusted'" type="button" :disabled="dotfilesBusy" data-testid="trust-dotfiles" @click="trustDotfiles">{{ t('trustDotfilesSource') }}</button>
                    <template v-if="dotfilesStatus.state === 'ready'">
                      <button v-for="operation in readonlyDotfilesOperations" v-show="dotfilesStatus.manifest?.operations[operation]" :key="operation" type="button" :disabled="dotfilesBusy" :data-testid="`run-dotfiles-${operation}`" @click="runDotfilesOperation(operation)">{{ dotfilesOperationLabel(operation) }}</button>
                    </template>
                    <button v-if="canOpenDotfilesInTerminal && dotfilesStatus.repositoryPath" type="button" :disabled="dotfilesBusy" @click="openDotfilesInTerminal">{{ t('openInTerminal') }}</button>
                  </div>
                </div>
                <pre v-if="dotfilesResult" class="dotfiles-output" :data-succeeded="dotfilesResult.succeeded"><code>{{ dotfilesResult.stdout }}{{ dotfilesResult.stderr }}{{ dotfilesResult.error && !dotfilesResult.stderr ? dotfilesResult.error : '' }}</code></pre>
              </section>
            </TabsContent>

            <TabsContent value="history" class="settings-tab-content">
              <section class="settings-section">
                <h3>{{ t('runHistory') }}</h3>
                <p>{{ t('runHistoryDescription') }}</p>
                <div class="settings-transfer-actions">
                  <button type="button" @click="cleanupRuns(false)">{{ t('cleanupExpiredLogs') }}</button>
                  <button type="button" @click="cleanupRuns(true)">{{ t('cleanupAllLogs') }}</button>
                </div>
                <p v-if="cleanupMessage">{{ cleanupMessage }}</p>
              </section>
            </TabsContent>

            <TabsContent value="transfer" class="settings-tab-content">
              <section class="settings-section">
                <h3>{{ t('settingsTransfer') }}</h3>
                <p>{{ t('settingsTransferDescription') }}</p>
                <div class="settings-transfer-actions">
                  <button type="button" :disabled="transferring" @click="downloadSettings('minimal')">{{ t('exportMinimalSettings') }}</button>
                  <button type="button" :disabled="transferring" @click="downloadSettings('full')">{{ t('exportFullSettings') }}</button>
                  <label class="settings-import-button">
                    {{ t('importSettings') }}
                    <input type="file" accept="application/json,.json" :disabled="transferring" @change="importSettings">
                  </label>
                  <button v-if="canOpenSettingsFile" type="button" :disabled="transferring" @click="openSettingsFile">{{ t('openSettingsJson') }}</button>
                </div>
                <label class="settings-replace-option">
                  <input v-model="replaceOnImport" type="checkbox">
                  {{ t('replaceSettingsOnImport') }}
                </label>
              </section>
            </TabsContent>

            <TabsContent value="help" class="settings-tab-content">
              <CelebrationSettings context="help" />
            </TabsContent>
            </div>
          </TabsRoot>
        </div>
  </DialogShell>
</template>
