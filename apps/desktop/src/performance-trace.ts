import { appendFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

/** Opt-in local readiness evidence; only fixed marker names and timing metadata, never runtime payloads. */
export function traceDesktopPerformance(event: 'app-launched' | 'runtime-ready' | 'window-presented' | 'web-ready'): void {
  const path = process.env.CRAFT_HUB_PERFORMANCE_TRACE
  if (!path || !isAbsolute(path))
    return
  try {
    appendFileSync(path, `${JSON.stringify({ host: 'electron', event, pid: process.pid, wallTimeMs: Date.now(), uptimeMs: performance.now() })}\n`, { mode: 0o600 })
  }
  catch { /* Diagnostics must never prevent the app from starting. */ }
}
