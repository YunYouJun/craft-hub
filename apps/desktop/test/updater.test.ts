import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { autoUpdater } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopUpdater } from '../src/updater.ts'

const mocks = vi.hoisted(() => ({
  app: {
    exit: vi.fn(),
    getVersion: vi.fn(() => '0.0.1'),
    isPackaged: true,
    whenReady: vi.fn(async () => undefined),
  },
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  updateElectronApp: vi.fn(),
}))

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: mocks.app,
    autoUpdater: Object.assign(new EventEmitter(), {
      checkForUpdates: mocks.checkForUpdates,
      quitAndInstall: mocks.quitAndInstall,
    }),
    dialog: { showMessageBox: mocks.showMessageBox },
  }
})

vi.mock('update-electron-app', () => ({
  updateElectronApp: mocks.updateElectronApp,
  UpdateSourceType: { StaticStorage: 1 },
}))

const nativePlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const hour = 60 * 60 * 1000
const updaterEmitter: NodeJS.EventEmitter = autoUpdater
let dataDir: string
let updaters: DesktopUpdater[]
let stopUpdates: ReturnType<typeof vi.fn>

function createUpdater(updateBaseUrl: string | null = 'https://example.com/releases/darwin-arm64') {
  const onInstallRequested = vi.fn()
  const onStatus = vi.fn()
  const writeLog = vi.fn()
  const updater = new DesktopUpdater({
    applicationName: 'Craft Hub',
    dataDir,
    getWindow: () => undefined,
    onInstallRequested,
    onStatus,
    updateBaseUrl: updateBaseUrl ?? undefined,
    writeLog,
  })
  updaters.push(updater)
  return { updater, onInstallRequested, onStatus, writeLog }
}

function downloaded(releaseName = '0.0.2') {
  autoUpdater.emit('update-downloaded', {}, '', releaseName)
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'craft-hub-updater-'))
  updaters = []
  Object.defineProperty(process, 'platform', { ...nativePlatform, value: 'darwin' })
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.app.isPackaged = true
  mocks.app.whenReady.mockResolvedValue(undefined)
  mocks.showMessageBox.mockResolvedValue({ response: 1 })
  mocks.quitAndInstall.mockReset()
  mocks.checkForUpdates.mockImplementation(() => autoUpdater.emit('checking-for-update'))
  // Model the helper's listener additions, immediate check, and unguarded
  // interval so these tests also detect accidental helper reinitialization.
  mocks.updateElectronApp.mockImplementation(() => {
    autoUpdater.on('error', vi.fn())
    autoUpdater.on('checking-for-update', vi.fn())
    autoUpdater.on('update-available', vi.fn())
    autoUpdater.on('update-not-available', vi.fn())
    mocks.checkForUpdates()
    const timer = setInterval(() => mocks.checkForUpdates(), hour)
    stopUpdates = vi.fn(() => clearInterval(timer))
    return { stopUpdates }
  })
})

afterEach(async () => {
  for (const updater of updaters)
    updater.dispose()
  autoUpdater.removeAllListeners()
  vi.useRealTimers()
  Object.defineProperty(process, 'platform', nativePlatform)
  await rm(dataDir, { force: true, recursive: true })
})

