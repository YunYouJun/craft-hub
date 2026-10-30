<script setup lang="ts">
import type { ActionToastMessage } from './types'
import { ToastProvider, ToastRoot, ToastTitle, ToastViewport } from 'reka-ui'
import { ref, watch } from 'vue'
import Icon from '../../../NavigationIcon.vue'

const props = defineProps<{ message?: ActionToastMessage }>()
const open = ref(false)
watch(() => props.message, () => {
  open.value = true
})
</script>

<template>
  <ToastProvider>
    <ToastRoot v-if="message" :key="message.id" v-model:open="open" :duration="message.error ? 5000 : 2000" class="ui-action-toast" :data-error="message.error || undefined">
      <Icon :name="message.error ? 'error' : 'check'" />
      <ToastTitle>{{ message.title }}</ToastTitle>
    </ToastRoot>
    <ToastViewport class="ui-action-toast-viewport" />
  </ToastProvider>
</template>

<style>
.ui-action-toast-viewport { position: fixed; top: 20px; left: 50%; z-index: 100; display: flex; flex-direction: column; align-items: center; max-width: calc(100vw - 32px); margin: 0; padding: 0; transform: translateX(-50%); outline: none; list-style: none; pointer-events: none; }
.ui-action-toast { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--border); border-radius: 999px; background: var(--menu-background, var(--surface)); color: var(--text); box-shadow: var(--menu-shadow); font: 500 var(--font-size-body)/1.4 -apple-system, BlinkMacSystemFont, sans-serif; backdrop-filter: blur(18px); }
.ui-action-toast > .app-icon { width: 17px; height: 17px; color: var(--accent); }
.ui-action-toast[data-error] > .app-icon { color: var(--danger); }
</style>
