/** Local, payload-free samples enabled only by the desktop's explicit performance session. */
export interface InteractionTraceSample {
  kind: 'palette' | 'page'
  outcome: 'complete' | 'cancelled'
  timeOriginMs: number
  startTimeMs: number
  durationMs: number
}

interface TraceWindow extends Window {
  __craftHubInteractionTrace?: { samples: InteractionTraceSample[], dropped: number }
}

/** Start at the UI state transition; callers finish at their documented lifecycle callback, never at a claimed paint. */
export function beginInteractionTrace(kind: InteractionTraceSample['kind'], target: Window = window): ((outcome?: InteractionTraceSample['outcome']) => void) | undefined {
  const state = (target as TraceWindow).__craftHubInteractionTrace
  if (!state)
    return undefined
  const startTimeMs = target.performance.now()
  const timeOriginMs = target.performance.timeOrigin
  let finished = false
  return (outcome = 'complete') => {
    if (finished)
      return
    finished = true
    if (state.samples.length >= 128) {
      state.dropped++
      return
    }
    state.samples.push({ kind, outcome, timeOriginMs, startTimeMs, durationMs: target.performance.now() - startTimeMs })
  }
}
