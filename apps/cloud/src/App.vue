<script setup lang="ts">
import type { CloudDevice, CloudRequest } from './api'
import { computed, onMounted, ref } from 'vue'
import { cloudRequest } from './api'
import { login, restoreSession } from './auth'

const loading = ref(true)
const busy = ref(false)
const error = ref('')
const csrf = ref('')
const userId = ref('')
const devices = ref<CloudDevice[]>([])
const requests = ref<CloudRequest[]>([])
const targetDeviceId = ref('')
const projectKey = ref('')
const capabilityId = ref('')
const availableDevices = computed(() => devices.value.filter(deviceAvailable))

onMounted(async () => {
  try {
    rememberDesktopConnect()
    const session = await restoreSession()
    if (!session)
      return
    csrf.value = session.csrf
    userId.value = session.user.userId
    await loadData()
    await finishDesktopConnect()
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    loading.value = false
  }
})

async function loadData(): Promise<void> {
  const [deviceResult, requestResult] = await Promise.all([
    cloudRequest<{ devices: CloudDevice[] }>('/v1/devices'),
    cloudRequest<{ requests: CloudRequest[] }>('/v1/requests'),
  ])
  devices.value = deviceResult.devices
  requests.value = requestResult.requests
  if (!availableDevices.value.some(device => device.deviceId === targetDeviceId.value))
    targetDeviceId.value = availableDevices.value[0]?.deviceId ?? ''
}

function deviceAvailable(device: CloudDevice): boolean {
  return !device.revokedAt && Date.now() - device.lastSeenAt <= 120_000
}

function deviceStatus(device: CloudDevice): string {
  if (device.revokedAt)
    return '已撤销'
  return deviceAvailable(device) ? '可用' : '离线'
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}

async function submitRequest(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await cloudRequest('/v1/requests', {
      method: 'POST',
      headers: { 'x-craft-csrf': csrf.value },
      body: JSON.stringify({ targetDeviceId: targetDeviceId.value, projectKey: projectKey.value, capabilityId: capabilityId.value }),
    })
    projectKey.value = ''
    capabilityId.value = ''
    await loadData()
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    busy.value = false
  }
}

function rememberDesktopConnect(): void {
  const url = new URL(window.location.href)
  const publicKey = url.searchParams.get('public_key')
  const challenge = url.searchParams.get('challenge')
  const callback = url.searchParams.get('callback')
  if (url.pathname === '/connect' && publicKey && challenge && callback === 'craft-hub://cloud/connect')
    sessionStorage.setItem('craft-hub-device-connect', JSON.stringify({ publicKey, challenge, callback }))
}

async function finishDesktopConnect(): Promise<void> {
  const raw = sessionStorage.getItem('craft-hub-device-connect')
  if (!raw || !csrf.value)
    return
  const pending = JSON.parse(raw) as { publicKey: string, challenge: string, callback: string }
  const result = await cloudRequest<{ code: string, challenge: string }>('/v1/device-bootstrap', {
    method: 'POST',
    headers: { 'x-craft-csrf': csrf.value },
    body: JSON.stringify({ publicKey: pending.publicKey, challenge: pending.challenge }),
  })
  sessionStorage.removeItem('craft-hub-device-connect')
  const callback = new URL(pending.callback)
  callback.searchParams.set('code', result.code)
  callback.searchParams.set('challenge', result.challenge)
  window.location.assign(callback)
}
</script>

<template>
  <main>
    <aside aria-label="连接状态">
      <span class="status-mark" :class="{ online: userId }" />
      <strong>CRAFT HUB</strong>
      <small>PERSONAL CLOUD</small>
    </aside>

    <section class="content-column">
      <header>
        <p>外网请求信箱</p>
        <h1>让电脑执行已有命令</h1>
        <span>云端只负责投递；项目路径、信任、终端输出与 Codex 任务保留在电脑本地。</span>
      </header>

      <p v-if="loading" class="notice">正在检查会话…</p>
      <button v-else-if="!userId" class="primary" type="button" @click="login">使用 YunLeFun 登录</button>

      <template v-else>
        <form @submit.prevent="submitRequest">
          <label>目标电脑
            <select v-model="targetDeviceId" required>
              <option v-for="device in availableDevices" :key="device.deviceId" :value="device.deviceId">{{ device.name }} · {{ device.platform }}</option>
            </select>
          </label>
          <label>项目 key<input v-model.trim="projectKey" required maxlength="128" autocomplete="off" placeholder="例如 craft-hub"></label>
          <label>命令 capability ID<input v-model.trim="capabilityId" required maxlength="256" autocomplete="off" placeholder="例如 package.json:test"></label>
          <button class="primary" type="submit" :disabled="busy || !availableDevices.length">{{ busy ? '正在投递…' : '发送到电脑' }}</button>
        </form>

        <section class="device-list" aria-labelledby="device-list-title">
          <h2 id="device-list-title">设备状态</h2>
          <p v-if="!devices.length" class="notice">还没有已连接设备。</p>
          <article v-for="device in devices" :key="device.deviceId" class="device-row" :class="{ revoked: device.revokedAt }">
            <span><strong>{{ device.name }}</strong><small>{{ device.platform }}</small></span>
            <code>{{ formatTime(device.lastSeenAt) }}</code>
            <b :class="{ online: deviceAvailable(device) }">{{ deviceStatus(device) }}</b>
          </article>
        </section>

        <section class="request-list">
          <h2>最近请求</h2>
          <p v-if="!requests.length" class="notice">还没有请求。</p>
          <article v-for="request in requests" :key="request.requestId">
            <code>{{ request.projectKey }} / {{ request.capabilityId }}</code>
            <strong>{{ request.status }}</strong>
            <small>{{ request.finishedAt ?? request.expiresAt }}</small>
          </article>
        </section>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </main>
</template>
