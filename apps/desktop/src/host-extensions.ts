import type { HostExtension, HostExtensionManager, HostExtensionStatus } from 'craft-hub'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { findLocalHostExtension, prepareDesktopHostExtension } from './host-extension-review.ts'

export { findLocalHostExtension, prepareDesktopHostExtension } from './host-extension-review.ts'

/** Register desktop-only installation controls; HTTP clients cannot enable executable code. */
export function registerHostExtensionHandlers(options: {
  manager: HostExtensionManager
  window: () => BrowserWindow | undefined
  restart: () => Promise<void>
  localPluginPath: (packageName: string) => Promise<string | undefined>
  bundledExtensions?: HostExtensionStatus['bundledExtensions']
  /** Bundled extensions the user can turn on or off; their state is read again for every request. */
  optionalBundledExtensions?: () => Promise<NonNullable<HostExtensionStatus['bundledExtensions']>>
}): void {
  const { manager } = options
  const status = async (): Promise<HostExtensionStatus> => {
    const bundledExtensions = [...options.bundledExtensions ?? [], ...await options.optionalBundledExtensions?.() ?? []]
    return { ...await manager.status(), ...(bundledExtensions.length ? { bundledExtensions } : {}) }
  }
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
    return status()
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
      return status()
    const extension = await prepareDesktopHostExtension(manager, selected.filePaths[0])
    await installReviewed(window, extension)
    return status()
  })
  ipcMain.handle('craft-hub:configure-local-plugin-host', async (event, packageName: unknown) => {
    const window = windowFor(event)
    if (typeof packageName !== 'string')
      throw new TypeError('Invalid local plugin')
    const path = await options.localPluginPath(packageName)
    const extension = path ? await findLocalHostExtension(manager, path) : undefined
    if (extension)
      await installReviewed(window, extension)
    return status()
  })
  ipcMain.handle('craft-hub:set-host-extension-enabled', async (event, id: unknown, enabled: unknown) => {
    windowFor(event)
    if (typeof id !== 'string' || typeof enabled !== 'boolean')
      throw new TypeError('Invalid host extension state')
    if ((await options.optionalBundledExtensions?.() ?? []).some(extension => extension.id === id))
      await manager.setBundledEnabled(id, enabled)
    else
      await manager.setEnabled(id, enabled)
    return status()
  })
  ipcMain.handle('craft-hub:remove-host-extension', async (event, id: unknown) => {
    windowFor(event)
    if (typeof id !== 'string')
      throw new TypeError('Invalid host extension id')
    await manager.remove(id)
    return status()
  })
  ipcMain.handle('craft-hub:restart-for-host-extensions', async (event) => {
    windowFor(event)
    await options.restart()
  })
}
