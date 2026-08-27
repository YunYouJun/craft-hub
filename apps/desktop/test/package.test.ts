import { readdir, readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop package scripts', () => {
  it('uses TypeScript syntax supported by the Electron entry loader', async () => {
    const { stripTypeScriptTypes } = process.getBuiltinModule('node:module')
    const sourceDirectory = new URL('../src/', import.meta.url)
    const sourceFiles = (await readdir(sourceDirectory)).filter(file => file.endsWith('.ts'))

    for (const sourceFile of sourceFiles) {
      const source = await readFile(new URL(sourceFile, sourceDirectory), 'utf8')
      expect(() => stripTypeScriptTypes(source, { mode: 'strip' }), sourceFile).not.toThrow()
    }
  })

  it('passes the tsx loader value as part of the Electron option', async () => {
    const packageJsonUrl = new URL('../package.json', import.meta.url)
    const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.dev).toBe('electron --import=tsx src/main.ts')
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

  it('unpacks the native PTY module from the Electron asar archive', async () => {
    const packageMacSource = await readFile(new URL('../../../scripts/package-macos.ts', import.meta.url), 'utf8')
    const nodePtyPatch = await readFile(new URL('../../../patches/node-pty@1.1.0.patch', import.meta.url), 'utf8')

    expect(packageMacSource).toContain('asar: { unpack: \'**/node-pty/**\' }')
    expect(nodePtyPatch).toContain('fs.chmodSync(spawnHelper, 0o755)')
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
    expect(desktopMain).toContain('app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), applicationIcon))')
    expect(desktopMain).toContain('installApplicationMenu()')
    expect(desktopMain).toContain('aboutDocument(app.getVersion(), iconDataUrl)')
    expect(desktopMain).toContain('const windowTitle = developmentUrl ? \'Craft Hub — Dev\' : \'Craft Hub\'')
    expect(desktopMain).toContain('title: windowTitle')
    expect(desktopMain).toContain('mainWindow.on(\'page-title-updated\', event => event.preventDefault())')
    expect(webIndex).toContain('<title>Craft Hub</title>')
    expect(webMain).toContain('import \'./desktop.css\'')
    expect(webMain).toContain('document.documentElement.dataset.desktopPlatform')
    expect(desktopStyles).toContain(':root[data-desktop-platform=\'darwin\'] .app-shell')
    expect(desktopStyles).toContain(':root[data-desktop-platform=\'darwin\'] .marketplace-page')
    expect(desktopStyles).toContain('-webkit-app-region: drag')
    expect(desktopMain).toContain('nativeTheme.themeSource = theme')
    expect(desktopMain).toContain('settings[\'workbench.theme\']')
    expect(desktopMain).toContain('nativeTheme.shouldUseDarkColors')
  })

  it('runs one desktop instance and separates development from packaged ports', async () => {
    const desktopMain = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(desktopMain).toContain('app.requestSingleInstanceLock()')
    expect(desktopMain).toContain('if (!hasSingleInstanceLock) {\n  process.exit(0)\n}')
    expect(desktopMain).toContain('app.setPath(\'userData\', resolve(app.getPath(\'appData\'), \'Craft Hub Dev\'))')
    expect(desktopMain).toContain('app.on(\'second-instance\', () => void showMainWindow())')
    expect(desktopMain).toContain('mainWindow.restore()')
    expect(desktopMain).toContain('mainWindow.focus()')
    expect(desktopMain).toContain('port: developmentUrl ? 4318 : 0')
  })

  it('closes the local server before quitting and exits when the development window closes', async () => {
    const desktopMain = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(desktopMain).toContain('app.on(\'before-quit\'')
    expect(desktopMain).toContain('window.destroy()')
    expect(desktopMain).toContain('await craftHubServer?.close()')
    expect(desktopMain).toContain('process.platform !== \'darwin\' || developmentUrl')
  })

  it('persists desktop lifecycle failures to a discoverable application log', async () => {
    const desktopMain = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

    expect(desktopMain).toContain('app.setAppLogsPath()')
    expect(desktopMain).toContain('craft-hub.log')
    expect(desktopMain).toContain('Local server started at')
    expect(desktopMain).toContain('render-process-gone')
    expect(desktopMain).toContain('unresponsive')
  })

  it('exposes a sandboxed folder picker through Electron IPC', async () => {
    const desktopMainUrl = new URL('../src/main.ts', import.meta.url)
    const preloadUrl = new URL('../preload.cjs', import.meta.url)
    const tsconfigUrl = new URL('../../../tsconfig.json', import.meta.url)
    const [desktopMain, preload, tsconfig] = await Promise.all([
      readFile(desktopMainUrl, 'utf8'),
      readFile(preloadUrl, 'utf8'),
      readFile(tsconfigUrl, 'utf8'),
    ])

    expect(desktopMain).toContain('ipcMain.handle(\'craft-hub:select-project-directory\'')
    expect(desktopMain).toContain('from \'./folder-picker.ts\'')
    expect(desktopMain).toContain('properties: [\'openDirectory\', \'createDirectory\']')
    expect(desktopMain).toContain('properties: [\'openDirectory\', \'multiSelections\', \'createDirectory\']')
    expect(preload).toContain('ipcRenderer.invoke(\'craft-hub:select-project-directory\')')
    expect(preload).toContain('ipcRenderer.invoke(\'craft-hub:select-project-directories\')')
    expect(JSON.parse(tsconfig).compilerOptions.allowImportingTsExtensions).toBe(true)
  })

  it('keeps editor and Codex launch requests in the desktop main process', async () => {
    const desktopMainUrl = new URL('../src/main.ts', import.meta.url)
    const preloadUrl = new URL('../preload.cjs', import.meta.url)
    const [desktopMain, preload] = await Promise.all([
      readFile(desktopMainUrl, 'utf8'),
      readFile(preloadUrl, 'utf8'),
    ])

    expect(desktopMain).toContain('craft-hub:open-capability-source-in-vscode')
    expect(desktopMain).toContain('craft-hub:open-project-in-vscode')
    expect(desktopMain).toContain('craft-hub:open-project-in-codex')
    expect(desktopMain).toContain('craft-hub:open-workspace')
    expect(desktopMain).toContain('craft-hub:start-project-in-codex')
    expect(desktopMain).toContain('clipboard.writeText(normalizedPrompt)')
    expect(desktopMain).toContain('craft-hub:open-project-in-terminal')
    expect(desktopMain).toContain('craft-hub:list-terminal-applications')
    expect(desktopMain).toContain('await craftHubServer.runtime.projects.get(projectId)')
    expect(preload).toContain('openCapabilitySourceInVSCode')
    expect(preload).toContain('openProjectInVSCode')
    expect(preload).toContain('openProjectInCodex')
    expect(preload).toContain('openWorkspace')
    expect(preload).toContain('startProjectInCodex')
    expect(preload).toContain('openProjectInTerminal')
    expect(preload).toContain('listTerminalApplications')
  })
})
