import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('development environment lifecycle', () => {
  it('waits for every child process to exit while stopping', async () => {
    const source = await readFile(new URL('./dev-environment.ts', import.meta.url), 'utf8')

    expect(source).toContain('await Promise.allSettled(childExits)')
  })

  it('reports desktop startup failures to the invoking terminal', async () => {
    const source = await readFile(new URL('../apps/desktop/src/main.ts', import.meta.url), 'utf8')

    expect(source).toContain('process.stderr.write')
    expect(source).toContain('process.exitCode = 1')
  })
})
