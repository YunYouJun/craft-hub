<script setup lang="ts">
import type { EnvironmentSourceCommand, EnvironmentSourceSnapshot } from 'craft-hub'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from './api'
import { Alert } from './components/ui/alert'
import { Button as UiButton } from './components/ui/button'
import { Input } from './components/ui/input'
import { useI18n } from './i18n'

const emit = defineEmits<{ connected: [] }>()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const snapshot = ref<EnvironmentSourceSnapshot>()
const repository = ref('')
const kind = ref<'private' | 'public'>('private')
const username = ref('')
const token = ref('')
const busy = ref(false)
const error = ref('')
const active = computed(() => snapshot.value?.connections.find(job => job.providerId === 'workstation'))
const running = computed(() => active.value?.state === 'connecting')
const failures = { 'authentication-required': ['需要登录或当前凭据无效，请核对仓库地址并完成认证。', 'Sign-in is required or the credentials were rejected. Check the repository and authenticate.'], 'invalid-source': ['未通过配置源验证。请确认仓库包含有效配置，原有来源保持不变。', 'Configuration source validation failed. Check the repository contents; the previous binding is retained.'], 'destination-conflict': ['本机已有不同仓库或配置源刚发生变化，请核对后重试。', 'A different checkout exists or the binding changed. Review it before retrying.'], unavailable: ['连接未完成，请检查网络、Git 与 Workstation 后重试。', 'Connection did not complete. Check the network, Git and Workstation, then retry.'] } as const
let mounted = true
let timer: ReturnType<typeof setTimeout> | undefined
let notified = ''
let generation = 0
function accept(value: EnvironmentSourceSnapshot): void {
  if (!mounted) return
  snapshot.value = value
  if (active.value?.state === 'connected' && active.value.id !== notified) { notified = active.value.id; emit('connected') }
  clearTimeout(timer)
  if (running.value) timer = setTimeout(() => { void refresh() }, 750)
}
async function refresh(): Promise<void> {
  const current = ++generation
  try { const value = await api.environmentSources(); if (current === generation && mounted) { accept(value); error.value = '' } }
  catch { if (mounted && current === generation) error.value = copy('无法读取连接状态。请重新检查后继续。', 'Could not read connection status. Check again before continuing.') }
}
async function operate(input: EnvironmentSourceCommand): Promise<void> {
  const current = ++generation
  busy.value = true
  error.value = ''
  try { const value = await api.connectEnvironmentSource(input); if (current === generation) accept(value) }
  catch { if (mounted && current === generation) error.value = copy('操作未完成，请重新检查连接状态后重试。', 'The operation did not complete. Recheck connection status and retry.') }
  finally { busy.value = false; token.value = '' }
}
function connect(): void {
  try {
    const url = new URL(repository.value.trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid repository')
    void operate({ operation: 'connect', providerId: 'workstation', kind: kind.value, repository: url.href })
  }
  catch { error.value = copy('请输入不含用户名、令牌或查询参数的 HTTPS 仓库地址。', 'Enter an HTTPS repository URL without credentials or query parameters.') }
}
onMounted(refresh)
onUnmounted(() => { mounted = false; clearTimeout(timer); token.value = ''; username.value = '' })
</script>

<template>
  <section v-if="snapshot?.providers.some(provider => provider.id === 'workstation') || error" class="source-connection" data-testid="environment-source-connection">
    <h4>{{ copy('在这里连接配置仓库', 'Connect the configuration repository here') }}</h4>
    <p class="connection-note">{{ copy('输入 HTTPS 地址后连接，已有 Git 登录会自动尝试。连接只准备配置来源，之后仍需审阅并应用。', 'Connect using an HTTPS URL. Existing Git sign-in is tried first. Connecting prepares the source; review and apply configuration afterward.') }}</p>
    <form class="connection-form" @submit.prevent="connect">
      <label>{{ copy('配置源类型', 'Source type') }}<select v-model="kind" class="ui-form-control" :disabled="busy || running || active?.state === 'authentication-required'"><option value="private">{{ copy('私有配置', 'Private configuration') }}</option><option value="public">{{ copy('公开配置', 'Public configuration') }}</option></select></label>
      <label class="repository-field">{{ copy('仓库地址', 'Repository URL') }}<Input v-model="repository" type="url" placeholder="https://github.com/owner/config.git" autocomplete="off" :disabled="busy || running || active?.state === 'authentication-required'" required /></label>
      <UiButton type="submit" variant="primary" :disabled="busy || running || active?.state === 'authentication-required' || !repository.trim()">{{ copy('连接配置源', 'Connect source') }}</UiButton>
    </form>
    <Alert v-if="error" variant="danger" role="alert">{{ error }} <UiButton size="compact" :disabled="busy" @click="refresh">{{ copy('重新检查连接', 'Recheck connection') }}</UiButton></Alert>
    <div v-if="active" class="connection-status" role="status">
      <p v-if="running">{{ active.phase === 'binding' ? copy('正在保存已验证的配置源…', 'Saving the validated source…') : active.phase === 'validating' ? copy('正在验证配置内容…', 'Validating configuration…') : copy('正在获取仓库；请完成可能出现的 Git 登录窗口…', 'Getting the repository; complete any Git sign-in window…') }}</p>
      <p v-if="active.error" role="alert">{{ copy(failures[active.error][0], failures[active.error][1]) }}</p>
      <p v-if="active.state === 'connected'">{{ copy('配置源已连接。请根据前置检查结果继续检查并恢复。', 'Source connected. Continue to check and restore based on the prerequisite results.') }}<code>{{ active.localPath }}</code></p>
      <p v-if="active.state === 'cancelled'">{{ copy('连接已取消，可以重新开始。', 'Connection cancelled. You can start again.') }}</p>
      <form v-if="active.state === 'authentication-required'" class="authentication-form" @submit.prevent="operate({ operation: 'authenticate', id: active!.id, credentials: { username, token } })">
        <p class="connection-note">{{ copy('请使用该仓库的 Git 用户名和访问令牌。令牌仅用于本次连接，Craft Hub 不保存。', 'Use the repository’s Git username and access token. Craft Hub uses the token for this connection only and does not save it.') }} <strong>{{ active.repository }}</strong></p>
        <label>{{ copy('Git 用户名', 'Git username') }}<Input v-model="username" autocomplete="off" required :disabled="busy" /></label>
        <label>{{ copy('访问令牌', 'Access token') }}<Input v-model="token" type="password" autocomplete="off" required :disabled="busy" /></label>
        <UiButton type="submit" variant="primary" :disabled="busy || !username || !token">{{ copy('认证并继续', 'Authenticate and continue') }}</UiButton>
      </form>
      <UiButton v-if="['connecting', 'authentication-required'].includes(active.state)" size="compact" :disabled="busy || active.phase === 'binding'" @click="operate({ operation: 'cancel', id: active!.id })">{{ copy('取消连接', 'Cancel connection') }}</UiButton>
    </div>
  </section>
</template>

<style scoped>
.source-connection { margin-top: var(--space-4); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--control-radius); }
.source-connection h4 { margin: 0; }
.connection-note { color: var(--muted); line-height: 1.7; overflow-wrap: anywhere; }
.connection-form { display: flex; align-items: end; gap: var(--space-3); flex-wrap: wrap; }
.connection-form label, .authentication-form label { display: grid; gap: var(--space-2); min-width: 0; font-size: var(--font-size-control); }
.repository-field { flex: 1; min-width: 200px !important; }
.authentication-form { display: grid; gap: var(--space-3); max-width: 600px; margin-bottom: var(--space-4); }
.connection-status { line-height: 1.7; overflow-wrap: anywhere; }
.connection-status code { display: block; font-size: 12px; }
@media (max-width: 600px) { .connection-form { display: grid; } .repository-field { min-width: 0 !important; } }
</style>
