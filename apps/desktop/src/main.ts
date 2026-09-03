import type { CraftHubServer, ProjectReference } from 'craft-hub'
import type { BrowserWindow as BrowserWindowType, MenuItemConstructorOptions, OpenDialogOptions } from 'electron'
import type { DesktopUpdateStatus } from './updater.ts'
import type { WorkspaceLaunchTarget } from './workspace-launch-target.ts'
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PersonalCloudController } from '@craft-hub/personal-cloud'
import { communityDistribution, CraftHubRuntime, startCraftHubServer } from 'craft-hub'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell } from 'electron'
import { aboutDocument, aboutPanelOptions } from './about.ts'
import { loadDesktopBuildInfo } from './build-info.ts'
import { CodexActivityMonitor } from './codex-activity.ts'
import { CodexAgentTaskProvider } from './codex-agent-task-provider.ts'
import { openCodexThreadAfterTaskRelease, waitForAgentTaskThread } from './codex-agent-task-thread.ts'
import { resolveDesktopDataDirectories } from './data-directories.ts'
import { DesktopLinkCoordinator, DesktopLinkError, findDesktopLinkArgument } from './deep-links.ts'
import { DeviceVault } from './device-vault.ts'
import { communityDesktopAboutBranding, communityDesktopDevelopmentProtocol, communityDesktopProtocol, communityDesktopUpdateBaseUrl, loadDesktopDistributionManifest, resolveDesktopDistributionAsset } from './distribution.ts'
import { selectedDirectoryPath, selectedDirectoryPaths } from './folder-picker.ts'
import { codexThreadUrl, editorTargetPaths, externalHttpUrl, focusCodexApplication, gitRemoteHttpUrl, macTerminalApplications, openCodexProject, openCursorEditor, openCustomEditor, openMacTerminalProject, projectContainsPath, vscodeUrl } from './open-targets.ts'
import { createDeferredOnceTask } from './shutdown-task.ts'
import { DesktopUpdater } from './updater.ts'
import { resolveWorkspaceLaunchTarget } from './workspace-launch-target.ts'

const execFileAsync = promisify(execFile)

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
let aboutWindow: BrowserWindowType | undefined
let craftHubServer: CraftHubServer | undefined
let readyToQuit = false
let personalCloud: PersonalCloudController | undefined
let desktopUpdater: DesktopUpdater | undefined
let codexActivityMonitor: CodexActivityMonitor | undefined
let installUpdateAfterShutdown = false
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
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1f232b' : '#ffffff')
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

function installApplicationMenu(): void {
  if (process.platform !== 'darwin')
    return

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: `About ${app.name}`, click: () => void showAboutWindow() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Replay Getting Started',
          click: () => void replayOnboarding(),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.setName(productName)
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
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1f232b' : '#ffffff')
})

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

async function projectPath(projectId: string): Promise<string> {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  return (await craftHubServer.runtime.projects.get(projectId)).path
}

async function openCodexThread(threadId: string): Promise<void> {
  try {
    await shell.openExternal(codexThreadUrl(threadId))
  }
  catch {
    await focusCodexApplication().catch(() => {})
    throw new Error('Codex could not open this task link. The task and its output remain available in Craft Hub.')
  }
}

async function openConfiguredEditor(path: string, line?: number, column?: number, projectRoot?: string): Promise<void> {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const editor = (await craftHubServer.runtime.settings.get()).settings['workbench.editor']
  const targets = editorTargetPaths(path, projectRoot)
  if (editor.default === 'vscode') {
    for (const target of targets)
      await shell.openExternal(vscodeUrl(target, target === path ? line : undefined))
  }
  else if (editor.default === 'cursor') {
    for (const target of targets)
      await openCursorEditor(target)
  }
  else if (editor.default === 'custom') {
    if (!editor.custom)
      throw new Error('Custom editor is not configured')
    for (const target of targets)
      await openCustomEditor(target, editor.custom, target === path ? { line, column } : {})
  }
}

async function projectOwnedTarget(projectId: string, targetPath: string): Promise<{ projectRoot: string, target: string }> {
  const projectRoot = await realpath(await projectPath(projectId))
  const target = await realpath(targetPath)
  if (!projectContainsPath(projectRoot, target))
    throw new Error('Capability target must stay inside the project')
  return { projectRoot, target }
}

async function projectEvidencePath(projectId: string, relativePath: string): Promise<string> {
  if (!relativePath || isAbsolute(relativePath))
    throw new Error('Evidence path must be project-relative')
  const root = await realpath(await projectPath(projectId))
  const target = await realpath(resolve(root, relativePath))
  const offset = relative(root, target)
  if (offset.startsWith('..') || isAbsolute(offset))
    throw new Error('Evidence path must stay inside the project')
  return target
}

