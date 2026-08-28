<script setup lang="ts">
import type { AgentTaskRecord } from 'craft-hub'
import { useI18n } from './i18n'

defineProps<{ task: AgentTaskRecord }>()
const { t } = useI18n()
</script>

<template>
  <p v-if="task.status === 'running'" class="agent-task-running-note">
    {{ t('codexTaskRunningOwner') }}
  </p>
  <details v-if="task.output" class="agent-task-output" :open="task.status === 'running'" data-testid="agent-task-output">
    <summary>{{ t('codexTaskLiveOutput') }}</summary>
    <pre>{{ task.output }}</pre>
    <small v-if="task.outputTruncated">{{ t('codexTaskOutputTruncated') }}</small>
  </details>
</template>
