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
const updateEvents = ['checking-for-update', 'update-available', 'update-not-available', 'update-downloaded', 'error'] as const
const updateInterval = 60 * 60 * 1000
const updaterEmitter: NodeJS.EventEmitter = autoUpdater

/** Owns the desktop updater boundary, persisted preference, status events, and restart confirmation. */
export class DesktopUpdater {
  private automaticCheck = true
  private initialized = false
  private initialization: Promise<DesktopUpdateStatus> | undefined
  private disposed = false
  private checkInFlight = false
  private installRequested = false
  private installStarted = false
  private notifiedRelease: string | undefined
  private phase: DesktopUpdatePhase = 'idle'
  private message: string | undefined
  private releaseName: string | undefined
  private session: IUpdateElectronApp | undefined
  private scheduledCheck: ReturnType<typeof setInterval> | undefined
  private readonly removeListeners: (() => void)[] = []
  private readonly options: DesktopUpdaterOptions
  private readonly preferencesPath: string

  constructor(options: DesktopUpdaterOptions) {
    this.options = options
    this.preferencesPath = join(options.dataDir, 'desktop-update.json')
  }

  /** Load preferences, bind Electron events, and begin automatic checks when enabled. */
  initialize(): Promise<DesktopUpdateStatus> {
    if (this.initialized || this.disposed)
      return Promise.resolve(this.status())
    this.initialization ??= this.initializeOnce()
    return this.initialization
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

  /** Persist and apply the automatic-check preference without interrupting a download. */
  async setAutomaticCheck(enabled: boolean): Promise<DesktopUpdateStatus> {
    await this.initialize()
    if (this.disposed)
      return this.status()
    await this.writePreferences({ automaticCheck: enabled })
    this.automaticCheck = enabled
    if (!this.supported()) {
      this.phase = 'unsupported'
    }
    else if (enabled) {
      this.checkNow()
      this.scheduleChecks()
    }
    else {
      this.stopScheduledChecks()
      if (!this.checkInFlight && this.phase !== 'downloaded') {
        this.phase = 'disabled'
        this.message = undefined
      }
    }
    return this.publish()
  }

  /** Trigger an explicit update check without enabling future periodic checks. */
  checkNow(): DesktopUpdateStatus {
    if (this.disposed || !this.initialized)
      return this.status()
    if (!this.supported()) {
      this.phase = 'unsupported'
      return this.publish()
    }
    // Electron downloads automatically after update-available. Another check
    // during that download can request the same archive a second time.
    if (this.checkInFlight || this.phase === 'downloaded')
      return this.status()

    this.checkInFlight = true
    this.phase = 'checking'
    this.message = undefined
    this.releaseName = undefined
    try {
      if (this.session)
        autoUpdater.checkForUpdates()
      else
        this.startUpdateSession()
    }
    catch (error) {
      this.reportError(error)
    }
    this.scheduleChecks()
    return this.publish()
  }

  /** Request a clean application shutdown before installing a downloaded update. */
  requestInstall(): DesktopUpdateStatus {
    if (this.disposed || this.phase !== 'downloaded' || this.installRequested)
      return this.status()
    this.installRequested = true
    try {
      this.options.onInstallRequested()
    }
    catch (error) {
      this.installRequested = false
      this.reportError(error)
    }
    return this.status()
  }

  /** Stop scheduled checks and remove session listeners, retaining shutdown error handling. */
  dispose(): void {
    if (this.disposed)
      return
    this.disposed = true
    this.stopScheduledChecks()
    this.session?.stopUpdates()
    this.session = undefined
    for (const remove of this.removeListeners.splice(0))
      remove()
    if (this.supported()) {
      // Native work can finish while other application resources are closing.
      // Keep one error sink until process exit without contacting a renderer.
      autoUpdater.on('error', (error: Error) => {
        this.options.writeLog('error', `Updater failed during shutdown: ${error.message}`)
        if (this.installStarted)
          app.exit(1)
      })
    }
  }

  /** Install a downloaded update after shutdown, including after disposing event listeners. */
  installDownloadedUpdate(): void {
    if (this.phase !== 'downloaded' || this.installStarted || !this.supported())
      return
    this.installStarted = true
    try {
      autoUpdater.quitAndInstall()
    }
    catch (error) {
      this.reportError(error)
      // The caller has already closed windows and application resources.
      app.exit(1)
    }
  }

  private async initializeOnce(): Promise<DesktopUpdateStatus> {
    this.automaticCheck = (await this.readPreferences()).automaticCheck
    if (this.disposed)
      return this.status()
    try {
      if (!this.supported()) {
        this.initialized = true
        this.phase = 'unsupported'
      }
      else {
        // update-electron-app defers setup when Electron is not ready; waiting
        // here ensures its timer can be stopped immediately after creation.
        await app.whenReady()
        if (this.disposed)
          return this.status()
        this.bindEvents()
        this.initialized = true
        if (this.automaticCheck)
          return this.checkNow()
        this.phase = 'disabled'
      }
    }
    catch (error) {
      this.initialized = true
      this.reportError(error)
    }
    return this.publish()
  }

  private supported(): boolean {
    return app.isPackaged && process.platform === 'darwin' && this.options.updateBaseUrl !== undefined
  }

  private scheduleChecks(): void {
    if (this.automaticCheck && this.initialized && this.supported() && !this.scheduledCheck && !this.disposed)
      this.scheduledCheck = setInterval(() => this.checkNow(), updateInterval)
  }

  private stopScheduledChecks(): void {
    if (this.scheduledCheck)
      clearInterval(this.scheduledCheck)
    this.scheduledCheck = undefined
  }

  private startUpdateSession(): void {
    const updateBaseUrl = this.options.updateBaseUrl
    if (!updateBaseUrl)
      throw new Error('Desktop updates are not configured for this distribution')
    const previousListeners = new Map(updateEvents.map(event => [event, new Set(updaterEmitter.listeners(event))]))
    const addedListeners: (() => void)[] = []
    try {
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
      // The helper's timer checks without an in-flight guard. Keep its feed
      // configuration and initial check, and own subsequent checks ourselves.
      this.session.stopUpdates()
    }
    finally {
      for (const event of updateEvents) {
        for (const listener of updaterEmitter.listeners(event)) {
          if (!previousListeners.get(event)?.has(listener))
            addedListeners.push(() => updaterEmitter.removeListener(event, listener))
        }
      }
      if (this.session)
        this.removeListeners.push(...addedListeners)
      else
        addedListeners.forEach(remove => remove())
    }
  }

  private bindEvents(): void {
    const handlers = {
      'checking-for-update': () => {
        if (this.phase === 'downloaded')
          return
        this.checkInFlight = true
        this.phase = 'checking'
        this.message = undefined
        this.publish()
      },
      'update-available': () => {
        if (this.phase === 'downloaded')
          return
        this.checkInFlight = true
        this.phase = 'available'
        this.message = undefined
        this.publish()
      },
      'update-not-available': () => {
        this.checkInFlight = false
        if (this.phase === 'downloaded')
          return
        this.phase = 'up-to-date'
        this.message = undefined
        this.publish()
      },
      'error': (error: Error) => this.reportError(error),
      'update-downloaded': (_event: unknown, _notes: string, releaseName: string) => {
        void this.onDownloaded(releaseName)
      },
    }
    for (const event of updateEvents) {
      const handler = handlers[event]
      updaterEmitter.on(event, handler)
      this.removeListeners.push(() => updaterEmitter.removeListener(event, handler))
    }
  }

  private async onDownloaded(releaseName: string): Promise<void> {
    this.checkInFlight = false
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
    try {
      const window = this.options.getWindow()
      const result = window
        ? await dialog.showMessageBox(window, prompt)
        : await dialog.showMessageBox(prompt)
      if (result.response === 0)
        this.requestInstall()
    }
    catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown): void {
    this.checkInFlight = false
    if (this.phase !== 'downloaded')
      this.phase = 'error'
    this.message = error instanceof Error ? error.message : String(error)
    this.options.writeLog('error', `Updater failed: ${this.message}`)
    this.publish()
  }

  private publish(): DesktopUpdateStatus {
    const status = this.status()
    if (!this.disposed)
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
