import type { BrowserWindow } from 'electron'
import type { IUpdateElectronApp } from 'update-electron-app'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { app, autoUpdater, dialog } from 'electron'
import { updateElectronApp, UpdateSourceType } from 'update-electron-app'

export type DesktopUpdatePhase = 'available' | 'checking' | 'disabled' | 'downloaded' | 'error' | 'idle' | 'unsupported' | 'up-to-date'

export interface DesktopUpdateStatus {
  automaticCheck: boolean
  currentVersion: string
  message?: string
  phase: DesktopUpdatePhase
  releaseName?: string
}

interface DesktopUpdatePreferences {
  automaticCheck: boolean
}

interface DesktopUpdaterOptions {
  applicationName: string
  dataDir: string
  getWindow: () => BrowserWindow | undefined
  onInstallRequested: () => void
  onStatus: (status: DesktopUpdateStatus) => void
  updateBaseUrl?: string
  writeLog: (level: 'info' | 'error', message: string) => void
}

const defaultPreferences: DesktopUpdatePreferences = { automaticCheck: true }
/** Owns the desktop updater boundary, persisted preference, status events, and restart confirmation. */
export class DesktopUpdater {
  private automaticCheck = true
  private initialized = false
  private notifiedRelease = ''
  private phase: DesktopUpdatePhase = 'idle'
  private message: string | undefined
  private releaseName: string | undefined
  private session: IUpdateElectronApp | undefined
  private readonly options: DesktopUpdaterOptions
  private readonly preferencesPath: string

  constructor(options: DesktopUpdaterOptions) {
    this.options = options
    this.preferencesPath = join(options.dataDir, 'desktop-update.json')
  }

  /** Load preferences, bind Electron events, and begin automatic checks when enabled. */
  async initialize(): Promise<DesktopUpdateStatus> {
    if (this.initialized)
      return this.status()
    this.initialized = true
    this.automaticCheck = (await this.readPreferences()).automaticCheck
    this.bindEvents()

    if (!this.supported())
      this.phase = 'unsupported'
    else if (this.automaticCheck)
      this.startUpdateSession()
    else
      this.phase = 'disabled'

    return this.publish()
  }

  /** Return the latest updater state for the renderer. */
  status(): DesktopUpdateStatus {
    return {
      automaticCheck: this.automaticCheck,
      currentVersion: app.getVersion(),
      message: this.message,
      phase: this.phase,
      releaseName: this.releaseName,
    }
  }

  /** Persist and apply the automatic-check preference. */
  async setAutomaticCheck(enabled: boolean): Promise<DesktopUpdateStatus> {
    this.automaticCheck = enabled
    await this.writePreferences({ automaticCheck: enabled })
    if (!this.supported()) {
      this.phase = 'unsupported'
    }
    else if (enabled) {
      this.startUpdateSession()
    }
    else {
      this.session?.stopUpdates()
      this.session = undefined
      if (this.phase !== 'downloaded')
        this.phase = 'disabled'
    }
    return this.publish()
  }

  /** Trigger an explicit update check without enabling future periodic checks. */
  checkNow(): DesktopUpdateStatus {
    if (!this.supported()) {
      this.phase = 'unsupported'
      return this.publish()
    }
    if (this.phase === 'downloaded')
      return this.publish()

    this.phase = 'checking'
    this.message = undefined
    if (this.session) {
      autoUpdater.checkForUpdates()
    }
    else {
      const session = this.startUpdateSession()
      if (!this.automaticCheck) {
        session.stopUpdates()
        this.session = undefined
      }
    }
    return this.publish()
  }

  /** Stop scheduled checks and remove this controller's Electron listeners. */
  dispose(): void {
    this.session?.stopUpdates()
    this.session = undefined
    autoUpdater.removeAllListeners('checking-for-update')
    autoUpdater.removeAllListeners('update-available')
    autoUpdater.removeAllListeners('update-not-available')
    autoUpdater.removeAllListeners('update-downloaded')
    autoUpdater.removeAllListeners('error')
  }

  /** Install an already-downloaded update after the application has shut down cleanly. */
  installDownloadedUpdate(): void {
    autoUpdater.quitAndInstall()
  }

  private supported(): boolean {
    return app.isPackaged && process.platform === 'darwin' && this.options.updateBaseUrl !== undefined
  }

  private startUpdateSession(): IUpdateElectronApp {
    if (this.session)
      return this.session
    this.phase = 'checking'
    this.message = undefined
    const updateBaseUrl = this.options.updateBaseUrl
    if (!updateBaseUrl)
      throw new Error('Desktop updates are not configured for this distribution')
    this.session = updateElectronApp({
      updateInterval: '1 hour',
      updateSource: {
        type: UpdateSourceType.StaticStorage,
        baseUrl: updateBaseUrl,
      },
      logger: {
        error: (...values: unknown[]) => this.options.writeLog('error', values.map(String).join(' ')),
        info: (...values: unknown[]) => this.options.writeLog('info', values.map(String).join(' ')),
        log: (...values: unknown[]) => this.options.writeLog('info', values.map(String).join(' ')),
        warn: (...values: unknown[]) => this.options.writeLog('info', values.map(String).join(' ')),
      },
      notifyUser: false,
    })
    return this.session
  }

  private bindEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.phase = 'checking'
      this.message = undefined
      this.publish()
    })
    autoUpdater.on('update-available', () => {
      this.phase = 'available'
      this.message = undefined
      this.publish()
    })
    autoUpdater.on('update-not-available', () => {
      this.phase = 'up-to-date'
      this.message = undefined
      this.publish()
    })
    autoUpdater.on('error', (error) => {
      this.phase = 'error'
      this.message = error.message
      this.options.writeLog('error', `Updater failed: ${error.message}`)
      this.publish()
    })
    autoUpdater.on('update-downloaded', async (_event, _notes, releaseName) => {
      this.phase = 'downloaded'
      this.releaseName = releaseName
      this.message = undefined
      this.publish()
      if (this.notifiedRelease === releaseName)
        return
      this.notifiedRelease = releaseName
      const prompt = {
        type: 'info' as const,
        title: `${this.options.applicationName} Update`,
        message: `${this.options.applicationName} ${releaseName} is ready to install.`,
        detail: `Restart ${this.options.applicationName} now to apply the downloaded update.`,
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }
      const window = this.options.getWindow()
      const result = window
        ? await dialog.showMessageBox(window, prompt)
        : await dialog.showMessageBox(prompt)
      if (result.response === 0)
        this.options.onInstallRequested()
    })
  }

  private publish(): DesktopUpdateStatus {
    const status = this.status()
    this.options.onStatus(status)
    return status
  }

  private async readPreferences(): Promise<DesktopUpdatePreferences> {
    try {
      const parsed = JSON.parse(await readFile(this.preferencesPath, 'utf8')) as Partial<DesktopUpdatePreferences>
      return { automaticCheck: parsed.automaticCheck !== false }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.options.writeLog('error', `Could not read updater preferences: ${error instanceof Error ? error.message : String(error)}`)
      return defaultPreferences
    }
  }

  private async writePreferences(preferences: DesktopUpdatePreferences): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true })
    await writeFile(this.preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
  }
}
