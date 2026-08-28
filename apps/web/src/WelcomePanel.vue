<script setup lang="ts">
import { ref } from 'vue'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const store = useWorkbenchStore()
const { t } = useI18n()
const props = withDefaults(defineProps<{ replaying?: boolean }>(), { replaying: false })
const emit = defineEmits<{ close: [] }>()
const adding = ref(false)
const error = ref('')

async function chooseProject(): Promise<void> {
  if (adding.value)
    return
  error.value = ''
  const path = window.craftHubDesktop?.selectProjectDirectory
    ? await window.craftHubDesktop.selectProjectDirectory(store.repositoriesRoot)
    : window.prompt(t('projectPath')) ?? undefined
  if (!path)
    return
  adding.value = true
  try {
    await store.addProject(path)
    if (props.replaying)
      emit('close')
  }
  catch (caught) {
    error.value = t('addProjectFailed', { message: caught instanceof Error ? caught.message : String(caught) })
  }
  finally {
    adding.value = false
  }
}
</script>

<template>
  <main class="welcome-panel" data-testid="guided-first-run-welcome">
    <span class="welcome-icon"><Icon name="hub" /></span>
    <p class="welcome-eyebrow">{{ t('guidedFirstRun') }}</p>
    <h1>{{ t('welcomeTitle') }}</h1>
    <p class="welcome-description">{{ t('welcomeDescription') }}</p>
    <ol class="welcome-steps">
      <li><span>1</span>{{ t('welcomeStepDiscover') }}</li>
      <li><span>2</span>{{ t('welcomeStepPreview') }}</li>
      <li><span>3</span>{{ t('welcomeStepRun') }}</li>
    </ol>
    <div class="welcome-actions">
      <UiButton class="welcome-action" variant="primary" :disabled="adding" @click="chooseProject">
        <Icon name="folder" /> {{ adding ? t('adding') : t(props.replaying ? 'chooseAdditionalProject' : 'chooseLocalProject') }}
      </UiButton>
      <UiButton v-if="props.replaying" class="welcome-close" @click="emit('close')">
        {{ t('backToWorkbench') }}
      </UiButton>
    </div>
    <p class="permission-note">{{ t('welcomeSafetyNote') }}</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
  </main>
</template>