async function workspaceLaunchTarget(workspaceId: string, primaryProjectId?: string): Promise<WorkspaceLaunchTarget> {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  return resolveWorkspaceLaunchTarget(craftHubServer.runtime, workspaceId, primaryProjectId)
}

ipcMain.handle('craft-hub:open-project-in-vscode', async (_event, projectId: string) => {
  await shell.openExternal(vscodeUrl(await projectPath(projectId)))
})

ipcMain.handle('craft-hub:open-project-in-editor', async (_event, projectId: string) => {
  await openConfiguredEditor(await projectPath(projectId))
})

ipcMain.handle('craft-hub:open-project-evidence-in-editor', async (_event, projectId: string, path: unknown, line: unknown, column: unknown) => {
  if (typeof path !== 'string')
    throw new TypeError('Evidence path is required')
  const resolvedLine = typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined
  const resolvedColumn = typeof column === 'number' && Number.isInteger(column) && column > 0 ? column : undefined
  await openConfiguredEditor(await projectEvidencePath(projectId, path), resolvedLine, resolvedColumn)
})

ipcMain.handle('craft-hub:open-project-directory', async (_event, projectId: string) => {
  const error = await shell.openPath(await projectPath(projectId))
  if (error)
    throw new Error(error)
})

ipcMain.handle('craft-hub:open-project-git-remote', async (_event, projectId: string) => {
  const path = await projectPath(projectId)
  const { stdout } = await execFileAsync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  await shell.openExternal(gitRemoteHttpUrl(stdout))
})

ipcMain.handle('craft-hub:open-capability-source-in-editor', async (_event, projectId: string, capabilityId: string) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const capability = (await craftHubServer.runtime.capabilities(projectId)).find(item => item.id === capabilityId)
  if (!capability)
    throw new Error(`Unknown capability: ${capabilityId}`)
  const path = capability.kind === 'command' ? capability.sourcePath : capability.path
  const line = capability.kind === 'command' ? capability.sourceLine : undefined
  if (!path)
    throw new Error(`No source file is available for ${capability.name}`)
  const { projectRoot, target } = await projectOwnedTarget(projectId, path)
  await openConfiguredEditor(target, line, undefined, projectRoot)
})

ipcMain.handle('craft-hub:open-capability-working-directory', async (_event, projectId: string, capabilityId: string) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const capability = (await craftHubServer.runtime.capabilities(projectId)).find(item => item.id === capabilityId)
  if (capability?.kind !== 'command')
    throw new Error(`No command working directory is available for ${capabilityId}`)
  const { target } = await projectOwnedTarget(projectId, capability.invocation.cwd)
  const error = await shell.openPath(target)
  if (error)
    throw new Error(error)
})

ipcMain.handle('craft-hub:open-project-in-codex', async (_event, projectId: string) => {
  await openCodexProject(await projectPath(projectId))
})

ipcMain.handle('craft-hub:open-workspace-in-codex', async (_event, workspaceId: string) => {
  await openCodexProject((await workspaceLaunchTarget(workspaceId)).primaryProjectPath)
})

ipcMain.handle('craft-hub:open-workspace-in-editor', async (_event, workspaceId: string) => {
  await openConfiguredEditor((await workspaceLaunchTarget(workspaceId)).editorPath)
})

ipcMain.handle('craft-hub:start-project-in-codex', async (_event, projectId: string, prompt: string) => {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt)
    throw new Error('Codex prompt is required')
  clipboard.writeText(normalizedPrompt)
  await openCodexProject(await projectPath(projectId))
})

ipcMain.handle('craft-hub:start-workspace-in-codex', async (
  _event,
  workspaceId: string,
  projectIds: unknown,
  primaryProjectId: string,
  prompt: string,
) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt)
    throw new Error('Codex prompt is required')
  const target = await workspaceLaunchTarget(workspaceId, primaryProjectId)
  if (!Array.isArray(projectIds) || projectIds.some(projectId => typeof projectId !== 'string'))
    throw new TypeError('Workspace project ids are required')
  const selectedProjectIds = projectIds as string[]
  const workspaceProjectIds = new Set(target.projectIds)
  if (selectedProjectIds.some(projectId => !workspaceProjectIds.has(projectId)))
    throw new Error('Every selected project must belong to the Workspace')
  const task = await craftHubServer.runtime.agentTasks.start({
    prompt: normalizedPrompt,
    projectIds: selectedProjectIds,
    primaryProjectId,
    workspaceId,
    sandboxMode: 'workspace-write',
  })
  const threadId = await waitForAgentTaskThread(craftHubServer.runtime.agentTasks, task.id)
  void openCodexThreadAfterTaskRelease(craftHubServer.runtime.agentTasks, task.id, openCodexThread).catch((error) => {
    writeApplicationLog('error', `Could not open released Codex task ${task.id}: ${error instanceof Error ? error.message : String(error)}`)
  })
  return { taskId: task.id, threadId }
})

