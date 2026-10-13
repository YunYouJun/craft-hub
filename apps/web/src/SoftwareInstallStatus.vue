<script setup lang="ts">
import type { SoftwareInstallationRun } from 'craft-hub'
import { computed, useId } from 'vue'
import { Tooltip } from './components/ui/tooltip'
import { useI18n } from './i18n'

const props = defineProps<{
  item: SoftwareInstallationRun['items'][number]
  stopping?: boolean
  cancellable?: boolean
  cancelPending?: boolean
  stopLabel?: string
}>()
const emit = defineEmits<{ stop: [] }>()
const { locale } = useI18n()
const statusId = useId()
const copy = (zh: string, en: string) => locale.value === 'zh-CN' ? zh : en
const stopping = computed(() => props.stopping || props.cancelPending)
const downloading = computed(() => !stopping.value && props.item.state === 'running' && props.item.progress?.phase === 'downloading')
const percent = computed(() => downloading.value && props.item.progress?.phase === 'downloading' ? props.item.progress.percent : undefined)
const label = computed(() => {
  if (stopping.value)
    return copy('正在停止', 'Stopping')
  if (props.item.state === 'queued')
    return copy('等待安装', 'Queued')
  if (downloading.value)
    return copy('正在下载', 'Downloading')
  if (props.item.progress?.phase === 'preparing')
    return copy('正在准备', 'Preparing')
  return copy('正在安装', 'Installing')
})
const detail = computed(() => {
  if (!downloading.value)
    return label.value
  const resource = props.item.progress?.phase === 'downloading' ? props.item.progress.resource : undefined
  return [copy('当前文件下载进度', 'Current file download progress'), resource, percent.value === undefined ? copy('总大小未知', 'Total size unavailable') : `${percent.value}%`].filter(Boolean).join(' · ')
})
const stopLabel = computed(() => props.stopLabel ?? copy('停止安装任务', 'Stop installation task'))
const indeterminate = computed(() => percent.value === undefined && props.item.state !== 'queued')
</script>

<template>
  <span class="software-install-status" :data-phase="stopping ? 'stopping' : item.state === 'queued' ? 'queued' : item.progress?.phase ?? 'installing'">
    <span class="software-progress-control">
      <span class="download-ring" :class="{ 'is-indeterminate': indeterminate }" :role="percent !== undefined ? 'progressbar' : undefined" :aria-label="percent !== undefined ? detail : undefined" :aria-valuenow="percent" :aria-valuemin="percent !== undefined ? 0 : undefined" :aria-valuemax="percent !== undefined ? 100 : undefined">
        <svg viewBox="0 0 32 32" aria-hidden="true"><circle class="download-ring-track" cx="16" cy="16" r="12.5" /><circle v-if="percent !== undefined || indeterminate" class="download-ring-value" cx="16" cy="16" r="12.5" pathLength="100" :stroke-dasharray="`${percent ?? 24} 100`" /></svg>
      </span>
      <Tooltip v-if="cancellable" :text="`${stopLabel} · ${detail}`">
        <button type="button" class="software-progress-stop" :disabled="stopping" :aria-label="stopLabel" :aria-describedby="statusId" data-testid="stop-software-card-installation" @click="emit('stop')"><span class="software-stop-mark" aria-hidden="true" /></button>
      </Tooltip>
    </span>
    <Tooltip :text="detail">
      <span :id="statusId" class="software-progress-label"><span>{{ label }}</span><span v-if="percent !== undefined" class="software-progress-percent">{{ Math.floor(percent) }}%</span></span>
    </Tooltip>
  </span>
</template>

<style scoped>
.software-install-status { display: inline-flex; align-items: center; gap: 6px; min-width: 0; min-height: 32px; color: var(--text-secondary); }
.software-progress-control { position: relative; display: inline-grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; color: var(--accent); }
.download-ring { position: relative; z-index: 1; display: block; width: 32px; height: 32px; pointer-events: none; }
.download-ring svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; }
.download-ring-track { opacity: 0.2; }
.download-ring-value { transform: rotate(-90deg); transform-origin: center; stroke-linecap: round; }
.is-indeterminate svg { animation: software-progress-spin 1.2s linear infinite; }
.software-progress-stop { position: absolute; inset: 0; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.software-progress-stop:hover:not(:disabled) { background: var(--accent-soft); }
.software-progress-stop:active:not(:disabled) { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.software-progress-stop:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.software-progress-stop:disabled { cursor: default; }
.software-stop-mark { width: 8px; height: 8px; border-radius: 1.5px; background: currentColor; }
.software-progress-stop:disabled .software-stop-mark { opacity: 0.4; }
.software-progress-label { display: inline-flex; flex-wrap: wrap; align-items: baseline; column-gap: 6px; min-width: 0; font-size: var(--font-size-control); line-height: 1.4; }
.software-progress-percent { min-width: 4ch; font-variant-numeric: tabular-nums; }
@keyframes software-progress-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .is-indeterminate svg { animation: none; } }
@media (prefers-contrast: more) { .download-ring-track { opacity: 0.5; } }
@media (forced-colors: active) { .software-progress-control { color: ButtonText; } .download-ring-track { opacity: 1; stroke: GrayText; } .software-stop-mark { background: ButtonText; } }
@media (pointer: coarse) { .software-progress-control { flex-basis: 44px; width: 44px; height: 44px; } }
</style>
