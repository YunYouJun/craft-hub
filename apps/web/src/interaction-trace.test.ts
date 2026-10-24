// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { beginInteractionTrace } from './interaction-trace'

const traceWindow = window as Window & { __craftHubInteractionTrace?: { samples: unknown[], dropped: number } }
afterEach(() => {
  delete traceWindow.__craftHubInteractionTrace
  vi.restoreAllMocks()
})

it('does not retain measurements without the desktop opt-in', () => {
  const clock = vi.spyOn(window.performance, 'now')
  expect(beginInteractionTrace('palette')).toBeUndefined()
  expect(clock).not.toHaveBeenCalled()
  expect(traceWindow.__craftHubInteractionTrace).toBeUndefined()
})

it('measures one completion on the renderer monotonic clock and never records cancelled work as complete', () => {
  traceWindow.__craftHubInteractionTrace = { samples: [], dropped: 0 }
  const clock = vi.spyOn(window.performance, 'now')
  clock.mockReturnValueOnce(10).mockReturnValueOnce(34).mockReturnValueOnce(50).mockReturnValueOnce(55)
  const finish = beginInteractionTrace('palette')
  finish?.()
  finish?.('cancelled')
  beginInteractionTrace('page')?.('cancelled')
  expect(traceWindow.__craftHubInteractionTrace.samples).toEqual([
    { kind: 'palette', outcome: 'complete', startTimeMs: 10, durationMs: 24, timeOriginMs: window.performance.timeOrigin },
    { kind: 'page', outcome: 'cancelled', startTimeMs: 50, durationMs: 5, timeOriginMs: window.performance.timeOrigin },
  ])
})

it('bounds retained samples and explicitly counts losses while the collector is absent', () => {
  traceWindow.__craftHubInteractionTrace = { samples: [], dropped: 0 }
  for (let index = 0; index < 140; index++)
    beginInteractionTrace('page')?.()
  expect(traceWindow.__craftHubInteractionTrace.samples).toHaveLength(128)
  expect(traceWindow.__craftHubInteractionTrace.dropped).toBe(12)
})
