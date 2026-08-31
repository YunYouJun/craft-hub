<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { highlightShellCommand } from './shell-command-highlighter'

const props = withDefaults(defineProps<{
  command: string
  compact?: boolean
  copyable?: boolean
}>(), {
  compact: false,
  copyable: true,
})

const { t } = useI18n()
const highlighted = ref('')
const error = ref(false)
const copyState = ref<'copied' | 'failed' | 'idle'>('idle')
let renderSequence = 0
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

function resetCopyState(): void {
  if (copyResetTimer)
    clearTimeout(copyResetTimer)
  copyState.value = 'idle'
  copyResetTimer = undefined
}

async function copyCommand(): Promise<void> {
  resetCopyState()
  try {
    await navigator.clipboard.writeText(props.command)
    copyState.value = 'copied'
  }
  catch {
    copyState.value = 'failed'
  }
  copyResetTimer = setTimeout(resetCopyState, 2000)
}

watch(() => props.command, async (command) => {
  resetCopyState()
  const sequence = ++renderSequence
  error.value = false
  try {
    const html = await highlightShellCommand(command)
    if (sequence === renderSequence)
      highlighted.value = html
  }
  catch {
    if (sequence === renderSequence) {
      highlighted.value = ''
      error.value = true
    }
  }
}, { immediate: true })

onBeforeUnmount(resetCopyState)
</script>

<template>
  <div class="shell-command-preview" :class="{ compact }" data-testid="shell-command-preview">
    <span class="shell-command-prompt" aria-hidden="true">$</span>
    <div v-if="highlighted" class="shell-command-highlighted" v-html="highlighted" />
    <pre v-else :class="{ 'highlight-error': error }">{{ command }}</pre>
    <button
      v-if="copyable"
      class="shell-command-copy"
      :class="copyState"
      type="button"
      data-testid="copy-shell-command"
      :aria-label="t(copyState === 'copied' ? 'commandCopied' : copyState === 'failed' ? 'copyCommandFailed' : 'copyCommand')"
      :title="t(copyState === 'copied' ? 'commandCopied' : copyState === 'failed' ? 'copyCommandFailed' : 'copyCommand')"
      @click="copyCommand"
    >
      <Icon :name="copyState === 'copied' ? 'check' : copyState === 'failed' ? 'error' : 'copy'" />
    </button>
    <span class="sr-only" role="status" aria-live="polite">{{ copyState === 'copied' ? t('commandCopied') : copyState === 'failed' ? t('copyCommandFailed') : '' }}</span>
  </div>
</template>
