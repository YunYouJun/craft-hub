import type { CraftHubServer, ProjectReference } from 'craft-hub'
import type { BrowserWindow as BrowserWindowType, OpenDialogOptions } from 'electron'
import type { DesktopMenuAction, DesktopMenuLocale } from './application-menu.ts'
import type { DesktopUpdateStatus } from './updater.ts'
import { appendFileSync, existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PersonalCloudController } from '@craft-hub/personal-cloud'
import { communityDistribution, HostExtensionManager, ProfileMigrationGuardError, startCraftHubServer } from 'craft-hub'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, shell } from 'electron'
import { aboutDocument, aboutPanelOptions } from './about.ts'
import { createApplicationMenu, createEditContextMenu, createWorkbenchMenuShortcutMatcher, isDesktopMenuLocale } from './application-menu.ts'
import { loadDesktopBuildInfo } from './build-info.ts'
import { CodexActivityMonitor } from './codex-activity.ts'
import { resolveDesktopDataDirectories } from './data-directories.ts'
import { DesktopLinkCoordinator, DesktopLinkError, findDesktopLinkArgument } from './deep-links.ts'
import { DeviceVault } from './device-vault.ts'
import { communityDesktopAboutBranding, communityDesktopDevelopmentProtocol, communityDesktopProtocol, communityDesktopUpdateBaseUrl, loadDesktopDistributionManifest, resolveDesktopDistributionAsset } from './distribution.ts'
import { installExternalNavigationHandlers } from './external-navigation.ts'
import { selectedDirectoryPath, selectedDirectoryPaths } from './folder-picker.ts'
import { registerHostExtensionHandlers } from './host-extensions.ts'
import { createBuiltinHostPlugins, createDesktopHostRuntime, optionalHostPluginStatus } from './host-runtime.ts'
import { startDesktopInteractionTrace } from './interaction-trace.ts'
import { createNativeMigrationEntry, nativeMigrationArgument } from './native-migration-entry.ts'
import { externalHttpUrl, openPersonalWorkbenchTool } from './open-targets.ts'
import { traceDesktopPerformance } from './performance-trace.ts'
import { createProjectLaunchService } from './project-launch.ts'
import { createDeferredOnceTask } from './shutdown-task.ts'
import { DesktopUpdater } from './updater.ts'
import { mainWindowAppearance, windowBackgroundColor } from './window-appearance.ts'
import { readWindowState, restoreWindowState, writeWindowState } from './window-state.ts'

let quickCaptureRegistered = false
let pendingQuickCapture = false

const packagedDesktopBuildInfoPath = fileURLToPath(new URL('../desktop-build.json', import.meta.url))
const desktopBuildInfo = loadDesktopBuildInfo(packagedDesktopBuildInfoPath)
const packagedDistributionManifestPath = fileURLToPath(new URL('../distribution.json', import.meta.url))
const configuredDistributionManifestPath = process.env.CRAFT_HUB_DESKTOP_DISTRIBUTION_CONFIG
const desktopDistributionManifestPath = configuredDistributionManifestPath
  ? resolve(configuredDistributionManifestPath)
  : packagedDistributionManifestPath
const desktopDistribution = loadDesktopDistributionManifest(desktopDistributionManifestPath)
const runtimeDistribution = desktopDistribution?.distribution ?? communityDistribution
const productName = runtimeDistribution.name
const aboutBranding = desktopDistribution?.desktop.about ?? communityDesktopAboutBranding
const configuredDesktopUpdateBaseUrl = desktopDistribution?.desktop.updateBaseUrl
  ?? (!desktopDistribution ? communityDesktopUpdateBaseUrl : undefined)
const desktopUpdateBaseUrl = desktopBuildInfo.updatesEnabled && configuredDesktopUpdateBaseUrl
  ? `${configuredDesktopUpdateBaseUrl}/${process.platform}/${process.arch}`
  : undefined

