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

  it('brands the desktop shell and reserves the macOS title-bar safe area', async () => {
    const desktopMainUrl = new URL('../src/main.ts', import.meta.url)
    const webIndexUrl = new URL('../../web/index.html', import.meta.url)
    const webMainUrl = new URL('../../web/src/main.ts', import.meta.url)
    const desktopStylesUrl = new URL('../../web/src/desktop.css', import.meta.url)
    const [desktopMain, webIndex, webMain, desktopStyles] = await Promise.all([
      readFile(desktopMainUrl, 'utf8'),
      readFile(webIndexUrl, 'utf8'),
      readFile(webMainUrl, 'utf8'),
      readFile(desktopStylesUrl, 'utf8'),
    ])

    expect(desktopMain).toContain('app.setName(\'Craft Hub\')')
    expect(desktopMain).toContain('title: \'Craft Hub\'')
    expect(webIndex).toContain('<title>Craft Hub</title>')
    expect(webMain).toContain('import \'./desktop.css\'')
    expect(webMain).toContain('document.documentElement.dataset.desktopPlatform')
    expect(desktopStyles).toContain(':root[data-desktop-platform=\'darwin\'] .app-shell')
    expect(desktopStyles).toContain('-webkit-app-region: drag')
  })
})
