import type { WebContents } from 'electron'
import { appendFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import process from 'node:process'

interface Sample {
  kind: 'palette' | 'page'
  outcome: 'complete' | 'cancelled'
  timeOriginMs: number
  startTimeMs: number
  durationMs: number
}

/** Treat renderer diagnostics as untrusted: export only the fixed vocabulary and finite timing fields. */
export function readInteractionSamples(value: unknown): Sample[] {
  if (!Array.isArray(value))
    return []
  return value.slice(0, 128).flatMap((entry): Sample[] => {
    if (!entry || typeof entry !== 'object')
      return []
    const { kind, outcome, timeOriginMs, startTimeMs, durationMs } = entry
    if (!['palette', 'page'].includes(kind) || !['complete', 'cancelled'].includes(outcome)
      || ![timeOriginMs, startTimeMs, durationMs].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      || durationMs > 60_000) {
      return []
    }
    return [{ kind, outcome, timeOriginMs, startTimeMs, durationMs }]
  })
}

/** Collect opt-in Vue lifecycle timing without an IPC capability, route names, input text or account data. */
export function startDesktopInteractionTrace(contents: WebContents): void {
  const path = process.env.CRAFT_HUB_PERFORMANCE_TRACE
  if (!path || !isAbsolute(path) || contents.isDestroyed())
    return
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    stopped = true
    clearTimeout(timer)
  }
  contents.once('destroyed', stop)
  const collect = async (): Promise<void> => {
    if (stopped || contents.isDestroyed())
      return
    try {
      const result: unknown = await contents.executeJavaScript(`(() => {
        let state = window.__craftHubInteractionTrace
        if (!state) {
          window.__craftHubInteractionTrace = { samples: [], dropped: 0 }
          return { installed: true, samples: [], dropped: 0 }
        }
        const result = { samples: Array.isArray(state.samples) ? state.samples.splice(0, 128) : [], dropped: state.dropped }
        state.dropped = 0
        return result
      })()`)
      if (!stopped && result && typeof result === 'object') {
        const batch = result as Record<string, unknown>
        const records: object[] = readInteractionSamples(batch.samples).map(sample => ({ event: 'interaction', ...sample }))
        if (batch.installed === true)
          records.unshift({ event: 'interaction-trace-ready' })
        if (typeof batch.dropped === 'number' && Number.isSafeInteger(batch.dropped) && batch.dropped > 0)
          records.push({ event: 'interaction-samples-dropped', count: batch.dropped })
        for (const record of records)
          appendFileSync(path, `${JSON.stringify({ host: 'electron', pid: process.pid, renderer: contents.id, ...record })}\n`, { mode: 0o600 })
      }
    }
    catch { /* Diagnostics must not affect navigation or keep a destroyed window alive. */ }
    if (!stopped)
      timer = setTimeout(collect, 1000).unref()
  }
  void collect()
}
