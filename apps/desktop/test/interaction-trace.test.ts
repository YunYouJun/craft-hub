import { expect, it } from 'vitest'
import { readInteractionSamples } from '../src/interaction-trace.ts'

const valid = { kind: 'palette', outcome: 'complete', timeOriginMs: 1000, startTimeMs: 20, durationMs: 15 }

it('exports only fixed timing fields, never renderer payloads or route names', () => {
  expect(readInteractionSamples([{ ...valid, title: 'private', path: '/private', secret: 'fixture' }])).toEqual([valid])
  expect(readInteractionSamples([{ ...valid, kind: 'private title' }, { ...valid, outcome: 'unknown' }])).toEqual([])
})

it('rejects invalid and implausible timings and bounds untrusted batches', () => {
  for (const durationMs of [NaN, Infinity, -1, 60001, '15', null])
    expect(readInteractionSamples([{ ...valid, durationMs }])).toEqual([])
  expect(readInteractionSamples([null, false, { ...valid, timeOriginMs: -1 }, { ...valid, startTimeMs: Infinity }])).toEqual([])
  expect(readInteractionSamples(Array.from({ length: 150 }).fill(valid))).toHaveLength(128)
  expect(readInteractionSamples({ samples: [valid] })).toEqual([])
})
