<script setup lang="ts">
import type { ProjectRecord, ProjectReference } from 'craft-hub'
import { ref, watch } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{
  matches: ProjectRecord[]
  reference: ProjectReference
}>()
const emit = defineEmits<{ close: [], resolved: [] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const selectedPath = ref('')
const busy = ref(false)
const error = ref('')

watch(() => props.reference, () => {
  selectedPath.value = ''
  error.value = ''
}, { deep: true })

async function openProject(projectId: string): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await store.selectProject(projectId)
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
  <div class="dialog-overlay desktop-navigation-overlay" data-state="open" @click.self="emit('close')" />
  <section class="dialog-content desktop-navigation-dialog" data-state="open" role="dialog" aria-modal="true" :aria-labelledby="'desktop-navigation-title'">
    <span class="desktop-navigation-mark"><Icon name="hub" /></span>
    <h2 id="desktop-navigation-title">{{ t('desktopLinkTitle') }}</h2>
    <p>{{ t(matches.length ? 'desktopLinkMultiple' : 'desktopLinkUnresolved') }}</p>
    <dl class="desktop-reference">
      <div><dt>{{ t('desktopLinkRepository') }}</dt><dd>{{ reference.repository }}</dd></div>
      <div v-if="reference.subdir"><dt>{{ t('desktopLinkSubdir') }}</dt><dd>{{ reference.subdir }}</dd></div>
    </dl>

    <div v-if="matches.length" class="desktop-project-matches">
      <UiButton v-for="project in matches" :key="project.id" :disabled="busy" @click="openProject(project.id)">
        <Icon name="folder" />
        <span><strong>{{ project.name }}</strong><small>{{ project.path }}</small></span>
      </UiButton>
    </div>
    <template v-else>
      <p class="desktop-link-safety">{{ t('desktopLinkSafety') }}</p>
      <div v-if="selectedPath" class="desktop-selected-checkout"><Icon name="folder" /><span>{{ selectedPath }}</span></div>
    </template>

    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <footer>
      <UiButton :disabled="busy" @click="emit('close')">{{ t('cancel') }}</UiButton>
      <UiButton v-if="!matches.length" :disabled="busy" @click="chooseCheckout">{{ selectedPath ? t('chooseAnotherProject') : t('chooseLocalCheckout') }}</UiButton>
      <UiButton v-if="selectedPath" variant="primary" :disabled="busy" @click="registerCheckout">{{ busy ? t('adding') : t('registerProject') }}</UiButton>
    </footer>
  </section>
</template>
