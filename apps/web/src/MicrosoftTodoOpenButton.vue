<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from './api'
import { Button as UiButton } from './components/ui/button'
import { Icon } from './icons'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

withDefaults(defineProps<{ iconOnly?: boolean }>(), { iconOnly: false })
const store = useWorkbenchStore()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const local = computed(() => store.hostEnvironment.kind === 'local')
const opening = ref(false)
const failed = ref(false)
const message = ref('')
const label = computed(() => local.value ? copy('在本机打开 Microsoft To Do', 'Open Microsoft To Do locally') : copy('打开 Microsoft To Do 网页版', 'Open Microsoft To Do on the web'))
const hint = computed(() => failed.value ? message.value : local.value ? copy('优先打开本机 Microsoft To Do；未安装时打开网页版', 'Open Microsoft To Do locally; use the website if unavailable') : label.value)

async function open(): Promise<void> {
  if (opening.value)
    return
  failed.value = false
  message.value = ''
  if (!local.value) {
    window.open('https://to-do.office.com/tasks/', '_blank', 'noopener,noreferrer')
    return
  }
  opening.value = true
  try {
    const result = await api.openLocalApplication('microsoft-todo')
    message.value = result.destination === 'application'
      ? copy('已请求打开本机 Microsoft To Do。', 'Requested Microsoft To Do to open locally.')
      : copy('已打开 Microsoft To Do 网页版。', 'Opened Microsoft To Do on the web.')
  }
  catch {
    failed.value = true
    message.value = copy('无法打开 Microsoft To Do，请点击重试。', 'Could not open Microsoft To Do. Click to retry.')
  }
  finally {
    opening.value = false
  }
}
</script>

<template>
  <span class="application-open-action">
    <UiButton variant="ghost" :size="iconOnly ? 'icon' : 'compact'" :disabled="opening" :aria-busy="opening" :aria-label="label" :title="hint" @click="open">
      <Icon :name="opening ? 'loading' : failed ? 'error' : 'externalLink'" />
      <span v-if="!iconOnly">{{ local ? copy('在本机打开', 'Open locally') : copy('打开网页版', 'Open website') }}</span>
    </UiButton>
    <span v-if="message" class="sr-only" :role="failed ? 'alert' : 'status'">{{ message }}</span>
  </span>
</template>

<style scoped>
.application-open-action { display: inline-flex; flex: none; align-items: center; }
</style>
