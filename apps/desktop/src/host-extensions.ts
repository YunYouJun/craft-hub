import type { HostExtension, HostExtensionManager } from 'craft-hub'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { loadDesktopDistributionManifest } from './distribution'

/** Review a local distribution as an extension without changing application identity or loading code. */
export async function prepareDesktopHostExtension(manager: HostExtensionManager, manifestPath: string): Promise<HostExtension> {
  const manifest = loadDesktopDistributionManifest(manifestPath)
  if (!manifest?.hostPlugins?.length)
    throw new Error('This distribution does not declare any host plugins')
  const extension = manager.prepare({
    id: manifest.distribution.id,
    name: manifest.distribution.name,
    manifestPath,
    modules: manifest.hostPlugins,
  })
  await Promise.all(extension.modules.map(path => access(path)))
  return extension
}

/** Find the containing distribution for a linked local plugin; only reads declarations. */
export async function findLocalHostExtension(manager: HostExtensionManager, pluginPath: string): Promise<HostExtension | undefined> {
  let directory = resolve(pluginPath)
  while (dirname(directory) !== directory) {
    const manifestPath = join(directory, 'distribution.json')
    try {
      await access(manifestPath)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
      directory = dirname(directory)
      continue
    }
    return prepareDesktopHostExtension(manager, manifestPath)
  }
}

/** Register desktop-only installation controls; HTTP clients cannot enable executable code. */
export function registerHostExtensionHandlers(options: {
  manager: HostExtensionManager
  window: () => BrowserWindow | undefined
  restart: () => Promise<void>
  localPluginPath: (packageName: string) => Promise<string | undefined>
}): void {
  const { manager } = options
  function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
    const window = options.window()
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Host extension management is only available in the main desktop window')
    return window
  }
  async function installReviewed(window: BrowserWindow, extension: HostExtension): Promise<void> {
    const saved = (await manager.status()).extensions.find(item => item.id === extension.id)
    if (saved?.enabled && JSON.stringify(saved.modules) === JSON.stringify(extension.modules))
      return
    const approval = await dialog.showMessageBox(window, {
      type: 'question',
      title: '启用宿主扩展 / Enable host extension',
      message: extension.name,
      detail: `宿主扩展会在本机运行代码。仅添加你信任的扩展。确认后，Craft Hub 将记住配置并在每次启动时自动加载。\nHost extensions run local code. Only enable extensions you trust. This installation will load automatically on startup.\n\n${extension.modules.join('\n')}`,
      buttons: ['取消 / Cancel', '信任并添加 / Trust and add'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (approval.response === 1)
      await manager.install(extension)
  }
  ipcMain.handle('craft-hub:host-extensions', async (event) => {
    windowFor(event)
    return manager.status()
  })
  ipcMain.handle('craft-hub:install-host-extension', async (event) => {
    const window = windowFor(event)
    const selected = await dialog.showOpenDialog(window, {
      title: '添加宿主扩展 / Add host extension',
      buttonLabel: '选择配置 / Select configuration',
      filters: [{ name: 'Distribution configuration (distribution.json)', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (selected.canceled || !selected.filePaths[0])
      return manager.status()
    const extension = await prepareDesktopHostExtension(manager, selected.filePaths[0])
    await installReviewed(window, extension)
    return manager.status()
  })
  ipcMain.handle('craft-hub:configure-local-plugin-host', async (event, packageName: unknown) => {
    const window = windowFor(event)
    if (typeof packageName !== 'string')
      throw new Error('Invalid local plugin')
    const path = await options.localPluginPath(packageName)
    const extension = path ? await findLocalHostExtension(manager, path) : undefined
    if (extension)
      await installReviewed(window, extension)
    return manager.status()
  })
  ipcMain.handle('craft-hub:set-host-extension-enabled', async (event, id: unknown, enabled: unknown) => {
    windowFor(event)
    if (typeof id !== 'string' || typeof enabled !== 'boolean')
      throw new Error('Invalid host extension state')
    await manager.setEnabled(id, enabled)
    return manager.status()
  })
  ipcMain.handle('craft-hub:remove-host-extension', async (event, id: unknown) => {
    windowFor(event)
    if (typeof id !== 'string')
      throw new Error('Invalid host extension id')
    await manager.remove(id)
    return manager.status()
  })
  ipcMain.handle('craft-hub:restart-for-host-extensions', async (event) => {
    windowFor(event)
    await options.restart()
  })
}
