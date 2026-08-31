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
    expect(mainSource).toContain('desktopDistribution.desktop.icons.application')
    expect(mainSource).toContain('resolveDesktopDistributionAsset')
    expect(packageMacSource).toContain('desktopDistribution.desktop.icons.macos')
    expect(packageMacSource).toContain('icon: macosApplicationIcon')
    expect(packageMacSource).toContain('copyDistributionAsset')
    expect(packageMacSource).toContain('protocols: [{ name: `')
    expect(packageMacSource).toContain('schemes: [desktopProtocol]')
    expect(packageMacSource).toContain('CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG')
    expect(packageMacSource).toContain('CRAFT_HUB_DESKTOP_OUTPUT_DIR')
    expect(packageMacSource).toContain('identity: \'-\'')
    expect(packageMacSource).toContain('identityValidation: false')
    expect(packageMacSource).toContain('hardenedRuntime: false')
    expect(packageMacSource).toContain('timestamp: \'none\'')
  })

  it('unpacks the native PTY module from the Electron asar archive', async () => {
    const packageMacSource = await readFile(new URL('../../../scripts/package-macos.ts', import.meta.url), 'utf8')
    const nodePtyPatch = await readFile(new URL('../../../patches/node-pty@1.1.0.patch', import.meta.url), 'utf8')

    expect(packageMacSource).toContain('asar: { unpack: \'**/node-pty/**\' }')
    expect(nodePtyPatch).toContain('fs.chmodSync(spawnHelper, 0o755)')
  })

  it('creates architecture-specific DMG installers and ZIP update artifacts', async () => {
    const packageMacSource = await readFile(new URL('../../../scripts/package-macos.ts', import.meta.url), 'utf8')
    const releaseWorkflow = await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')

    expect(packageMacSource).toContain('await symlink(\'/Applications\'')
    expect(packageMacSource).toContain('await execFileAsync(\'hdiutil\'')
    expect(packageMacSource).toContain('\'notarytool\',')
    expect(packageMacSource).toContain('await signDiskImage(dmgPath)')
    expect(packageMacSource).toContain('"Developer ID Application:')
    expect(packageMacSource.indexOf('await signDiskImage(dmgPath)')).toBeLessThan(packageMacSource.indexOf('\'notarytool\','))
    expect(packageMacSource).toContain('await stapleNotarizedArtifact(dmgPath)')
    expect(packageMacSource).toContain('output.includes(\'Record not found\')')
    expect(packageMacSource).toContain('attempt === staplerMaxAttempts')
    expect(packageMacSource).toContain('await execFileAsync(\'ditto\'')
    expect(releaseWorkflow).toContain('Run mounted DMG startup smoke test')
    expect(releaseWorkflow).toContain('codesign --verify --verbose=2 "$dmg_path"')
    expect(releaseWorkflow).toContain('needs: [validate, package-macos]')
    expect(releaseWorkflow.indexOf('Upload verified macOS artifacts')).toBeGreaterThan(releaseWorkflow.indexOf('Run mounted DMG startup smoke test'))
  })

  it('keeps the alpha updater behind a narrow desktop IPC boundary', async () => {
    const updater = await readFile(new URL('../src/updater.ts', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
    const preload = await readFile(new URL('../preload.cjs', import.meta.url), 'utf8')

    expect(updater).toContain('from \'update-electron-app\'')
    expect(updater).toContain('UpdateSourceType.StaticStorage')
    expect(updater).toContain('desktop-update.json')
    expect(main).toContain('ipcMain.handle(\'craft-hub:check-for-updates\'')
    expect(main).toContain('installUpdateAfterShutdown')
    expect(preload).toContain('ipcRenderer.invoke(\'craft-hub:check-for-updates\')')
    expect(preload).toContain('ipcRenderer.on(\'craft-hub:update-status-changed\'')
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

    expect(desktopMain).toContain('app.setName(productName)')
    expect(desktopMain).toContain('app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), applicationIcon, productName, aboutBranding))')
    expect(desktopMain).toContain('installApplicationMenu()')
    expect(desktopMain).toContain('aboutDocument(app.getVersion(), iconDataUrl, productName, aboutBranding)')
    expect(desktopMain).toContain('const windowTitle = developmentUrl ?')
    expect(desktopMain).toContain(': productName')
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
    expect(desktopMain).toContain('Replay Getting Started')
    expect(desktopMain).toContain('mainWindow?.webContents.send(\'craft-hub:replay-onboarding\')')
    expect(await readFile(new URL('../preload.cjs', import.meta.url), 'utf8')).toContain('ipcRenderer.on(\'craft-hub:replay-onboarding\'')
  })

  it('runs one desktop instance and separates development from packaged ports', async () => {
    const desktopMain = (await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')

    expect(desktopMain).toContain('app.requestSingleInstanceLock()')
    expect(desktopMain).toContain('if (!hasSingleInstanceLock) {\n  process.exit(0)\n}')
    expect(desktopMain).toContain('resolveDesktopDataDirectories({')
    expect(desktopMain).toContain('app.setPath(\'userData\', desktopDataDirectories.developmentUserDataDir)')
    expect(desktopMain).toContain('dataDir: desktopDataDirectories.runtimeDataDir')
    expect(desktopMain).toContain('distribution: runtimeDistribution')
    expect(desktopMain).toContain('app.on(\'second-instance\', (_event, argv) => {')
    expect(desktopMain).toContain('findDesktopLinkArgument(argv, [desktopProtocol])')
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
    expect(desktopMain).toContain('defaultPath: directoryDialogDefaultPath(defaultPath)')
    expect(preload).toContain('ipcRenderer.invoke(\'craft-hub:select-project-directory\', defaultPath)')
    expect(preload).toContain('ipcRenderer.invoke(\'craft-hub:select-project-directories\', defaultPath)')
    expect(JSON.parse(tsconfig).compilerOptions.allowImportingTsExtensions).toBe(true)
  })

  it('keeps editor and Codex launch requests in the desktop main process', async () => {
    const desktopMainUrl = new URL('../src/main.ts', import.meta.url)
    const preloadUrl = new URL('../preload.cjs', import.meta.url)
    const [desktopMain, preload] = await Promise.all([
      readFile(desktopMainUrl, 'utf8'),
      readFile(preloadUrl, 'utf8'),
    ])

    expect(desktopMain).toContain('craft-hub:open-capability-source-in-editor')
    expect(desktopMain).toContain('craft-hub:open-capability-working-directory')
    expect(desktopMain).toContain('craft-hub:open-project-directory')
    expect(desktopMain).toContain('craft-hub:open-project-in-vscode')
    expect(desktopMain).toContain('craft-hub:open-project-git-remote')
    expect(desktopMain).toContain('craft-hub:open-project-in-codex')
    expect(desktopMain).toContain('craft-hub:open-workspace-in-codex')
    expect(desktopMain).toContain('craft-hub:open-workspace-in-editor')
    expect(desktopMain).not.toContain('ipcMain.handle(\'craft-hub:open-workspace\',')
    expect(desktopMain).toContain('openCodexProject((await workspaceLaunchTarget(workspaceId)).primaryProjectPath)')
    expect(desktopMain).toContain('craft-hub:start-workspace-in-codex')
    expect(desktopMain).toContain('runtime.agentTasks.start')
    expect(desktopMain).toContain('settings[\'workbench.codex\']')
    expect(desktopMain).toContain('waitForAgentTaskThread')
    const workspaceTaskHandler = desktopMain.slice(
      desktopMain.indexOf('ipcMain.handle(\'craft-hub:start-workspace-in-codex\''),
      desktopMain.indexOf('ipcMain.handle(\'craft-hub:open-codex-thread\''),
    )
    expect(workspaceTaskHandler).not.toContain('shell.openExternal')
    expect(desktopMain).toContain('craft-hub:start-project-in-codex')
    expect(desktopMain).toContain('clipboard.writeText(normalizedPrompt)')
    expect(desktopMain).toContain('craft-hub:open-project-in-terminal')
    expect(desktopMain).toContain('craft-hub:list-terminal-applications')
    expect(desktopMain).toContain('await craftHubServer.runtime.projects.get(projectId)')
    expect(preload).toContain('openCapabilitySourceInEditor')
    expect(preload).toContain('openCapabilityWorkingDirectory')
    expect(preload).toContain('openProjectDirectory')
    expect(preload).toContain('openProjectInVSCode')
    expect(preload).toContain('openProjectGitRemote')
    expect(preload).toContain('openProjectInCodex')
    expect(preload).toContain('openWorkspaceInCodex')
    expect(preload).toContain('openWorkspaceInEditor')
    expect(preload).not.toContain('openWorkspace: (workspaceId, launcher)')
    expect(preload).toContain('startWorkspaceInCodex')
    expect(preload).toContain('startProjectInCodex')
    expect(preload).toContain('openProjectInTerminal')
    expect(preload).toContain('listTerminalApplications')
  })
})
