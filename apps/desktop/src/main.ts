import type { CraftHubServer } from 'craft-hub'
import type { BrowserWindow as BrowserWindowType, MenuItemConstructorOptions, OpenDialogOptions } from 'electron'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PersonalCloudController } from '@craft-hub/personal-cloud'
import { CraftHubRuntime, startCraftHubServer } from 'craft-hub'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell } from 'electron'
import { aboutDocument, aboutPanelOptions, projectUrl } from './about.ts'
import { CodexAgentTaskProvider } from './codex-agent-task-provider.ts'
import { DeviceVault } from './device-vault.ts'
import { selectedDirectoryPath, selectedDirectoryPaths } from './folder-picker.ts'
import { codexThreadUrl, externalHttpUrl, macTerminalApplications, openCodeBuddyWorkspace, openCodexProject, openMacTerminalProject, vscodeUrl } from './open-targets.ts'

let mainWindow: BrowserWindowType | undefined
let aboutWindow: BrowserWindowType | undefined
let craftHubServer: CraftHubServer | undefined
let shutdown: Promise<void> | undefined
let readyToQuit = false
let personalCloud: PersonalCloudController | undefined
let pendingCloudCallback: string | undefined
const applicationIcon = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../assets/icon.png',
)
const developmentUrl = process.env.CRAFT_HUB_DEV_URL
if (developmentUrl)
  app.setPath('userData', resolve(app.getPath('appData'), 'Craft Hub Dev'))