ipcMain.handle('craft-hub:open-codex-thread', async (_event, threadId: string) => {
  await openCodexThread(threadId)
})

ipcMain.handle('craft-hub:focus-codex-application', () => focusCodexApplication())
ipcMain.handle('craft-hub:codex-activity-status', () => codexActivityMonitor?.status())
ipcMain.handle('craft-hub:install-codex-activity-hooks', () => codexActivityMonitor?.install())
ipcMain.handle('craft-hub:uninstall-codex-activity-hooks', () => codexActivityMonitor?.uninstall())

ipcMain.handle('craft-hub:list-terminal-applications', () => macTerminalApplications())

ipcMain.handle('craft-hub:open-project-in-terminal', async (_event, projectId: string, application?: string) => {
  const availableApplications = macTerminalApplications()
  if (application && !availableApplications.includes(application))
    throw new Error(`Terminal application is not available: ${application}`)
  await openMacTerminalProject(await projectPath(projectId), application)
})

ipcMain.handle('craft-hub:open-dotfiles-in-terminal', async () => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const status = await craftHubServer.runtime.dotfilesManager.status()
  if (!status.repositoryPath)
    throw new Error('Dotfiles manager is not configured')
  await openMacTerminalProject(status.repositoryPath)
})

ipcMain.handle('craft-hub:open-external-url', async (_event, url: string) => {
  await shell.openExternal(externalHttpUrl(url))
})

ipcMain.handle('craft-hub:open-settings-file', async () => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  const error = await shell.openPath(await craftHubServer.runtime.settings.ensureFile())
  if (error)
    throw new Error(error)
})

ipcMain.handle('craft-hub:set-theme', (_event, theme: unknown) => {
  if (!isDesktopTheme(theme))
    throw new Error('Theme must be system, light, or dark')
  applyDesktopTheme(theme)
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

ipcMain.handle('craft-hub:cloud-status', () => personalCloud?.status() ?? { state: 'disabled' })
ipcMain.handle('craft-hub:cloud-connect', () => personalCloud?.connect())
ipcMain.handle('craft-hub:cloud-disconnect', () => personalCloud?.disconnect())
ipcMain.handle('craft-hub:cloud-synchronize', () => personalCloud?.synchronize())
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
    mainWindow?.webContents.send(link.kind === 'marketplace-import'
      ? 'craft-hub:marketplace-source-import-available'
      : 'craft-hub:desktop-navigation-available')
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
  const staticDir = developmentUrl
    ? undefined
    : resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')
  if (!craftHubServer) {
    let runtime!: CraftHubRuntime
    const agentTaskProvider = new CodexAgentTaskProvider(async () => (await runtime.settings.get()).settings['workbench.codex'])
    runtime = new CraftHubRuntime({ agentTaskProvider, dataDir: desktopDataDirectories.runtimeDataDir, distribution: runtimeDistribution })
    craftHubServer = await startCraftHubServer({ port: developmentUrl ? 4318 : 0, runtime, staticDir })
    writeApplicationLog('info', `Local server started at ${craftHubServer.url}`)
    await initializePersonalCloud()
  }
  applyDesktopTheme((await craftHubServer.runtime.settings.get()).settings['workbench.theme'])

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: windowTitle,
    icon: applicationIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { titleBarOverlay: true } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f232b' : '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(fileURLToPath(new URL('.', import.meta.url)), '../preload.cjs'),
    },
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
  await loadUrlWithRetry(mainWindow, developmentUrl ?? craftHubServer.url)
  mainWindow.setTitle(windowTitle)
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
  if (BrowserWindow.getAllWindows().length === 0)
    await createWindow()
  else
    focusMainWindow()
}

async function startDesktopApp(): Promise<void> {
  await app.whenReady()
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
  process.exit(0)
}
else {
  void startDesktopApp().catch((error) => {
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
    for (const window of BrowserWindow.getAllWindows())
      window.destroy()
    personalCloud?.close()
    desktopUpdater?.dispose()
    await codexActivityMonitor?.close()
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
      if (immediateProcess.reallyExit) {
        immediateProcess.reallyExit(0)
      }
      process.kill(process.pid, 'SIGKILL')
    }
  }
})

app.on('before-quit', (event) => {
  if (readyToQuit)
    return
  event.preventDefault()
  void requestShutdown()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || developmentUrl)
    app.quit()
})
