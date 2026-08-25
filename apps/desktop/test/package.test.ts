import { readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop package scripts', () => {
  it('passes the tsx loader value as part of the Electron option', async () => {
    const packageJsonUrl = new URL('../package.json', import.meta.url)
    const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).toContain('electron --import=tsx src/main.ts')
  })

  it('ships application icons for the Electron window and macOS package', async () => {
    const iconPngUrl = new URL('../assets/icon.png', import.meta.url)
    const iconIcnsUrl = new URL('../assets/icon.icns', import.meta.url)
    const mainUrl = new URL('../src/main.ts', import.meta.url)
    const packageMacUrl = new URL('../../../scripts/package-macos.ts', import.meta.url)
    const [iconPng, iconIcns, mainSource, packageMacSource] = await Promise.all([
      stat(iconPngUrl),
      stat(iconIcnsUrl),
      readFile(mainUrl, 'utf8'),
      readFile(packageMacUrl, 'utf8'),
    ])

    expect(iconPng.size).toBeGreaterThan(0)
    expect(iconIcns.size).toBeGreaterThan(0)
    expect(mainSource).toContain('icon: applicationIcon')
    expect(mainSource).toContain('app.dock?.setIcon(applicationIcon)')
    expect(packageMacSource).toContain('icon: resolve(repositoryRoot, \'apps/desktop/assets/icon.icns\')')
  })
})
