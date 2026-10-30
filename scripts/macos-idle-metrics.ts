/** Cumulative, read-only libproc counters for one process identity. CPU times use nanoseconds. */
export interface ProcessUsage {
  pid: number
  startedAtMachTicks: string
  cpuUserNs: number
  cpuSystemNs: number
  interruptWakeups: number
  packageIdleWakeups: number
  physicalFootprintBytes: number
  residentBytes: number
}

/** Reject missing permissions, truncated responses and duplicate processes rather than substituting zeros. */
export function readUsageSamples(value: unknown, expected: number[]): ProcessUsage[] {
  if (!value || typeof value !== 'object' || !('cpuUnit' in value) || value.cpuUnit !== 'nanoseconds' || !('samples' in value) || !Array.isArray(value.samples))
    throw new Error('Process usage output is unavailable')
  const rows = value.samples as ProcessUsage[]
  const fields = ['cpuUserNs', 'cpuSystemNs', 'interruptWakeups', 'packageIdleWakeups', 'physicalFootprintBytes', 'residentBytes'] as const
  if (!expected.length || new Set(expected).size !== expected.length || rows.length !== expected.length
    || rows.some(row => !row || !expected.includes(row.pid) || typeof row.startedAtMachTicks !== 'string' || !/^\d+$/.test(row.startedAtMachTicks)
      || BigInt(row.startedAtMachTicks) === 0n || 'error' in row || fields.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0))
    || new Set(rows.map(row => row.pid)).size !== expected.length) {
    throw new Error('Process usage sampling is incomplete')
  }
  return rows
}

/** Only a stable process set with the same kernel birth times can produce an idle interval. 100% is one CPU core. */
export function usageInterval(before: ProcessUsage[], after: ProcessUsage[], elapsedMs: number): {
  elapsedMs: number
  cpuPercent: number
  interruptWakeupsPerSecond: number
  packageIdleWakeupsPerSecond: number
} | undefined {
  if (!before.length || before.length !== after.length || !Number.isFinite(elapsedMs) || elapsedMs <= 0
    || new Set(before.map(row => row.pid)).size !== before.length || new Set(after.map(row => row.pid)).size !== after.length) {
    return
  }
  const totals = { cpuUserNs: 0, cpuSystemNs: 0, interruptWakeups: 0, packageIdleWakeups: 0 }
  for (const previous of before) {
    const current = after.find(row => row.pid === previous.pid && row.startedAtMachTicks === previous.startedAtMachTicks)
    if (!current)
      return
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      const delta = current[key] - previous[key]
      if (!Number.isSafeInteger(delta) || delta < 0)
        return
      totals[key] += delta
    }
  }
  return {
    elapsedMs,
    cpuPercent: (totals.cpuUserNs + totals.cpuSystemNs) / (elapsedMs * 1e6) * 100,
    interruptWakeupsPerSecond: totals.interruptWakeups / (elapsedMs / 1000),
    packageIdleWakeupsPerSecond: totals.packageIdleWakeups / (elapsedMs / 1000),
  }
}
