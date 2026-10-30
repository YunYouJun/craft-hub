import { expect, it } from 'vitest'
import { readUsageSamples, usageInterval } from './macos-idle-metrics'

const first = { pid: 21, startedAtMachTicks: '123456789123456789', cpuUserNs: 10, cpuSystemNs: 20, interruptWakeups: 30, packageIdleWakeups: 5, physicalFootprintBytes: 1000, residentBytes: 2000 }

it('calculates CPU and the two distinct wakeup rates without treating RSS as footprint', () => {
  const before = readUsageSamples({ cpuUnit: 'nanoseconds', samples: [first] }, [21])
  const after = readUsageSamples({ cpuUnit: 'nanoseconds', samples: [{ ...first, cpuUserNs: 800_000_010, cpuSystemNs: 200_000_020, interruptWakeups: 50, packageIdleWakeups: 6 }] }, [21])
  expect(usageInterval(before, after, 10_000)).toEqual({ elapsedMs: 10_000, cpuPercent: 10, interruptWakeupsPerSecond: 2, packageIdleWakeupsPerSecond: 0.1 })
  expect(after[0]!.physicalFootprintBytes).toBe(1000)
})

it('does not report zero CPU for a recycled PID, counter rollback or changed process set', () => {
  for (const after of [[], [first, { ...first, pid: 22 }], [{ ...first, startedAtMachTicks: '2' }], [{ ...first, interruptWakeups: 29 }]])
    expect(usageInterval([first], after, 1000)).toBeUndefined()
  expect(usageInterval([first], [first], 0)).toBeUndefined()
  expect(usageInterval([first], [first], Number.NaN)).toBeUndefined()
})

it('rejects failed, duplicate, partial and imprecise kernel counters', () => {
  for (const samples of [[], [{ pid: 21, error: 1 }], [first, first], [{ ...first, cpuUserNs: Number.MAX_SAFE_INTEGER + 1 }], [{ ...first, startedAtMachTicks: 'invalid' }]])
    expect(() => readUsageSamples({ cpuUnit: 'nanoseconds', samples }, [21])).toThrow('incomplete')
  expect(() => readUsageSamples({ cpuUnit: 'ticks', samples: [first] }, [21])).toThrow('unavailable')
})
