<script setup lang="ts">
import type { PersonalGitSyncResolution, PersonalGitSyncStatus } from 'craft-hub'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import { ref, watch } from 'vue'
import { api } from './api'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { locale, t } = useI18n()
const store = useWorkbenchStore()
const canOpenSettingsFile = Boolean(window.craftHubDesktop?.openSettingsFile)
const canChooseGitRepository = Boolean(window.craftHubDesktop?.selectProjectDirectory)
const replaceOnImport = ref(false)
const transferError = ref('')
const transferring = ref(false)
const cleanupMessage = ref('')
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
const gitDirectory = ref('.craft-hub')
const gitSyncBusy = ref(false)

watch(() => props.open, (open) => {
  if (open)
    void Promise.all([refreshCloudStatus(), refreshGitSyncStatus()])
}, { immediate: true })

async function refreshGitSyncStatus(): Promise<void> {
  gitSyncStatus.value = await api.personalGitSyncStatus()
  gitRepositoryPath.value = gitSyncStatus.value.target?.repositoryPath ?? gitRepositoryPath.value
  gitDirectory.value = gitSyncStatus.value.target?.directory ?? gitDirectory.value
}

async function configureGitSync(): Promise<void> {
  gitSyncBusy.value = true
  transferError.value = ''
  try {
    gitSyncStatus.value = await api.configurePersonalGitSync(gitRepositoryPath.value.trim(), gitDirectory.value.trim())
  }
  catch (error) {
    transferError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    gitSyncBusy.value = false
  }
}

async function chooseGitRepository(): Promise<void> {
  const selected = await window.craftHubDesktop?.selectProjectDirectory?.()
  if (selected)
    gitRepositoryPath.value = selected
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
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="settings-dialog">
        <header class="settings-header">
          <div>
            <DialogTitle>{{ t('settings') }}</DialogTitle>
            <DialogDescription>{{ t('settingsDescription') }}</DialogDescription>
          </div>
          <button type="button" class="dialog-close" :aria-label="t('close')" @click="emit('update:open', false)">
            <Icon name="close" />
          </button>
        </header>

        <div class="settings-body">
          <div v-if="store.settings?.diagnostic || transferError" class="settings-alerts">
            <p v-if="store.settings?.diagnostic" role="alert">
              {{ t('settingsFileInvalid', { path: store.settings.path, message: store.settings.diagnostic }) }}
            </p>
            <p v-if="transferError" role="alert">{{ transferError }}</p>
          </div>

          <TabsRoot class="settings-tabs" default-value="general" orientation="vertical">
            <TabsList class="settings-tab-list" :aria-label="t('settings')">
              <TabsTrigger value="general">{{ t('settingsGeneral') }}</TabsTrigger>
              <TabsTrigger value="cloud">{{ t('personalCloud') }}</TabsTrigger>
              <TabsTrigger value="history">{{ t('runHistory') }}</TabsTrigger>
              <TabsTrigger value="transfer">{{ t('settingsTransfer') }}</TabsTrigger>
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
              <section class="settings-section">
                <h3>{{ t('personalGitSync') }}</h3>
                <p>{{ t('personalGitSyncDescription') }}</p>
                <form class="git-sync-form" data-testid="personal-git-sync-form" @submit.prevent="configureGitSync">
                  <label>
                    <span>{{ t('gitRepositoryPath') }}</span>
                    <span class="git-repository-entry">
                      <input v-model="gitRepositoryPath" name="git-repository-path" :placeholder="t('gitRepositoryPathPlaceholder')">
                      <button v-if="canChooseGitRepository" type="button" @click="chooseGitRepository">{{ t('chooseGitRepository') }}</button>
                    </span>
                  </label>
                  <label>
                    <span>{{ t('gitSyncDirectory') }}</span>
                    <input v-model="gitDirectory" name="git-sync-directory" placeholder=".craft-hub">
                  </label>
                  <button type="submit" :disabled="gitSyncBusy || !gitRepositoryPath.trim() || !gitDirectory.trim()">{{ t('saveGitSyncTarget') }}</button>
                </form>
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
            </div>
          </TabsRoot>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
