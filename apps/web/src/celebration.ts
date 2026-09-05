import confetti from 'canvas-confetti'

export const celebrationThrottleMs = 1_000

const burstOptions = {
  colors: ['#f26a3d', '#f5b942', '#37b67a', '#4b8ef7', '#a970ff'],
  disableForReducedMotion: true,
  gravity: 0.95,
  particleCount: 56,
  resize: true,
  scalar: 0.9,
  spread: 68,
  startVelocity: 44,
  ticks: 220,
  zIndex: 1_000,
}

export interface CelebrationController {
  fire: () => boolean
  reset: () => void
}

export function createCelebrationController(
  emitter: typeof confetti = confetti,
  now: () => number = Date.now,
): CelebrationController {
  let lastFiredAt = Number.NEGATIVE_INFINITY

  return {
    fire(): boolean {
      const firedAt = now()
      if (firedAt - lastFiredAt < celebrationThrottleMs)
        return false
      lastFiredAt = firedAt
      void emitter({
        ...burstOptions,
        angle: 58,
        origin: { x: 0, y: 0.72 },
      })
      void emitter({
        ...burstOptions,
        angle: 122,
        origin: { x: 1, y: 0.72 },
      })
      return true
    },
    reset(): void {
      lastFiredAt = Number.NEGATIVE_INFINITY
      emitter.reset()
    },
  }
}

export const celebration = createCelebrationController()
