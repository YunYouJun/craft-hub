import { readFile } from 'node:fs/promises'
import { satisfies } from 'semver'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import contract from '../../../apps/desktop/test/fixtures/node-host-contract.json'
import workspace from '../../../package.json'
import runtime from '../package.json'

describe('runtime Node compatibility contract', () => {
  it('publishes the same bounded range used by the workspace and native host fixtures', () => {
    expect(runtime.engines.node).toBe(contract.engines)
    expect(workspace.engines.node).toBe(contract.engines)
  })

  it.each(contract.versions)('classifies $value as supported=$supported', ({ value, supported }) => {
    expect(satisfies(value, runtime.engines.node)).toBe(supported)
  })

  it('covers every supported major in the shared host fixtures', () => {
    const supported = new Set(contract.supportedMajors)
    for (let major = 0; major < 100; major++) {
      // Include a high minor to cover majors whose supported range starts above x.0.0.
      expect(supported.has(major)).toBe(satisfies(`${major}.999.0`, runtime.engines.node))
    }
  })

  it('runs compatibility CI on supported Node majors', async () => {
    const ci = parse(await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
    const testedMajors = ci.jobs['node-compatibility'].strategy.matrix.node
    expect(testedMajors.length).toBeGreaterThan(0)
    for (const major of testedMajors) {
      expect(contract.supportedMajors).toContain(major)
    }
  })
})