const windowTitle = developmentUrl ? 'Craft Hub — Dev' : 'Craft Hub'

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
    title: 'About Craft Hub',
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
    if (url === projectUrl)
      void shell.openExternal(url)
    return { action: 'deny' }
  })
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url === projectUrl)
      void shell.openExternal(url)
  })
  aboutWindow.once('closed', () => {
    aboutWindow = undefined
  })
  const iconDataUrl = nativeImage.createFromPath(applicationIcon).toDataURL()
  await aboutWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(aboutDocument(app.getVersion(), iconDataUrl))}`)
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.setName('Craft Hub')
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

app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), applicationIcon))
const hasSingleInstanceLock = app.requestSingleInstanceLock()

nativeTheme.on('updated', () => {
  mainWindow?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1f232b' : '#ffffff')
})

app.setAsDefaultProtocolClient('craft-hub')
app.on('open-url', (event, url) => {
  event.preventDefault()
  void handleCloudCallback(url)
})

ipcMain.handle('craft-hub:select-project-directory', async () => {
  const options: OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return selectedDirectoryPath(result)
})

ipcMain.handle('craft-hub:select-project-directories', async () => {
  const options: OpenDialogOptions = {
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

type WorkspaceLauncher = 'vscode' | 'codebuddy' | 'codex'

function isWorkspaceLauncher(value: unknown): value is WorkspaceLauncher {
  return value === 'vscode' || value === 'codebuddy' || value === 'codex'
}

async function workspaceLaunchTarget(workspaceId: string): Promise<{ editorPath: string, primaryProjectPath: string }> {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')

  const workspace = (await craftHubServer.runtime.workspaces.list()).find(item => item.id === workspaceId)
  const primaryMember = workspace?.members.find(member => member.project === workspace.primaryProject && member.projectId)
    ?? workspace?.members.find(member => member.projectId)
  if (!workspace || !primaryMember?.projectId)
    throw new Error(`Workspace has no resolved project: ${workspaceId}`)
  const primaryProjectPath = await projectPath(primaryMember.projectId)
  return { editorPath: primaryProjectPath, primaryProjectPath }
}

ipcMain.handle('craft-hub:open-project-in-vscode', async (_event, projectId: string) => {
  await shell.openExternal(vscodeUrl(await projectPath(projectId)))
})

ipcMain.handle('craft-hub:open-capability-source-in-vscode', async (_event, projectId: string, capabilityId: string) => {
  if (!craftHubServer)
    throw new Error('Craft Hub is still starting')
  await craftHubServer.runtime.projects.get(projectId)
  const capability = (await craftHubServer.runtime.capabilities(projectId)).find(item => item.id === capabilityId)
  if (!capability)
    throw new Error(`Unknown capability: ${capabilityId}`)
  const path = capability.kind === 'command' ? capability.sourcePath : capability.path
  const line = capability.kind === 'command' ? capability.sourceLine : undefined
  if (!path)
    throw new Error(`No source file is available for ${capability.name}`)
  await shell.openExternal(vscodeUrl(path, line))
})

ipcMain.handle('craft-hub:open-project-in-codex', async (_event, projectId: string) => {
  await openCodexProject(await projectPath(projectId))
})

ipcMain.handle('craft-hub:open-workspace', async (_event, workspaceId: string, launcher: unknown) => {
  if (!isWorkspaceLauncher(launcher))
    throw new Error(`Unsupported workspace launcher: ${String(launcher)}`)
  const target = await workspaceLaunchTarget(workspaceId)
  if (launcher === 'vscode')
    await shell.openExternal(vscodeUrl(target.editorPath))
  else if (launcher === 'codebuddy')
    await openCodeBuddyWorkspace(target.editorPath)
  else
    await openCodexProject(target.primaryProjectPath)
})

ipcMain.handle('craft-hub:start-project-in-codex', async (_event, projectId: string, prompt: string) => {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt)
    throw new Error('Codex prompt is required')
  clipboard.writeText(normalizedPrompt)
  await openCodexProject(await projectPath(projectId))
})

ipcMain.handle('craft-hub:open-codex-thread', async (_event, threadId: string) => {
  await shell.openExternal(codexThreadUrl(threadId))
})

ipcMain.handle('craft-hub:list-terminal-applications', () => macTerminalApplications())

ipcMain.handle('craft-hub:open-project-in-terminal', async (_event, projectId: string, application?: string) => {
  const availableApplications = macTerminalApplications()
  if (application && !availableApplications.includes(application))
    throw new Error(`Terminal application is not available: ${application}`)
  await openMacTerminalProject(await projectPath(projectId), application)
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

ipcMain.handle('craft-hub:cloud-status', () => personalCloud?.status() ?? { state: 'disabled' })
ipcMain.handle('craft-hub:cloud-connect', () => personalCloud?.connect())
ipcMain.handle('craft-hub:cloud-disconnect', () => personalCloud?.disconnect())
ipcMain.handle('craft-hub:cloud-synchronize', () => personalCloud?.synchronize())

async function handleCloudCallback(url: string): Promise<void> {
  if (!url.startsWith('craft-hub://cloud/connect'))
    return
  if (!personalCloud) {
    pendingCloudCallback = url
    return
  }
  try {
    await personalCloud.adopt(url)
    focusMainWindow()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
  if (pendingCloudCallback) {
    const callback = pendingCloudCallback
    pendingCloudCallback = undefined
    await handleCloudCallback(callback)
  }
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
    const runtime = new CraftHubRuntime({ agentTaskProvider: new CodexAgentTaskProvider() })
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

  await createWindow()
  app.on('activate', () => void showMainWindow())
  app.on('second-instance', () => void showMainWindow())
  app.on('second-instance', (_event, argv) => {
    const callback = argv.find(argument => argument.startsWith('craft-hub://cloud/connect'))
    if (callback)
      void handleCloudCallback(callback)
  })
}

if (!hasSingleInstanceLock) {
  process.exit(0)
}
else {
  void startDesktopApp().catch((error) => {
    writeApplicationLog('error', `Craft Hub failed to start: ${error instanceof Error ? error.message : String(error)}`)
    app.quit()
  })
}

app.on('before-quit', (event) => {
  if (readyToQuit)
    return
  event.preventDefault()
  shutdown ??= (async () => {
    try {
      writeApplicationLog('info', 'Shutdown requested')
      for (const window of BrowserWindow.getAllWindows())
        window.destroy()
      personalCloud?.close()
      await craftHubServer?.close()
    }
    catch (error) {
      writeApplicationLog('error', `Craft Hub failed to shut down cleanly: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      writeApplicationLog('info', 'Shutdown complete')
      craftHubServer = undefined
      personalCloud = undefined
      readyToQuit = true
      app.quit()
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || developmentUrl)
    app.quit()
})
