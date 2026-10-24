export interface PerformanceProcess {
  pid: number
  parent: number
  rssKiB: number
  startedAt: string
  executable: string
}

/** Parse LC_ALL=C ps output, retaining process birth time so cleanup cannot rely on a recycled PID alone. */
export function parsePerformanceProcesses(text: string): PerformanceProcess[] {
  return text.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S.*)$/)
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), rssKiB: Number(match[3]), startedAt: match[4]!.replace(/\s+/g, ' '), executable: match[5]! }] : []
  })
}

/** Match a previously observed process before signaling it; new processes with the same executable are unrelated. */
export function samePerformanceProcess(left: PerformanceProcess, right: PerformanceProcess): boolean {
  return left.pid === right.pid && left.startedAt === right.startedAt && left.executable === right.executable
}

/** Sampling must cover the same process set before and after collection, including newly spawned services. */
export function samePerformanceProcesses(before: readonly PerformanceProcess[], after: readonly PerformanceProcess[]): boolean {
  return before.length === after.length && before.every(row => after.some(current => samePerformanceProcess(row, current)))
}

/** The host and its current descendants; XPC services require independent attribution. */
export function performanceProcessTree(rows: PerformanceProcess[], pid: number): PerformanceProcess[] {
  const selected = new Set([pid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) {
      if (selected.has(row.parent) && !selected.has(row.pid)) {
        selected.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter(row => selected.has(row.pid))
}

/** Only system WebKit service binaries are candidates for responsible-process attribution. */
export function isWebKitService(row: PerformanceProcess): boolean {
  return /^(?:\/System\/Library|\/System\/Volumes\/Preboot\/Cryptexes\/OS\/System\/Library)\/Frameworks\/WebKit\.framework\/.*\/XPCServices\/com\.apple\.WebKit\.[^/]+\.xpc\/Contents\/MacOS\/com\.apple\.WebKit\.[^/]+$/.test(row.executable)
}

/** Select exact responsibility matches; a name, new PID or launch time alone does not prove XPC ownership. */
export function attributedWebKitServices(rows: PerformanceProcess[], responsible: ReadonlyMap<number, number>, host: number): PerformanceProcess[] {
  return rows.filter(row => isWebKitService(row) && responsible.get(row.pid) === host)
}

export interface FootprintMeasurement {
  complete: boolean
  totalBytes?: number
  processes: Array<{ pid: number, physicalFootprintBytes: number }>
  missingPids: number[]
}

/** Reject partial, duplicate or unrelated footprint output instead of reporting an artificially low total. */
export function readFootprintMeasurement(value: unknown, expected: readonly number[]): FootprintMeasurement {
  const missing = (): FootprintMeasurement => ({ complete: false, processes: [], missingPids: [...expected] })
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return missing()
  const report = value as Record<string, unknown>
  if (report.unit !== 'byte' || report['bytes per unit'] !== 1 || !Array.isArray(report.processes)
    || !Array.isArray(report.errors) || report.errors.length || !Array.isArray(report.warnings) || report.warnings.length) {
    return missing()
  }
  const processes: FootprintMeasurement['processes'] = []
  for (const entry of report.processes) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return missing()
    const item = entry as Record<string, unknown>
    const auxiliary = item.auxiliary as Record<string, unknown> | undefined
    const bytes = auxiliary?.phys_footprint
    if (!Number.isSafeInteger(item.pid) || !expected.includes(item.pid as number) || processes.some(row => row.pid === item.pid)
      || !Number.isSafeInteger(bytes) || Number(bytes) < 0) {
      return missing()
    }
    processes.push({ pid: item.pid as number, physicalFootprintBytes: bytes as number })
  }
  const missingPids = expected.filter(pid => !processes.some(row => row.pid === pid))
  const totalBytes = processes.reduce((sum, row) => sum + row.physicalFootprintBytes, 0)
  const complete = missingPids.length === 0 && expected.length > 0 && Number.isSafeInteger(totalBytes)
  return { complete, ...(complete ? { totalBytes } : {}), processes, missingPids }
}
