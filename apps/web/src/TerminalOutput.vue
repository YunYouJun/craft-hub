<script setup lang="ts">
import type { RunRecord } from 'craft-hub'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import '@xterm/xterm/css/xterm.css'
import { useI18n } from './i18n'
import { useWorkbenchStore } from './store'
import { resolvedWorkbenchTheme } from './theme'
import { shouldActivateTerminalLink, terminalHttpUrl } from './terminal-links'

const props = defineProps<{
  commandLabel: string
  run: RunRecord
}>()
const store = useWorkbenchStore()
const { t } = useI18n()
const container = ref<HTMLElement>()
function terminalTheme() {
  return resolvedWorkbenchTheme.value === 'dark'
    ? { background: '#11151b', foreground: '#e7ebf0', cursor: '#e7ebf0', brightBlue: '#6ea8fe', brightGreen: '#74d05b', brightRed: '#ff938a' }
    : { background: '#f6f8fb', foreground: '#242a33', cursor: '#242a33', blue: '#1463df', brightBlue: '#1463df', brightGreen: '#238543', brightRed: '#b42318' }
}

const terminal = new Terminal({
  convertEol: true,
  cursorBlink: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  scrollback: 10_000,
  theme: terminalTheme(),
})
const fitAddon = new FitAddon()
let resizeObserver: ResizeObserver | undefined
let writtenOutput = ''
let inputBuffer = ''
let inputTimer: ReturnType<typeof setTimeout> | undefined
let exitWritten = false
let opened = false

function syncTerminalTypography(): void {
  const fontSize = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--font-size-body'),
  )
  if (Number.isFinite(fontSize))
    terminal.options.fontSize = fontSize
}

async function openUrl(event: MouseEvent, url: string): Promise<void> {
  const platform = window.craftHubDesktop?.platform ?? window.navigator.platform
  if (!shouldActivateTerminalLink(event, platform))
    return
  const safeUrl = terminalHttpUrl(url)
  if (!safeUrl)
    return
  if (window.craftHubDesktop?.openExternalUrl)
    await window.craftHubDesktop.openExternalUrl(safeUrl)
  else
    window.open(safeUrl, '_blank', 'noopener,noreferrer')
}

function flushInput(): void {
  inputTimer = undefined
  if (!inputBuffer)
    return
  const data = inputBuffer
  inputBuffer = ''
  void store.writeRunInput(data)
}

function queueInput(data: string): void {
  inputBuffer += data
  inputTimer ??= setTimeout(flushInput, 16)
}

function syncOutput(output: string): void {
  if (!opened)
    return
  if (output.startsWith(writtenOutput)) {
    terminal.write(output.slice(writtenOutput.length))
  }
  else {
    terminal.reset()
    terminal.write(`\x1B[94m$ ${props.commandLabel}\x1B[0m\r\n`)
    terminal.write(output)
    exitWritten = false
  }
  writtenOutput = output
}

function syncStatus(status: RunRecord['status']): void {
  if (!opened || status === 'running' || exitWritten)
    return
  exitWritten = true
  const message = status === 'cancelled'
    ? t('terminalCancelled')
    : t('exit', { code: String(props.run.exitCode ?? '—') })
  terminal.write(`\r\n\x1B[92m${message}\x1B[0m\r\n`)
}

onMounted(() => {
  if (!container.value)
    return
  syncTerminalTypography()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon((event, url) => void openUrl(event, url)))
  terminal.options.linkHandler = {
    activate: (event, url) => void openUrl(event, url),
    allowNonHttpProtocols: false,
  }
  terminal.open(container.value)
  opened = true
  terminal.write(`\x1B[94m$ ${props.commandLabel}\x1B[0m\r\n`)
  syncOutput(props.run.stdout + props.run.stderr)
  syncStatus(props.run.status)
  terminal.onData(queueInput)
  terminal.onResize(({ cols, rows }) => void store.resizeRun(cols, rows))
  resizeObserver = new ResizeObserver(() => fitAddon.fit())
  resizeObserver.observe(container.value)
  fitAddon.fit()
  if (props.run.status === 'running')
    terminal.focus()
})

watch(() => props.run.stdout + props.run.stderr, syncOutput)
watch(() => props.run.status, syncStatus)
watch(resolvedWorkbenchTheme, () => {
  terminal.options.theme = terminalTheme()
})

onBeforeUnmount(() => {
  opened = false
  if (inputTimer)
    clearTimeout(inputTimer)
  resizeObserver?.disconnect()
  terminal.dispose()
})
</script>

<template>
  <div ref="container" class="xterm-host" data-testid="terminal-output" />
</template>
