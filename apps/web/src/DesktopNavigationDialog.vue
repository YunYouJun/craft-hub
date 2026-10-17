<script setup lang="ts">
import type { ProjectRecord, ProjectReference } from 'craft-hub'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { copyText } from './clipboard'
import { Alert as UiAlert } from './components/ui/alert'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{
  open: boolean
  matches: ProjectRecord[]
  reference: ProjectReference
  capabilityId?: string
}>()
const emit = defineEmits<{ 'update:open': [value: boolean], 'resolved': [] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const selectedPath = ref('')
const busy = ref(false)
const error = ref('')
const copyState = ref<'copied' | 'failed' | 'idle'>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

/** Show the repository as host and path; the full URL stays in the tooltip and the copied text. */
const repositoryLabel = computed(() => props.reference.repository
  .replace(/^[a-z][\w+.-]*:\/\//i, '')
  .replace(/^[^@/]+@([^:/]+):/, '$1/')
  .replace(/\.git$/, '')
  .replace(/\/$/, ''))
const copyLabel = computed(() => t(copyState.value === 'copied' ? 'desktopLinkRepositoryCopied' : copyState.value === 'failed' ? 'desktopLinkCopyFailed' : 'desktopLinkCopyRepository'))

watch(() => [props.open, props.reference] as const, ([open]) => {
  if (!open)
    return
  selectedPath.value = ''
  error.value = ''
  resetCopyState()
}, { deep: true })

onBeforeUnmount(resetCopyState)

function resetCopyState(): void {
  if (copyResetTimer)
    clearTimeout(copyResetTimer)
  copyResetTimer = undefined
  copyState.value = 'idle'
}

function close(): void {
  if (!busy.value)
    emit('update:open', false)
}

async function copyRepository(): Promise<void> {
  resetCopyState()
  try {
    await copyText(props.reference.repository)
    copyState.value = 'copied'
  }
  catch {
    copyState.value = 'failed'
  }
  copyResetTimer = setTimeout(resetCopyState, 2000)
}

async function openProject(projectId: string): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await store.selectProject(projectId)
    if (props.capabilityId)
      store.selectCapability(props.capabilityId)
    emit('resolved')
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    busy.value = false
  }
}

async function chooseCheckout(): Promise<void> {
  const selectDirectory = window.craftHubDesktop?.selectProjectDirectory
  const verifyReference = window.craftHubDesktop?.verifyProjectReference
  if (!selectDirectory || !verifyReference)
    return
  const path = await selectDirectory(store.repositoriesRoot)
  if (!path)
    return
  busy.value = true
  selectedPath.value = ''
  error.value = ''
  try {
    await verifyReference(props.reference, path)
    selectedPath.value = path
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    busy.value = false
  }
}

async function registerCheckout(): Promise<void> {
  if (!selectedPath.value)
    return
  busy.value = true
  error.value = ''
  try {
    await store.addProject(selectedPath.value)
    if (props.capabilityId)
      store.selectCapability(props.capabilityId)
    emit('resolved')
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <DialogShell
    :open="open"
    layout="panel"
    content-class="dialog-content desktop-navigation-dialog"
    @update:open="value => value || close()"
  >
    <template #title>{{ t('desktopLinkTitle') }}</template>
    <template #description>{{ t(matches.length ? 'desktopLinkMultiple' : 'desktopLinkUnresolved') }}</template>
    <template #header-actions>
      <span class="desktop-navigation-mark" aria-hidden="true"><Icon name="hub" /></span>
    </template>

    <dl class="desktop-reference">
      <div class="desktop-reference-row">
        <span class="desktop-reference-icon" aria-hidden="true"><Icon name="gitRepository" /></span>
        <dt>{{ t('desktopLinkRepository') }}</dt>
        <dd :title="reference.repository">{{ repositoryLabel }}</dd>
        <UiButton
          class="desktop-reference-copy"
          :class="{ copied: copyState === 'copied' }"
          size="icon"
          variant="ghost"
          :aria-label="copyLabel"
          :title="copyLabel"
          @click="copyRepository"
        >
          <Icon :name="copyState === 'copied' ? 'check' : copyState === 'failed' ? 'error' : 'copy'" />
        </UiButton>
      </div>
      <div v-if="reference.subdir" class="desktop-reference-row">
        <span class="desktop-reference-icon" aria-hidden="true"><Icon name="folder" /></span>
        <dt>{{ t('desktopLinkSubdir') }}</dt>
        <dd :title="reference.subdir">{{ reference.subdir }}</dd>
      </div>
    </dl>
    <span class="sr-only" role="status" aria-live="polite">{{ copyState === 'idle' ? '' : copyLabel }}</span>

    <div v-if="matches.length" class="desktop-project-matches">
      <UiButton v-for="project in matches" :key="project.id" :disabled="busy" @click="openProject(project.id)">
        <Icon name="folder" />
        <span><strong>{{ project.name }}</strong><small>{{ project.path }}</small></span>
      </UiButton>
    </div>
    <template v-else>
      <div v-if="selectedPath" class="desktop-selected-checkout motion-reveal" role="status">
        <span class="desktop-selected-checkout-icon" aria-hidden="true"><Icon name="check" /></span>
        <span class="desktop-selected-checkout-text">
          <strong>{{ t('desktopLinkCheckoutVerified') }}</strong>
          <span :title="selectedPath">{{ selectedPath }}</span>
        </span>
      </div>
      <p class="desktop-link-safety">
        <span aria-hidden="true"><Icon name="untrusted" /></span>
        <span>{{ t('desktopLinkSafety') }}</span>
      </p>
    </template>

    <UiAlert v-if="error" class="desktop-navigation-error motion-reveal" variant="danger">{{ error }}</UiAlert>

    <template #footer>
      <UiButton :variant="selectedPath ? 'ghost' : 'secondary'" :disabled="busy" @click="close">{{ t('cancel') }}</UiButton>
      <UiButton v-if="!matches.length" :variant="selectedPath ? 'secondary' : 'primary'" :disabled="busy" data-testid="choose-checkout" @click="chooseCheckout">
        <Icon name="folderOpen" />
        {{ selectedPath ? t('chooseAnotherProject') : t('chooseLocalCheckout') }}
      </UiButton>
      <UiButton v-if="selectedPath" variant="primary" :disabled="busy" data-testid="register-checkout" @click="registerCheckout">{{ busy ? t('adding') : t('registerProject') }}</UiButton>
    </template>
  </DialogShell>
</template>
