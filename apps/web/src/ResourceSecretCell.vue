<script setup lang="ts">
import type { ResourceDesktopSession } from './resource-desktop'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button } from './components/ui/button'
import Icon from './NavigationIcon.vue'

const props = defineProps<{ rowId: string, session: ResourceDesktopSession, disabled?: boolean, chinese: boolean }>()
const emit = defineEmits<{ feedback: [message: string, error?: boolean] }>()
const password = ref('')
const busy = ref(false)
const available = ref(false)
let generation = 0
let mounted = true
let timer: ReturnType<typeof setTimeout> | undefined
const label = (zh: string, en: string) => props.chinese ? zh : en
function conceal(): void {
  generation++
  password.value = ''
  clearTimeout(timer)
}
watch(() => [props.rowId, props.session] as const, () => {
  conceal()
  available.value = props.session.availableRowIds.includes(props.rowId)
}, { immediate: true })
async function perform(operation: 'show' | 'copy' | 'remove'): Promise<void> {
  if (operation === 'show' && password.value) {
    conceal()
    return
  }
  const stamp = generation
  const sessionId = props.session.sessionId
  busy.value = true
  try {
    const result = await window.craftHubDesktop!.resourceCredential!({ sessionId: props.session.sessionId, rowId: props.rowId, operation })
    if (!mounted || sessionId !== props.session.sessionId || (operation === 'show' && stamp !== generation))
      return
    if (operation === 'show' && result.value && !document.hidden) {
      password.value = result.value
      timer = setTimeout(conceal, 30000)
    }
    else if (operation === 'copy') {
      emit('feedback', label('已复制', 'Copied'))
    }
    else if (operation === 'remove') {
      available.value = false
      conceal()
      emit('feedback', label('已清除本机密码', 'Local password removed'))
    }
  }
  catch {
    if (mounted && sessionId === props.session.sessionId)
      emit('feedback', label('本机密码操作失败，请刷新重试', 'Local password action failed. Refresh and retry.'), true)
  }
  finally { busy.value = false }
}
onMounted(() => {
  window.addEventListener('blur', conceal)
  window.addEventListener('craft-hub-conceal', conceal)
  window.addEventListener('pagehide', conceal)
  document.addEventListener('visibilitychange', conceal)
})
onBeforeUnmount(() => {
  mounted = false
  conceal()
  window.removeEventListener('blur', conceal)
  window.removeEventListener('craft-hub-conceal', conceal)
  window.removeEventListener('pagehide', conceal)
  document.removeEventListener('visibilitychange', conceal)
})
</script>

<template>
  <div class="resource-secret-cell">
    <span class="resource-secret-value">{{ available ? password || '••••••••' : label('未保存', 'Not saved') }}</span>
    <template v-if="available">
      <Button size="compact" variant="ghost" :disabled="disabled || busy" :aria-label="password ? label('隐藏密码', 'Hide Password') : label('显示密码', 'Show Password')" @click="perform('show')">
        <Icon :name="password ? 'eyeOff' : 'eye'" />
      </Button>
      <Button size="compact" variant="ghost" :disabled="disabled || busy" :aria-label="label('复制密码', 'Copy Password')" @click="perform('copy')">
        <Icon name="copy" />
      </Button>
      <Button size="compact" variant="ghost" :disabled="disabled || busy" :aria-label="label('清除本机密码', 'Remove Local Password')" @click="perform('remove')">
        <Icon name="trash" />
      </Button>
    </template>
  </div>
</template>

<style scoped>
.resource-secret-cell { display: flex; align-items: center; gap: 2px; }
.resource-secret-value { min-width: 76px; font-family: ui-monospace, monospace; color: var(--text-secondary); }
.resource-secret-cell .ui-button { padding-inline: 5px; }
</style>