let mainWindow: BrowserWindowType | undefined
let desktopMenuLocale: DesktopMenuLocale = 'zh-CN'
let aboutWindow: BrowserWindowType | undefined
let craftHubServer: CraftHubServer | undefined
let readyToQuit = false
let shuttingDown = false
let personalCloud: PersonalCloudController | undefined
let desktopUpdater: DesktopUpdater | undefined
let codexActivityMonitor: CodexActivityMonitor | undefined
let installUpdateAfterShutdown = false
const openNativeMigration = createNativeMigrationEntry({
  canRestart: () => app.isPackaged && process.platform === 'darwin' && craftHubServer !== undefined && !shuttingDown && !installUpdateAfterShutdown,
  hasActiveWork: async () => Boolean(craftHubServer?.runtime.projectRunSummaries().some(summary => summary.running > 0))
    || Boolean((await craftHubServer?.runtime.agentTasks.list())?.some(task => task.status === 'running')),
  restart: () => {
    app.relaunch({ args: [nativeMigrationArgument] })
    app.quit()
  },
})
const applicationIcon = desktopDistribution?.desktop.icons
  ? resolveDesktopDistributionAsset(desktopDistributionManifestPath, desktopDistribution.desktop.icons.application)
  : resolve(fileURLToPath(new URL('.', import.meta.url)), '../assets/icon.png')
if (!existsSync(applicationIcon))
  throw new Error(`Desktop application icon does not exist: ${applicationIcon}`)
const developmentUrl = process.env.CRAFT_HUB_DEV_URL
const desktopDataDirectories = resolveDesktopDataDirectories({
  appDataDir: app.getPath('appData'),
  development: Boolean(developmentUrl),
  distribution: runtimeDistribution,
})
if (desktopDataDirectories.developmentUserDataDir)
  app.setPath('userData', desktopDataDirectories.developmentUserDataDir)
// Acceptance runs isolate Chromium preferences as well as runtime state; never change the default profile.
if (process.env.CRAFT_HUB_DESKTOP_PROFILE_DIR && isAbsolute(process.env.CRAFT_HUB_DESKTOP_PROFILE_DIR))
  app.setPath('userData', process.env.CRAFT_HUB_DESKTOP_PROFILE_DIR)
const windowTitle = developmentUrl ? `${productName} — Dev` : productName
const desktopProtocol = developmentUrl
  ? desktopDistribution?.desktop.developmentProtocol ?? communityDesktopDevelopmentProtocol
  : desktopDistribution?.desktop.protocol ?? communityDesktopProtocol
const desktopLinks = new DesktopLinkCoordinator()

type DesktopTheme = 'system' | 'light' | 'dark'

function isDesktopTheme(value: unknown): value is DesktopTheme {
  return value === 'system' || value === 'light' || value === 'dark'
}

function applyDesktopTheme(theme: DesktopTheme): void {
  nativeTheme.themeSource = theme
  mainWindow?.setBackgroundColor(windowBackgroundColor(process.platform, nativeTheme.shouldUseDarkColors))
}

async function showAboutWindow(): Promise<void> {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show()
    aboutWindow.focus()
    return
  }

  aboutWindow = new BrowserWindow({
    width: 420,
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${productName}`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f232b' : '#ffffff',
    ...(mainWindow ? { parent: mainWindow } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  aboutWindow.setMenuBarVisibility(false)
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === aboutBranding.website)
      void shell.openExternal(url)
    return { action: 'deny' }
  })
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url === aboutBranding.website)
      void shell.openExternal(url)
  })
  aboutWindow.once('closed', () => {
    aboutWindow = undefined
  })
  const iconDataUrl = nativeImage.createFromPath(applicationIcon).toDataURL()
  await aboutWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(aboutDocument(app.getVersion(), iconDataUrl, productName, aboutBranding))}`)
}

async function replayOnboarding(): Promise<void> {
  await showMainWindow()
  mainWindow?.webContents.send('craft-hub:replay-onboarding')
}

async function openHelp(): Promise<void> {
  await showMainWindow()
  mainWindow?.webContents.send('craft-hub:open-help')
}

async function openSettings(): Promise<void> {
  await showMainWindow()
  mainWindow?.webContents.send('craft-hub:open-settings')
}

async function performMenuAction(action: DesktopMenuAction): Promise<void> {
  await showMainWindow()
  mainWindow?.webContents.send('craft-hub:menu-action', action)
}

