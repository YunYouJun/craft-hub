<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { DialogShell } from './components/ui/dialog'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { t } = useI18n()
const loading = ref(false)
const error = ref('')

watch(() => props.open, async (open) => {
  if (!open)
    return
  loading.value = true
  error.value = ''
  try {
    await store.previewProjectConfigInitialization()
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
})

async function createConfig(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    if (store.selectedProject?.trust !== 'trusted' && !await store.trustProject())
      return
    await store.applyProjectConfigInitialization()
    emit('update:open', false)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <DialogShell :open="open" content-class="project-config-init-dialog dialog-content" @update:open="emit('update:open', $event)">
    <template #title>{{ t('initializeProjectConfig') }}</template>
    <template #description>{{ t('initializeProjectConfigDescription') }}</template>
        <p v-if="loading && !store.projectConfigInitialization" class="dialog-empty-state">{{ t('loading') }}</p>
        <template v-else-if="store.projectConfigInitialization">
          <p class="config-preview-path"><strong>{{ t('targetConfigurationFile') }}</strong><code>{{ store.projectConfigInitialization.targetPath }}</code></p>
          <pre class="config-preview-content">{{ store.projectConfigInitialization.content }}</pre>
          <p class="permission-note">{{ t('configPreviewSafety') }}</p>
        </template>
        <p v-if="error || store.error" class="error-message" role="alert">{{ error || store.error }}</p>
        <footer>
          <UiButton :disabled="loading" @click="emit('update:open', false)">{{ t('cancel') }}</UiButton>
          <UiButton
            v-if="store.projectConfigInitialization && !store.projectConfigInitialization.exists"
            variant="primary"
            :disabled="loading"
            @click="createConfig"
          ><Icon name="plus" /> {{ loading ? t('creating') : store.selectedProject?.trust === 'trusted' ? t('createConfiguration') : t('trustAndCreateConfiguration') }}</UiButton>
        </footer>
  </DialogShell>
</template>
