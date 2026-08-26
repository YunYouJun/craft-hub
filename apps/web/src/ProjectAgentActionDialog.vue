<script setup lang="ts">
import type { WorkbenchLocale } from 'craft-hub'
import { computed, ref, watch } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const store = useWorkbenchStore()
const { locale, t } = useI18n()
const targetLocale = ref<WorkbenchLocale>(locale.value)
const starting = ref(false)
const error = ref('')
const action = computed(() => store.agentActions.find(item => item.id === 'improve-project-config'))
const running = computed(() => store.agentTasks.some(task => task.actionId === 'improve-project-config'
  && task.projectIds.includes(store.selectedProjectId)
  && task.status === 'running'))

watch(() => props.open, async (open) => {
  if (!open)
    return
  targetLocale.value = locale.value
  error.value = ''
  await store.loadAgentActions().catch((caught) => {
    error.value = caught instanceof Error ? caught.message : String(caught)
  })
})

watch(targetLocale, async () => {
  if (!props.open || !store.selectedProject)
    return
  try {
    await store.loadAgentActions(store.selectedProject.id, targetLocale.value)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
})

async function start(): Promise<void> {
  if (!store.selectedProject || !action.value?.missingCommandCount || running.value)
    return
  starting.value = true
  error.value = ''
  try {
    if (store.selectedProject.trust !== 'trusted')
      await store.trustProject()
    await store.startAgentAction('improve-project-config', targetLocale.value)
    emit('update:open', false)
  }
  catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
  }
  finally {
    starting.value = false
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="agent-action-dialog">
        <DialogTitle>{{ t('improveProjectConfig') }}</DialogTitle>
        <DialogDescription>{{ t('improveProjectConfigDescription') }}</DialogDescription>

        <dl class="agent-action-summary">
          <div><dt>{{ t('targetConfigurationFile') }}</dt><dd><code>{{ action?.targetPath ?? '.craft-hub/project.yaml' }}</code></dd></div>
          <div><dt>{{ t('commands') }}</dt><dd>{{ t('commandsToDescribe', { count: String(action?.missingCommandCount ?? 0) }) }}</dd></div>
        </dl>

        <label class="agent-action-language">
          <span>{{ t('targetLanguage') }}</span>
          <select v-model="targetLocale">
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
          </select>
        </label>

        <p class="permission-note">{{ t('configurationPreserveNotice') }}</p>
        <p v-if="store.selectedProject?.trust !== 'trusted'" class="agent-action-trust"><Icon name="untrusted" /> {{ t('agentActionPermission') }}</p>
        <p v-if="action && action.missingCommandCount === 0" class="agent-action-empty">{{ t('allCommandDescriptionsPresent') }}</p>
        <p v-if="error" class="error-message">{{ error }}</p>

        <footer>
          <button type="button" class="secondary-button" @click="emit('update:open', false)">{{ t('cancel') }}</button>
          <button class="primary-button" type="button" :disabled="starting || running || !action?.missingCommandCount" @click="start">
            <Icon name="codex" />
            {{ starting ? t('startingTask') : store.selectedProject?.trust === 'trusted' ? t('startAgentAction') : t('trustAndStartAgentAction') }}
          </button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