function installApplicationMenu(): void {
  if (process.platform !== 'darwin')
    return

  const template = createApplicationMenu({
    applicationName: productName,
    locale: desktopMenuLocale,
    platform: process.platform,
    onAction: action => void performMenuAction(action),
    onAbout: () => void showAboutWindow(),
    onCheckForUpdates: () => {
      void openSettings().then(() => desktopUpdater?.checkNow())
    },
    onSettings: () => void openSettings(),
    ...(app.isPackaged ? { onNativeMigration: () => void openNativeMigration() } : {}),
    onHelp: () => void openHelp(),
    onReplayOnboarding: () => void replayOnboarding(),
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function applyDesktopMenuLocale(locale: DesktopMenuLocale): void {
  if (desktopMenuLocale === locale)
    return
  desktopMenuLocale = locale
  installApplicationMenu()
}

app.setName(productName)
if (process.env.CRAFT_HUB_DESKTOP_PROFILE_DIR)
  app.setAppLogsPath(join(app.getPath('userData'), 'logs'))
else
  app.setAppLogsPath()
const applicationLogPath = resolve(app.getPath('logs'), 'craft-hub.log')

function writeApplicationLog(level: 'info' | 'error', message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`
  try {
    appendFileSync(applicationLogPath, line, 'utf8')
  }
  catch {
    process.stderr.write(line)
  }
}

app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), applicationIcon, productName, aboutBranding))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

nativeTheme.on('updated', () => {
  mainWindow?.setBackgroundColor(windowBackgroundColor(process.platform, nativeTheme.shouldUseDarkColors))
})

// macOS discovers the packaged Info.plist declaration. Re-registering on every launch would
// override an explicit native-host handover (including when launching Electron for rollback).
if (process.platform !== 'darwin' && !process.env.CRAFT_HUB_PERFORMANCE_TRACE)
  app.setAsDefaultProtocolClient(desktopProtocol)
app.on('open-url', (event, url) => {
  event.preventDefault()
  void handleProtocolUrl(url)
})
app.on('second-instance', (_event, argv) => {
  const link = findDesktopLinkArgument(argv, [desktopProtocol])
  if (link)
    void handleProtocolUrl(link)
  else if (app.isReady())
    void showMainWindow()
})

function directoryDialogDefaultPath(value: unknown): string | undefined {
  return typeof value === 'string' && isAbsolute(value) && !value.includes('\0') ? value : undefined
}

const workstationDirectory = fileURLToPath(new URL('../workstation-runtime', import.meta.url)).replace(/\.asar(?=\/)/, '.asar.unpacked')
const builtinHostPlugins = createBuiltinHostPlugins({
  workstationDirectory,
  workstationExecutable: process.platform === 'darwin' ? join(workstationDirectory, 'node/bin/node') : process.execPath,
  workstationElectronNodeMode: process.platform !== 'darwin',
  dataDir: desktopDataDirectories.runtimeDataDir,
})
const workstation = builtinHostPlugins.workstation
const hostExtensionManager = new HostExtensionManager(desktopDataDirectories.runtimeDataDir)
registerHostExtensionHandlers({
  manager: hostExtensionManager,
  bundledExtensions: workstation.bundled ? [{ id: 'workstation', name: 'Workstation', version: workstation.bundled.version }] : [],
  optionalBundledExtensions: () => optionalHostPluginStatus(hostExtensionManager, builtinHostPlugins.optionalPlugins),
  window: () => mainWindow,
  localPluginPath: async (packageName) => {
    const plugin = (await craftHubServer?.runtime.pluginManager.listInstalled())?.find(item => item.package === packageName)
    return plugin?.origin === 'local' && plugin.manifest.contributes.integrations.length ? plugin.packagePath : undefined
  },
  restart: async () => {
    if (craftHubServer?.runtime.projectRunSummaries().some(summary => summary.running > 0))
      throw new Error('请先结束运行中的命令再重启 / Finish active commands before restarting')
    const tasks = await craftHubServer?.runtime.agentTasks.list() ?? []
    if (tasks.some(task => task.status === 'running'))
      throw new Error('请先结束运行中的 Agent 任务再重启 / Finish active agent tasks before restarting')
    app.relaunch()
    app.quit()
  },
})

ipcMain.handle('craft-hub:select-project-directory', async (_event, defaultPath: unknown) => {
  const options: OpenDialogOptions = {
    defaultPath: directoryDialogDefaultPath(defaultPath),
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return selectedDirectoryPath(result)
})

ipcMain.handle('craft-hub:select-project-directories', async (_event, defaultPath: unknown) => {
  const options: OpenDialogOptions = {
    defaultPath: directoryDialogDefaultPath(defaultPath),
    properties: ['openDirectory', 'multiSelections', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return selectedDirectoryPaths(result)
})

const projectLaunch = createProjectLaunchService(() => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  return craftHubServer.runtime
}, {
  openURL: url => shell.openExternal(url),
  reportError: message => writeApplicationLog('error', message),
  openPath: async (path) => {
    const error = await shell.openPath(path)
    if (error)
      throw new Error(error)
  },
})

ipcMain.handle('craft-hub:open-project-in-vscode', (_event, projectId: string) => projectLaunch.openProjectInVSCode(projectId))
ipcMain.handle('craft-hub:open-project-in-editor', (_event, projectId: string) => projectLaunch.openProjectInEditor(projectId))
ipcMain.handle('craft-hub:open-integration-source', (_event, integrationId: string, actionId: string, entityId: string, detailIndex: number, projectId?: string) => projectLaunch.openIntegrationSource(integrationId, actionId, entityId, detailIndex, projectId))
ipcMain.handle('craft-hub:open-project-evidence-in-editor', async (_event, projectId: string, path: unknown, line: unknown, column: unknown) => {
  if (typeof path !== 'string')
    throw new TypeError('Evidence path is required')
  await projectLaunch.openProjectEvidenceInEditor(projectId, path, typeof line === 'number' ? line : undefined, typeof column === 'number' ? column : undefined)
})
ipcMain.handle('craft-hub:open-project-directory', (_event, projectId: string) => projectLaunch.openProjectDirectory(projectId))
ipcMain.handle('craft-hub:open-project-git-remote', (_event, projectId: string) => projectLaunch.openProjectGitRemote(projectId))
ipcMain.handle('craft-hub:open-capability-source-in-editor', (_event, projectId: string, capabilityId: string) => projectLaunch.openCapabilitySourceInEditor(projectId, capabilityId))
ipcMain.handle('craft-hub:open-capability-working-directory', (_event, projectId: string, capabilityId: string) => projectLaunch.openCapabilityWorkingDirectory(projectId, capabilityId))
ipcMain.handle('craft-hub:open-project-in-codex', (_event, projectId: string) => projectLaunch.openProjectInCodex(projectId))
ipcMain.handle('craft-hub:open-workspace-in-codex', (_event, workspaceId: string) => projectLaunch.openWorkspaceInCodex(workspaceId))
ipcMain.handle('craft-hub:open-workspace-in-editor', (_event, workspaceId: string) => projectLaunch.openWorkspaceInEditor(workspaceId))

ipcMain.handle('craft-hub:start-project-in-codex', async (_event, projectId: string, prompt: string, packageRelativePath = '.') => {
  const prepared = await projectLaunch.prepareProjectCodexHandoff(projectId, prompt, packageRelativePath)
  clipboard.writeText(prepared.prompt)
  await projectLaunch.openProjectInCodex(projectId, packageRelativePath)
})

ipcMain.handle('craft-hub:start-workspace-in-codex', (_event, workspaceId: string, projectIds: string[], primaryProjectId: string, prompt: string) => projectLaunch.startWorkspaceInCodex(workspaceId, projectIds, primaryProjectId, prompt))

ipcMain.handle('craft-hub:open-codex-thread', async (_event, threadId: string) => {
  await projectLaunch.openCodexThread(threadId)
})

ipcMain.handle('craft-hub:focus-codex-application', () => projectLaunch.focusCodexApplication())
ipcMain.handle('craft-hub:codex-activity-status', () => codexActivityMonitor?.status())
ipcMain.handle('craft-hub:install-codex-activity-hooks', () => codexActivityMonitor?.install())
ipcMain.handle('craft-hub:uninstall-codex-activity-hooks', () => codexActivityMonitor?.uninstall())

ipcMain.handle('craft-hub:list-terminal-applications', () => projectLaunch.listTerminalApplications())
ipcMain.handle('craft-hub:open-project-in-terminal', (_event, projectId: string, application?: string) => projectLaunch.openProjectInTerminal(projectId, application))
ipcMain.handle('craft-hub:open-dotfiles-in-terminal', () => projectLaunch.openDotfilesInTerminal())

ipcMain.handle('craft-hub:open-external-url', async (_event, url: string) => {
  await shell.openExternal(externalHttpUrl(url))
})

ipcMain.handle('craft-hub:open-workbench-tool', async (_event, toolId: unknown) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  if (typeof toolId !== 'string')
    throw new TypeError('Workbench tool identifier is required')
  const home = (await craftHubServer.runtime.settings.get()).settings['workbench.home']
  const tool = home.tools.find(tool => tool.id === toolId)
  if (!tool)
    throw new Error('Unknown workbench tool')
  return openPersonalWorkbenchTool(tool, url => shell.openExternal(url))
})

ipcMain.handle('craft-hub:open-settings-file', () => projectLaunch.openSettingsFile())

ipcMain.handle('craft-hub:set-theme', (_event, theme: unknown) => {
  if (!isDesktopTheme(theme))
    throw new Error('Theme must be system, light, or dark')
  applyDesktopTheme(theme)
})

ipcMain.handle('craft-hub:set-locale', (_event, locale: unknown) => {
  if (!isDesktopMenuLocale(locale))
    throw new TypeError('Locale must be en or zh-CN')
  applyDesktopMenuLocale(locale)
})

ipcMain.handle('craft-hub:update-status', () => desktopUpdater?.status())
ipcMain.handle('craft-hub:set-automatic-updates', (_event, enabled: unknown) => {
  if (typeof enabled !== 'boolean')
    throw new TypeError('Automatic update preference must be a boolean')
  if (!desktopUpdater)
    throw new Error('Updater is still starting')
  return desktopUpdater.setAutomaticCheck(enabled)
})
ipcMain.handle('craft-hub:check-for-updates', () => {
  if (!desktopUpdater)
    throw new Error('Updater is still starting')
  return desktopUpdater.checkNow()
})
ipcMain.handle('craft-hub:install-update', () => {
  if (!desktopUpdater)
    throw new Error('Updater is still starting')
  return desktopUpdater.requestInstall()
})

ipcMain.handle('craft-hub:cloud-status', () => personalCloud?.status() ?? { state: 'disabled' })
ipcMain.handle('craft-hub:cloud-connect', () => personalCloud?.connect())
ipcMain.handle('craft-hub:cloud-disconnect', () => personalCloud?.disconnect())
ipcMain.handle('craft-hub:cloud-synchronize', () => personalCloud?.synchronize())
ipcMain.handle('craft-hub:consume-quick-capture', () => {
  const pending = pendingQuickCapture
  pendingQuickCapture = false
  return pending
})
ipcMain.handle('craft-hub:quick-capture-status', () => ({ registered: quickCaptureRegistered, accelerator: 'CommandOrControl+Shift+Space' }))
ipcMain.handle('craft-hub:consume-celebration', () => desktopLinks.consumeCelebration())
ipcMain.handle('craft-hub:consume-marketplace-source-import', () => desktopLinks.consumeMarketplaceImport())
ipcMain.handle('craft-hub:consume-desktop-navigation', async () => {
  const navigation = desktopLinks.consumeNavigation()
  if (!navigation || navigation.kind !== 'project')
    return navigation
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  return {
    ...navigation,
    matches: await craftHubServer.runtime.projects.resolveReference(navigation.reference),
  }
})
ipcMain.handle('craft-hub:verify-project-reference', async (_event, reference: ProjectReference, path: unknown) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  if (!reference || typeof reference.repository !== 'string' || (reference.subdir !== undefined && typeof reference.subdir !== 'string') || typeof path !== 'string')
    throw new TypeError('Project Reference and local directory are required')
  await craftHubServer.runtime.projects.verifyReference(path, reference)
  return true
})

async function handleProtocolUrl(url: string): Promise<void> {
  try {
    const link = desktopLinks.accept(url, [desktopProtocol])
    if (!app.isReady())
      return
    if (link.kind === 'cloud-connect') {
      await handlePendingCloudCallback()
      return
    }
    await showMainWindow()
    mainWindow?.webContents.send(
      link.kind === 'celebration'
        ? 'craft-hub:celebration-requested'
        : link.kind === 'marketplace-import'
          ? 'craft-hub:marketplace-source-import-available'
          : 'craft-hub:desktop-navigation-available',
    )
  }
  catch (error) {
    const reason = error instanceof DesktopLinkError ? error.code : 'unexpected-error'
    writeApplicationLog('error', `Desktop Link rejected: ${reason}`)
  }
}

async function handlePendingCloudCallback(): Promise<void> {
  if (!personalCloud)
    return
  const url = desktopLinks.consumeCloudConnect()
  if (!url)
    return
  try {
    await personalCloud.adopt(url)
    focusMainWindow()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeApplicationLog('error', `Personal cloud connection failed: ${message}`)
    if (mainWindow)
      await dialog.showMessageBox(mainWindow, { type: 'error', title: '个人云连接失败', message })
  }
}

async function initializePersonalCloud(): Promise<void> {
  if (!craftHubServer || personalCloud)
    return
  personalCloud = new PersonalCloudController({
    endpoint: process.env.CRAFT_HUB_CLOUD_ENDPOINT,
    webOrigin: process.env.CRAFT_HUB_CLOUD_ORIGIN,
    callbackScheme: desktopProtocol,
    dataDir: craftHubServer.runtime.store.dataDir,
    platform: process.platform,
    runtime: craftHubServer.runtime,
    vault: new DeviceVault(craftHubServer.runtime.store.dataDir, safeStorage, process.platform),
    openExternal: url => shell.openExternal(url),
    approve: async (projectName, capabilityName) => {
      const options = {
        type: 'warning' as const,
        title: '个人云远程请求',
        message: `是否运行“${capabilityName}”？`,
        detail: `项目：${projectName}\n请求只会调用 Craft Hub 已发现的本地命令。`,
        buttons: ['拒绝', '运行'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }
      const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options)
      return result.response === 1
    },
  })
  await personalCloud.start()
  await handlePendingCloudCallback()
}

async function loadUrlWithRetry(window: BrowserWindowType, url: string): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await window.loadURL(url)
      return
    }
    catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  throw lastError
}

async function createWindow(): Promise<void> {
  if (shuttingDown)
    return
  const staticDir = developmentUrl
    ? undefined
    : resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')
  if (!craftHubServer) {
    const runtime = await createDesktopHostRuntime({
      builtinPlugins: builtinHostPlugins.plugins,
      optionalPlugins: builtinHostPlugins.optionalPlugins,
      dataDir: desktopDataDirectories.runtimeDataDir,
      distribution: runtimeDistribution,
      distributionPlugins: desktopDistribution?.hostPlugins?.length
        ? { id: desktopDistribution.distribution.id, name: desktopDistribution.distribution.name, manifestPath: desktopDistributionManifestPath, modules: desktopDistribution.hostPlugins }
        : undefined,
      hostExtensions: hostExtensionManager,
      logError: message => writeApplicationLog('error', message),
    })
    craftHubServer = await startCraftHubServer({ port: developmentUrl ? 4318 : 0, runtime, staticDir })
    traceDesktopPerformance('runtime-ready')
    runtime.settings.onChanged(snapshot => applyDesktopMenuLocale(snapshot.settings['workbench.locale']))
    writeApplicationLog('info', `Local server started at ${craftHubServer.url}`)
    await initializePersonalCloud()
  }
  const { settings } = await craftHubServer.runtime.settings.get()
  if (shuttingDown)
    return
  applyDesktopTheme(settings['workbench.theme'])
  applyDesktopMenuLocale(settings['workbench.locale'])

  const { additionalArguments, ...appearance } = mainWindowAppearance(process.platform, nativeTheme.shouldUseDarkColors)
  // Reopen where the user left the window, as native apps do; frames from a disconnected display fall back to centered.
  const windowStateFile = join(app.getPath('userData'), 'window-state.json')
  const windowState = restoreWindowState(readWindowState(windowStateFile), screen.getAllDisplays().map(display => display.workArea), { width: 1440, height: 900, minWidth: 900, minHeight: 620 })
  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 620,
    title: windowTitle,
    icon: applicationIcon,
    // Reveal the window after its first styled frame so launch never shows an empty background.
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    // Center the 14px native controls in the renderer's 48px macOS toolbar.
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 17 }, titleBarOverlay: true } : {}),
    ...appearance,
    webPreferences: {
      additionalArguments,
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(fileURLToPath(new URL('.', import.meta.url)), '../preload.cjs'),
    },
  })
  const createdWindow = mainWindow
  if (windowState.maximized)
    createdWindow.maximize()
  createdWindow.once('ready-to-show', () => {
    createdWindow.show()
    traceDesktopPerformance('window-presented')
  })
  createdWindow.on('close', () => writeWindowState(windowStateFile, createdWindow.getNormalBounds(), createdWindow.isMaximized()))
  const windowContents = mainWindow.webContents
  installExternalNavigationHandlers(
    windowContents,
    developmentUrl ?? craftHubServer.url,
    url => shell.openExternal(url),
    error => writeApplicationLog('error', `External link failed to open: ${error instanceof Error ? error.message : String(error)}`),
  )
  windowContents.on('context-menu', (_event, params) => {
    // Renderer menus cancel the DOM event, so this only covers text fields and plain selections.
    const template = createEditContextMenu(params, word => windowContents.replaceMisspelling(word), desktopMenuLocale)
    if (template.length)
      Menu.buildFromTemplate(template).popup({ window: createdWindow })
  })
  const isWorkbenchMenuShortcut = createWorkbenchMenuShortcutMatcher(process.platform)
  windowContents.on('before-input-event', (_event, input) => {
    // Keep native menu hints and clicks while letting the renderer prioritize custom shortcuts.
    windowContents.setIgnoreMenuShortcuts(isWorkbenchMenuShortcut(input))
  })
  mainWindow.on('page-title-updated', event => event.preventDefault())
  mainWindow.on('unresponsive', () => writeApplicationLog('error', 'Main window became unresponsive'))
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeApplicationLog('error', `Renderer process exited: ${details.reason} (${details.exitCode})`)
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    writeApplicationLog('error', `Page load failed: ${errorCode} ${errorDescription} ${validatedUrl}`)
  })
  mainWindow.once('closed', () => {
    mainWindow = undefined
  })
  try {
    await loadUrlWithRetry(mainWindow, developmentUrl ?? craftHubServer.url)
  }
  catch (error) {
    // A failed load never paints, but the window must still appear for the user and diagnostics.
    if (!createdWindow.isDestroyed())
      createdWindow.show()
    throw error
  }
  mainWindow.setTitle(windowTitle)
  if (process.env.CRAFT_HUB_PERFORMANCE_TRACE) {
    void windowContents.executeJavaScript(`new Promise(resolve => {
      const deadline = performance.now() + 30000
      const check = () => {
        if (performance.getEntriesByName('craft-hub:workbench-ready').length) resolve(true)
        else if (performance.now() >= deadline) resolve(false)
        else setTimeout(check, 10)
      }
      check()
    })`).then((ready) => {
      if (ready) {
        traceDesktopPerformance('web-ready')
        startDesktopInteractionTrace(windowContents)
      }
    }).catch(() => {})
  }
  if (desktopLinks.hasCelebration())
    mainWindow.webContents.send('craft-hub:celebration-requested')
  if (desktopLinks.hasMarketplaceImport())
    mainWindow.webContents.send('craft-hub:marketplace-source-import-available')
  if (desktopLinks.hasNavigation())
    mainWindow.webContents.send('craft-hub:desktop-navigation-available')
  if (process.env.CRAFT_HUB_SMOKE_TEST === 'true')
    writeApplicationLog('info', 'Startup smoke test completed')
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed())
    return
  if (mainWindow.isMinimized())
    mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function showMainWindow(): Promise<void> {
  if (shuttingDown)
    return
  if (!mainWindow || mainWindow.isDestroyed())
    await createWindow()
  else
    focusMainWindow()
}

async function startDesktopApp(): Promise<void> {
  await app.whenReady()
  traceDesktopPerformance('app-launched')
  installApplicationMenu()
  if (process.platform === 'darwin')
    app.dock?.setIcon(applicationIcon)

  codexActivityMonitor = new CodexActivityMonitor({
    dataDir: app.getPath('userData'),
    onStatus: status => mainWindow?.webContents.send('craft-hub:codex-activity-status-changed', status),
  })
  await codexActivityMonitor.start()

  const startupLink = findDesktopLinkArgument(process.argv, [desktopProtocol])
  if (startupLink) {
    try {
      desktopLinks.accept(startupLink, [desktopProtocol])
    }
    catch (error) {
      const reason = error instanceof DesktopLinkError ? error.code : 'unexpected-error'
      writeApplicationLog('error', `Desktop Link rejected: ${reason}`)
    }
  }
  await createWindow()
  quickCaptureRegistered = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    pendingQuickCapture = true
    void showMainWindow().then(() => mainWindow?.webContents.send('craft-hub:quick-capture'))
  })
  if (process.env.CRAFT_HUB_SMOKE_TEST === 'true') {
    app.quit()
    return
  }
  desktopUpdater = new DesktopUpdater({
    applicationName: productName,
    dataDir: app.getPath('userData'),
    getWindow: () => mainWindow,
    onInstallRequested: () => {
      installUpdateAfterShutdown = true
      app.quit()
    },
    onStatus: (status: DesktopUpdateStatus) => mainWindow?.webContents.send('craft-hub:update-status-changed', status),
    updateBaseUrl: desktopUpdateBaseUrl,
    writeLog: writeApplicationLog,
  })
  await desktopUpdater.initialize()
  app.on('activate', () => void showMainWindow())
}

if (!hasSingleInstanceLock) {
  if (developmentUrl)
    process.stderr.write(`${productName} Dev is already running; activated the existing window instead.\n`)
  process.exit(0)
}
else {
  void startDesktopApp().catch((error) => {
    if (app.isPackaged && process.platform === 'darwin' && error instanceof ProfileMigrationGuardError) {
      // A guard may appear after the early read. Drain partially initialized resources before recovery UI.
      app.relaunch({ args: [nativeMigrationArgument] })
      app.quit()
      return
    }
    const message = `Craft Hub failed to start: ${error instanceof Error ? error.message : String(error)}`
    writeApplicationLog('error', message)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
    app.quit()
  })
}

const requestShutdown = createDeferredOnceTask(async () => {
  try {
    writeApplicationLog('info', 'Shutdown requested')
    globalShortcut.unregisterAll()
    for (const window of BrowserWindow.getAllWindows())
      window.destroy()
    const cloudCleanup = personalCloud?.close()
    desktopUpdater?.dispose()
    const connectionCleanup = await Promise.allSettled([
      cloudCleanup,
      codexActivityMonitor?.close(),
      ...builtinHostPlugins.closeConnections(),
    ])
    for (const result of connectionCleanup) {
      if (result.status === 'rejected')
        writeApplicationLog('error', `Desktop connection failed to close: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    }
    await craftHubServer?.close({ processExiting: !installUpdateAfterShutdown })
  }
  catch (error) {
    writeApplicationLog('error', `Craft Hub failed to shut down cleanly: ${error instanceof Error ? error.message : String(error)}`)
  }
  finally {
    writeApplicationLog('info', 'Shutdown complete')
    craftHubServer = undefined
    personalCloud = undefined
    codexActivityMonitor = undefined
    readyToQuit = true
    if (installUpdateAfterShutdown) {
      desktopUpdater?.installDownloadedUpdate()
    }
    else {
      // Chokidar's macOS FSEvents handles can block Electron teardown for many
      // seconds. All stateful resources are closed above; remaining watchers
      // are read-only and can be released safely by the operating system.
      const immediateProcess = process as typeof process & { reallyExit?: (code: number) => never }
      const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0
      if (immediateProcess.reallyExit) {
        immediateProcess.reallyExit(exitCode)
      }
      process.kill(process.pid, 'SIGKILL')
    }
  }
})

app.on('before-quit', (event) => {
  if (readyToQuit)
    return
  event.preventDefault()
  shuttingDown = true
  void requestShutdown()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || developmentUrl)
    app.quit()
})
