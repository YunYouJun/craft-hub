<script setup lang="ts">
import type { EnvironmentSetupSnapshot, EnvironmentSetupStep } from 'craft-hub'
import { onUnmounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { api } from './api'
import { Alert } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button as UiButton } from './components/ui/button'
import { useI18n } from './i18n'
import EnvironmentSourceConnection from './EnvironmentSourceConnection.vue'

const props = defineProps<{ profileRevision: string }>()
const { locale } = useI18n()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const text = (value: { en: string, zh?: string }) => locale.value === 'zh-CN' ? value.zh ?? value.en : value.en
const snapshot = ref<EnvironmentSetupSnapshot>()
const busy = ref(false)
const error = ref('')
const notice = ref('')
let generation = 0
let mounted = true
const labels: Record<EnvironmentSetupStep['state'], [string, string]> = {
  ready: ['已验证', 'Verified'], 'not-required': ['当前无需准备', 'Not required now'],
  'action-required': ['待操作', 'Action needed'], blocked: ['先完成前面的步骤', 'Complete prerequisites first'], unknown: ['尚未确认', 'Not confirmed'],
}
async function refresh(): Promise<void> {
  const current = ++generation
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api.environmentSetup()
    if (!mounted || current !== generation) return
    if (result.profileRevision !== props.profileRevision) throw new Error(copy('方案已变化，请重新读取方案后检查。', 'The profile changed. Reload the profile before checking again.'))
    snapshot.value = result
  }
  catch {
    if (mounted && current === generation) error.value = copy('无法确认前置条件，请检查本机服务后重新检查。', 'Could not verify prerequisites. Check the local service and retry.')
  }
  finally { if (mounted && current === generation) busy.value = false }
}
async function copyCommand(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    notice.value = copy('命令已复制。请在目标 Mac 的终端运行，完成后重新检查。', 'Command copied. Run it in Terminal on the target Mac, then check again.')
  }
  catch { notice.value = copy('无法复制，请手动选择下方命令。', 'Could not copy. Select the command below manually.') }
}
watch(() => props.profileRevision, () => { snapshot.value = undefined; void refresh() }, { immediate: true })
onUnmounted(() => { mounted = false; generation++ })
</script>

<template>
  <section class="environment-setup-guide" :aria-busy="busy" data-testid="environment-setup-guide">
    <header><h2>{{ copy('3. 准备目标 Mac', '3. Prepare the target Mac') }}</h2><UiButton size="compact" :disabled="busy" data-testid="refresh-setup-guide" @click="refresh">{{ copy('重新检查前置条件', 'Recheck prerequisites') }}</UiButton></header>
    <p class="guide-note">{{ copy('按顺序完成需要的安装。配置仓库可在下方直接连接，完成后重新检查。', 'Complete the required installations in order. Connect configuration repositories below, then check again.') }}</p>
    <p v-if="busy" class="guide-note" aria-live="polite">{{ copy('正在检查本机工具与配置源…', 'Checking local tools and configuration sources…') }}</p>
    <Alert v-if="error" variant="danger" role="alert">{{ error }}<span v-if="snapshot"> {{ copy('下方保留上次结果，当前状态未确认。', 'Previous results remain below; current state is unconfirmed.') }}</span></Alert>
    <p v-if="notice" class="guide-note" role="status">{{ notice }}</p>
    <ol v-if="snapshot" class="guide-steps">
      <li v-for="step in snapshot.steps" :key="step.id" :data-testid="`setup-stage-${step.id}`">
        <div class="guide-step-header"><h3>{{ text(step.title) }}</h3><Badge :variant="!error && step.state === 'ready' ? 'success' : 'secondary'">{{ error ? copy('尚未确认', 'Not confirmed') : copy(...labels[step.state]) }}</Badge></div>
        <p class="guide-note">{{ text(step.description) }}</p>
        <EnvironmentSourceConnection v-if="step.id === 'workstation.sources' && !['blocked', 'not-required'].includes(step.state) && !error" @connected="refresh" />
        <div class="guide-links"><a v-for="(action, index) in step.actions.filter(action => action.kind === 'link')" :key="index" :href="action.url" target="_blank" rel="noopener noreferrer">{{ text(action.title) }} ↗</a></div>
        <details v-for="(action, index) in step.actions.filter(action => action.kind === 'copy')" :key="index" class="guide-command">
          <summary>{{ text(action.title) }}</summary>
          <pre><code>{{ action.text }}</code></pre>
          <UiButton size="compact" :disabled="busy || !!error || step.state === 'blocked' || snapshot.profileRevision !== profileRevision" @click="copyCommand(action.text)">{{ copy('复制命令', 'Copy command') }}</UiButton>
        </details>
      </li>
    </ol>
    <p v-if="snapshot?.prerequisitesReady && !error && !busy" class="guide-ready" role="status">{{ copy('前置条件已验证，可以继续检查并审阅恢复。', 'Prerequisites verified. Continue to check and review recovery.') }}</p>
    <div class="guide-links"><RouterLink to="/environment">{{ copy('查看本机检测与实际路径', 'View machine checks and executable paths') }}</RouterLink><RouterLink to="/marketplace">{{ copy('管理本机插件', 'Manage local plugins') }}</RouterLink></div>
  </section>
</template>

<style scoped>
.environment-setup-guide { padding: var(--space-5) 0; border-bottom: 1px solid var(--border); }
.environment-setup-guide > header, .guide-step-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); }
.environment-setup-guide h2, .guide-step-header h3 { margin: 0; font-size: var(--font-size-body); font-weight: 600; }
.guide-note { color: var(--muted); font-size: var(--font-size-control); line-height: 1.7; overflow-wrap: anywhere; }
.guide-steps { list-style: decimal; margin: var(--space-4) 0; padding-left: 24px; }
.guide-steps li { min-width: 0; padding: var(--space-4) 0; }
.guide-steps li + li { border-top: 1px solid var(--border); }
.guide-step-header h3 { font-size: var(--font-size-control); }
.guide-links { display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: var(--font-size-control); }
.guide-command { margin-top: var(--space-3); font-size: var(--font-size-control); }
.guide-command summary { cursor: pointer; padding: var(--space-2) 0; }
.guide-command pre { max-width: 100%; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--control-radius); background: var(--surface); font: 12px/1.7 var(--font-mono); overflow-wrap: anywhere; white-space: pre-wrap; }
.guide-ready { color: var(--text); font-size: var(--font-size-control); }
</style>
