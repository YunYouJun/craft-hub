import { expect, it } from 'vitest'
import { attributedWebKitServices, parsePerformanceProcesses, performanceProcessTree, readFootprintMeasurement, samePerformanceProcess, samePerformanceProcesses } from './macos-performance.ts'

it('keeps paths with spaces and process birth times when selecting descendants', () => {
  const rows = parsePerformanceProcesses(`
  21 1 1200 Fri Oct 23 14:00:01 2026 /fixture/Craft Hub.app/Contents/MacOS/Craft Hub
  22 21 300 Fri Oct 23 14:00:02 2026 /fixture/node
  23 22 400 Fri Oct 23 14:00:03 2026 /fixture/worker
  24 1 500 Fri Oct 23 14:00:04 2026 /fixture/other
  invalid row
`)
  expect(performanceProcessTree(rows, 21).map(row => row.pid)).toEqual([21, 22, 23])
  expect(rows[0]!.executable).toBe('/fixture/Craft Hub.app/Contents/MacOS/Craft Hub')
  expect(samePerformanceProcess(rows[0]!, { ...rows[0]!, startedAt: 'Fri Oct 23 14:00:05 2026' })).toBe(false)
  expect(samePerformanceProcess(rows[0]!, { ...rows[0]!, executable: '/replacement' })).toBe(false)
  expect(samePerformanceProcess(rows[0]!, { ...rows[0]!, rssKiB: 2000 })).toBe(true)
  expect(samePerformanceProcesses(rows, [...rows].reverse())).toBe(true)
  expect(samePerformanceProcesses(rows, [...rows, { ...rows[0]!, pid: 25 }])).toBe(false)
  expect(samePerformanceProcesses(rows, rows.slice(1))).toBe(false)
  expect(samePerformanceProcesses(rows, rows.map(row => ({ ...row, startedAt: 'Fri Oct 23 14:00:05 2026' })))).toBe(false)
})

it('includes only system WebKit services attributed to the exact measured host', () => {
  const service = '/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent'
  const rows = parsePerformanceProcesses([service, service, `/tmp${service}`].map((path, i) => `${30 + i} 1 100 Fri Oct 23 14:00:01 2026 ${path}`).join('\n'))
  expect(attributedWebKitServices(rows, new Map([[30, 21], [31, 99], [32, 21]]), 21).map(row => row.pid)).toEqual([30])
  expect(attributedWebKitServices(rows, new Map(), 21)).toEqual([])
})

it('reads physical footprint rather than RSS or the tool’s dirty-region total', () => {
  const report = { 'unit': 'byte', 'bytes per unit': 1, 'processes': [{ pid: 21, footprint: 90, auxiliary: { phys_footprint: 100 } }, { pid: 22, footprint: 180, auxiliary: { phys_footprint: 200 } }], 'errors': [], 'warnings': [] }
  expect(readFootprintMeasurement(report, [21, 22])).toEqual({ complete: true, totalBytes: 300, processes: [{ pid: 21, physicalFootprintBytes: 100 }, { pid: 22, physicalFootprintBytes: 200 }], missingPids: [] })
  expect(readFootprintMeasurement(report, [21, 22, 23])).toMatchObject({ complete: false, missingPids: [23] })
  expect(readFootprintMeasurement(report, [21, 22, 23])).not.toHaveProperty('totalBytes')
  for (const invalid of [{ ...report, errors: ['access denied'] }, { ...report, warnings: ['incomplete accounting'] }, { ...report, unit: 'page' }, { ...report, processes: [...report.processes, report.processes[0]] }, { ...report, processes: [{ pid: 21, auxiliary: { phys_footprint: -1 } }] }])
    expect(readFootprintMeasurement(invalid, [21, 22]).complete).toBe(false)
  expect(readFootprintMeasurement(report, [21]).complete).toBe(false)
})
