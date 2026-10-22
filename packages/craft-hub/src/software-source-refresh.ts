import { z } from 'zod'

/** Device-local refresh choices for a saved online software catalog. */
export const softwareSourceRefreshPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('manual') }).strict(),
  z.object({ mode: z.literal('interval'), intervalMinutes: z.number().int().min(15).max(7 * 24 * 60) }).strict(),
  z.object({
    mode: z.literal('daily'),
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().trim().min(1).max(128).refine((timeZone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone }).format(0)
        return true
      }
      catch { return false }
    }, 'Use a valid time zone'),
  }).strict(),
])

/** Manual, elapsed-time or daily wall-clock scheduling, independent of repository contents. */
export type SoftwareSourceRefreshPolicy = z.infer<typeof softwareSourceRefreshPolicySchema>

/** Determine the latest due check, including a single catch-up after the client was closed. */
export function softwareSourceRefreshDue(source: { checkedAt: string, refreshPolicy?: SoftwareSourceRefreshPolicy }, now = Date.now()): boolean {
  const policy = source.refreshPolicy ?? { mode: 'interval', intervalMinutes: 24 * 60 }
  if (policy.mode === 'manual')
    return false
  if (policy.mode === 'interval')
    return now - Date.parse(source.checkedAt) >= policy.intervalMinutes * 60 * 1000

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: policy.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const localMinute = (date: number): string => {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
  }
  const scheduledInstant = (date: string): number => {
    const target = `${date}T${policy.time}`
    const nominal = Date.parse(`${target}:00.000Z`)
    const day = 24 * 60 * 60 * 1000
    const offsets = new Set([-day, 0, day].map((delta) => {
      const sample = nominal + delta
      return Date.parse(`${localMinute(sample)}:00.000Z`) - sample
    }))
    const candidates = [...offsets].map(offset => nominal - offset).sort((a, b) => a - b)
    const exact = candidates.find(candidate => localMinute(candidate) === target)
    if (exact !== undefined)
      return exact // A repeated local time uses its first occurrence.

    // A skipped local time becomes due at the first valid minute after the clock jumps forward.
    let before = candidates[0]!
    let after = candidates[candidates.length - 1]!
    const minute = 60 * 1000
    while (after - before > minute) {
      const middle = Math.floor((before + after) / (2 * minute)) * minute
      if (localMinute(middle) < target)
        before = middle
      else
        after = middle
    }
    return after
  }
  const today = localMinute(now).slice(0, 10)
  let due = scheduledInstant(today)
  if (due > now) {
    const previous = new Date(`${today}T00:00:00.000Z`)
    previous.setUTCDate(previous.getUTCDate() - 1)
    due = scheduledInstant(previous.toISOString().slice(0, 10))
  }
  return Date.parse(source.checkedAt) < due
}
