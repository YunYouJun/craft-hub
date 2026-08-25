import type { BrowserWindow as BrowserWindowType } from 'electron'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startCraftHubServer } from 'craft-hub'
import { app, BrowserWindow } from 'electron'

let mainWindow: BrowserWindowType | undefined
let serverUrl: string | undefined
const applicationIcon = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../assets/icon.png',
)

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
  const developmentUrl = process.env.CRAFT_HUB_DEV_URL
  const staticDir = developmentUrl
    ? undefined
    : resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')
  if (!serverUrl)
    serverUrl = (await startCraftHubServer({ port: 4318, staticDir })).url

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: 'Craft Hub',
    icon: applicationIcon,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: resolve(fileURLToPath(new URL('.', import.meta.url)), '../preload.cjs'),
    },
  })
  await loadUrlWithRetry(mainWindow, developmentUrl ?? serverUrl)
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin')
    app.dock?.setIcon(applicationIcon)

  await createWindow()
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0)
      await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit()
})
