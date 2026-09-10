<script setup lang="ts">
import type { AccountSyncStatus } from 'craft-hub'
import { onMounted, onUnmounted, ref } from 'vue'
import { Button } from './components/ui/button'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'

const { locale } = useI18n()
const text = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const store = useWorkbenchStore()
const status = ref<AccountSyncStatus & { teams?: Array<{ id: string, error?: string }> }>()
const error = ref('')
const busy = ref(false)
let timer: ReturnType<typeof setInterval> | undefined
async function load(): Promise<void> {
  const response = await fetch('/api/config-sync')
  if (response.ok) {
    const value = await response.json()
    if (typeof value.state === 'string')
      status.value = value
  }
}
async function sync(resolution?: 'use-local' | 'use-cloud'): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const response = await fetch('/api/config-sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution }) })
    const value = await response.json()
    if (!response.ok)
      throw new Error(value.error)
    status.value = value
    await store.loadOwnerScopes()
    await store.loadWorkspaces()
  }
  catch (caught) { error.value = caught instanceof Error ? caught.message : String(caught) }
  finally { busy.value = false }
}
onMounted(() => { void load().catch(() => {}); timer = setInterval(() => { void load().catch(() => {}) }, 10000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <section v-if="status" class="subscription-card" aria-label="Configuration synchronization">
    <p>{{ status.state === 'disabled' ? text('团队配置每 30 秒检查更新', 'Team sources are checked every 30 seconds') : text('账号配置自动同步', 'Automatic account synchronization') }} <span v-if="status.state !== 'disabled'">· {{ ({ idle: text('等待同步', 'Waiting'), syncing: text('同步中', 'Syncing'), synced: text('已同步', 'Synced'), conflict: text('需要处理冲突', 'Conflict'), error: text('同步失败', 'Error') })[status.state] }}</span> <span v-if="status.lastSyncedAt">{{ new Date(status.lastSyncedAt).toLocaleString() }}</span></p>
    <p v-if="error || status.error" role="alert">{{ error || status.error }}</p>
    <p v-for="team in status.teams?.filter(item => item.error)" :key="team.id" role="alert">{{ team.error }}</p>
    <div class="sync-actions">
    <Button :disabled="busy" @click="sync()">{{ text('立即同步', 'Sync now') }}</Button>
    <a href="/api/config-sync/export" download="craft-hub-configuration.json">{{ text('导出配置与冲突备份', 'Export configuration and conflicts') }}</a>
    <template v-if="status.state === 'conflict'">
      <Button :disabled="busy" @click="sync('use-local')">{{ text('保留本机版本', 'Keep local version') }}</Button>
      <Button :disabled="busy" @click="sync('use-cloud')">{{ text('使用云端版本', 'Use cloud version') }}</Button>
    </template>
    </div>
  </section>
</template>

<style scoped>
.subscription-card { margin-bottom: 20px; }
.sync-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.sync-actions a { color: var(--accent); font-size: var(--font-size-body); }
</style>
