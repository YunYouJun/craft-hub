<script setup lang="ts">
import type { AccountSyncStatus } from 'craft-hub'
import { onMounted, onUnmounted, ref } from 'vue'
import { Button } from './components/ui/button'
import { Icon } from './icons'
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
  <section v-if="status" class="configuration-sync-status" :aria-label="text('配置同步', 'Configuration synchronization')">
    <div class="sync-toolbar">
      <div class="sync-summary">
        <Icon :name="status.state === 'disabled' ? 'refresh' : 'cloud'" />
        <span>{{ status.state === 'disabled' ? text('团队配置每 30 秒检查更新', 'Team sources are checked every 30 seconds') : text('账号配置自动同步', 'Automatic account synchronization') }}</span>
        <span v-if="status.state !== 'disabled'" class="sync-state" :class="{ attention: status.state === 'conflict' || status.state === 'error' }">{{ ({ idle: text('等待同步', 'Waiting'), syncing: text('同步中', 'Syncing'), synced: text('已同步', 'Synced'), conflict: text('需要处理冲突', 'Conflict'), error: text('同步失败', 'Error') })[status.state] }}</span>
        <time v-if="status.lastSyncedAt" :datetime="status.lastSyncedAt">{{ new Date(status.lastSyncedAt).toLocaleString() }}</time>
      </div>
      <div class="sync-actions">
        <Button size="compact" :disabled="busy" @click="sync()"><Icon :name="busy ? 'loading' : 'refresh'" />{{ busy ? text('同步中…', 'Syncing…') : text('立即同步', 'Sync now') }}</Button>
        <a class="workbench-action-link" href="/api/config-sync/export" download="craft-hub-configuration.json" :title="text('导出配置与冲突备份', 'Export configuration and conflict backups')" :aria-label="text('导出备份：配置与冲突备份', 'Export backup: configuration and conflicts')"><span class="app-icon i-ri-download-2-line" aria-hidden="true" />{{ text('导出备份', 'Export backup') }}</a>
      </div>
    </div>
    <p v-if="error || status.error" role="alert">{{ error || status.error }}</p>
    <p v-for="team in status.teams?.filter(item => item.error)" :key="team.id" role="alert">{{ team.error }}</p>
    <div v-if="status.state === 'conflict'" class="sync-actions sync-conflict">
      <Button size="compact" :disabled="busy" @click="sync('use-local')">{{ text('保留本机版本', 'Keep local version') }}</Button>
      <Button size="compact" :disabled="busy" @click="sync('use-cloud')">{{ text('使用云端版本', 'Use cloud version') }}</Button>
    </div>
  </section>
</template>

<style scoped>
.configuration-sync-status { margin-bottom: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); padding: var(--space-2) var(--space-3); background: var(--surface-subtle); }
.sync-toolbar, .sync-summary, .sync-actions { display: flex; align-items: center; gap: var(--space-2); }
.sync-toolbar { justify-content: space-between; flex-wrap: wrap; }
.sync-summary { min-width: 0; flex-wrap: wrap; color: var(--text-secondary); font-size: var(--font-size-body); line-height: var(--line-height-body); }
.sync-summary > .app-icon { width: 14px; height: 14px; color: var(--muted); }
.sync-summary time { color: var(--muted); font-size: var(--font-size-control); }
.sync-state { border-radius: var(--status-badge-radius); background: var(--surface-hover); padding: 1px 5px; font-size: var(--font-size-control); }
.sync-state.attention { color: var(--warning); background: var(--warning-soft); }
.sync-actions { flex: none; flex-wrap: wrap; }
.sync-conflict { margin-top: var(--space-2); }
[role=alert] { margin: var(--space-2) 0 0; color: var(--danger); font-size: var(--font-size-body); overflow-wrap: anywhere; }
</style>
