import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('runtime package scripts', () => {
  it('keeps existing build output while starting the development watcher', async () => {
    const packageJsonUrl = new URL('../package.json', import.meta.url)
    const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).toContain('tsdown --watch --no-clean')
  })
})
