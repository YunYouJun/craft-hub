import confetti from 'canvas-confetti'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { celebrationThrottleMs, createCelebrationController } from './celebration'

vi.mock('canvas-confetti', () => ({
  default: Object.assign(vi.fn(), { reset: vi.fn() }),
}))

describe('celebration controller', () => {
  beforeEach(() => {
    vi.mocked(confetti).mockClear()
    vi.mocked(confetti.reset).mockClear()
  })

  it('fires a reduced-motion-aware burst from both sides', () => {
    const controller = createCelebrationController(confetti, () => 1_000)

    expect(controller.fire()).toBe(true)
    expect(confetti).toHaveBeenCalledTimes(2)
    expect(confetti).toHaveBeenNthCalledWith(1, expect.objectContaining({
      angle: 58,
      disableForReducedMotion: true,
      origin: { x: 0, y: 0.72 },
    }))
    expect(confetti).toHaveBeenNthCalledWith(2, expect.objectContaining({
      angle: 122,
      disableForReducedMotion: true,
      origin: { x: 1, y: 0.72 },
    }))
  })

  it('throttles repeated requests and resets cleanly', () => {
    let now = 1_000
    const controller = createCelebrationController(confetti, () => now)

    expect(controller.fire()).toBe(true)
    expect(controller.fire()).toBe(false)
    now += celebrationThrottleMs - 1
    expect(controller.fire()).toBe(false)
    now += 1
    expect(controller.fire()).toBe(true)
    expect(confetti).toHaveBeenCalledTimes(4)

    controller.reset()
    expect(confetti.reset).toHaveBeenCalledTimes(1)
    expect(controller.fire()).toBe(true)
  })
})
