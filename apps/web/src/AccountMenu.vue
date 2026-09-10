<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from './i18n'
import { Icon } from './icons'

interface AccountStatus {
  enabled: boolean
  provider?: string
  mode?: 'gateway' | 'local'
  identity?: { id: string, name: string, expiresAt: string, avatarUrl?: string }
  canSignIn?: boolean
  canSignOut?: boolean
}

const { locale } = useI18n()
const zh = computed(() => locale.value === 'zh-CN')
const panelId = useId()
const trigger = ref<HTMLButtonElement>()
const panelPosition = ref({ left: '48px', bottom: '68px' })

function positionPanel(): void {
  const bounds = trigger.value?.getBoundingClientRect()
  if (!bounds)
    return
  const width = Math.min(280, window.innerWidth - 16)
  panelPosition.value = {
    left: `${Math.max(8, Math.min(bounds.right + 8, window.innerWidth - width - 8))}px`,
    bottom: `${Math.max(8, window.innerHeight - bounds.bottom)}px`,
  }
}
const status = ref<AccountStatus>({ enabled: false })
const failedAvatar = ref(false)
const avatarUrl = computed(() => {
  try {
    const url = new URL(status.value.identity?.avatarUrl ?? '')
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined
  }
  catch {
    return undefined
  }
})
watch(avatarUrl, () => { failedAvatar.value = false })
const busy = ref(false)
const waiting = ref(false)
const authorizationUrl = ref('')
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let revision = 0
let deadline = 0

async function call<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`/api/account${path}`, { method })
  if (!response.ok)
    throw new Error(zh.value ? '无法完成账号操作，请检查登录配置或重试。' : 'Account operation failed. Check configuration or retry.')
  return response.json() as Promise<T>
}

async function refresh(): Promise<void> {
  try {
    status.value = await call<AccountStatus>('')
    error.value = ''
    clearTimeout(expiryTimer)
    const expiration = Date.parse(status.value.identity?.expiresAt ?? '')
    if (Number.isFinite(expiration) && expiration > Date.now())
      expiryTimer = setTimeout(() => { void refresh() }, Math.min(expiration - Date.now() + 50, 2147483647))
  }
  catch {
    // A configured gateway can reject a missing or unauthorized identity.
    status.value = { enabled: true, mode: 'gateway' }
    error.value = zh.value ? '登录验证失败或当前账号无权访问此工作台。' : 'Authentication failed or this account cannot access the workbench.'
  }
}

async function poll(current: number): Promise<void> {
  if (current !== revision)
    return
  try {
    if (Date.now() >= deadline)
      throw new Error(zh.value ? '登录已超时，请重试。' : 'Sign-in expired. Please retry.')
    await call('/complete', 'POST')
    if (current !== revision)
      return
    await refresh()
    if (status.value.identity) {
      waiting.value = false
      return
    }
    timer = setTimeout(() => { void poll(current) }, 2000)
  }
  catch (cause) {
    if (current !== revision)
      return
    waiting.value = false
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function signIn(): Promise<void> {
  busy.value = true
  error.value = ''
  const current = ++revision
  const popup = !window.craftHubDesktop?.openExternalUrl ? window.open('about:blank', '_blank') : null
  if (popup)
    popup.opener = null
  try {
    const result = await call<{ authorizationUrl: string }>('/sign-in', 'POST')
    const url = new URL(result.authorizationUrl)
    if (url.protocol !== 'https:')
      throw new Error('Invalid sign-in URL')
    authorizationUrl.value = url.toString()
    if (window.craftHubDesktop?.openExternalUrl)
      await window.craftHubDesktop.openExternalUrl(url.toString())
    else if (popup)
      popup.location.href = url.toString()
    waiting.value = true
    deadline = Date.now() + 300000
    void poll(current)
  }
  catch (cause) {
    popup?.close()
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    busy.value = false
  }
}

async function signOut(): Promise<void> {
  ++revision
  clearTimeout(timer)
  waiting.value = false
  busy.value = true
  error.value = ''
  try {
    await call('/sign-out', 'POST')
    await refresh()
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    busy.value = false
  }
}

onMounted(() => {
  void refresh()
  window.addEventListener('focus', refresh)
  window.addEventListener('resize', positionPanel)
})
onBeforeUnmount(() => {
  ++revision
  clearTimeout(timer)
  clearTimeout(expiryTimer)
  window.removeEventListener('focus', refresh)
  window.removeEventListener('resize', positionPanel)
})
</script>

<template>
  <aside class="account-menu" :aria-label="zh ? '账号' : 'Account'">
    <button ref="trigger" type="button" :popovertarget="panelId" class="activity-button" :title="status.identity?.name || (zh ? '账号' : 'Account')" :aria-label="zh ? '打开账号信息' : 'Open account details'">
      <img v-if="avatarUrl && !failedAvatar" :src="avatarUrl" class="account-avatar account-photo" alt="" referrerpolicy="no-referrer" @error="failedAvatar = true">
      <span v-else-if="status.identity" class="account-avatar" aria-hidden="true">{{ status.identity.name.slice(0, 1).toUpperCase() }}</span>
      <Icon v-else name="personal" />
    </button>
    <div :id="panelId" popover="auto" class="account-panel" :style="panelPosition" @beforetoggle="positionPanel">
      <strong>{{ status.identity?.name || (status.enabled ? (zh ? '未登录' : 'Signed out') : (zh ? '本地模式' : 'Local mode')) }}</strong>
      <span v-if="status.provider">{{ status.provider }}</span>
      <span v-if="status.identity" class="account-id">{{ zh ? '账号 ID' : 'Account ID' }}: {{ status.identity.id }}</span>
      <span v-if="!status.enabled">{{ zh ? '此工作台未配置账号登录。' : 'Account sign-in is not configured for this workbench.' }}</span>
      <a v-if="waiting && authorizationUrl" :href="authorizationUrl" target="_blank" rel="noopener noreferrer">{{ zh ? '打开登录页' : 'Open sign-in page' }}</a>
      <span v-if="waiting" role="status">{{ zh ? '等待浏览器确认…' : 'Waiting for browser…' }}</span>
      <button v-if="status.canSignIn && !status.identity && !waiting" :disabled="busy" @click="signIn">{{ zh ? '登录' : 'Sign in' }}</button>
      <button v-if="status.canSignOut && (status.identity || waiting)" :disabled="busy" @click="signOut">{{ waiting ? (zh ? '取消' : 'Cancel') : (zh ? '退出' : 'Sign out') }}</button>
      <button v-if="status.mode === 'gateway' && !status.identity" @click="refresh">{{ zh ? '重试' : 'Retry' }}</button>
      <span v-if="error" role="alert">{{ error }}</span>
    </div>
  </aside>
</template>

<style scoped>
.account-menu { position: relative; color: var(--text); font-size: 12px; -webkit-app-region: no-drag; }
.activity-button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.account-avatar { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); font-size: 11px; }
.account-photo { object-fit: cover; }
.account-panel { position: fixed; inset: auto; max-height: calc(100dvh - 16px); overflow-y: auto; margin: 0; flex-direction: column; align-items: stretch; gap: 10px; width: min(280px, calc(100vw - 16px)); padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); box-shadow: 0 8px 30px #0002; white-space: normal; z-index: 45; }
.account-panel:popover-open { display: flex; }
.account-id, [role="alert"] { overflow-wrap: anywhere; }
.account-panel button { cursor: pointer; text-align: start; padding: 6px 8px; border: 1px solid var(--border); border-radius: 5px; }
</style>
