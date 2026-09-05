/** Child-process surface required by the development Runtime supervisor. */
export interface DevRuntimeProcess {
  kill: (signal?: NodeJS.Signals) => boolean
  once: ((event: 'error', listener: (error: Error) => void) => this)
    & ((event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void) => this)
}

export interface DevRuntimeCleanExit {
  code: 0
  signal: null
}

export interface DevRuntimeSupervisorOptions {
  onCleanExit?: (exit: DevRuntimeCleanExit) => void
  processName?: string
}

interface RunningRuntime {
  expectedExit: boolean
  exit: Promise<void>
  process: DevRuntimeProcess
}

/** Serialize Runtime replacement so only one successfully built process can own the local port. */
export class DevRuntimeSupervisor {
  private activeRevision = ''
  private running: RunningRuntime | undefined
  private stopped = false
  private tail: Promise<void> = Promise.resolve()

  constructor(
    private readonly launch: () => DevRuntimeProcess,
    private readonly onUnexpectedExit: (error: Error) => void,
    private readonly options: DevRuntimeSupervisorOptions = {},
  ) {}

  /** Start or replace the Runtime after a successful build, ignoring duplicate build notifications. */
  applyBuild(revision: string): Promise<void> {
    if (this.stopped)
      return Promise.reject(new Error('Development Runtime supervisor is stopped'))
    const operation = this.tail.then(async () => {
      if (revision === this.activeRevision)
        return
      await this.stopRunning()
      this.running = this.track(this.launch())
      this.activeRevision = revision
    })
    this.tail = operation.catch(() => {})
    return operation
  }

  /** Stop the current Runtime after every queued replacement has settled. */
  stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    this.stopped = true
    const operation = this.tail.then(() => this.stopRunning(signal))
    this.tail = operation.catch(() => {})
    return operation
  }

  private track(process: DevRuntimeProcess): RunningRuntime {
    const running: RunningRuntime = {
      expectedExit: false,
      exit: Promise.resolve(),
      process,
    }
    running.exit = new Promise<void>((resolve) => {
      let settled = false
      const finish = (error: Error, cleanExit?: DevRuntimeCleanExit): void => {
        if (settled)
          return
        settled = true
        if (!running.expectedExit) {
          if (cleanExit && this.options.onCleanExit)
            this.options.onCleanExit(cleanExit)
          else
            this.onUnexpectedExit(error)
        }
        resolve()
      }
      const processName = this.options.processName ?? 'Development Runtime'
      process.once('error', error => finish(error))
      process.once('exit', (code, signal) => {
        const cleanExit: DevRuntimeCleanExit | undefined = code === 0 && signal === null
          ? { code: 0, signal: null }
          : undefined
        finish(new Error(`${processName} exited with code ${String(code)} and signal ${String(signal)}`), cleanExit)
      })
    })
    return running
  }

  private async stopRunning(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const running = this.running
    if (!running)
      return
    this.running = undefined
    running.expectedExit = true
    running.process.kill(signal)
    await running.exit
  }
}
