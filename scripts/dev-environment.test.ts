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

  it('acquires the development session before starting the build watcher', async () => {
    const source = await readFile(new URL('./dev-environment.ts', import.meta.url), 'utf8')

    expect(source.indexOf('const developmentSession = await acquireDevelopmentSessionLock()'))
      .toBeLessThan(source.indexOf('spawnWorkspace(\'Runtime build watcher\''))
  })

  it('lets the build watcher perform the initial build after session ownership is confirmed', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).toBe('tsx scripts/dev-environment.ts desktop')
    expect(packageJson.scripts['dev:web']).toBe('tsx scripts/dev-environment.ts web')
  })
})