describe('desktop updater checks', () => {
  it('initializes once for concurrent callers and configures the existing static feed', async () => {
    const { updater } = createUpdater()
    const first = updater.initialize()
    const second = updater.initialize()
    expect(second).toBe(first)
    expect(await first).toMatchObject({ automaticCheck: true, currentVersion: '0.0.1', phase: 'checking' })
    await updater.initialize()
    expect(mocks.updateElectronApp).toHaveBeenCalledOnce()
    expect(mocks.updateElectronApp).toHaveBeenCalledWith(expect.objectContaining({
      updateSource: { type: 1, baseUrl: 'https://example.com/releases/darwin-arm64' },
      notifyUser: false,
    }))
    expect(stopUpdates).toHaveBeenCalledOnce()
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it.each(['development', 'linux', 'missing-feed'])('disables native updates for %s distributions', async (distribution) => {
    if (distribution === 'development')
      mocks.app.isPackaged = false
    if (distribution === 'linux')
      Object.defineProperty(process, 'platform', { ...nativePlatform, value: 'linux' })
    const { updater } = createUpdater(distribution === 'missing-feed' ? null : 'https://example.com/releases')
    expect((await updater.initialize()).phase).toBe('unsupported')
    expect(updater.checkNow().phase).toBe('unsupported')
    expect(mocks.updateElectronApp).not.toHaveBeenCalled()
    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
    expect(autoUpdater.listenerCount('update-available')).toBe(0)
  })

  it('uses the default preference and reports malformed persisted preferences', async () => {
    await writeFile(join(dataDir, 'desktop-update.json'), '{invalid', 'utf8')
    const { updater, writeLog } = createUpdater()
    expect((await updater.initialize()).automaticCheck).toBe(true)
    expect(writeLog).toHaveBeenCalledWith('error', expect.stringContaining('Could not read updater preferences'))
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('checks manually while automatic checks are disabled and reuses the same feed afterward', async () => {
    await writeFile(join(dataDir, 'desktop-update.json'), '{"automaticCheck":false}', 'utf8')
    const { updater } = createUpdater()
    expect((await updater.initialize()).phase).toBe('disabled')
    expect(mocks.updateElectronApp).not.toHaveBeenCalled()

    expect(updater.checkNow()).toMatchObject({ automaticCheck: false, phase: 'checking' })
    autoUpdater.emit('update-not-available')
    expect(updater.status().phase).toBe('up-to-date')
    vi.advanceTimersByTime(hour * 2)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()

    updater.checkNow()
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(mocks.updateElectronApp).toHaveBeenCalledOnce()
  })

  it('does not check again while checking or downloading, including scheduled checks', async () => {
    const { updater } = createUpdater()
    await updater.initialize()
    updater.checkNow()
    vi.advanceTimersByTime(hour)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()

    autoUpdater.emit('update-available')
    expect(updater.checkNow().phase).toBe('available')
    vi.advanceTimersByTime(hour)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()

    autoUpdater.emit('update-not-available')
    vi.advanceTimersByTime(hour)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(updater.status().phase).toBe('checking')
  })

  it('preserves a running download when toggling automatic checking without recreating the session', async () => {
    const { updater } = createUpdater()
    await updater.initialize()
    autoUpdater.emit('update-available')

    expect(await updater.setAutomaticCheck(false)).toMatchObject({ automaticCheck: false, phase: 'available' })
    expect(JSON.parse(await readFile(join(dataDir, 'desktop-update.json'), 'utf8'))).toEqual({ automaticCheck: false })
    vi.advanceTimersByTime(hour)
    expect(await updater.setAutomaticCheck(true)).toMatchObject({ automaticCheck: true, phase: 'available' })
    vi.advanceTimersByTime(hour)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
    expect(mocks.updateElectronApp).toHaveBeenCalledOnce()

    downloaded()
    await Promise.resolve()
    expect(await updater.setAutomaticCheck(false)).toMatchObject({ automaticCheck: false, phase: 'downloaded', releaseName: '0.0.2' })
    expect(await updater.setAutomaticCheck(true)).toMatchObject({ automaticCheck: true, phase: 'downloaded', releaseName: '0.0.2' })
    vi.advanceTimersByTime(hour * 2)
    updater.checkNow()
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('preserves an in-flight manual check when automatic checks are disabled', async () => {
    const { updater } = createUpdater()
    await updater.initialize()
    expect((await updater.setAutomaticCheck(false)).phase).toBe('checking')
    autoUpdater.emit('update-not-available')
    vi.advanceTimersByTime(hour)
    expect(updater.status()).toMatchObject({ automaticCheck: false, phase: 'up-to-date' })
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('resumes automatic checking from an idle disabled state', async () => {
    await writeFile(join(dataDir, 'desktop-update.json'), '{"automaticCheck":false}', 'utf8')
    const { updater } = createUpdater()
    await updater.initialize()
    expect((await updater.setAutomaticCheck(true)).phase).toBe('checking')
    autoUpdater.emit('update-not-available')
    vi.advanceTimersByTime(hour)
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(mocks.updateElectronApp).toHaveBeenCalledOnce()
  })

  it('returns initialization errors to the UI and allows retry without leaked helper listeners', async () => {
    const transientListener = vi.fn()
    mocks.updateElectronApp.mockImplementationOnce(() => {
      autoUpdater.on('update-available', transientListener)
      throw new Error('Update feed is invalid')
    })
    const { updater, writeLog } = createUpdater()
    expect(await updater.initialize()).toMatchObject({ phase: 'error', message: 'Update feed is invalid' })
    expect(writeLog).toHaveBeenCalledWith('error', 'Updater failed: Update feed is invalid')
    expect(autoUpdater.listeners('update-available')).not.toContain(transientListener)

    expect(updater.checkNow().phase).toBe('checking')
    expect(mocks.updateElectronApp).toHaveBeenCalledTimes(2)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('retries automatically after the first helper initialization fails', async () => {
    mocks.updateElectronApp.mockImplementationOnce(() => {
      throw new Error('Feed initialization failed')
    })
    const { updater } = createUpdater()
    expect((await updater.initialize()).phase).toBe('error')
    vi.advanceTimersByTime(hour)
    expect(updater.status().phase).toBe('checking')
    expect(mocks.updateElectronApp).toHaveBeenCalledTimes(2)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('clears an in-flight check after synchronous or event errors so the user can retry', async () => {
    const { updater } = createUpdater()
    await updater.initialize()
    autoUpdater.emit('error', new Error('Network unavailable'))
    expect(updater.status()).toMatchObject({ phase: 'error', message: 'Network unavailable' })
    mocks.checkForUpdates.mockImplementationOnce(() => {
      throw new Error('Retry failed')
    })
    expect(updater.checkNow()).toMatchObject({ phase: 'error', message: 'Retry failed' })
    expect(updater.checkNow()).toMatchObject({ phase: 'checking', message: undefined })
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(3)
  })
})

describe('desktop updater installation and lifecycle', () => {
  it('allows restart after Later, requests shutdown once, and installs only after shutdown', async () => {
    const { updater, onInstallRequested } = createUpdater()
    await updater.initialize()
    updater.requestInstall()
    updater.installDownloadedUpdate()
    expect(onInstallRequested).not.toHaveBeenCalled()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()

    downloaded()
    await Promise.resolve()
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(onInstallRequested).not.toHaveBeenCalled()
    expect(updater.requestInstall().phase).toBe('downloaded')
    updater.requestInstall()
    expect(onInstallRequested).toHaveBeenCalledOnce()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()

    updater.dispose()
    updater.installDownloadedUpdate()
    updater.installDownloadedUpdate()
    expect(mocks.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('requests a clean shutdown from Restart and prompts only once for the downloaded release', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    const { updater, onInstallRequested } = createUpdater()
    await updater.initialize()
    downloaded()
    await Promise.resolve()
    downloaded()
    await Promise.resolve()
    expect(onInstallRequested).toHaveBeenCalledOnce()
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
  })

  it('keeps a downloaded update installable if the notification dialog fails', async () => {
    mocks.showMessageBox.mockRejectedValue(new Error('Dialog unavailable'))
    const { updater, onInstallRequested } = createUpdater()
    await updater.initialize()
    downloaded()
    await Promise.resolve()
    expect(updater.status()).toMatchObject({ phase: 'downloaded', releaseName: '0.0.2', message: 'Dialog unavailable' })
    updater.requestInstall()
    expect(onInstallRequested).toHaveBeenCalledOnce()
  })

  it('ignores a pending Restart dialog after disposal', async () => {
    let resolveDialog!: (result: { response: number }) => void
    mocks.showMessageBox.mockImplementationOnce(() => new Promise((resolve) => {
      resolveDialog = resolve
    }))
    const { updater, onInstallRequested } = createUpdater()
    await updater.initialize()
    downloaded()
    updater.dispose()
    resolveDialog({ response: 0 })
    await Promise.resolve()
    expect(onInstallRequested).not.toHaveBeenCalled()
  })

  it('removes its own and helper listeners while preserving other Electron subscribers', async () => {
    const events = ['checking-for-update', 'update-available', 'update-not-available', 'update-downloaded', 'error'] as const
    const foreignListener = vi.fn()
    for (const event of events)
      updaterEmitter.on(event, foreignListener)
    const { updater, onStatus } = createUpdater()
    await updater.initialize()
    const publishedCount = onStatus.mock.calls.length
    updater.dispose()
    updater.dispose()

    for (const event of events) {
      if (event === 'error') {
        expect(autoUpdater.listeners(event)).toHaveLength(2)
        expect(autoUpdater.listeners(event)).toContain(foreignListener)
      }
      else {
        expect(autoUpdater.listeners(event)).toEqual([foreignListener])
      }
    }
    autoUpdater.emit('update-available')
    vi.advanceTimersByTime(hour * 2)
    expect(onStatus).toHaveBeenCalledTimes(publishedCount)
    expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.checkNow().phase).toBe('checking')
  })

  it('handles native errors during shutdown without losing downloaded readiness or contacting the renderer', async () => {
    const { updater, onStatus, writeLog } = createUpdater()
    await updater.initialize()
    downloaded()
    await Promise.resolve()
    updater.dispose()
    const publishedCount = onStatus.mock.calls.length

    expect(() => autoUpdater.emit('error', new Error('Native shutdown error'))).not.toThrow()
    expect(writeLog).toHaveBeenCalledWith('error', 'Updater failed during shutdown: Native shutdown error')
    expect(onStatus).toHaveBeenCalledTimes(publishedCount)
    expect(updater.status().phase).toBe('downloaded')
    expect(mocks.app.exit).not.toHaveBeenCalled()

    updater.installDownloadedUpdate()
    expect(mocks.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('exits if quitAndInstall throws after application resources have closed', async () => {
    const { updater, onStatus, writeLog } = createUpdater()
    await updater.initialize()
    downloaded()
    await Promise.resolve()
    updater.dispose()
    const publishedCount = onStatus.mock.calls.length
    mocks.quitAndInstall.mockImplementationOnce(() => {
      throw new Error('Install invocation failed')
    })

    updater.installDownloadedUpdate()
    expect(writeLog).toHaveBeenCalledWith('error', 'Updater failed: Install invocation failed')
    expect(onStatus).toHaveBeenCalledTimes(publishedCount)
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
    updater.installDownloadedUpdate()
    expect(mocks.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('exits on a native installation error after quitAndInstall starts', async () => {
    const { updater, onStatus, writeLog } = createUpdater()
    await updater.initialize()
    downloaded()
    await Promise.resolve()
    updater.dispose()
    const publishedCount = onStatus.mock.calls.length
    updater.installDownloadedUpdate()

    expect(() => autoUpdater.emit('error', new Error('Native installation failed'))).not.toThrow()
    expect(writeLog).toHaveBeenCalledWith('error', 'Updater failed during shutdown: Native installation failed')
    expect(onStatus).toHaveBeenCalledTimes(publishedCount)
    expect(mocks.app.exit).toHaveBeenCalledWith(1)
  })

  it('does not initialize or bind events after disposal while waiting for Electron readiness', async () => {
    let resolveReady!: () => void
    mocks.app.whenReady.mockImplementationOnce(() => new Promise((resolve) => {
      resolveReady = () => resolve(undefined)
    }))
    const { updater } = createUpdater()
    const initialized = updater.initialize()
    await vi.waitFor(() => expect(mocks.app.whenReady).toHaveBeenCalledOnce())
    updater.dispose()
    resolveReady()
    await initialized
    expect(mocks.updateElectronApp).not.toHaveBeenCalled()
    expect(autoUpdater.listenerCount('update-available')).toBe(0)
  })
})
